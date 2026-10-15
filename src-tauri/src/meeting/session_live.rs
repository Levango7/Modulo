//! meeting/session_live.rs —— 会话状态机本体（struct + 转写线程）。
//!
//! **为什么单独成文件**：`session.rs` 加上状态机后 309 行，顶穿 300 行纪律，
//! 按 D-01/D-02 的手法拆出。命令外壳与契约映射留在 `session.rs`，
//! 这里只管「一个会话怎么活着」。
//!
//! 暂停/恢复不是"流暂停"，而是「丢采集句柄 → join 线程 → 收回引擎 → 重新开」：
//! cpal 流暂停再启容易 xrun，而且引擎必须跟着停，否则 VAD 会把暂停期间的静音
//! 当成一段话吐出来。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

use super::asr_engine::{AsrEngine, Utterance};
use super::audio::{self, AudioCapture, AudioSource};

/// live 转写段事件（D-15）
const EVENT_SEGMENT: &str = "minutes_segment";
/// 采集出错事件：设备被拔/被占。前端据此提示，重连由用户点"继续"触发。
const EVENT_ERROR: &str = "minutes_error";

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 一个进行中的会话
pub struct Session {
    pub id: String,
    pub source: AudioSource,
    pub device_id: Option<String>,
    pub started_ms: u64,
    /// 暂停起点；`None` = 正在录
    pub paused_at_ms: Option<u64>,
    /// 累计暂停时长，算 duration 时要扣掉
    pub paused_total_ms: u64,
    /// 采集句柄：**drop 即停**，转写线程因此收到流结束信号
    pub capture: Option<AudioCapture>,
    /// 引擎在暂停期间寄存在这里（线程退出时交回）
    pub engine: Option<AsrEngine>,
    pub worker: Option<JoinHandle<(AsrEngine, Vec<Utterance>)>>,
    /// 已完成的段（含历次暂停前攒下的）
    pub segments: Vec<Utterance>,
}

pub fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static S: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 转写线程：吃帧 → VAD 断句 → 转写 → emit。
/// 流结束（采集句柄被 drop）后 flush 尾巴，把引擎一并交回，供 resume 复用。
pub fn run_worker(
    app: AppHandle,
    mut engine: AsrEngine,
    capture: AudioCapture,
) -> (AsrEngine, Vec<Utterance>) {
    let mut out = Vec::new();
    while let Some(ev) = capture.recv() {
        match ev {
            audio::AudioEvent::Frame(frame) => {
                for u in engine.push(&frame.samples) {
                    let _ = app.emit(EVENT_SEGMENT, &u);
                    out.push(u);
                }
            }
            audio::AudioEvent::Error(e) => {
                // 设备没了：把已有段落留着，让上层决定怎么办（stop 仍会落盘）
                let _ = app.emit(EVENT_ERROR, e);
                break;
            }
        }
    }
    for u in engine.flush() {
        let _ = app.emit(EVENT_SEGMENT, &u);
        out.push(u);
    }
    (engine, out)
}

/// 结束当前采集段：drop 句柄 → join 线程 → 收回引擎与本轮段落。
/// 返回 `None` 表示本来就没在录。
pub fn take_worker(s: &mut Session) -> Option<(AsrEngine, Vec<Utterance>)> {
    s.capture.take();
    let h = s.worker.take()?;
    // 线程 panic 时返回 None：引擎已随线程销毁，只能重开一场
    h.join().ok()
}
