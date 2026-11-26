//! β2 织布机交付面板：专用子进程与随机回环端口。
//!
//! 这不是通用 HTTP 取数通道：`net.rs` 的 https / 私网拒绝边界原样保留。
//! 这里只启动β1已安装运行时的 `run.py --dashboard`，host 与启动超时来自
//! `net-policy.json` 的 `loomDashboard`，且 host 必须仍是 127.0.0.1。

use serde::Serialize;
use std::fs;
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::{loom, net_policy};

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoomDashboardInfo {
    pub running: bool,
    pub url: Option<String>,
    pub version: Option<String>,
    pub pid: Option<u32>,
}

impl LoomDashboardInfo {
    fn stopped() -> Self {
        Self {
            running: false,
            url: None,
            version: None,
            pid: None,
        }
    }
}

struct DashboardProcess {
    child: Child,
    url: String,
    version: String,
    config: PathBuf,
}

impl DashboardProcess {
    fn info(&self) -> LoomDashboardInfo {
        LoomDashboardInfo {
            running: true,
            url: Some(self.url.clone()),
            version: Some(self.version.clone()),
            pid: Some(self.child.id()),
        }
    }

    fn cleanup_config(&self) {
        let _ = fs::remove_file(&self.config);
    }
}

impl Drop for DashboardProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.cleanup_config();
    }
}

#[derive(Default)]
pub struct LoomDashboardState {
    process: Mutex<Option<DashboardProcess>>,
}

fn lock_error() -> String {
    "交付面板进程锁已损坏，请重启应用后再试".to_string()
}

/// 已退出的子进程不得继续投影成 running；取走时由 Drop 清掉临时配置。
fn reap(slot: &mut Option<DashboardProcess>) -> Result<(), String> {
    let exited = match slot.as_mut() {
        Some(process) => process
            .child
            .try_wait()
            .map_err(|e| format!("读取交付面板进程状态失败：{e}"))?
            .is_some(),
        None => false,
    };
    if exited {
        drop(slot.take());
    }
    Ok(())
}

fn info(slot: &mut Option<DashboardProcess>) -> Result<LoomDashboardInfo, String> {
    reap(slot)?;
    Ok(slot
        .as_ref()
        .map(DashboardProcess::info)
        .unwrap_or_else(LoomDashboardInfo::stopped))
}

fn stop_slot(slot: &mut Option<DashboardProcess>) -> Result<LoomDashboardInfo, String> {
    reap(slot)?;
    if let Some(process) = slot.take() {
        let mut process = process;
        let result = process
            .child
            .kill()
            .map_err(|e| format!("停止交付面板失败：{e}"));
        let _ = process.child.wait();
        drop(process);
        result?;
    }
    Ok(LoomDashboardInfo::stopped())
}

fn reserve_port(host: &str) -> Result<(u16, SocketAddr), String> {
    let ip = host
        .parse::<IpAddr>()
        .map_err(|e| format!("dashboard host 不是 IP 地址：{e}"))?;
    let listener = TcpListener::bind((ip, 0))
        .map_err(|e| format!("给交付面板分配回环端口失败：{e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("读取交付面板端口失败：{e}"))?;
    Ok((addr.port(), addr))
}

fn write_config(path: &Path, host: &str, port: u16) -> Result<(), String> {
    let body = serde_json::json!({
        "admin_api": { "host": host, "port": port }
    });
    let tmp = path.with_extension("tmp");
    fs::write(
        &tmp,
        serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写交付面板配置失败：{e}"))?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("落交付面板配置失败：{e}"));
    }
    Ok(())
}

fn wait_ready(child: &mut Child, addr: SocketAddr, timeout: Duration) -> Result<(), String> {
    let began = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("读取交付面板启动状态失败：{e}"))?
        {
            return Err(format!("交付面板启动后提前退出（{status}）"));
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        if began.elapsed() >= timeout {
            return Err(format!("交付面板启动超过 {} 秒", timeout.as_secs()));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

/// 启动并返回内嵌面板地址。重复调用只复用活着的进程，不再起第二份 Admin API。
#[tauri::command]
pub fn loom_dashboard_start(app: AppHandle) -> Result<LoomDashboardInfo, String> {
    let state = app.state::<LoomDashboardState>();
    let mut slot = state.process.lock().map_err(|_| lock_error())?;
    if info(&mut slot)?.running {
        return Ok(slot.as_ref().map(DashboardProcess::info).expect("running"));
    }

    let (runtime, version) = loom::current_runtime(&app)?;
    let python = runtime.join("python").join("python.exe");
    let loom_root = runtime.join("loom");
    let run_py = loom_root.join("run.py");
    if !python.is_file() || !run_py.is_file() {
        return Err(format!(
            "运行时 {version} 缺少 dashboard 启动件（python/run.py）：请重新安装"
        ));
    }

    let host = net_policy::loom_dashboard_host();
    if host != "127.0.0.1" {
        return Err(format!("交付面板只允许 127.0.0.1，单源却配置了 {host}"));
    }
    let (port, addr) = reserve_port(host)?;
    let parent = runtime.parent().unwrap_or(runtime.as_path());
    let config = parent.join(format!(".dashboard-{}-{port}.json", std::process::id()));
    write_config(&config, host, port)?;

    let log_path = parent.join(format!(".dashboard-{version}.log"));
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("写交付面板日志失败：{e}"));
    let log = match log {
        Ok(file) => file,
        Err(e) => {
            let _ = fs::remove_file(&config);
            return Err(e);
        }
    };
    let log_err = log.try_clone().map_err(|e| e.to_string());
    let log_err = match log_err {
        Ok(file) => file,
        Err(e) => {
            let _ = fs::remove_file(&config);
            return Err(format!("复制交付面板日志句柄失败：{e}"));
        }
    };

    let child = Command::new(&python)
        .arg("-X")
        .arg("utf8")
        .arg(&run_py)
        .arg("--dashboard")
        .arg("--config")
        .arg(&config)
        .current_dir(&loom_root)
        .env("LOOM_ROOT", &loom_root)
        .env("LOOM_STATE_DIR", runtime.join(".state"))
        .env("LOOM_VERSIONS_DIR", runtime.join(".versions"))
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .spawn();
    let child = match child {
        Ok(child) => child,
        Err(e) => {
            let _ = fs::remove_file(&config);
            return Err(format!("启动交付面板进程失败：{e}"));
        }
    };
    let process = DashboardProcess {
        child,
        url: format!("http://{host}:{port}/"),
        version,
        config,
    };
    let mut process = process;
    if let Err(e) = wait_ready(
        &mut process.child,
        addr,
        net_policy::loom_dashboard_startup_timeout(),
    ) {
        drop(process);
        return Err(format!("{e}；日志见 {}", log_path.display()));
    }
    let answer = process.info();
    *slot = Some(process);
    Ok(answer)
}

#[tauri::command]
pub fn loom_dashboard_status(app: AppHandle) -> Result<LoomDashboardInfo, String> {
    let state = app.state::<LoomDashboardState>();
    let mut slot = state.process.lock().map_err(|_| lock_error())?;
    info(&mut slot)
}

#[tauri::command]
pub fn loom_dashboard_stop(app: AppHandle) -> Result<LoomDashboardInfo, String> {
    let state = app.state::<LoomDashboardState>();
    let mut slot = state.process.lock().map_err(|_| lock_error())?;
    stop_slot(&mut slot)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_process(script: &str) -> DashboardProcess {
        let child = Command::new("python")
            .args(["-I", "-c", script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("测试需要 CI 已安装的 python");
        let config = std::env::temp_dir().join(format!(
            "loom-dashboard-test-{}-{}.json",
            std::process::id(),
            child.id()
        ));
        fs::write(&config, "{}").unwrap();
        DashboardProcess {
            child,
            url: "http://127.0.0.1:8910/".into(),
            version: "test".into(),
            config,
        }
    }

    #[test]
    fn 随机端口来自回环且非零() {
        let (port, addr) = reserve_port("127.0.0.1").unwrap();
        assert!(port > 0);
        assert!(addr.ip().is_loopback());
        assert!(reserve_port("not-an-ip").is_err());
    }

    #[test]
    fn 重复读状态复用同一进程且不假装有第二份() {
        let mut slot = Some(test_process("import time; time.sleep(60)"));
        let first = info(&mut slot).unwrap();
        let second = info(&mut slot).unwrap();
        assert!(first.running);
        assert_eq!(first.pid, second.pid);
        assert_eq!(first.url, second.url);
        stop_slot(&mut slot).unwrap();
        assert!(!info(&mut slot).unwrap().running);
    }

    #[test]
    fn 停止会杀子进程并清配置() {
        let mut slot = Some(test_process("import time; time.sleep(60)"));
        let config = slot.as_ref().unwrap().config.clone();
        assert!(config.exists());
        stop_slot(&mut slot).unwrap();
        assert!(slot.is_none());
        assert!(!config.exists());
    }

    #[test]
    fn 异常退出会被回收而不继续显示运行中() {
        let process = test_process("pass");
        let config = process.config.clone();
        let mut slot = Some(process);
        slot.as_mut().unwrap().child.wait().unwrap();
        assert!(!info(&mut slot).unwrap().running);
        assert!(slot.is_none());
        assert!(!config.exists());
    }
}
