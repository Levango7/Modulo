//! AI 出口收敛层 —— OpenAI 兼容协议的命令与 IO（reqwest 0.13，Rust 出口，CSP 不动，ADR-004/010）。
//!
//! 分包（300 行纪律，同 D-01/D-02 手法）：**纯函数在 protocol.rs**（URL 白名单
//! / SSE 解析 / 人话化，全部可单测），**配置读写在 settings.rs**（D-07），本文件
//! 只留命令、请求执行、限流与取消。
//!
//! 纪律：
//! 1. 并发限流 Semaphore(2)（AC-12）；中止走 `ai_chat_cancel`（D-08）。
//! 2. 错误一律人话（映射表在 protocol.rs），不抛原始堆栈。
//! 3. TLS：rustls-no-provider + ring，进程内装一次（已装则忽略，updater 可能先装）。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

use super::keys;
use super::protocol::{
    humanize_connect, humanize_status, parse_sse_data_line, validate_base_url, SseEvent,
};
use super::settings::{load_provider, load_settings, ProviderCfg, ProviderView};

/// 一次性摘要的整体超时；流式对话不设整体超时（长对话合法），只有连接超时。
///
/// 数字不再写在这里：来自仓库根 `net-policy.json` 的 `timeouts.aiSummarizeMs`
/// （见 `net_policy.rs`）。前端此前没有这一档的对应常量 —— 三档超时只在 Rust 侧，
/// 现在两侧同一份单源。
fn summarize_timeout() -> Duration {
    crate::net_policy::ai_summarize_timeout()
}

/// 就绪探测（GET /models）超时。要快失败：填错地址时不该让人等。
fn probe_timeout() -> Duration {
    crate::net_policy::ai_probe_timeout()
}

fn new_conversation_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("conv-{nanos:x}")
}

/// TLS provider：进程内装一次。updater 等可能先装——Err（已装）忽略
fn ensure_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

// ---- 限流与取消注册表（AC-12 / D-08）----

fn chat_sem() -> &'static Semaphore {
    static SEM: OnceLock<Semaphore> = OnceLock::new();
    SEM.get_or_init(|| Semaphore::new(2))
}

fn chat_tasks() -> &'static Mutex<HashMap<String, CancellationToken>> {
    static TASKS: OnceLock<Mutex<HashMap<String, CancellationToken>>> = OnceLock::new();
    TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}

// ---- 命令 ----

#[tauri::command]
pub async fn ai_providers(app: AppHandle) -> Result<Vec<ProviderView>, String> {
    let cfgs = load_settings(&app)?;
    let mut out = Vec::with_capacity(cfgs.len());
    for c in cfgs {
        let key_configured = keys::get_key(&c.id)?.is_some();
        out.push(ProviderView {
            ready: probe_ready(&c, key_configured).await,
            key_configured,
            id: c.id,
            kind: c.kind,
            base_url: c.base_url,
            model: c.model,
        });
    }
    Ok(out)
}

/// GET /models 探测（3s 超时）。任何失败都如实 ready=false，不猜原因
async fn probe_ready(c: &ProviderCfg, has_key: bool) -> bool {
    if validate_base_url(&c.base_url).is_err() {
        return false;
    }
    ensure_crypto_provider();
    let Ok(client) = reqwest::Client::builder().timeout(probe_timeout()).build() else {
        return false;
    };
    let mut req = client.get(format!("{}/models", c.base_url.trim_end_matches('/')));
    if has_key {
        if let Ok(Some(k)) = keys::get_key(&c.id) {
            req = req.bearer_auth(k);
        }
    }
    matches!(req.send().await, Ok(r) if r.status().is_success())
}

#[derive(Serialize, Deserialize)]
pub struct Msg {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChunk {
    pub delta: String,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRef {
    pub conversation_id: String,
}

#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    provider_id: String,
    conversation_id: Option<String>,
    messages: Vec<Msg>,
    on_chunk: Channel<AiChunk>,
) -> Result<ConversationRef, String> {
    let cfg = load_provider(&app, &provider_id)?;
    let key = keys::get_key(&provider_id)?;
    let conv_id = conversation_id.unwrap_or_else(new_conversation_id);
    let token = CancellationToken::new();
    chat_tasks()
        .lock()
        .unwrap()
        .insert(conv_id.clone(), token.clone());

    let sink = on_chunk.clone();
    let base = cfg.base_url.clone();
    let model = cfg.model.clone();
    let task_conv = conv_id.clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let _permit = chat_sem().acquire().await;
        // 历史落盘用：入参全量消息 + 流式累积的 assistant 回复 = 完整一轮
        let mut full: Vec<(String, String)> = messages
            .iter()
            .map(|m| (m.role.clone(), m.content.clone()))
            .collect();
        match run_chat(&base, &model, key, messages, &token, &sink).await {
            Ok(reply) => {
                let _ = sink.send(AiChunk {
                    delta: String::new(),
                    done: true,
                    error: None,
                });
                if !reply.trim().is_empty() {
                    full.push(("assistant".to_string(), reply));
                    let _ = super::history::upsert_conversation(&app2, &task_conv, &full);
                }
            }
            Err(msg) => {
                let _ = sink.send(AiChunk {
                    delta: String::new(),
                    done: true,
                    error: Some(msg),
                });
            }
        }
        chat_tasks().lock().unwrap().remove(&task_conv);
    });
    Ok(ConversationRef {
        conversation_id: conv_id,
    })
}

/// 中止一次进行中的对话（D-08）。会话不存在/已结束是幂等成功
#[tauri::command]
pub fn ai_chat_cancel(conversation_id: String) -> Result<(), String> {
    if let Some(token) = chat_tasks().lock().unwrap().get(&conversation_id) {
        token.cancel();
    }
    Ok(())
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: &'a [Msg],
    stream: bool,
}

async fn run_chat(
    base: &str,
    model: &str,
    key: Option<String>,
    messages: Vec<Msg>,
    token: &CancellationToken,
    sink: &Channel<AiChunk>,
) -> Result<String, String> {
    ensure_crypto_provider();
    validate_base_url(base)?;
    let client = reqwest::Client::builder()
        // 连接超时同读单源（net-policy.json 的 timeouts.aiConnectMs）
        .connect_timeout(crate::net_policy::ai_connect())
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败：{e}"))?;
    let mut req = client
        .post(format!("{}/chat/completions", base.trim_end_matches('/')))
        .json(&ChatRequest {
            model,
            messages: &messages,
            stream: true,
        });
    if let Some(k) = &key {
        req = req.bearer_auth(k);
    }
    let resp = token
        .run_until_cancelled(req.send())
        .await
        .ok_or_else(|| "已中止".to_string())?
        .map_err(|e| {
            if e.is_connect() {
                humanize_connect(base)
            } else if e.is_timeout() {
                "模型服务连接超时，稍后再试".into()
            } else {
                format!("连接模型服务失败：{e}")
            }
        })?;
    if !resp.status().is_success() {
        return Err(humanize_status(resp.status().as_u16()));
    }
    let mut resp = resp;
    // **字节缓冲**：SSE 按 \n 切行后才做 UTF-8 解码——中文多字节字符可能被
    // 网络分块从中间劈开，直接对 chunk 做 lossy 会出替换符
    let mut buf: Vec<u8> = Vec::new();
    // 累积 assistant 全文：流结束后原样交给 history 落盘（D-02）。
    // 只累积不做二次加工——前端已收到的 delta 与这里的一致，落盘即所见
    let mut reply = String::new();
    loop {
        let bytes = token
            .run_until_cancelled(resp.chunk())
            .await
            .ok_or_else(|| "已中止".to_string())?
            .map_err(|e| format!("读模型响应失败：{e}"))?;
        let Some(bytes) = bytes else { return Ok(reply) }; // 流正常收尾（无 [DONE] 也算完）
        buf.extend_from_slice(&bytes);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes[..line_bytes.len() - 1]);
            match parse_sse_data_line(&line) {
                Some(SseEvent::Delta(delta)) => {
                    reply.push_str(&delta);
                    sink.send(AiChunk {
                        delta,
                        done: false,
                        error: None,
                    })
                    .map_err(|_| "输出通道已关闭，已停止".to_string())?;
                }
                Some(SseEvent::Done) => return Ok(reply),
                None => {}
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRef {
    pub summary: String,
}

const MEETING_PROMPT: &str = "你是会议速记助手。把下面的会议转写整理成简明总结：要点（不超过 8 条）、待办与责任人（如有）、遗留问题。忠实原文，不编造。";
const PLAIN_PROMPT: &str = "把下面的文本总结成 3 到 5 句话的摘要。忠实原文，不编造。";

/// 一次性摘要（会议速记与其它卡片共用，契约 ai_summarize；style 默认 meeting）
#[tauri::command]
pub async fn ai_summarize(
    app: AppHandle,
    provider_id: String,
    text: String,
    style: Option<String>,
) -> Result<SummaryRef, String> {
    let cfg = load_provider(&app, &provider_id)?;
    let key = keys::get_key(&provider_id)?;
    ensure_crypto_provider();
    validate_base_url(&cfg.base_url)?;
    let _permit = chat_sem().acquire().await;

    let system = if style.as_deref() == Some("plain") {
        PLAIN_PROMPT
    } else {
        MEETING_PROMPT
    };
    let messages = vec![
        Msg {
            role: "system".into(),
            content: system.into(),
        },
        Msg {
            role: "user".into(),
            content: text,
        },
    ];
    let client = reqwest::Client::builder()
        .timeout(summarize_timeout())
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败：{e}"))?;
    let mut req = client
        .post(format!(
            "{}/chat/completions",
            cfg.base_url.trim_end_matches('/')
        ))
        .json(&ChatRequest {
            model: &cfg.model,
            messages: &messages,
            stream: false,
        });
    if let Some(k) = &key {
        req = req.bearer_auth(k);
    }
    let resp = req.send().await.map_err(|e| {
        if e.is_connect() {
            humanize_connect(&cfg.base_url)
        } else if e.is_timeout() {
            "模型服务响应超时（超过 2 分钟），稍后再试".into()
        } else {
            format!("连接模型服务失败：{e}")
        }
    })?;
    if !resp.status().is_success() {
        return Err(humanize_status(resp.status().as_u16()));
    }
    #[derive(Deserialize)]
    struct Full {
        #[serde(default)]
        choices: Vec<FullChoice>,
    }
    #[derive(Deserialize)]
    struct FullChoice {
        #[serde(default)]
        message: FullMessage,
    }
    #[derive(Deserialize, Default)]
    struct FullMessage {
        content: Option<String>,
    }
    let full: Full = resp
        .json()
        .await
        .map_err(|e| format!("解析模型响应失败：{e}"))?;
    let summary = full
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "模型返回了空内容，换一个模型试试".to_string())?;
    Ok(SummaryRef { summary })
}
