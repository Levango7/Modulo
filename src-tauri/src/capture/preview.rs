//! capture/preview.rs —— Win 窗口预览（WGC，windows-capture 2.0.1，AC-24..30）。
//!
//! 两命令：`win_preview_start`（起会话）/ `win_preview_stop`（停会话）；枚举在
//! `winlist.rs`，纯函数在 `preview_geom.rs`，错误人话化在 `preview_errors.rs`
//! （300 行纪律）。
//! 帧管线：WGC on_frame_arrived → 等比缩放封顶 → JPEG q80 → Channel<Raw>。
//! 背压（R-04）：handler 持"正在编码"标志，新帧到达直接丢——不排队，延迟不累积。
//!
//! **会话模型（D-12，修订设计文档 §1.1）**：设计原文是"每会话一个 OS 线程 +
//! stop 标志位"，API 实测后改为 `start_free_threaded` + `CaptureControl`：
//! crate 自管捕获线程（自带消息循环），`CaptureControl::stop()` 会 post
//! WM_QUIT 并 join——**静止窗口（无帧到达）也能确定性地停**，标志位方案
//! 要等下一帧才停得了，静止窗口下 stop 命令直接挂死。
//!
//! 三态降级：已最小化（start 人话错误，AC-26）/ 受保护内容（黑帧照出，卡内
//! 说明，AC-27）/ 会话停止（emit win_preview_stopped，reason 词表见契约）。
//! 唤起真窗口是前端经 launcher 的事（AC-28）；本模块不碰 SetParent（AC-30，
//! 连 P1 都不做——预览就是预览，不假装嵌入）。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{IsIconic, IsWindow};
use windows_capture::capture::{
    CaptureControl, Context, GraphicsCaptureApiHandler,
};
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use super::preview_errors::{humanize_start_error, humanize_stop_error};
use super::preview_geom::{clamp_fps, clamp_max_width, fps_interval, scale_dims};

/// JPEG 质量（设计 80；实现日实测再调，先按设计落）
const JPEG_QUALITY: u8 = 80;

/// 会话停止事件（契约 event win_preview_stopped）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStopped {
    pub session: String,
    /// 词表：user / window-closed / error（契约 enum）
    pub reason: String,
}

/// 会话表条目。control 即停凭证（Send，可跨命令线程持有；见 D-12）
struct SessionEntry {
    #[allow(dead_code)]
    hwnd: isize,
    control: CaptureControl<PreviewHandler, String>,
}

fn sessions() -> &'static Mutex<HashMap<String, SessionEntry>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, SessionEntry>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 摘除会话并原样返回。停止/自查/on_closed 三条路径都走它——
/// **谁摘到谁负责善后**（emit + stop），天然防双发
fn take_session(id: &str) -> Option<SessionEntry> {
    sessions().lock().unwrap().remove(id)
}

/// 会话 id：时间戳（纳秒十六进制）。单机单用户，不需要更强唯一性
fn new_session_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("pv-{nanos:x}")
}

// ---- 命令 ----

/// 起预览会话。hwnd 来自 win_list 的返回；fps/max_width 缺省走契约默认档。
/// 已最小化直接人话错误（AC-26：不出黑屏）；受保护窗口**允许**起（设计 §1.2：
/// 黑帧照出非错误，前端靠 win_list 的 isProtected 显示说明）
#[tauri::command]
pub fn win_preview_start(
    app: AppHandle,
    hwnd: isize,
    fps: Option<u8>,
    max_width: Option<u32>,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<String, String> {
    let hwnd = HWND(hwnd as *mut std::ffi::c_void);
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return Err("该窗口已关闭，无法预览".to_string());
    }
    if unsafe { IsIconic(hwnd) }.as_bool() {
        return Err("窗口已最小化，先还原窗口再预览".to_string());
    }
    let fps = clamp_fps(fps.unwrap_or(0));
    let max_width = clamp_max_width(max_width.unwrap_or(0));

    let session = new_session_id();
    // Flags 即构造参数袋（crate 的设定机制：Settings.flags → Context.flags → new()）
    let flags = PreviewFlags {
        app,
        session: session.clone(),
        hwnd: hwnd.0 as isize,
        max_width,
        channel: on_frame,
    };
    let settings = Settings::new(
        Window::from_raw_hwnd(hwnd.0),
        CursorCaptureSettings::Default,
        // Default = 系统默认（画捕获边框）——用户能看到"这个窗口正在被捕获"，
        // 透明比好看重要
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Custom(fps_interval(fps)),
        DirtyRegionSettings::Default,
        // Rgba8 而非设计文档提的 BGRA：image 的 RgbaImage 就是 RGBA 字节序，
        // 让 WGC/crate 做转换，省掉我们逐像素 swap（缩放那一步直接吃）
        ColorFormat::Rgba8,
        flags,
    );
    match PreviewHandler::start_free_threaded(settings) {
        Ok(control) => {
            sessions()
                .lock()
                .unwrap()
                .insert(session.clone(), SessionEntry { hwnd: hwnd.0 as isize, control });
            Ok(session)
        }
        Err(e) => Err(humanize_start_error(&e)),
    }
}

/// 停会话。会话已自行结束（窗口关了/通道断了）时返回人话错误——前端据此
/// 把卡片切到"已结束"态，而不是干等一个永不到来的帧
#[tauri::command]
pub fn win_preview_stop(app: AppHandle, session: String) -> Result<(), String> {
    let Some(entry) = take_session(&session) else {
        return Err("预览会话已结束".to_string());
    };
    entry.control.stop().map_err(humanize_stop_error)?;
    let _ = app.emit(
        "win_preview_stopped",
        PreviewStopped { session, reason: "user".to_string() },
    );
    Ok(())
}

// ---- WGC 帧处理器 ----

/// Flags 袋：一次会话的全部构造参数（随 Settings 传给 new()）
struct PreviewFlags {
    app: AppHandle,
    session: String,
    hwnd: isize,
    max_width: u32,
    channel: Channel<InvokeResponseBody>,
}

/// 帧处理器。所有错误在帧内消化（emit + stop），不从 on_frame_arrived 上抛——
/// 上抛的错误只能从 CaptureControl 的 join 结果里取，没人 wait 就咽了，
/// 前端会对着最后一帧干等（设计 §1.3：错误要变成前端可见的状态）
struct PreviewHandler {
    app: AppHandle,
    session: String,
    hwnd: isize,
    max_width: u32,
    channel: Channel<InvokeResponseBody>,
    /// 背压标志：一帧在编码，后来的帧直接丢（R-04）
    encoding: bool,
}

impl GraphicsCaptureApiHandler for PreviewHandler {
    type Flags = PreviewFlags;
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let f = ctx.flags;
        Ok(Self {
            app: f.app,
            session: f.session,
            hwnd: f.hwnd,
            max_width: f.max_width,
            channel: f.channel,
            encoding: false,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut windows_capture::frame::Frame<'_>,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        // 窗口消失自查：on_closed 不总是触发（有些窗口是"不再产帧"地消失）
        if !unsafe { IsWindow(Some(HWND(self.hwnd as *mut std::ffi::c_void))) }.as_bool() {
            self.finish("window-closed", Some(capture_control));
            return Ok(());
        }
        // 背压：上一帧没编完就丢（R-04，不排队）
        if self.encoding {
            return Ok(());
        }
        let mut buffer = match frame.buffer() {
            Ok(b) => b,
            Err(e) => {
                eprintln!("[modulo] 预览 {} 取帧失败：{e}", self.session);
                self.finish("error", Some(capture_control));
                return Ok(());
            }
        };
        let (w, h) = (buffer.width(), buffer.height());
        if w == 0 || h == 0 {
            return Ok(());
        }
        // 行 padding：外层 buffer 有时带（row_pitch > w*4）。取无 padding 视图
        // 再拷走——image 的 from_raw 要紧密排布，多一字节都不认
        let mut scratch: Vec<u8> = Vec::new();
        let pixels = if buffer.has_padding() {
            buffer.as_nopadding_buffer(&mut scratch).to_vec()
        } else {
            buffer.as_raw_buffer().to_vec()
        };
        let Some(img) = image::RgbaImage::from_raw(w, h, pixels) else {
            return Ok(()); // 脏帧（尺寸对不上），丢
        };
        let (sw, sh) = scale_dims(w, h, self.max_width);
        let img = if (sw, sh) != (w, h) {
            image::imageops::resize(&img, sw, sh, image::imageops::FilterType::Triangle)
        } else {
            img
        };
        let mut jpeg: Vec<u8> = Vec::new();
        self.encoding = true;
        let encoded = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
            .encode(img.as_raw(), sw, sh, image::ExtendedColorType::Rgba8);
        self.encoding = false;
        if let Err(e) = encoded {
            eprintln!("[modulo] 预览 {} 编码失败：{e}", self.session);
            self.finish("error", Some(capture_control));
            return Ok(());
        }
        // 通道关 = 前端没了（卡片移除/窗口关闭）：停会话。emit 归 "user"——
        // 关卡片就是用户意图，词表不添新值（契约 enum 三档）
        if self.channel.send(InvokeResponseBody::Raw(jpeg)).is_err() {
            self.finish("user", Some(capture_control));
        }
        Ok(())
    }

    /// WGC 通知捕获项关闭：会话该结束了（无需再 stop，循环本来就停）
    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.finish("window-closed", None);
        Ok(())
    }
}

impl PreviewHandler {
    /// 收尾：摘会话 →（摘到了才 emit，防与 stop / on_closed 双发）→ 停循环。
    /// control 为 None 表示会话本就该结束（on_closed 路径）
    fn finish(&mut self, reason: &str, control: Option<InternalCaptureControl>) {
        if take_session(&self.session).is_some() {
            let _ = self.app.emit(
                "win_preview_stopped",
                PreviewStopped {
                    session: self.session.clone(),
                    reason: reason.to_string(),
                },
            );
        }
        if let Some(c) = control {
            c.stop();
        }
    }
}
