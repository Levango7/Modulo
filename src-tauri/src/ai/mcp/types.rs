//! MCP 消息的数据模型、错误类型与可读文案（纯数据，零 IO）。
//!
//! 由单文件 `protocol.rs` 拆出（F4b 步骤 B，**行为零改**）：这里只放类型定义、
//! 对类型的展示与结果结构体，不含 JSON-RPC 帧编解码、也不含 `result` 的强类型解析。
//! 帧编解码在 `protocol.rs`，强类型解析在 `views.rs`。

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::limits::MCP_TOOLS_MAX;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Id {
    Num(i64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    pub data: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Incoming {
    Response {
        id: Id,
        result: Option<Value>,
        error: Option<RpcError>,
    },
    Notification {
        method: String,
        params: Option<Value>,
    },
    /// server→client 请求（sampling / elicitation / roots）：一期明确拒收，理由带方法名。
    ServerRequest { id: Id, method: String },
}

#[derive(Debug, Clone, PartialEq)]
pub enum Outgoing {
    Request {
        id: Id,
        method: String,
        params: Option<Value>,
    },
    Notification {
        method: String,
        params: Option<Value>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum CodecError {
    EmptyLine,
    LineTooLong {
        bytes: usize,
        max: usize,
    },
    Parse(String),
    BatchNotSupported,
    InvalidShape(String),
    WrongVersion(String),
    MissingField(&'static str),
    ResultAndError,
    NeitherResultNorError,
    NullId,
    BadId,
    Serialize(String),
    TooManyTools(usize),
    BadTool(String),
    NotReady,
    SessionFailed(String),
    /// method 字段存在但不是非空字符串（JSON-RPC 2.0 规定 method MUST 为 String）。
    BadMethod,
    /// 带 method 又带 result / error —— 自相矛盾的形状，不能悄悄当响应认领。
    RequestHasResult,
    /// 影响判定的字段存在但类型非法：一律拒收，不用 `.unwrap_or(缺省)` 静默放行。
    BadField(&'static str),
    /// error.code 超出 i32 范围（避免 `as i32` 环绕）。
    BadErrorCode,
}

impl fmt::Display for CodecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CodecError::EmptyLine => write!(f, "收到空行（server 是不是把日志打到 stdout 了）"),
            CodecError::LineTooLong { bytes, max } => write!(f, "单行 {bytes} 字节超过上限 {max}"),
            CodecError::Parse(e) => write!(f, "这一行不是合法 JSON：{e}"),
            CodecError::BatchNotSupported => write!(f, "这一版不处理批量消息（JSON-RPC batch）"),
            CodecError::InvalidShape(s) => write!(f, "消息形状不对：{s}"),
            CodecError::WrongVersion(v) => write!(f, "jsonrpc 版本是 {v}，只认 2.0"),
            CodecError::MissingField(k) => write!(f, "缺少字段 {k}"),
            CodecError::ResultAndError => write!(f, "result 和 error 不能同时出现"),
            CodecError::NeitherResultNorError => write!(f, "响应里既没有 result 也没有 error"),
            CodecError::NullId => write!(f, "id 不能是 null"),
            CodecError::BadId => write!(f, "id 只能是整数或字符串"),
            CodecError::Serialize(e) => write!(f, "序列化失败：{e}"),
            CodecError::TooManyTools(n) => write!(f, "工具数 {n} 超过上限 {MCP_TOOLS_MAX}"),
            CodecError::BadTool(s) => write!(f, "工具定义不合法：{s}"),
            CodecError::NotReady => write!(f, "初始化还没完成，不能发这个请求"),
            CodecError::SessionFailed(s) => write!(f, "会话已失败：{s}"),
            CodecError::BadMethod => write!(f, "method 必须是非空字符串"),
            CodecError::RequestHasResult => write!(f, "带 method 的请求不该同时带 result 或 error"),
            CodecError::BadField(k) => write!(f, "字段 {k} 的类型不对，不能当缺省值处理"),
            CodecError::BadErrorCode => write!(f, "error.code 超出可用范围"),
        }
    }
}

impl std::error::Error for CodecError {}

// ---------- 强类型视图的结果类型（解析函数见 views.rs） ----------

#[derive(Debug, Clone, PartialEq)]
pub struct InitializeResult {
    pub protocol_version: String,
    pub has_tools: bool,
    pub server_name: Option<String>,
    pub instructions: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Tool {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolsListResult {
    pub tools: Vec<Tool>,
    pub next_cursor: Option<String>,
}

impl ToolsListResult {
    /// 一期不自动翻页，但必须如实标注「没拿全」，不假装完整。
    pub fn is_partial(&self) -> bool {
        self.next_cursor.is_some()
    }
    pub fn notice(&self) -> Option<String> {
        self.next_cursor
            .as_ref()
            .map(|_| "还有下一页工具，这一版只取第一页".to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ContentKind {
    Text,
    Image,
    Audio,
    ResourceLink,
    Resource,
    Unknown(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolContent {
    pub kind: ContentKind,
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CallToolResult {
    pub content: Vec<ToolContent>,
    pub is_error: bool,
}

impl CallToolResult {
    /// 判据 11：非文字内容要**产出可展示的文案**，不能只留个 kind 让人猜。
    pub fn notice(&self) -> Option<String> {
        let n = self
            .content
            .iter()
            .filter(|c| c.kind != ContentKind::Text)
            .count();
        if n == 0 {
            None
        } else {
            Some(format!("这一版只收文字结果，另有 {n} 项非文字内容未展示"))
        }
    }
}

/// 错误码映射成中文短句，同时保留原始 code / message **以及 `data`**，不丢信息。
/// `data` 尤其重要：版本协商失败时 `data.supported` 是唯一能告诉上层「该降到哪版」的字段。
pub fn describe_rpc_error(e: &RpcError) -> String {
    let base = match e.code {
        -32700 => "消息不是合法 JSON",
        -32600 => "请求格式不对",
        -32601 => "这个方法不存在",
        -32602 => "参数不合法",
        -32603 => "服务内部出错",
        _ => "服务返回了错误",
    };
    let mut s = format!("{base}（code {}）：{}", e.code, e.message);
    if let Some(d) = &e.data {
        s.push_str(&format!("；服务端信息：{d}"));
    }
    s
}

pub fn label_incoming(m: &Incoming) -> &'static str {
    match m {
        Incoming::Response { .. } => "响应",
        Incoming::Notification { .. } => "通知",
        Incoming::ServerRequest { .. } => "服务主动请求",
    }
}
