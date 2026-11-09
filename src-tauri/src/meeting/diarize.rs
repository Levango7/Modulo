//! meeting/diarize.rs —— 说话人分离（D-14b/c/d 接线的引擎侧）。
//!
//! **为什么单独成文件**：`session.rs` 是命令外壳、`session_live.rs` 是会话状态机，
//! 说话人分离的「配置怎么搭 / PCM 怎么读 / 中点归属怎么算 / 事件怎么发」是另一块
//! 独立逻辑，混进哪边都会顶穿 300 行纪律。
//!
//! **波形来源是 PCM 文件不是内存 Vec**（用户 2026-11-09 拍板）：16kHz 单声道 f32
//! 是 64KB/s，1 小时会议 ≈ 230MB 常驻 RSS，而且 `Vec` 几何增长在 realloc 峰值时
//! 是双份 —— 一场长会就能把桌面壳的内存曲线抬到不可解释。文件方案存的时候只握
//! 一个句柄（内存 O(1)），峰值只出现在 `process(&[f32])` 跑的那几分钟（整段读入
//! 是 sherpa 离线批处理 API 的形态决定的，1h ≈ 230MB 瞬时，如实登记；长会议分块
//! 对抗是另一笔）。暂停 = 线程退 = 句柄关，resume 重开同一文件续写；PCM 只在帧
//! 到达时写，`Utterance.start_ms` 也只数喂入的帧，两轴都跳过暂停，是同一条时钟。
//!
//! **对齐规则**：中点归属 —— 转写句的中点落在哪个说话人段，就归哪个说话人。
//! 中点是 VAD 断句的语义中心；重叠比例法会把跨段长句判给占比大但可能没说话的一方。

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::asr_models;
use super::session_store;

/// live 事件名（契约里早有，本批接上发射；事件名不按 yaml 是既定偏差，见 `minutesLive.ts`）。
pub const EVENT_DIARIZED: &str = "meeting_diarized";

/// 采样率口径：与 `audio.rs` / `asr_engine.rs` 一致（16kHz 单声道 f32）。
const SAMPLE_RATE: u64 = 16000;
/// 短于此的 PCM 不跑 diarization（pyannote 对亚秒音频的聚类没有意义，且可能空跑报错）。
const MIN_AUDIO_SEC: f32 = 1.0;

/// diarization 的一段（秒）。直接镜像 sherpa `OfflineSpeakerDiarizationSegment` 的形状。
#[derive(Clone, Copy, Debug)]
pub struct DiarSeg {
    pub start: f32,
    pub end: f32,
    pub speaker: i32,
}

/// 说话人编号口径：diarization 给的是聚类下标（0 基、顺序不定），显示口径是
/// **按出现先后** 1 基编号 —— `spk1` / 「说话人 1」是第一个开口的人。
/// key 沿用 `session_store.rs` 既定约定（`spk{n}` → 「说话人 {n}」，用户可改）。
pub fn speaker_key(idx: usize) -> String {
    format!("spk{}", idx + 1)
}

pub fn speaker_label(idx: usize) -> String {
    format!("说话人 {}", idx + 1)
}

/// `speaker_names` 全量映射（按出现顺序编号）。
pub fn speaker_names(count: usize) -> HashMap<String, String> {
    (0..count)
        .map(|i| (speaker_key(i), speaker_label(i)))
        .collect()
}

/// 按出现先后（先按 start 排序的输入里第一次出现）去重的说话人下标表。
/// 输入必须已按 start 排序（`sort_by_start_time` 的产物）。
pub fn speaker_order(segs: &[DiarSeg]) -> Vec<i32> {
    let mut out = Vec::new();
    for s in segs {
        if !out.contains(&s.speaker) {
            out.push(s.speaker);
        }
    }
    out
}

/// 中点归属纯函数：每句取中点，落入哪个说话人段就返回该段说话人在 `speaker_order`
/// 里的下标；没有任何段覆盖中点（段间缝隙 / 中点在 PCM 范围外）→ `None`。
///
/// 已知边界（如实登记）：一句跨两个说话人段时归中点所在方；diarization 空 → 全 `None`。
pub fn assign_speakers(utterances: &[(u64, u64)], segs: &[DiarSeg]) -> Vec<Option<usize>> {
    let order = speaker_order(segs);
    utterances
        .iter()
        .map(|&(start_ms, end_ms)| {
            let mid_s = (start_ms + (end_ms.saturating_sub(start_ms)) / 2) as f32 / 1000.0;
            segs.iter()
                .find(|s| mid_s >= s.start && mid_s < s.end)
                .and_then(|s| order.iter().position(|&id| id == s.speaker))
        })
        .collect()
}

/// PCM 路径：`<meetings_root>/<id>/audio.pcm`（与 transcript.json 同目录，会话 id 已过 `is_safe_id`）。
pub fn pcm_path(meetings_root: &Path, session_id: &str) -> PathBuf {
    session_store::transcript_path(meetings_root, session_id).with_file_name("audio.pcm")
}

/// 下次 `meeting_start` 时清掉 24h 前的孤儿 PCM（崩溃 / 强杀留下的）。
pub fn prune_stale_pcm(meetings_root: &Path) {
    let Ok(rd) = fs::read_dir(meetings_root) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path().join("audio.pcm");
        if !p.is_file() {
            continue;
        }
        let stale = fs::metadata(&p)
            .and_then(|m| m.modified())
            .map(|t| {
                t.elapsed()
                    .map(|d| d.as_secs() > 24 * 3600)
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        if stale {
            let _ = fs::remove_file(&p);
        }
    }
}

/// diarization 配置。分割模型路径**显式点名 `model.onnx`**：pyannote 归档解压后
/// `model.onnx` 与 `model.int8.onnx` 并存（2026-11-09 实测），`find_ext("onnx")` 按
/// 字典序会误取 int8 那份 —— 转写三件用 `find_ext` 是因为它们的归档里没有这层歧义。
pub fn diar_config(root: &Path) -> Result<sherpa_onnx::OfflineSpeakerDiarizationConfig, String> {
    let seg_model = asr_models::target(root, &asr_models::DIAR_SEG).join("model.onnx");
    if !seg_model.is_file() {
        return Err(format!(
            "说话人分割模型不在该在的位置：{}（模型目录可能坏了）",
            seg_model.display()
        ));
    }
    let emb_model = asr_models::target(root, &asr_models::DIAR_EMB);
    if !emb_model.is_file() {
        return Err(format!(
            "说话人嵌入模型不在该在的位置：{}（模型目录可能坏了）",
            emb_model.display()
        ));
    }
    let mut cfg = sherpa_onnx::OfflineSpeakerDiarizationConfig::default();
    cfg.segmentation.pyannote.model = Some(seg_model.to_string_lossy().into_owned());
    cfg.embedding.model = Some(emb_model.to_string_lossy().into_owned());
    Ok(cfg)
}

/// 把落盘的 PCM 字节还原成 f32 样本。长度不是 4 的整数倍 = 文件坏了（如实说，不猜）。
pub fn pcm_to_samples(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if !bytes.len().is_multiple_of(4) {
        return Err(format!(
            "录音文件长度 {} 不是 4 字节的整数倍（f32 采样），这场的声音还原不了",
            bytes.len()
        ));
    }
    Ok(bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|c| f32::from_le_bytes(*c))
        .collect())
}

/// 跑一遍 diarization 的三种结局：跑成 / 诚实跳过（短或空）/ 失败（带人话）。
enum RunOutcome {
    Done(Vec<DiarSeg>),
    Skip,
    Fail(String),
}

fn run_diarize(pcm: &Path, root: &Path) -> RunOutcome {
    let bytes = match fs::read(pcm) {
        Ok(b) => b,
        Err(e) => return RunOutcome::Fail(format!("录音文件读不出来（{e}），这场先不标说话人")),
    };
    let samples = match pcm_to_samples(&bytes) {
        Ok(s) => s,
        Err(e) => return RunOutcome::Fail(e),
    };
    if samples.len() as f32 / (SAMPLE_RATE as f32) < MIN_AUDIO_SEC {
        return RunOutcome::Skip;
    }
    let cfg = match diar_config(root) {
        Ok(c) => c,
        Err(e) => return RunOutcome::Fail(e),
    };
    let d = match sherpa_onnx::OfflineSpeakerDiarization::create(&cfg) {
        Some(d) => d,
        None => {
            return RunOutcome::Fail(
                "说话人分离引擎初始化失败（模型文件可能坏了），这场先不标说话人".to_string(),
            )
        }
    };
    match d.process(&samples) {
        Some(r) => RunOutcome::Done(
            r.sort_by_start_time()
                .into_iter()
                .map(|s| DiarSeg {
                    start: s.start,
                    end: s.end,
                    speaker: s.speaker,
                })
                .collect(),
        ),
        None => RunOutcome::Fail("说话人分离跑失败了，这场先不标说话人".to_string()),
    }
}

/// 事件载荷（camelCase 与其余事件一致）。`error` 有人话串就是降级信号：
/// transcript 保持现状（speaker 仍 null），前端不必为这一条做什么。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizedSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizedEvent {
    pub session_id: String,
    pub speaker_names: HashMap<String, String>,
    pub segments: Vec<DiarizedSegment>,
    pub error: Option<String>,
}

/// 后台 diarize 的全部流程（`meeting_stop` 里 `thread::spawn` 进来）：
/// 跑分离 → 中点归属回填 transcript → 原子重写 → emit `meeting_diarized` → 删 PCM。
/// 任何失败都只带 error 人话串离场，绝不让它反过来动转写正文。
pub fn run_diarization(
    app: AppHandle,
    meetings_root: PathBuf,
    mut t: session_store::Transcript,
    pcm: PathBuf,
) {
    let models_root = match super::asr::models_root(&app) {
        Ok(r) => r,
        Err(e) => {
            finish(
                &app,
                &pcm,
                DiarizedEvent {
                    session_id: t.id.clone(),
                    speaker_names: HashMap::new(),
                    segments: Vec::new(),
                    error: Some(format!("拿不到模型目录（{e}），这场先不标说话人")),
                },
            );
            return;
        }
    };
    let ev = match run_diarize(&pcm, &models_root) {
        RunOutcome::Skip => DiarizedEvent {
            session_id: t.id.clone(),
            speaker_names: HashMap::new(),
            segments: Vec::new(),
            error: None,
        },
        RunOutcome::Fail(e) => DiarizedEvent {
            session_id: t.id.clone(),
            speaker_names: HashMap::new(),
            segments: Vec::new(),
            error: Some(e),
        },
        RunOutcome::Done(segs) => {
            let order = speaker_order(&segs);
            let assigned = assign_speakers(
                &t.segments
                    .iter()
                    .map(|s| (s.start_ms, s.end_ms))
                    .collect::<Vec<_>>(),
                &segs,
            );
            for (seg, a) in t.segments.iter_mut().zip(assigned) {
                seg.speaker = a.map(speaker_key);
            }
            t.speaker_names = speaker_names(order.len());
            match session_store::write_transcript(&meetings_root, &t) {
                Ok(_) => DiarizedEvent {
                    session_id: t.id.clone(),
                    speaker_names: t.speaker_names.clone(),
                    segments: t
                        .segments
                        .iter()
                        .map(|s| DiarizedSegment {
                            start_ms: s.start_ms,
                            end_ms: s.end_ms,
                            speaker: s.speaker.clone(),
                        })
                        .collect(),
                    error: None,
                },
                Err(e) => DiarizedEvent {
                    session_id: t.id.clone(),
                    speaker_names: HashMap::new(),
                    segments: Vec::new(),
                    error: Some(format!("转写稿写不回去（{e}），说话人没回填上")),
                },
            }
        }
    };
    finish(&app, &pcm, ev);
}

/// 清 PCM + emit，一条不漏的收尾（所有结局都走这里）。
fn finish(app: &AppHandle, pcm: &Path, ev: DiarizedEvent) {
    // PCM 的使命结束了（成功：已回填；失败/跳过：主功能不依赖它）。
    let _ = fs::remove_file(pcm);
    let _ = app.emit(EVENT_DIARIZED, &ev);
}

/// `run_worker` 每帧调用：把采样以 f32 LE 流式 append 进 PCM。
/// 失败只记 stderr 不返回 —— 说话人是可选增强，录不能为它停。
pub fn append_pcm(file: &mut fs::File, samples: &[f32]) {
    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    if let Err(e) = file.write_all(&bytes) {
        eprintln!("[meeting] PCM 写不进去（diarization 将降级）：{e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: f32, end: f32, speaker: i32) -> DiarSeg {
        DiarSeg {
            start,
            end,
            speaker,
        }
    }

    #[test]
    fn 中点归属_跨段取中点所在方_缝隙与越界归_none() {
        let segs = [seg(0.0, 5.0, 0), seg(5.0, 10.0, 1)];
        // 中点 2.5s → spk0；7.5s → spk1
        let out = assign_speakers(&[(0, 5_000), (5_000, 10_000)], &segs);
        assert_eq!(out, vec![Some(0), Some(1)]);
        // 一句跨两段：中点（而非起点）决定归属 —— 起点 4.0s 在 seg0、中点 5.0s 落
        // seg1（右开端边界），这是选实现时不选重叠比例法的理由所在
        let out = assign_speakers(&[(4_000, 6_000)], &segs);
        assert_eq!(out, vec![Some(1)]);
        // 中点落在段间缝隙（diarization 的 min_duration_off 留下的洞）→ None
        let out = assign_speakers(&[(4_900, 5_100)], &[seg(0.0, 4.9, 0), seg(5.2, 10.0, 1)]);
        assert_eq!(out, vec![None]);
        // diarization 空 → 全 None（转写照常，speaker 恒 null）
        let out = assign_speakers(&[(0, 1_000)], &[]);
        assert_eq!(out, vec![None]);
        // 句子为空
        assert!(assign_speakers(&[], &segs).is_empty());
    }

    #[test]
    fn 编号口径_按出现先后_一基() {
        // sherpa 给的聚类下标顺序不定（这里故意乱序）：出现先后决定显示编号
        let segs = [seg(0.0, 5.0, 2), seg(5.0, 10.0, 0), seg(10.0, 12.0, 2)];
        assert_eq!(speaker_order(&segs), vec![2, 0]);
        assert_eq!(speaker_key(0), "spk1");
        assert_eq!(speaker_label(0), "说话人 1");
        assert_eq!(speaker_label(1), "说话人 2");
        let names = speaker_names(2);
        assert_eq!(names.get("spk1").map(String::as_str), Some("说话人 1"));
        assert_eq!(names.get("spk2").map(String::as_str), Some("说话人 2"));
    }

    #[test]
    fn pcm_字节往返_且坏长度如实报错() {
        let samples = vec![
            0.0f32,
            -0.5,
            1.0,
            f32::from_le_bytes([0x3f, 0x80, 0x00, 0x00]),
        ];
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        assert_eq!(bytes.len(), 16);
        let back = pcm_to_samples(&bytes).unwrap();
        assert_eq!(back, samples);
        assert!(pcm_to_samples(&[0u8, 1, 2]).is_err());
    }

    #[test]
    fn 配置点名_model_onnx_不被_int8_抢注() {
        // pyannote 归档解压后两个 onnx 并存 —— 这是本模块唯一怕踩的坑，钉死它。
        // fixture 按注册表真实布局建（DIAR_SEG 是 Archive 件、DIAR_EMB 是 Single 件）；
        // 旧版写「seg/emb.onnx」是从未对上 target() 的假布局，CI 首跑即红。
        let d = std::env::temp_dir().join(format!("modulo-diar-cfg-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let seg_dir = asr_models::target(&d, &asr_models::DIAR_SEG);
        fs::create_dir_all(&seg_dir).unwrap();
        fs::write(seg_dir.join("model.onnx"), b"fp32").unwrap();
        fs::write(seg_dir.join("model.int8.onnx"), b"int8").unwrap();
        let emb_file = asr_models::target(&d, &asr_models::DIAR_EMB);
        fs::write(&emb_file, b"emb").unwrap();
        let cfg = diar_config(&d).unwrap();
        assert_eq!(
            cfg.segmentation.pyannote.model,
            Some(seg_dir.join("model.onnx").to_string_lossy().into_owned())
        );
        assert_eq!(
            cfg.embedding.model,
            Some(emb_file.to_string_lossy().into_owned())
        );
        // 缺件 → Err（不进 create 拿 None 再猜）
        let _ = fs::remove_file(seg_dir.join("model.onnx"));
        assert!(diar_config(&d).is_err());
        let _ = fs::remove_dir_all(&d);
    }
}
