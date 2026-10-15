//! meeting/session.rs —— 会议会话的**命令层**（施工顺序 9）。
//!
//! 状态机本体（Session / 转写线程 / 暂停恢复的实现）在 `session_live.rs`
//! （300 行纪律拆分），落盘与读取在 `session_store.rs`。本文件只做
//! 「契约命令 → 状态机」的映射，不放业务逻辑。
//!
//! **状态机口径**：`recording → paused → recording → stopped`。
//! 暂停/恢复的实现是「丢掉采集句柄 → join 转写线程 → 拿回引擎 → 重新开采集」，
//! 不是"留着流不动"——cpal 的流暂停后再启容易出 xrun，而且引擎要跟着一起停，
//! 否则 VAD 会把暂停期间的静音当成一段话吐出来。
//!
//! **live 事件（D-15）**：契约没定义实时事件，但会议速记没有实时字幕等于没有
//! 产品。本批新增 `minutes_segment` / `minutes_error` 两个事件，已在偏差登记。
//!
//! **说话人（D-14）**：diarization 无权威校验源，本批不落地，`speaker` 恒 null。

use std::collections::HashMap;
use std::thread;

use serde::Serialize;
use tauri::AppHandle;

use super::asr::models_root;
use super::asr_engine::AsrEngine;
use super::asr_models;
use super::audio::{self, AudioSource};
use super::session_live::{now_ms, run_worker, sessions, take_worker, Session};
use super::session_store;


fn parse_source(s: Option<&str>) -> Result<AudioSource, String> {
    match s.unwrap_or("mic") {
        "mic" => Ok(AudioSource::Mic),
        "system" => Ok(AudioSource::System),
        other => Err(format!("未知音源：{other}（应为 mic 或 system）")),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingStarted {
    pub session_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingStopped {
    pub id: String,
    pub transcript_path: String,
    pub segment_count: usize,
    pub duration_ms: u64,
}

/// 契约 `meeting_start`
#[tauri::command]
pub fn meeting_start(
    app: AppHandle,
    device_id: Option<String>,
    source: Option<String>,
) -> Result<MeetingStarted, String> {
    let src = parse_source(source.as_deref())?;
    let root = models_root(&app)?;
    if !asr_models::all_ready(&root) {
        return Err("语音模型还没下载完，先在设置里下载模型再开始速记".to_string());
    }
    let engine = AsrEngine::load(&root)?;
    let capture = audio::open_capture(src, device_id.as_deref())?;

    let id = session_store::new_id();
    let app2 = app.clone();
    let worker = thread::spawn(move || run_worker(app2, engine, capture));

    let s = Session {
        id: id.clone(),
        source: src,
        device_id,
        started_ms: now_ms(),
        paused_at_ms: None,
        paused_total_ms: 0,
        capture: None,
        engine: None,
        worker: Some(worker),
        segments: Vec::new(),
    };
    sessions()
        .lock()
        .map_err(|_| "会话表锁坏了".to_string())?
        .insert(id.clone(), s);
    Ok(MeetingStarted { session_id: id })
}

/// 契约 `meeting_pause`（幂等：已暂停也返回成功）
#[tauri::command]
pub fn meeting_pause(session_id: String) -> Result<(), String> {
    let mut map = sessions().lock().map_err(|_| "会话表锁坏了".to_string())?;
    let s = map
        .get_mut(&session_id)
        .ok_or_else(|| format!("会话不存在：{session_id}"))?;
    if s.paused_at_ms.is_some() {
        return Ok(());
    }
    if let Some((engine, segs)) = take_worker(s) {
        s.engine = Some(engine);
        s.segments.extend(segs);
    }
    s.paused_at_ms = Some(now_ms());
    Ok(())
}

/// 契约 `meeting_resume`（幂等：正在录也返回成功）
#[tauri::command]
pub fn meeting_resume(app: AppHandle, session_id: String) -> Result<(), String> {
    let mut map = sessions().lock().map_err(|_| "会话表锁坏了".to_string())?;
    let s = map
        .get_mut(&session_id)
        .ok_or_else(|| format!("会话不存在：{session_id}"))?;
    let Some(paused_at) = s.paused_at_ms.take() else {
        return Ok(());
    };
    s.paused_total_ms += now_ms().saturating_sub(paused_at);

    let engine = s
        .engine
        .take()
        .ok_or_else(|| "会话引擎已丢失，请重新开始一场速记".to_string())?;
    let capture = audio::open_capture(s.source, s.device_id.as_deref())?;
    let app2 = app.clone();
    s.worker = Some(thread::spawn(move || run_worker(app2, engine, capture)));
    Ok(())
}

/// 契约 `meeting_stop`：收尾 flush → 落 transcript.json → 返回路径
#[tauri::command]
pub fn meeting_stop(app: AppHandle, session_id: String) -> Result<MeetingStopped, String> {
    let mut s = sessions()
        .lock()
        .map_err(|_| "会话表锁坏了".to_string())?
        .remove(&session_id)
        .ok_or_else(|| format!("会话不存在：{session_id}"))?;

    if let Some((_engine, segs)) = take_worker(&mut s) {
        s.segments.extend(segs);
    }
    // 停止时若还在暂停态，暂停时长要算到最后一次 pause 起
    let paused_total = match s.paused_at_ms {
        Some(p) => s.paused_total_ms + now_ms().saturating_sub(p),
        None => s.paused_total_ms,
    };
    let duration_ms = now_ms().saturating_sub(s.started_ms + paused_total);

    let t = session_store::Transcript {
        id: s.id.clone(),
        created_at: s.started_ms,
        duration_ms,
        segments: s
            .segments
            .iter()
            .map(|u| session_store::Segment {
                start_ms: u.start_ms,
                end_ms: u.end_ms,
                text: u.text.clone(),
                speaker: None, // D-14：本批无 diarization
            })
            .collect(),
        speaker_names: HashMap::new(),
        summary: None,
    };
    let root = session_store::meetings_root(&app)?;
    let path = session_store::write_transcript(&root, &t)?;
    Ok(MeetingStopped {
        segment_count: t.segments.len(),
        id: t.id,
        transcript_path: path,
        duration_ms,
    })
}

/// 契约 `meeting_list`
#[tauri::command]
pub fn meeting_list(app: AppHandle) -> Result<Vec<session_store::MeetingItem>, String> {
    let root = session_store::meetings_root(&app)?;
    Ok(session_store::list_meetings(&root))
}

/// 契约 `meeting_get`
#[tauri::command]
pub fn meeting_get(app: AppHandle, id: String) -> Result<session_store::Transcript, String> {
    let root = session_store::meetings_root(&app)?;
    session_store::read_transcript(&root, &id)
}

/// 契约 `meeting_delete`
#[tauri::command]
pub fn meeting_delete(app: AppHandle, id: String) -> Result<(), String> {
    let root = session_store::meetings_root(&app)?;
    session_store::delete_meeting(&root, &id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryOut {
    pub summary: String,
}

/// 契约 `meeting_summarize`。
///
/// **契约只给 `id`，没给 `providerId`（登记 D-15）**：这里取第一个 `ready`
/// 的 provider。没有可用 provider 时返回"未配置"人话，而不是让前端猜。
#[tauri::command]
pub async fn meeting_summarize(app: AppHandle, id: String) -> Result<SummaryOut, String> {
    let root = session_store::meetings_root(&app)?;
    let mut t = session_store::read_transcript(&root, &id)?;
    if let Some(s) = &t.summary {
        if !s.is_empty() {
            return Ok(SummaryOut { summary: s.clone() });
        }
    }
    let text: String = t
        .segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        return Err("这场会议没有可总结的内容（转写为空）".to_string());
    }

    let providers = crate::ai::openai_compat::ai_providers(app.clone()).await?;
    let provider = providers
        .into_iter()
        .find(|p| p.ready)
        .ok_or_else(|| "还没有可用的模型服务：请先在 AI 设置里配置并测试一个 provider".to_string())?;

    let summary = crate::ai::openai_compat::ai_summarize(app.clone(), provider.id, text, None)
        .await?
        .summary;
    t.summary = Some(summary.clone());
    session_store::write_transcript(&root, &t)?;
    Ok(SummaryOut { summary })
}
