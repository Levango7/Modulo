//! 速达：把用户收藏的程序 / 文件用系统默认方式打开。
//!
//! ## 边界（与其它"会真的做事"的模块同一套纪律）
//!
//! - **只吃绝对路径与 http(s) URL**：判定在引擎 `launcher.ts`（`kindOf`），前端已经
//!   拦过一道；这里**再判一次**（前端能被 XSS 改，Rust 不能 —— 同 net.rs 的分工）。
//!   裸命令名（`explorer.exe`、`cmd`）一律拒：那会把"打开"变成"执行任意命令"。
//!   UNC（`\\server\share`、`//server/share`）同样拒：打开它要走 SMB，SMB 协商会把
//!   当前用户的 NTLM 凭据发给那台服务器 —— 收藏项被改一次就是一次凭据泄漏，
//!   这是"打开文件"兜不住的代价（F-11）。
//! - **不做 shell 解释**：不经 cmd/powershell，`ShellExecuteW` 是 Windows 打开文件的
//!   标准入口（等价双击）。正因如此，需要管理员权限的目标会弹系统 UAC —— 那是系统的
//!   决定，不是我们代劳（x-hub 用 ShellExecute 的 `runas` 动词静默提权，我们不做：
//!   静默提权意味着一个被改过的收藏项能拿到管理员会话）。
//! - **失败要能分辨**：路径不存在、被关联程序拒绝，`ShellExecuteW` 返回值 ≤ 32；
//!   这里把常见码翻成人话（见 `describe_code`），别让卡片只说"打开失败"。
//!
//! ## 为什么用 FFI 而不是加依赖
//!
//! 与 `net.rs` 的 winhttp 同一条理由：一个函数不值得引入 crate（还要过 ustc 镜像与
//! 供应链审查）。`ShellExecuteW` 的签名很稳定，直接声明即可。

/// ShellExecuteW 的返回值 ≤ 32 表示失败（微软文档的约定）。
#[cfg(windows)]
mod win {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut core::ffi::c_void,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> *mut core::ffi::c_void;
    }

    const SW_SHOWNORMAL: i32 = 1;

    /// 调 ShellExecuteW（verb 固定 `open`）。返回原始句柄值（≤32 视为失败）。
    pub fn shell_execute(target: &str) -> usize {
        let wide = |s: &str| -> Vec<u16> {
            std::ffi::OsStr::new(s)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect()
        };
        let op = wide("open");
        let file = wide(target);
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            ) as usize
        }
    }
}

/// ShellExecuteW 失败码 → 人话。未知码给通用兜底（带原始值，便于排查）。
pub fn describe_code(code: usize) -> String {
    match code {
        0 => "系统内存不足，这次打开被放弃".to_string(),
        2 => "找不到这个文件（路径可能已经变了）".to_string(),
        3 => "找不到这个路径的上级目录".to_string(),
        5 => "访问被拒绝（可能没有权限打开它）".to_string(),
        8 => "系统内存不足".to_string(),
        26 => "共享冲突：文件正被别的程序独占".to_string(),
        27 => "关联的程序不完整或被阻止".to_string(),
        28 => "打开超时".to_string(),
        29 => "这个文件的关联程序被阻止（可能被安全策略拦了）".to_string(),
        30 => "关联程序正忙，稍后再试".to_string(),
        31 => "没有可打开它的关联程序（这类文件系统不知道该用什么打开）".to_string(),
        32 => "只支持绝对路径或 http(s) 链接 —— 裸命令名会被拒（不能把“打开”变成“执行任意命令”）"
            .to_string(),
        other => format!("系统返回错误码 {other}"),
    }
}

/// 目标形状的复核（前端已拦一次；这里是安全边界那一份）。
pub fn shape_ok(target: &str) -> bool {
    let t = target.trim().trim_matches('"');
    if t.is_empty() || t.len() > 500 {
        return false;
    }
    if t.starts_with("http://") || t.starts_with("https://") {
        return true;
    }
    // UNC（`\\server\share` 与 `//server/share`，Windows 两种写法都算）一律拒：
    // 打开 UNC 走 SMB，SMB 协商能把当前用户的 NTLM 凭据发给那台服务器。收藏项一旦
    // 被改（或被 XSS 改），就是一次凭据泄漏 —— 这条面不能靠"用户自己当心"兜底（F-11）。
    if t.starts_with("\\\\") || t.starts_with("//") {
        return false;
    }
    // Windows 盘符 / POSIX 绝对路径
    let bytes = t.as_bytes();
    (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/'))
        || t.starts_with('/')
}

/// 用系统默认方式打开一个目标。成功返回 `Ok(None)`；
/// 失败返回 `Ok(Some(人话))` —— 与 web_probe / fetch_json 同一套"失败也是数据"的语义。
#[tauri::command]
pub fn launch_target(target: String) -> Result<Option<String>, String> {
    if !shape_ok(&target) {
        return Ok(Some(describe_code(32)));
    }
    #[cfg(windows)]
    {
        let code = win::shell_execute(&target);
        if code <= 32 {
            return Ok(Some(describe_code(code)));
        }
        Ok(None)
    }
    #[cfg(not(windows))]
    {
        // 桌面壳目前只有 Windows 产物（bundle targets=nsis）；这一支保编译用
        let _ = describe_code(0);
        Ok(Some("这个平台暂不支持直接打开".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 只认绝对路径与_http_链接() {
        for good in [
            "C:\\Program Files\\App\\app.exe",
            "c:/tools/thing.exe",
            "/usr/bin/thing",
            "https://example.com/x",
            "http://example.com/x",
        ] {
            assert!(shape_ok(good), "{good} 应放行");
        }
        for bad in [
            "",
            "explorer.exe",
            "cmd.exe /c calc",
            "file:///c:/a.txt",
            "javascript:alert(1)",
            "  ",
            // UNC 两种写法都拒（SMB / NTLM 凭据泄漏面，F-11）
            "\\\\server\\share\\a.docx",
            "//server/share/a.docx",
        ] {
            assert!(!shape_ok(bad), "{bad} 应被拒");
        }
    }

    #[test]
    fn 失败码翻成人话且未知码带原值() {
        assert!(describe_code(2).contains("找不到这个文件"));
        assert!(describe_code(32).contains("裸命令名"));
        assert!(describe_code(999).contains("999"));
    }

    /// 目标形状不合法时**不落到 ShellExecute**，只回错误文案（不 panic、不执行）。
    #[test]
    fn 非法目标不会被执行() {
        let r = launch_target("calc.exe".to_string()).unwrap();
        assert!(r.is_some());
    }
}
