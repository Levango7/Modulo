//! meeting 模块包（Phase 3，施工顺序 7-9）。
//!
//! **防混淆**（对账实证）：`packages/engine/src/meeting.ts` 是会议**时区规划**
//! 纯函数、`src/app/cards/MeetingCard.vue` 是时区对照卡——与本包（音频采集/
//! 转写/会话）同名不同物、零代码交集。前端新卡命名用 `minutes`。
//!
//! 分包纪律：audio（cpal 采集）与 asr（sherpa-onnx 转写）与 session（状态机）
//! 各自成文件，单文件 ≤300 行，入口只装配。纯函数在 audio_resample.rs。

pub mod asr;
pub mod asr_engine;
pub mod asr_errors;
pub mod asr_models;
pub mod audio;
pub mod audio_errors;
pub mod audio_resample;
