//! capture/preview_errors.rs —— 预览管线错误人话化（300 行纪律拆出）。
//!
//! 同 ai/protocol.rs 纪律：**不抛原始堆栈**。windows-capture 的错误 enum 是给
//! 开发者看的（FailedToInitWinRT 之流），前端要的是人话 + 下一步动作。
//! 两支错误的来源：`win_preview_start` 的启动失败（GraphicsCaptureApiError）
//! 与 `win_preview_stop` 的停止失败（CaptureControlError）。

use windows_capture::capture::{CaptureControlError, GraphicsCaptureApiError};

/// 启动失败人话化。注意 NewHandlerError / FrameHandlerError 两支的载荷就是
/// 我们自己塞的 String（本来就是人话），原样透出，别二次包装
pub fn humanize_start_error(e: &GraphicsCaptureApiError<String>) -> String {
    use windows_capture::capture::GraphicsCaptureApiError as E;
    match e {
        // 窗口在枚举与启动之间消失，或根本不是可捕获项
        E::ItemConvertFailed => "该窗口无法捕获（可能已关闭，或不是可捕获的窗口）".to_string(),
        E::NewHandlerError(msg) | E::FrameHandlerError(msg) => msg.clone(),
        E::DirectXError(_) | E::GraphicsCaptureApiError(_) => {
            "显卡捕获通道出错，稍后再试".to_string()
        }
        E::FailedToInitWinRT
        | E::FailedToCreateDispatcherQueueController
        | E::FailedToStartCaptureThread
        | E::FailedToRunMessageLoop => "系统捕获组件启动失败，重启应用再试".to_string(),
        _ => format!("预览启动失败：{e}"),
    }
}

/// 停止失败人话化。stop() 是 post WM_QUIT + join：消息发不出去说明线程卡死，
/// join 失败说明线程崩了——两者都让用户稍后再试，不教用户重启任务管理器
pub fn humanize_stop_error(e: CaptureControlError<String>) -> String {
    use windows_capture::capture::CaptureControlError as E;
    match e {
        E::FailedToPostThreadMessage => "停止预览失败：捕获线程无响应，稍后再试".to_string(),
        E::FailedToJoinThread => "停止预览失败：捕获线程收尾出错".to_string(),
        _ => format!("停止预览失败：{e}"),
    }
}
