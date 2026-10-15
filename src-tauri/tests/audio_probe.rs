//! 桌面探针：cpal 0.18.2 在本机的音频采集实证（D-03 运行期核验）。
//!
//! 源码级核验（D-03）已确认 cpal 对输出设备建输入流即 loopback
//! （自动加 AUDCLNT_STREAMFLAGS_LOOPBACK），但**没在这台机器上真采过帧就不算数**。
//! 本探针一次运行回答四个问题：
//! 1. 输入/输出设备枚举是否正常，mix format 到底是什么（率/声道/格式）？
//! 2. loopback 按 mix format 采集：回调到底来不来？来多少？（静音时也来？）
//! 3. 直接请求 16kHz 单声道能不能过（能过就省一个重采样器，D-04 的实证答案）？
//! 4. 采到的内容非零吗（RMS）？
//!
//! 默认 `#[ignore]` + `MODULO_AUDIO_PROBE=1` 双开关（CI 无音频设备，也不该跑）：
//!
//! ```text
//! MODULO_AUDIO_PROBE=1 cargo test --test audio_probe -- --ignored --nocapture
//! ```
//!
//! 探针用 cpal 裸 API，不依赖 meeting/audio.rs——**先证机制，再写实现**。

use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Data, SampleFormat, StreamConfig};

#[derive(Default)]
struct ProbeStats {
    callbacks: usize,
    samples: usize,
    non_zero: usize,
    sum_sq: f64,
}

impl ProbeStats {
    fn rms(&self) -> f64 {
        if self.samples == 0 {
            0.0
        } else {
            (self.sum_sq / self.samples as f64).sqrt()
        }
    }
}

fn accumulate(stats: &Arc<Mutex<ProbeStats>>, samples: &[f32]) {
    let mut s = stats.lock().unwrap();
    s.samples += samples.len();
    for &v in samples {
        if v != 0.0 {
            s.non_zero += 1;
        }
        s.sum_sq += (v as f64) * (v as f64);
    }
}

/// cpal 0.18.2 口径：`SampleRate` 就是 `u32` 的类型别名（不是元组结构），
/// `buffer_size()` 返回引用。照着写才不会踩 0.15→0.18 的 API churn
fn describe_config(cfg: &cpal::SupportedStreamConfig) -> String {
    format!(
        "{}Hz {}ch {:?} (buffer {:?})",
        cfg.sample_rate(),
        cfg.channels(),
        cfg.sample_format(),
        cfg.buffer_size(),
    )
}

/// 设备名走 `description().name()`（0.18 已无 `Device::name()`）
fn device_name(device: &cpal::Device) -> String {
    device
        .description()
        .map(|d| d.name().to_string())
        .unwrap_or_else(|_| "?".to_string())
}

/// 采 1.5 秒，把统计回传。format 用调用方给定的采样格式（mix format 的或试采的）
fn capture_round(
    device: &cpal::Device,
    config: StreamConfig,
    sample_format: SampleFormat,
    label: &str,
) -> Result<ProbeStats, String> {
    let stats = Arc::new(Mutex::new(ProbeStats::default()));
    let errors: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

    let label = label.to_string(); // 闭包要 'static：&str 借不出去，转成自有 String
    let cb_stats = Arc::clone(&stats);
    let cb_label = label.clone();
    let stream = device
        .build_input_stream_raw(
            config,
            sample_format,
            move |data: &Data, _: &cpal::InputCallbackInfo| {
                cb_stats.lock().unwrap().callbacks += 1;
                match data.sample_format() {
                    SampleFormat::F32 => {
                        if let Some(s) = data.as_slice::<f32>() {
                            accumulate(&cb_stats, s);
                        }
                    }
                    SampleFormat::I16 => {
                        if let Some(s) = data.as_slice::<i16>() {
                            let f: Vec<f32> = s.iter().map(|&v| v as f32 / 32768.0).collect();
                            accumulate(&cb_stats, &f);
                        }
                    }
                    SampleFormat::U16 => {
                        if let Some(s) = data.as_slice::<u16>() {
                            let f: Vec<f32> = s.iter().map(|&v| v as f32 / 65536.0).collect();
                            accumulate(&cb_stats, &f);
                        }
                    }
                    other => {
                        // 不认识的格式不当错误：callbacks 计数照走，音频.rs 实现时
                        // 必须覆盖这三种常见格式（F32/I16/U16），探针先报出来
                        eprintln!("[probe] {cb_label}: 未处理的采样格式 {other:?}");
                    }
                }
            },
            {
                let errors = Arc::clone(&errors);
                let err_label = label.clone();
                move |e| {
                    eprintln!("[probe] {err_label}: 流错误 {e}");
                    errors.lock().unwrap().push(e.to_string());
                }
            },
            None,
        )
        .map_err(|e| format!("建输入流失败：{e}"))?;
    stream.play().map_err(|e| format!("play 失败：{e}"))?;
    std::thread::sleep(Duration::from_millis(1500));
    drop(stream);

    let s = stats.lock().unwrap();
    let errs = errors.lock().unwrap();
    println!(
        "[probe] {label}: callbacks={} samples={} non_zero={} rms={:.6} errors={}",
        s.callbacks,
        s.samples,
        s.non_zero,
        s.rms(),
        errs.len()
    );
    Ok(ProbeStats {
        callbacks: s.callbacks,
        samples: s.samples,
        non_zero: s.non_zero,
        sum_sq: s.sum_sq,
    })
}

#[test]
#[ignore = "桌面探针：需要真实音频设备。本机跑：MODULO_AUDIO_PROBE=1 cargo test --test audio_probe -- --ignored --nocapture"]
fn probe_loopback_and_devices() {
    if std::env::var("MODULO_AUDIO_PROBE").is_err() {
        println!("[probe] 未设 MODULO_AUDIO_PROBE=1，跳过（双开关设计）");
        return;
    }
    let host = cpal::default_host();

    // 1. 输入设备（麦克风路径）
    println!("[probe] === 输入设备 ===");
    match host.input_devices() {
        Ok(devices) => {
            for (i, d) in devices.enumerate() {
                let name = device_name(&d);
                let cfg = d
                    .default_input_config()
                    .map(|c| describe_config(&c))
                    .unwrap_or_else(|e| format!("默认输入配置不可用：{e}"));
                println!("[probe]   in[{i}] {name} — {cfg}");
            }
        }
        Err(e) => println!("[probe]   枚举输入设备失败：{e}"),
    }

    // 2. 输出设备 + mix format（loopback 的真相来源）
    println!("[probe] === 输出设备（mix format）===");
    match host.output_devices() {
        Ok(devices) => {
            for (i, d) in devices.enumerate() {
                let name = device_name(&d);
                let cfg = d
                    .default_output_config()
                    .map(|c| describe_config(&c))
                    .unwrap_or_else(|e| format!("mix format 不可用：{e}"));
                println!("[probe]   out[{i}] {name} — {cfg}");
            }
        }
        Err(e) => println!("[probe]   枚举输出设备失败：{e}"),
    }

    let Some(device) = host.default_output_device() else {
        panic!("[probe] 没有默认输出设备，loopback 无从谈起");
    };
    let name = device_name(&device);
    let mix = device
        .default_output_config()
        .map_err(|e| format!("默认输出设备 {name} 拿不到 mix format：{e}"))
        .unwrap();
    println!("[probe] === loopback 目标：{name} — {} ===", describe_config(&mix));

    // 3. loopback @ mix format（audio.rs 将来要走的路）
    let mix_stats = capture_round(
        &device,
        StreamConfig::from(mix.clone()),
        mix.sample_format(),
        "loopback@mix",
    )
    .expect("[probe] loopback mix format 采集失败");
    // 断言只钉"帧到没到"——内容静音是环境问题，帧不来是机制问题（D-03 的本体）
    assert!(
        mix_stats.callbacks >= 5,
        "[probe] 1.5 秒只收到 {} 个回调，loopback 帧流没建起来",
        mix_stats.callbacks
    );
    assert!(
        mix_stats.samples > 0,
        "[probe] 一个样本都没收到，loopback 是空的"
    );

    // 4. 直接请求 16kHz 单声道（D-04 实证：能过就省重采样器）
    let mut cfg16 = StreamConfig::from(mix.clone());
    cfg16.channels = 1;
    cfg16.sample_rate = 16000; // SampleRate 是 u32 别名，别写成元组构造
    cfg16.buffer_size = cpal::BufferSize::Default;
    match capture_round(&device, cfg16, SampleFormat::F32, "loopback@16k-mono") {
        Ok(s) => println!(
            "[probe] 16k 单声道直采结果：callbacks={} samples={}（非零即说明引擎真的转了）",
            s.callbacks, s.samples
        ),
        Err(e) => println!("[probe] 16k 单声道直采不可用：{e}"),
    }

    println!(
        "[probe] 结论：mix format = {}Hz {}ch {:?}；loopback 帧流{}",
        mix.sample_rate(),
        mix.channels(),
        mix.sample_format(),
        if mix_stats.non_zero > 0 { "有非零内容" } else { "全零（本机静音中，帧流本身正常）" }
    );
}
