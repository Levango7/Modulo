//! meeting/audio.rs —— 音频采集（cpal 0.18.2，AC-15 系统音频 / AC-18 设备异常）。
//!
//! **本机实证（2026-10-15，tests/audio_probe.rs）**，不是推测：
//! - mix format：48000Hz 2ch F32，buffer 固定 480 帧（10ms）
//! - 对输出设备建输入流 = loopback，帧流正常（149 回调/1.5s），静音时出零帧
//! - **直接请求 16kHz 单声道也能过**：WASAPI 共享模式引擎自己转格式
//!   （149×160 = 23835 样本）——所以主路径就是 16k mono 直采，**不需要重采样
//!   依赖**（D-04 就此关闭，见架构文档）。
//! - 兜底：16k 请求被拒的设备走 mix format 采集，Rust 侧降混 + 线性插值重采样
//!   （`audio_resample.rs`）。诚实标注：兜底是简单插值不是窗函数 sinc，
//!   ASR 准确率可能略降——真要更好再引 rubato，那时另开一条偏差登记。
//!
//! 纯函数在 `audio_resample.rs`，错误人话化在 `audio_errors.rs`（300 行纪律）。
//! 本文件留设备枚举、采集会话与背压。

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, StreamConfig};

use super::audio_errors::humanize_cpal_error;
use super::audio_resample::{downmix_to_mono, resample_linear};

/// ASR 目标采样率（SenseVoice 吃 16k）
pub const TARGET_RATE: u32 = 16000;
/// 通道背压水位：32 × 10ms = 320ms 缓冲。满了就丢帧（不阻塞音频回调——
/// 阻塞会直接把 WASAPI 缓冲搞成 xrun，探针里那句 underrun/overrun 就是证据）
const QUEUE_SLOTS: usize = 32;

/// 音源：麦克风 / 系统音频（loopback）
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AudioSource {
    Mic,
    System,
}

/// 一条音频设备（契约 deviceId 用 `id`：cpal DeviceId 的 `host:device` 字符串）
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    /// input / output
    pub kind: &'static str,
}

/// 一帧 16kHz 单声道 PCM（ASR 直接吃）
#[derive(Debug)]
pub struct AudioFrame {
    pub samples: Vec<f32>,
    /// 采集时刻（Unix 毫秒）
    pub ts_ms: u64,
}

/// 采集会话的下游事件。**错误也走这条管道**（设备断开/被占/热插拔），
/// 让上层（session.rs）决定重连与提示——本模块不碰 tauri 事件
#[derive(Debug)]
pub enum AudioEvent {
    Frame(AudioFrame),
    Error(String),
}

/// 采集句柄。`stream` 只是保活（cpal::Stream 是 Send+Sync），drop 即停
pub struct AudioCapture {
    _stream: cpal::Stream,
    rx: Receiver<AudioEvent>,
    dropped: Arc<AtomicUsize>,
}

impl AudioCapture {
    /// 取一帧（阻塞）。队列空时返回 None 表示流已结束（上游 Sender 已释放）
    pub fn recv(&self) -> Option<AudioEvent> {
        self.rx.recv().ok()
    }
    /// 非阻塞取一帧（上层主循环用）
    pub fn try_recv(&self) -> Option<AudioEvent> {
        self.rx.try_recv().ok()
    }
    /// 因背压丢掉的帧数（看得见的丢，不静默）
    pub fn dropped(&self) -> usize {
        self.dropped.load(Ordering::Relaxed)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn device_name(d: &Device) -> String {
    d.description()
        .map(|x| x.name().to_string())
        .unwrap_or_else(|_| "未知设备".to_string())
}

fn to_info(d: &Device, kind: &'static str, default_id: Option<&str>) -> Result<DeviceInfo, String> {
    let id = d.id().map_err(|e| humanize_cpal_error(&e))?.to_string();
    Ok(DeviceInfo {
        is_default: default_id == Some(id.as_str()),
        id,
        name: device_name(d),
        kind,
    })
}

/// 枚举可用麦克风（AC-18 设备选择）
///
/// 命令外壳见 [`audio_devices`] —— 设备枚举本身不碰 tauri，方便单独测。
pub fn list_input_devices() -> Result<Vec<DeviceInfo>, String> {
    let host = cpal::default_host();
    let default_id = host
        .default_input_device()
        .and_then(|d| d.id().ok().map(|i| i.to_string()));
    let mut out = Vec::new();
    for d in host.input_devices().map_err(|e| humanize_cpal_error(&e))? {
        if let Ok(info) = to_info(&d, "input", default_id.as_deref()) {
            out.push(info);
        }
    }
    Ok(out)
}

/// 枚举可用输出设备（系统音频的 loopback 目标）。MVP 通常只用默认输出，
/// 但列出来前端才有的选
pub fn list_output_devices() -> Result<Vec<DeviceInfo>, String> {
    let host = cpal::default_host();
    let default_id = host
        .default_output_device()
        .and_then(|d| d.id().ok().map(|i| i.to_string()));
    let mut out = Vec::new();
    for d in host.output_devices().map_err(|e| humanize_cpal_error(&e))? {
        if let Ok(info) = to_info(&d, "output", default_id.as_deref()) {
            out.push(info);
        }
    }
    Ok(out)
}

/// 契约外新增（D-15）：AC-15 的音源选择要求"可选设备"，但契约里 `meeting_start`
/// 只收 `deviceId`、没有任何列设备的命令，前端无从选起。这里一次给全，用
/// `kind`（input / output）区分，与 `meeting_start.source` 对应。
#[tauri::command]
pub fn audio_devices() -> Result<Vec<DeviceInfo>, String> {
    let mut out = list_input_devices()?;
    match list_output_devices() {
        Ok(v) => out.extend(v),
        // 输出设备枚举失败不该让麦克风也跟着消失（有的机器禁了 loopback）
        Err(e) => eprintln!("[audio] 枚举输出设备失败：{e}"),
    }
    Ok(out)
}

/// 开采集。device_id 为 None 取默认设备；System 音源下 None = 默认输出设备
/// （AC-15 的"系统音频"就是"你在扬声器里听到的"，默认输出即此意）
pub fn open_capture(source: AudioSource, device_id: Option<&str>) -> Result<AudioCapture, String> {
    let host = cpal::default_host();
    let device = pick_device(&host, source, device_id)?;
    // 主路径：直接向引擎要 16k 单声道（本机实测引擎会转；省一个重采样依赖）
    match build_stream(&device, TARGET_RATE, 1) {
        Ok((stream, rx, dropped)) => Ok(AudioCapture {
            _stream: stream,
            rx,
            dropped,
        }),
        Err(primary) => {
            // 兜底：按设备 mix format 采，Rust 侧降混 + 线性插值到 16k。
            // 仍然请求 F32——共享模式下引擎会在 PCM/浮点间转换（探针就是 F32）
            let mix = match source {
                AudioSource::Mic => device.default_input_config(),
                AudioSource::System => device.default_output_config(),
            }
            .map_err(|e| humanize_cpal_error(&e))?;
            build_stream(&device, mix.sample_rate(), mix.channels() as u32)
                .map(|(stream, rx, dropped)| AudioCapture {
                    _stream: stream,
                    rx,
                    dropped,
                })
                .map_err(|fallback| format!("{primary}；回退到设备原生格式也失败：{fallback}"))
        }
    }
}

fn pick_device(
    host: &cpal::Host,
    source: AudioSource,
    device_id: Option<&str>,
) -> Result<Device, String> {
    match device_id {
        None => match source {
            AudioSource::Mic => host.default_input_device(),
            AudioSource::System => host.default_output_device(),
        }
        .ok_or_else(|| match source {
            AudioSource::Mic => "没有可用的麦克风设备".to_string(),
            AudioSource::System => {
                "没有可用的音频输出设备（系统音频需要能播放声音的设备）".to_string()
            }
        }),
        Some(want) => {
            let list: Vec<Device> = match source {
                AudioSource::Mic => host
                    .input_devices()
                    .map_err(|e| humanize_cpal_error(&e))?
                    .collect(),
                AudioSource::System => host
                    .output_devices()
                    .map_err(|e| humanize_cpal_error(&e))?
                    .collect(),
            };
            list.into_iter()
                .find(|d| d.id().map(|i| i.to_string()).unwrap_or_default() == want)
                .ok_or_else(|| "找不到这个音频设备，可能已拔出".to_string())
        }
    }
}

/// 建流：给回调一个固定容量的同步队列，满则丢帧计数（不阻塞音频线程）
fn build_stream(
    device: &Device,
    rate: u32,
    channels: u32,
) -> Result<(cpal::Stream, Receiver<AudioEvent>, Arc<AtomicUsize>), String> {
    let config = StreamConfig {
        channels: channels as u16,
        sample_rate: rate,
        buffer_size: cpal::BufferSize::Default,
    };
    let (tx, rx) = sync_channel::<AudioEvent>(QUEUE_SLOTS);
    let dropped = Arc::new(AtomicUsize::new(0));
    let cb_dropped = Arc::clone(&dropped);
    let cb_rate = rate;
    let cb_channels = channels;
    // 两个回调各持一份 Sender：move 闭包会把 tx 搬进去，必须先分身
    // （第一版直接把 tx 借给两个闭包，rustc E0382 报了 moved value）
    let tx_frames = tx.clone();
    let tx_errors = tx.clone();
    let stream = device
        .build_input_stream(
            config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // 降到 ASR 目标：多声道取均值 → 非 16k 才插值
                let mono = if cb_channels > 1 {
                    downmix_to_mono(data, cb_channels as usize)
                } else {
                    data.to_vec()
                };
                let samples = if cb_rate == TARGET_RATE {
                    mono
                } else {
                    resample_linear(&mono, cb_rate, TARGET_RATE)
                };
                push_frame(&tx_frames, &cb_dropped, samples);
            },
            move |e| {
                let _ = tx_errors.try_send(AudioEvent::Error(humanize_cpal_error(&e)));
            },
            None,
        )
        .map_err(|e| humanize_cpal_error(&e))?;
    stream.play().map_err(|e| humanize_cpal_error(&e))?;
    Ok((stream, rx, dropped))
}

fn push_frame(tx: &SyncSender<AudioEvent>, dropped: &Arc<AtomicUsize>, samples: Vec<f32>) {
    if samples.is_empty() {
        return;
    }
    let frame = AudioEvent::Frame(AudioFrame {
        samples,
        ts_ms: now_ms(),
    });
    if tx.try_send(frame).is_err() {
        // 下游（ASR）没跟上：丢这一帧而不是堆内存或卡住音频回调
        dropped.fetch_add(1, Ordering::Relaxed);
    }
}
