//! 系统监控：CPU / 内存 / 磁盘 / 网卡计数器。
//!
//! 取数用 `sysinfo`（跨平台）；这里只负责把结果整理成卡片要的形状。
//! 两条设计约束：
//!
//! 1. **`System` 是常驻状态，不是每次新建。** CPU 占用率是"两次采样之间的差值"，
//!    每次调用都 `System::new()` 永远拿到 0；网卡速率同理要靠前后两次的计数器差。
//!    常驻 + 卡片每 2 秒来一次，第二次调用起就是真实值（第一次的 CPU 显示 0，
//!    前端把它当"采样中"如实显示，不冒充）。
//! 2. **只回原始计数，不算速率。** 网卡回累计收发字节数，速率（B/s）由前端用
//!    相邻两次采样自算 —— 那是纯函数（引擎 `sysmon.ts` 可单测），Rust 侧少一份
//!    "上次采样时刻"的状态要解释。

use std::sync::Mutex;

use sysinfo::{Disks, Networks, System};

/// 一次系统采样。序列化给前端。
#[derive(serde::Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SysStats {
    /// 全局 CPU 占用率（0–100）。首次采样恒为 0（见文件头约束 1），前端显示「采样中」
    pub cpu_percent: f32,
    /// 已用内存（字节）
    pub mem_used: u64,
    /// 总内存（字节）
    pub mem_total: u64,
    /// 各挂载点：名字（Windows 上是盘符如 `C:\`）与已用/总量（字节）
    pub disks: Vec<DiskInfo>,
    /// 全部网卡**累计**收发的字节数。速率由前端差分（`netRate`），这里不给单速值
    pub net_rx_total: u64,
    pub net_tx_total: u64,
}

#[derive(serde::Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub mount: String,
    pub used: u64,
    pub total: u64,
}

/// 常驻系统状态。`System` 的 CPU/内存刷新都作用在它上面。
static SYS: Mutex<Option<System>> = Mutex::new(None);

/// 采一次。不失败 —— 这张卡只在桌面壳里被调用，任何字段拿不到都是 0/空表，
/// 前端对 0 的解释是「采样中/不可用」，比一个 Err 诚实。
#[tauri::command]
pub fn sys_stats() -> SysStats {
    let mut guard = SYS.lock().unwrap();
    let sys = guard.get_or_insert_with(System::new);

    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let cpu_percent = sys.global_cpu_usage();
    let mem_used = sys.used_memory();
    let mem_total = sys.total_memory();

    let mut disks = Vec::new();
    for d in Disks::new_with_refreshed_list().list() {
        let total = d.total_space();
        let avail = d.available_space();
        // 某些卷（空光驱/未挂载）总量为 0 —— 除零的源头，跳过而不是给前端一个 NaN 比例
        if total == 0 || avail > total {
            continue;
        }
        disks.push(DiskInfo {
            mount: d.mount_point().to_string_lossy().into_owned(),
            used: total - avail,
            total,
        });
    }

    let mut net_rx_total = 0u64;
    let mut net_tx_total = 0u64;
    for data in Networks::new_with_refreshed_list().list().values() {
        net_rx_total += data.received();
        net_tx_total += data.transmitted();
    }

    SysStats {
        cpu_percent,
        mem_used,
        mem_total,
        disks,
        net_rx_total,
        net_tx_total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 这台机器上最基本的事实：总内存 > 0、内存已用 ≤ 总量。
    /// CPU 首次采样是 0 是设计（见文件头约束 1），不在这里断言具体值。
    #[test]
    fn 采样字段自洽() {
        let s = sys_stats();
        assert!(s.mem_total > 0, "总内存不该是 0");
        assert!(s.mem_used <= s.mem_total, "已用内存不该超过总量");
        assert!(s.cpu_percent >= 0.0 && s.cpu_percent <= 100.0);
    }

    /// 连续两次采样：网卡计数器单调不减（累计值只会涨或持平）。
    #[test]
    fn 网卡计数器单调() {
        let a = sys_stats();
        let b = sys_stats();
        assert!(b.net_rx_total >= a.net_rx_total);
        assert!(b.net_tx_total >= a.net_tx_total);
    }

    /// 磁盘条目里 used ≤ total 且 total > 0（跳过空卷的约束在函数里）。
    #[test]
    fn 磁盘条目自洽() {
        for d in sys_stats().disks {
            assert!(d.total > 0, "{} 总量不该为 0", d.mount);
            assert!(d.used <= d.total, "{} 已用不该超过总量", d.mount);
        }
    }
}
