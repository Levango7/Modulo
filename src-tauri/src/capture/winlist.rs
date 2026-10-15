//! capture/winlist.rs —— 可预览顶层窗口枚举（windows crate 0.62.2，AC-24）。
//!
//! 契约口径（IPC yaml win_list）：**visible + top-level + non-owned + 有标题**。
//! `is_minimized` 由返回项带出（契约 notes 已声明，schema 同批补齐）——前端
//! 据此对已最小化窗口显示"已最小化"态（AC-26），不去启动预览。
//! `is_protected`（D-12 补）：GetWindowDisplayAffinity 探到的受保护窗口，
//! WGC 对它们只出黑帧——前端据此显示 AC-27 的说明，不猜一块黑是什么。
//! rect 为物理像素（与 shot 口径一致；前端要逻辑坐标自行 × scale_factor）。
//!
//! 为什么不用 windows-capture 的 `Window::enumerate()`：本枚举要的是"契约四条
//! 筛选 + is_minimized + 进程名"，自己枚举口径直白；windows-capture 只留在
//! WGC 捕获管线里（R-03：依赖隔离，升级不外溢）。

use serde::Serialize;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowDisplayAffinity, GetWindowRect, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GW_OWNER, WDA_NONE,
};

/// 一条可预览窗口（返回与契约 win_list 同形，camelCase）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub hwnd: isize,
    pub title: String,
    /// 进程镜像名，如 notepad.exe（取不到给空串，不编）
    pub process: String,
    pub pid: u32,
    /// 屏幕物理像素
    pub rect: WinRect,
    pub is_minimized: bool,
    /// 受保护内容（WDA_MONITOR / WDA_EXCLUDEFROMCAPTURE）：WGC 会出黑帧，
    /// 前端据此显示 AC-27 的说明而不是一块莫名的黑
    pub is_protected: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WinRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// EnumWindows 的收集袋：回调是 extern fn + lparam，没有闭包可关
struct EnumBag {
    items: Vec<WindowInfo>,
}

/// 单个窗口的筛选与采集。**不符合契约四条就当不存在**（不报错——不符合的
/// 窗口本来就不该出现在列表里）。采集出错返回 None，不拖垮整次枚举。
unsafe fn collect_one(hwnd: HWND) -> Option<WindowInfo> {
    // 1. visible
    if !IsWindowVisible(hwnd).as_bool() {
        return None;
    }
    // 2. non-owned：GW_OWNER 拿不到 owner 才是非 owned（有 owner 的是
    //    对话框/弹出附属窗，不属于用户想预览的顶层窗口）
    if !matches!(GetWindow(hwnd, GW_OWNER), Ok(owner) if owner.0.is_null()) {
        return None;
    }
    // 3. 有标题（无标题窗对用户不可辨识，列出来也没法选）
    let len = GetWindowTextLengthW(hwnd);
    if len <= 0 {
        return None;
    }
    let mut buf = vec![0u16; len as usize + 1];
    let copied = GetWindowTextW(hwnd, &mut buf);
    if copied <= 0 {
        return None;
    }
    let title = String::from_utf16_lossy(&buf[..copied as usize]);

    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_err() {
        return None;
    }
    Some(WindowInfo {
        hwnd: hwnd.0 as isize,
        title,
        process: process_image_name(pid),
        pid,
        rect: WinRect {
            x: rect.left,
            y: rect.top,
            w: rect.right - rect.left,
            h: rect.bottom - rect.top,
        },
        is_minimized: IsIconic(hwnd).as_bool(),
        is_protected: display_affinity(hwnd) != WDA_NONE.0,
    })
}

/// 显示亲和性：探测失败（老系统/权限）按不保护处理——帧照出，
/// 最坏是黑帧没说明，好过把正常窗口误标成受保护
fn display_affinity(hwnd: HWND) -> u32 {
    let mut affinity = WDA_NONE.0;
    if unsafe { GetWindowDisplayAffinity(hwnd, &mut affinity) }.is_ok() {
        affinity
    } else {
        WDA_NONE.0
    }
}

/// 全路径取末段镜像名（纯函数，单测直测；`C:\a\b\notepad.exe` → `notepad.exe`）
fn image_tail(path: &str) -> &str {
    path.rsplit(['\\', '/'])
        .find(|s| !s.is_empty())
        .unwrap_or(path)
}

/// 进程镜像名（notepad.exe）。权限不足/进程已退出给空串——前端显示
/// "未知进程"比编一个名字好。PROCESS_QUERY_LIMITED_INFORMATION 足够
/// QueryFullProcessImageNameW 用，不需要 Full 权限
fn process_image_name(pid: u32) -> String {
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buf = [0u16; 260];
        let mut size = buf.len() as u32;
        let name = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut size,
        )
        .ok()
        .map(|()| String::from_utf16_lossy(&buf[..size as usize]));
        let _ = CloseHandle(handle);
        name.map(|n| image_tail(&n).to_string()).unwrap_or_default()
    }
}

/// EnumWindows 回调：装袋，永远续枚举（返回 false 才会停）
unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    let bag = &mut *(lparam.0 as *mut EnumBag);
    if let Some(info) = collect_one(hwnd) {
        bag.items.push(info);
    }
    true.into()
}

/// 枚举当前可预览窗口（契约 win_list）。EnumWindows 本身失败才 Err——
/// 单窗采集失败只是不进列表（collect_one 已消化）
#[tauri::command]
pub fn win_list() -> Result<Vec<WindowInfo>, String> {
    let mut bag = EnumBag { items: Vec::new() };
    unsafe { EnumWindows(Some(enum_proc), LPARAM(&mut bag as *mut EnumBag as isize)) }
        .map_err(|e| format!("枚举系统窗口失败：{e}"))?;
    Ok(bag.items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 进程名只要末段镜像名() {
        assert_eq!(
            image_tail(r"C:\Windows\System32\notepad.exe"),
            "notepad.exe"
        );
        // 尾分隔符不产出空段
        assert_eq!(image_tail(r"C:\Windows\System32\"), "System32");
        // 裸名原样
        assert_eq!(image_tail("bash"), "bash");
        // 空路径回自身（空串），不 panic
        assert_eq!(image_tail(""), "");
        // 混合分隔符
        assert_eq!(image_tail("/usr/bin/chrome"), "chrome");
    }
}
