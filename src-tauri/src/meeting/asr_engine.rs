//! meeting/asr_engine.rs —— 转写引擎本体（Silero VAD 断句 → SenseVoice 转写 → 补标点）。
//!
//! **为什么单独成文件**：`asr.rs` 加上引擎后 414 行，顶穿 300 行纪律，按
//! D-01/D-02 的手法拆出纯引擎。sherpa-onnx 的选型实证（必须 shared 链接、
//! Windows 只有 MSVC 二进制、DLL 打包随行）见 `asr.rs` 文件头，不在这里重复。
//!
//! 采样率口径：16kHz 单声道 f32，与 `audio.rs` 一致。

use std::path::Path;

use serde::Serialize;

use super::asr_errors::engine_failure;
use super::asr_models;

/// VAD 缓冲窗口（秒）。超过这段没断句就强制切一段，防止长会议里句子无限长。
const VAD_WINDOW_SEC: f32 = 30.0;
/// 断句阈值：低于此概率算静音
const VAD_THRESHOLD: f32 = 0.5;
/// 静音超过这么久就断句
const VAD_MIN_SILENCE: f32 = 0.5;
/// 短于这个时长的语音不单独成段（滤掉咳嗽、键盘声）
const VAD_MIN_SPEECH: f32 = 0.25;
/// Silero VAD 的窗口样本数（16kHz 下 512 = 32ms）
const VAD_WINDOW_SIZE: i32 = 512;

/// 一句转写结果。时间戳由 VAD 报告的样本索引换算（见 [`AsrEngine::push`] 的诚实标注）。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Utterance {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

/// 转写引擎。三件套：Silero VAD 断句 → SenseVoice 转写 → CT-Transformer 补标点。
///
/// 标点是**可选**的：SenseVoice 自带一定的标点能力，标点档 61.7MB 没下时不应
/// 让整个转写不可用，所以 `punct` 是 `Option`。
pub struct AsrEngine {
    vad: sherpa_onnx::VoiceActivityDetector,
    recognizer: sherpa_onnx::OfflineRecognizer,
    punct: Option<sherpa_onnx::OfflinePunctuation>,
    /// 已喂入的样本总数，用于把 VAD 的相对索引换算成绝对时间
    fed: u64,
}

impl AsrEngine {
    /// 从模型根目录加载。三个模型必须都已就绪（先用 [`asr_models::all_ready`] 判）。
    pub fn load(root: &Path) -> Result<Self, String> {
        let vad_dir = asr_models::target(root, &asr_models::VAD);
        let asr_dir = asr_models::target(root, &asr_models::ASR);
        let punc_dir = asr_models::target(root, &asr_models::PUNC);

        let vad_model = vad_dir
            .to_str()
            .ok_or_else(|| "VAD 模型路径不是合法 UTF-8".to_string())?;
        let asr_model = asr_models::find_ext(&asr_dir, "onnx")
            .and_then(|p| p.to_str().map(str::to_string))
            .ok_or_else(|| "SenseVoice 模型目录里找不到 .onnx".to_string())?;
        let tokens = asr_models::find_ext(&asr_dir, "txt")
            .and_then(|p| p.to_str().map(str::to_string))
            .ok_or_else(|| "SenseVoice 模型目录里找不到 tokens.txt".to_string())?;

        let mut vad_cfg = sherpa_onnx::VadModelConfig::default();
        vad_cfg.silero_vad.model = Some(vad_model.into());
        vad_cfg.silero_vad.threshold = VAD_THRESHOLD;
        vad_cfg.silero_vad.min_silence_duration = VAD_MIN_SILENCE;
        vad_cfg.silero_vad.min_speech_duration = VAD_MIN_SPEECH;
        vad_cfg.silero_vad.window_size = VAD_WINDOW_SIZE;
        vad_cfg.silero_vad.max_speech_duration = VAD_WINDOW_SEC;
        vad_cfg.sample_rate = 16000;
        vad_cfg.num_threads = 1;
        vad_cfg.provider = Some("cpu".into());
        let vad = sherpa_onnx::VoiceActivityDetector::create(&vad_cfg, VAD_WINDOW_SEC)
            .ok_or_else(|| engine_failure("VAD"))?;

        let mut rec_cfg = sherpa_onnx::OfflineRecognizerConfig::default();
        rec_cfg.model_config.sense_voice.model = Some(asr_model);
        rec_cfg.model_config.sense_voice.language = Some("auto".into());
        rec_cfg.model_config.sense_voice.use_itn = true;
        rec_cfg.model_config.tokens = Some(tokens);
        rec_cfg.model_config.model_type = Some("sense_voice".into());
        rec_cfg.model_config.num_threads = 2;
        rec_cfg.model_config.provider = Some("cpu".into());
        let recognizer =
            sherpa_onnx::OfflineRecognizer::create(&rec_cfg).ok_or_else(|| engine_failure("转写"))?;

        let punct = asr_models::find_ext(&punc_dir, "onnx")
            .and_then(|p| p.to_str().map(str::to_string))
            .and_then(|m| {
                let mut c = sherpa_onnx::OfflinePunctuationConfig::default();
                c.model.ct_transformer = Some(m);
                c.model.num_threads = 1;
                c.model.provider = Some("cpu".into());
                sherpa_onnx::OfflinePunctuation::create(&c)
            });

        Ok(Self {
            vad,
            recognizer,
            punct,
            fed: 0,
        })
    }

    /// 喂一段 16kHz 单声道样本，返回本轮**已断句并转写完**的句子。
    ///
    /// 时间戳口径（诚实标注）：`SpeechSegment::start()` 的语义是「相对已喂入样本」，
    /// 这里按 `fed + start` 换算。未经长会话实测校准 —— 若上线后发现时间轴漂移，
    /// 优先怀疑这一处口径，而不是去调 VAD 参数。
    pub fn push(&mut self, samples: &[f32]) -> Vec<Utterance> {
        if samples.is_empty() {
            return Vec::new();
        }
        let base = self.fed;
        self.fed += samples.len() as u64;
        self.vad.accept_waveform(samples);

        let mut out = Vec::new();
        while !self.vad.is_empty() {
            let (start, n, text) = match self.vad.front() {
                Some(seg) => {
                    let s = seg.start().max(0) as u64;
                    let n = seg.n().max(0) as u64;
                    let t = self.transcribe(seg.samples());
                    (s, n, t)
                }
                None => break,
            };
            // borrow 结束再 pop：`front()` 借用的段必须在此前读完
            self.vad.pop();
            let text = self.punctuate(&text);
            if !text.trim().is_empty() {
                out.push(Utterance {
                    text,
                    start_ms: ms_of(base + start),
                    end_ms: ms_of(base + start + n),
                });
            }
        }
        out
    }

    /// 会议结束时把尾巴上没断出来的句子挤出来
    pub fn flush(&mut self) -> Vec<Utterance> {
        self.vad.flush();
        let mut out = Vec::new();
        while !self.vad.is_empty() {
            let (text, start, n) = match self.vad.front() {
                Some(seg) => (
                    self.transcribe(seg.samples()),
                    seg.start().max(0) as u64,
                    seg.n().max(0) as u64,
                ),
                None => break,
            };
            self.vad.pop();
            let text = self.punctuate(&text);
            if !text.trim().is_empty() {
                out.push(Utterance {
                    text,
                    start_ms: ms_of(start),
                    end_ms: ms_of(start + n),
                });
            }
        }
        out
    }

    fn transcribe(&self, samples: &[f32]) -> String {
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(16000, samples);
        self.recognizer.decode(&stream);
        stream
            .get_result()
            .map(|r| r.text.trim().to_string())
            .unwrap_or_default()
    }

    /// 补标点。**失败就原样返回**——标点错了比整句丢了好。
    fn punctuate(&self, text: &str) -> String {
        match &self.punct {
            Some(p) if !text.is_empty() => p.add_punctuation(text).unwrap_or_else(|| text.into()),
            _ => text.into(),
        }
    }
}

fn ms_of(samples: u64) -> u64 {
    samples * 1000 / 16000
}
