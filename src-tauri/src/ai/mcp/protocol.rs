//! MCP stdio 帧编解码 + JSON-RPC 2.0 子集（纯函数，零 IO）。
//!
//! 协议事实（2026-11-09 核自官方 spec `2025-06-18`，取舍见 ARCHITECTURE §12.76）：
//! - stdio = **newline-delimited JSON**，消息内 MUST NOT 含 embedded newlines，UTF-8；
//!   不是 LSP 的 `Content-Length` framing。server stdout 只写协议消息，日志走 stderr。
//! - `2025-06-18` 版消息是**单条** request / notification / response；
//!   `2025-03-26` 允许 batch（数组）⇒ 本层明确拒收数组。
//! - 未知字段交给 `Value` 兜住，不因多字段报错（前向兼容）；但形状错误逐条给独立理由。
//! - **字段分级**（§12.76 的两条纪律）：必填 / 影响判定的字段严查存在性 + 类型；
//!   `params` 是 JSON-RPC 保留字段，出现即校验 —— 前向兼容只针对**未知**字段。
//!
//! 由单文件拆出（F4b 步骤 B，**行为零改**）：类型 → `types.rs`，视图解析 → `views.rs`。

use serde_json::{json, Map, Value};

use super::limits::{line_too_long, MCP_LINE_MAX};
use super::types::*;

pub const PROTOCOL_VERSION: &str = "2025-06-18";
pub const SUPPORTED_VERSIONS: &[&str] = &["2025-06-18"];

impl Outgoing {
    fn to_value(&self) -> Result<Value, CodecError> {
        let mut m = Map::new();
        m.insert("jsonrpc".into(), json!("2.0"));
        match self {
            Outgoing::Request { id, method, params } => {
                m.insert(
                    "id".into(),
                    serde_json::to_value(id).map_err(|e| CodecError::Serialize(e.to_string()))?,
                );
                m.insert("method".into(), json!(method));
                if let Some(p) = params {
                    m.insert("params".into(), p.clone());
                }
            }
            Outgoing::Notification { method, params } => {
                m.insert("method".into(), json!(method));
                if let Some(p) = params {
                    m.insert("params".into(), p.clone());
                }
            }
        }
        Ok(Value::Object(m))
    }
}

/// 编码成**一行**（不含末尾 `\n`，由 F4c 的写管道统一追加）。
/// `serde_json` 会把字符串里的换行转义成 `\n`（反斜杠 + n），所以输出天然不含裸换行，
/// 不需要再做一次多余的「查换行」校验。
pub fn encode_line(msg: &Outgoing) -> Result<String, CodecError> {
    let v = msg.to_value()?;
    serde_json::to_string(&v).map_err(|e| CodecError::Serialize(e.to_string()))
}

fn parse_id(v: &Value) -> Result<Id, CodecError> {
    if v.is_null() {
        return Err(CodecError::NullId);
    }
    serde_json::from_value::<Id>(v.clone()).map_err(|_| CodecError::BadId)
}

fn parse_rpc_error(v: &Value) -> Result<RpcError, CodecError> {
    let o = v
        .as_object()
        .ok_or_else(|| CodecError::InvalidShape("error 不是对象".into()))?;
    // 存在性与类型分开判：「缺字段」和「字段在但类型不对」是两种错，不共用一个理由。
    let code_value = o
        .get("code")
        .ok_or(CodecError::MissingField("error.code"))?;
    let code = code_value
        .as_i64()
        .ok_or(CodecError::BadField("error.code"))?;
    let code = i32::try_from(code).map_err(|_| CodecError::BadErrorCode)?;
    let message_value = o
        .get("message")
        .ok_or(CodecError::MissingField("error.message"))?;
    let message = message_value
        .as_str()
        .ok_or(CodecError::BadField("error.message"))?
        .to_string();
    Ok(RpcError {
        code,
        message,
        data: o.get("data").cloned(),
    })
}

/// 解析 server 发来的**一行**。空行 / 数组 / 各种畸形形状逐条给独立理由。
pub fn decode_line(line: &str) -> Result<Incoming, CodecError> {
    if line.is_empty() {
        return Err(CodecError::EmptyLine);
    }
    if line_too_long(line) {
        return Err(CodecError::LineTooLong {
            bytes: line.len(),
            max: MCP_LINE_MAX,
        });
    }
    let v: Value = serde_json::from_str(line).map_err(|e| CodecError::Parse(e.to_string()))?;
    if v.is_array() {
        return Err(CodecError::BatchNotSupported);
    }
    let obj = v
        .as_object()
        .ok_or_else(|| CodecError::InvalidShape("不是 JSON 对象".into()))?;
    let jsonrpc_value = obj
        .get("jsonrpc")
        .ok_or(CodecError::MissingField("jsonrpc"))?;
    match jsonrpc_value.as_str() {
        Some("2.0") => {}
        Some(other) => return Err(CodecError::WrongVersion(other.to_string())),
        None => return Err(CodecError::BadField("jsonrpc")),
    }
    // result 与 error 并存是最根本的矛盾形状，优先于「带 method」的矛盾报出来。
    if obj.contains_key("result") && obj.contains_key("error") {
        return Err(CodecError::ResultAndError);
    }

    // method 字段存在但非字符串 / 空串：必须拒收，不能降级成「无 method」当成响应认领。
    let has_method_field = obj.contains_key("method");
    let method: Option<String> = match obj.get("method") {
        Some(v) => match v.as_str() {
            Some(s) if !s.is_empty() => Some(s.to_string()),
            _ => return Err(CodecError::BadMethod),
        },
        None => None,
    };
    // request / notification 不该带 result 或 error；带了就是矛盾形状。
    if has_method_field && (obj.contains_key("result") || obj.contains_key("error")) {
        return Err(CodecError::RequestHasResult);
    }
    // JSON-RPC 2.0：params 是保留字段，MUST 为 Array 或 Object。无论消息带不带 method，
    // 出现即校验 —— 前向兼容只针对**未知**字段，params 不是未知字段。
    if let Some(p) = obj.get("params") {
        if !(p.is_array() || p.is_object()) {
            return Err(CodecError::BadField("params"));
        }
    }
    let has_id = obj.contains_key("id");
    let has_result = obj.contains_key("result");
    let has_error = obj.contains_key("error");

    if method.is_none() {
        if !has_result && !has_error {
            return Err(CodecError::NeitherResultNorError);
        }
        if !has_id {
            return Err(CodecError::MissingField("id"));
        }
        let id = parse_id(obj.get("id").unwrap())?;
        let error = match obj.get("error") {
            Some(e) => Some(parse_rpc_error(e)?),
            None => None,
        };
        return Ok(Incoming::Response {
            id,
            result: obj.get("result").cloned(),
            error,
        });
    }

    let m = method.unwrap();
    if has_id {
        let id = parse_id(obj.get("id").unwrap())?;
        // 不解析 params：一期不实现 sampling / elicitation / roots。
        return Ok(Incoming::ServerRequest { id, method: m });
    }
    Ok(Incoming::Notification {
        method: m,
        params: obj.get("params").cloned(),
    })
}

/// 增量切行状态机：只按 `\n` 切，切完 **trim 掉行尾单个 `\r`**（Windows server 的 CRLF），
/// **不做全局 trim** —— 全局 trim 会掩盖畸形行。半包留在 `pending`，不尝试解析。
#[derive(Debug, Default)]
pub struct LineReader {
    pending: String,
}

impl LineReader {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &str) -> Result<Vec<String>, CodecError> {
        self.pending.push_str(chunk);
        let mut out = Vec::new();
        while let Some(pos) = self.pending.find('\n') {
            let mut line: String = self.pending.drain(..=pos).collect();
            line.pop(); // 去掉 \n
            if line.ends_with('\r') {
                line.pop(); // 只去掉行尾单个 \r
            }
            if line_too_long(&line) {
                return Err(CodecError::LineTooLong {
                    bytes: line.len(),
                    max: MCP_LINE_MAX,
                });
            }
            out.push(line);
        }
        // 残片超长立即报错，不等闭合。
        if line_too_long(&self.pending) {
            return Err(CodecError::LineTooLong {
                bytes: self.pending.len(),
                max: MCP_LINE_MAX,
            });
        }
        Ok(out)
    }

    pub fn take_pending(&self) -> Option<&str> {
        if self.pending.is_empty() {
            None
        } else {
            Some(&self.pending)
        }
    }
}
