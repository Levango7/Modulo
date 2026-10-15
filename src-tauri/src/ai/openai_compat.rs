//! AI 出口收敛层 —— OpenAI 兼容协议（reqwest 0.13，Rust 出口，CSP 不动，ADR-004/010）。
//!
//! 纪律：
//! 1. **provider 配置本体在 `ai-settings.v1` 文档**：前端 AI 设置面板经
//!    `storage::write_doc` 写，本模块经 `storage::read_doc_raw` 读（缺口 D-07）。
//!    密钥永不进这份文档（AC-09），只在钥匙串。
//! 2. **scheme 白名单**：https，或 localhost / 127.0.0.1 / [::1] 的 http（契约 ai_chat notes）。
//! 3. **并发限流 Semaphore(2)**（AC-12）；中止走 `ai_chat_cancel`（D-08，补契约缺口）。
//! 4. 错误一律人话（架构文档 §6 错误分类总表），不抛原始堆栈。
//! 5. TLS：rustls-no-provider + ring，进程内装一次（已装则忽略，updater 可能先装）。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

use super::keys;
use crate::storage::read_doc_raw;

/// provider 配置文档名（前端 AI 设置面板写入，schema 见 D-07 登记）
const SETTINGS_DOC: &str = "ai-settings.v1";
/// 一次性摘要的整体超时；流式对话不设整体超时（长对话合法），只有连接超时
const SUMMARIZE_TIMEOUT: Duration = Duration::from_secs(120);
/// 就绪探测（GET /models）超时
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

// ---- 配置与视图 ----

/// 一条 provider 配置（camelCase 存盘，与前端设置面板同一份 schema）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCfg {
    pub id: String,
    /// ollama | openai-compatible（契约枚举）
    pub kind: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SettingsDoc {
    #[serde(default)]
    providers: Vec<ProviderCfg>,
}

/// ai_providers 回给前端的条目（契约：只给布尔，不给密钥）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub id: String,
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub key_configured: bool,
    pub ready: bool,
}

fn load_settings(app: &AppHandle) -> Result<SettingsDoc, String> {
    match read_doc_raw(app, SETTINGS_DOC)? {
        None => Ok(SettingsDoc::default()),
        Some(text) => serde_json::from_str(&text)
            .map_err(|e| format!("AI 配置文档格式不对（{SETTINGS_DOC}）：{e}")),
    }
}

fn load_provider(app: &AppHandle, provider_id: &str) -> Result<ProviderCfg, String> {
    let doc = load_settings(app)?;
    doc.providers
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| "找不到这个模型配置，去 AI 设置里检查".to_string())
}

// ---- 纯函数（校验 / SSE / 人话），全部可单测 ----

/// 从 authority 段提取主机（去端口；IPv6 带 []）。空串不可能出现（调用方已保证）
fn extract_host(authority: &str) -> &str {
    if let Some(rest) = authority.strip_prefix('[') {
        return match rest.find(']') {
            // '[' 已耗 1 字节，']' 落在 rest 内偏移 end，即 authority 的 end+1（含）
            Some(end) => &authority[..end + 2],
            None => authority, // 未闭合的畸形串整段当主机，交给白名单去拒
        };
    }
    authority.split(':').next().unwrap_or(authority)
}

fn is_local_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

/// scheme 白名单（契约 notes 的落地）。尾部 `/` 容忍。
fn validate_base_url(base: &str) -> Result<(), String> {
    let base = base.trim();
    if let Some(rest) = base.strip_prefix("https://") {
        let host = extract_host(rest.split('/').next().unwrap_or(""));
        if host.is_empty() {
            return Err("模型服务地址缺少主机名".into());
        }
        return Ok(());
    }
    if let Some(rest) = base.strip_prefix("http://") {
        let authority = rest.split('/').next().unwrap_or("");
        if is_local_host(extract_host(authority)) {
            return Ok(());
        }
        return Err("明文 http 只允许本机地址（localhost / 127.0.0.1），云端必须用 https".into());
    }
    Err("模型服务地址必须以 https:// 或 http:// 开头".into())
}

fn is_local_base(base: &str) -> bool {
    base.trim()
        .strip_prefix("http://")
        .or_else(|| base.trim().strip_prefix("https://"))
        .map(|rest| is_local_host(extract_host(rest.split('/').next().unwrap_or(""))))
        .unwrap_or(false)
}

/// HTTP 状态码 → 人话（架构文档 §6 错误分类总表）
fn humanize_status(code: u16) -> String {
    match code {
        400 => "请求被服务端拒绝，检查模型名与参数".into(),
        401 | 403 => "API key 无效，去设置里重新填入".into(),
        404 => "这个模型在服务端不存在，换一个模型名".into(),
        402 | 429 => "额度不足或被限流，稍后再试".into(),
        other => format!("模型服务返回错误（HTTP {other}）"),
    }
}

fn humanize_connect(base: &str) -> String {
    if is_local_base(base) {
        "没连上本地模型服务，确认 Ollama 已启动".into()
    } else {
        "网络连不上模型服务，检查连接后重试".into()
    }
}

/// SSE 一行 `data:` 载荷 → 事件。忽略注释行/心跳/畸形行（诚实跳过，不中断流）
enum SseEvent {
    Delta(String),
    Done,
}

fn parse_sse_data_line(line: &str) -> Option<SseEvent> {
    let payload = line.trim().strip_prefix("data:")?.trim();
    if payload == "[DONE]" {
        return Some(SseEvent::Done);
    }
    #[derive(Deserialize)]
    struct Wire {
        #[serde(default)]
        choices: Vec<WireChoice>,
    }
    #[derive(Deserialize)]
    struct WireChoice {
        #[serde(default)]
        delta: WireDelta,
    }
    #[derive(Deserialize, Default)]
    struct WireDelta {
        content: Option<String>,
    }
    let wire: Wire = serde_json::from_str(payload).ok()?;
    let delta = wire.choices.first()?.delta.content.clone()?;
    if delta.is_empty() {
        None // 空增量不推，省一次 IPC
    } else {
        Some(SseEvent::Delta(delta))
    }
}

fn new_conversation_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
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
    let cfgs = load_settings(&app)?.providers;
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
    let Ok(client) = reqwest::Client::builder().timeout(PROBE_TIMEOUT).build() else {
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
    tauri::async_runtime::spawn(async move {
        let _permit = chat_sem().acquire().await;
        let result = run_chat(&base, &model, key, messages, &token, &sink).await;
        let error = match result {
            Ok(()) => None,
            Err(msg) => Some(msg),
        };
        let _ = sink.send(AiChunk { delta: String::new(), done: true, error });
        chat_tasks().lock().unwrap().remove(&task_conv);
    });
    Ok(ConversationRef { conversation_id: conv_id })
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
) -> Result<(), String> {
    ensure_crypto_provider();
    validate_base_url(base)?;
    if key.is_none() {
        // 契约 kind 区分 ollama（无需 key）与云端；这里只有云端会真的没 key，
        // 但为防配置写错 kind，统一以"调不动就引导"收口
        // （ollama 本地端点不校验 Authorization，key=None 不影响它）
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败：{e}"))?;
    let mut req = client
        .post(format!("{}/chat/completions", base.trim_end_matches('/')))
        .json(&ChatRequest { model, messages: &messages, stream: true });
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
    loop {
        let bytes = token
            .run_until_cancelled(resp.chunk())
            .await
            .ok_or_else(|| "已中止".to_string())?
            .map_err(|e| format!("读模型响应失败：{e}"))?;
        let Some(bytes) = bytes else { return Ok(()) }; // 流正常收尾（无 [DONE] 也算完）
        buf.extend_from_slice(&bytes);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes[..line_bytes.len() - 1]);
            match parse_sse_data_line(&line) {
                Some(SseEvent::Delta(delta)) => {
                    sink.send(AiChunk { delta, done: false, error: None })
                        .map_err(|_| "输出通道已关闭，已停止".to_string())?;
                }
                Some(SseEvent::Done) => return Ok(()),
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

    let system = if style.as_deref() == Some("plain") { PLAIN_PROMPT } else { MEETING_PROMPT };
    let messages = vec![
        Msg { role: "system".into(), content: system.into() },
        Msg { role: "user".into(), content: text },
    ];
    let client = reqwest::Client::builder()
        .timeout(SUMMARIZE_TIMEOUT)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败：{e}"))?;
    let mut req = client
        .post(format!("{}/chat/completions", cfg.base_url.trim_end_matches('/')))
        .json(&ChatRequest { model: &cfg.model, messages: &messages, stream: false });
    if let Some(k) = &key {
        req = req.bearer_auth(k);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| {
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
    let full: Full = resp.json().await.map_err(|e| format!("解析模型响应失败：{e}"))?;
    let summary = full
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "模型返回了空内容，换一个模型试试".to_string())?;
    Ok(SummaryRef { summary })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheme_白名单() {
        for ok in [
            "https://api.example.com/v1",
            "http://localhost:11434/v1",
            "http://127.0.0.1:11434/v1/",
            "http://[::1]:11434/v1",
            "https://api.deepseek.com",
        ] {
            assert!(validate_base_url(ok).is_ok(), "{ok} 应当放行");
        }
        for bad in [
            "http://api.example.com/v1",
            "ftp://x",
            "api.example.com",
            "https:///no-host",
            "",
        ] {
            assert!(validate_base_url(bad).is_err(), "{bad} 应当被拒");
        }
    }

    #[test]
    fn 提取主机_带端口与ipv6() {
        assert_eq!(extract_host("localhost:11434"), "localhost");
        assert_eq!(extract_host("127.0.0.1:8080"), "127.0.0.1");
        assert_eq!(extract_host("[::1]:11434"), "[::1]");
        assert_eq!(extract_host("api.example.com"), "api.example.com");
    }

    #[test]
    fn 本地判定() {
        assert!(is_local_base("http://127.0.0.1:11434/v1"));
        assert!(is_local_base("https://localhost:8443"));
        assert!(!is_local_base("https://api.example.com/v1"));
    }

    #[test]
    fn sse_行解析() {
        let delta = parse_sse_data_line(
            r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#,
        );
        assert_eq!(match delta { Some(SseEvent::Delta(d)) => d, _ => panic!("应是 Delta") }, "你好");
        assert!(matches!(parse_sse_data_line("data: [DONE]"), Some(SseEvent::Done)));
        // 忽略类：注释、无 data 前缀、畸形 JSON、role 帧（无 content）、空增量
        for ignored in [": keep-alive", "event: ping", "data: {oops", r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#, r#"data: {"choices":[{"delta":{"content":""}}]}"#] {
            assert!(parse_sse_data_line(ignored).is_none(), "{ignored} 应被忽略");
        }
    }

    #[test]
    fn 人话_状态码() {
        assert_eq!(humanize_status(401), "API key 无效，去设置里重新填入");
        assert_eq!(humanize_status(404), "这个模型在服务端不存在，换一个模型名");
        assert_eq!(humanize_status(429), "额度不足或被限流，稍后再试");
        assert!(humanize_status(500).contains("500"));
    }

    #[test]
    fn 人话_连接错误分本地与云端() {
        assert_eq!(humanize_connect("http://127.0.0.1:11434/v1"), "没连上本地模型服务，确认 Ollama 已启动");
        assert_eq!(humanize_connect("https://api.example.com/v1"), "网络连不上模型服务，检查连接后重试");
    }
}
