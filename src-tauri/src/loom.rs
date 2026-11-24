//! 织布机（nexusloom）运行时的**安装 / 状态 / 卸载**（β1「可选组件」，用户 2026-11-24 裁决）。
//!
//! 与 ASR 模型下载同一条分工与同一组纪律（`meeting/asr.rs` 是参照）：
//! 下载到 `.part` → sha256 校验 → 解压到 `.staging` → **原子改名**成 `<version>/`。
//! 校验不过就删，**绝不留半个目录**（R-01 的同一口径）。
//!
//! 四条边界（与 β 决策稿一致）：
//! 1. 版本目录名先过守卫（首字符字母数字，其余字母数字与 `._-`，≤32）—— 分隔符与 `..`
//!    天然进不来；清单里的 sha256 必须是 64 位小写 hex。
//! 2. **当前在用的版本不许删**（`loom.json` 指到哪一版，哪一版被钉住）。
//! 3. 失败一律人话，**不静默重试**（与「错过不补跑」同一条纪律）。
//! 4. 不静默改 MCP 配置：本模块只回答「装好了没有、在哪、有哪些版本」，配置由前端生成后让用户自己粘。

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::meeting::asr_models;

const SUBDIR: &str = "loom";
const STATE_FILE: &str = "loom.json";

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct LoomProgress {
    pub stage: String,
    pub received: u64,
    pub total: u64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct LoomState {
    /// 当前在用的版本目录名（`loom.json` 里记的那个）；没装过 = `None`
    pub current: Option<String>,
    /// 运行时根目录（`%APPDATA%/app.modulo/loom`）
    pub root: String,
    /// 盘上现存的版本目录名（升序；临时件 `.part-*` / `.staging-*` 不在内）
    pub versions: Vec<String>,
}

/// 版本目录名守卫：首字符字母或数字，其余字母数字与 `._-`，≤32 字符。
/// 与前端 `LOOM_VERSION_RE` 同一条口径（两处必须一致，别各写各的）。
fn is_valid_version(v: &str) -> bool {
    let b = v.as_bytes();
    if b.is_empty() || b.len() > 32 {
        return false;
    }
    let alnum = |c: u8| c.is_ascii_alphanumeric();
    if !alnum(b[0]) {
        return false;
    }
    b.iter()
        .all(|c| alnum(*c) || matches!(*c, b'.' | b'_' | b'-'))
}

fn valid_sha256(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

fn loom_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("拿不到应用数据目录：{e}"))?;
    Ok(base.join(SUBDIR))
}

/// 读 `loom.json`：没有 / 坏形状 = 没在用任何版本（不抛错，「没装过」是正常态）
fn read_current(root: &Path) -> Option<String> {
    let raw = fs::read_to_string(root.join(STATE_FILE)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("current")?.as_str().map(|s| s.to_string())
}

/// 写 `loom.json`：先写临时件再改名（与状态文件同一条纪律：不留半个文件）
fn write_current(root: &Path, version: &str, sha256: &str) -> Result<(), String> {
    let meta = root.join(STATE_FILE);
    let tmp = root.join(format!("{STATE_FILE}.tmp"));
    let body = serde_json::json!({ "current": version, "sha256": sha256 });
    fs::write(
        &tmp,
        serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写运行时状态失败：{e}"))?;
    fs::rename(&tmp, &meta).map_err(|e| format!("落运行时状态失败：{e}"))?;
    Ok(())
}

fn list_versions(root: &Path) -> Vec<String> {
    let mut out: Vec<String> = fs::read_dir(root)
        .map(|it| {
            it.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| is_valid_version(n))
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

fn state_at(root: &Path) -> LoomState {
    LoomState {
        current: read_current(root),
        root: root.to_string_lossy().to_string(),
        versions: list_versions(root),
    }
}

/// 契约 `loom_runtime_state`：没装过也能答（`current: null, versions: []`），不抛错。
#[tauri::command]
pub fn loom_runtime_state(app: AppHandle) -> Result<LoomState, String> {
    let root = loom_root(&app)?;
    Ok(state_at(&root))
}

/// 契约 `loom_runtime_download`：下载 → sha256 校验 → 解压 → 原子改名。
///
/// **该版本目录已存在就拒收**（不覆盖：那版可能正被 MCP 用着）—— 要重装先 `loom_runtime_remove`。
#[tauri::command]
pub async fn loom_runtime_download(
    app: AppHandle,
    url: String,
    sha256: String,
    version: String,
    on_progress: Channel<LoomProgress>,
) -> Result<LoomState, String> {
    if !is_valid_version(&version) {
        return Err(format!(
            "版本目录名「{version}」不合法（只允许字母数字与 . _ -，≤32 字符）"
        ));
    }
    if !valid_sha256(&sha256) {
        return Err(
            "清单里的 sha256 不是 64 位小写 hex（这是清单本身的问题，不是下载的问题）".into(),
        );
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("运行时地址只认 http(s)（别拿本地路径当下载源）".into());
    }

    let root = loom_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| format!("建运行时目录失败：{e}"))?;
    let dest = root.join(&version);
    if dest.exists() {
        return Err(format!(
            "版本 {version} 已在盘上（{}）—— 要重装请先卸载它，别覆盖一个可能在用的目录",
            dest.display()
        ));
    }

    let part = root.join(format!(".part-{version}.tar.bz2"));
    let staging = root.join(format!(".staging-{version}"));
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    fs::create_dir_all(&staging).map_err(|e| format!("建解压临时目录失败：{e}"))?;

    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败：{e}"))?;
    let mut resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载失败：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败：HTTP {}", resp.status().as_u16()));
    }
    let total = resp.content_length().unwrap_or(0);
    let _ = on_progress.send(LoomProgress {
        stage: "downloading".into(),
        received: 0,
        total,
    });

    let mut file = fs::File::create(&part).map_err(|e| format!("创建临时下载件失败：{e}"))?;
    let mut got: u64 = 0;
    loop {
        let Some(chunk) = resp.chunk().await.map_err(|e| format!("下载中断：{e}"))? else {
            break;
        };
        file.write_all(&chunk)
            .map_err(|e| format!("写下载件失败：{e}"))?;
        got += chunk.len() as u64;
        let _ = on_progress.send(LoomProgress {
            stage: "downloading".into(),
            received: got,
            total,
        });
    }
    drop(file);

    let _ = on_progress.send(LoomProgress {
        stage: "verifying".into(),
        received: got,
        total,
    });
    let actual = asr_models::sha256_file(&part)?;
    if actual != sha256 {
        let _ = fs::remove_file(&part);
        let _ = fs::remove_dir_all(&staging);
        return Err(format!(
            "校验和不一致：期望 {}…，实得 {}… —— 已删掉这份下载件，没装",
            &sha256[..8],
            &actual[..8]
        ));
    }

    let _ = on_progress.send(LoomProgress {
        stage: "extracting".into(),
        received: got,
        total,
    });
    if let Err(e) = asr_models::extract(&part, &staging) {
        let _ = fs::remove_file(&part);
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("解压失败：{e} —— 没装（临时件已清）"));
    }
    fs::rename(&staging, &dest).map_err(|e| format!("安装失败（改名）：{e}"))?;
    let _ = fs::remove_file(&part);
    // 校验记录随版本目录走：之后切回这一版时要用它（别处的 `loom.json` 只记当前那一版）。
    fs::write(dest.join("SHA256"), &sha256).map_err(|e| format!("写校验记录失败：{e}"))?;
    write_current(&root, &version, &sha256)?;
    Ok(state_at(&root))
}

/// 切版本的纯实现（与 AppHandle 无关，便于在测试壳里直接调）。
fn use_version(root: &Path, version: &str) -> Result<(), String> {
    if !is_valid_version(version) {
        return Err(format!("版本目录名「{version}」不合法"));
    }
    let dest = root.join(version);
    if !dest.is_dir() {
        return Err(format!(
            "{version} 还没装（{}）—— 先装它，再切过去",
            dest.display()
        ));
    }
    let sha = fs::read_to_string(dest.join("SHA256")).map_err(|_| {
        format!("{version} 没有校验记录（SHA256 文件缺失）—— 这版不是按 β1 装的，不能拿来切")
    })?;
    let sha = sha.trim().to_string();
    if !valid_sha256(&sha) {
        return Err(format!(
            "{version} 的校验记录不是 64 位小写 hex（SHA256 文件被改过？）"
        ));
    }
    write_current(root, version, &sha)
}

/// 契约 `loom_runtime_use`：把当前指针切到**已经装好**的某一版（回退 / 前进同一条路）。
/// 校验记录从该版本目录里的 `SHA256` 读回来 —— 那是安装时写下的，不是现在现算的。
#[tauri::command]
pub fn loom_runtime_use(app: AppHandle, version: String) -> Result<LoomState, String> {
    let root = loom_root(&app)?;
    use_version(&root, &version)?;
    Ok(state_at(&root))
}

/// 契约 `loom_runtime_remove`：当前在用的版本不许删；不存在的版本也不许装成删了。
#[tauri::command]
pub fn loom_runtime_remove(app: AppHandle, version: String) -> Result<LoomState, String> {
    if !is_valid_version(&version) {
        return Err(format!("版本目录名「{version}」不合法"));
    }
    let root = loom_root(&app)?;
    let current = read_current(&root);
    if current.as_deref() == Some(version.as_str()) {
        return Err(format!(
            "{version} 是当前在用的版本 —— 先切到别的版本（或先卸载全部）再删"
        ));
    }
    let dest = root.join(&version);
    if !dest.is_dir() {
        return Err(format!(
            "{version} 不在盘上（{}）—— 没什么可删的",
            dest.display()
        ));
    }
    fs::remove_dir_all(&dest).map_err(|e| format!("删除失败：{e}"))?;
    Ok(state_at(&root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 版本名守卫_分隔符与点点与超长一律拒() {
        for bad in ["..", "a/b", "a\\b", ".hidden", "", "a/b/c"] {
            assert!(!is_valid_version(bad), "{bad} 不该过");
        }
        assert!(!is_valid_version(&"a".repeat(33)));
        for good in ["v0.1.0", "v0.1.0-rc.1", "a", "A0_-."] {
            assert!(is_valid_version(good), "{good} 该过");
        }
    }

    #[test]
    fn sha256_只认64位小写hex() {
        assert!(valid_sha256(&"a".repeat(64)));
        assert!(valid_sha256(&"0123456789abcdef".repeat(4)));
        assert!(!valid_sha256(&"a".repeat(63)));
        assert!(!valid_sha256(&"A".repeat(64)));
        assert!(!valid_sha256(&"z".repeat(64)));
    }

    #[test]
    fn 状态文件_写了能读回来_且改名是原子的() {
        let root = std::env::temp_dir().join(format!("loom-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        assert_eq!(read_current(&root), None);
        write_current(&root, "v0.1.0", &"a".repeat(64)).unwrap();
        assert_eq!(read_current(&root).as_deref(), Some("v0.1.0"));
        // 写完没有残留临时件
        assert!(!root.join(format!("{STATE_FILE}.tmp")).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 版本列表_临时件不算安装() {
        let root = std::env::temp_dir().join(format!("loom-ls-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(root.join("v0.0.9")).unwrap();
        fs::create_dir_all(root.join("v0.1.0")).unwrap();
        fs::create_dir_all(root.join(".staging-x")).unwrap();
        fs::write(root.join(".part-x.tar.bz2"), b"x").unwrap();
        fs::write(root.join("notes.txt"), b"x").unwrap();
        let st = state_at(&root);
        assert_eq!(
            st.versions,
            vec!["v0.0.9".to_string(), "v0.1.0".to_string()]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn 切版本_要有目录与校验记录_否则不许切() {
        let root = std::env::temp_dir().join(format!("loom-use-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        // 没装过 ⇒ 不能切
        assert!(use_version(&root, "v0.1.0").is_err());
        fs::create_dir_all(root.join("v0.1.0")).unwrap();
        // 有目录但没校验记录 ⇒ 不能切
        assert!(use_version(&root, "v0.1.0").is_err());
        fs::write(root.join("v0.1.0").join("SHA256"), "a".repeat(64)).unwrap();
        use_version(&root, "v0.1.0").unwrap();
        assert_eq!(read_current(&root).as_deref(), Some("v0.1.0"));
        let _ = fs::remove_dir_all(&root);
    }
}
