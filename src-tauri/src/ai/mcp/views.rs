//! MCP 强类型视图解析：把 `result` 的 `Value` 折成可断言的结构（纯函数，零 IO）。
//!
//! 由单文件 `protocol.rs` 拆出（F4b 步骤 B，**行为零改**）。字段分级纪律见
//! 与 `protocol.rs` 同一条纪律（§12.76）：必填 / 影响判定的字段严查存在性 + 类型；可选不可信展示字段宽松忽略。

use serde_json::Value;

use super::limits::{name_too_long, too_many_tools};
use super::types::*;

pub fn parse_initialize_result(v: &Value) -> Result<InitializeResult, CodecError> {
    let o = v
        .as_object()
        .ok_or_else(|| CodecError::InvalidShape("result 不是对象".into()))?;
    let version_value = o
        .get("protocolVersion")
        .ok_or(CodecError::MissingField("protocolVersion"))?;
    let protocol_version = version_value
        .as_str()
        .ok_or(CodecError::BadField("protocolVersion"))?
        .to_string();
    // capabilities 是必填对象。若它是数字 / 字符串，不能静默判成「没声明工具能力」
    // —— 那会把畸形响应伪装成一条看起来合理的业务失败。
    let caps_value = o
        .get("capabilities")
        .ok_or(CodecError::MissingField("capabilities"))?;
    let caps = caps_value
        .as_object()
        .ok_or(CodecError::BadField("capabilities"))?;
    // A1：tools capability 的值按 MCP 惯例应是对象（可为空对象 / 带 listChanged）。
    // 只查 key 会把 `tools:false` / `null` / `123` 也当成「已声明工具能力」并驱动握手完成。
    let has_tools = match caps.get("tools") {
        None => false,
        Some(v) => {
            if !v.is_object() {
                return Err(CodecError::BadField("capabilities.tools"));
            }
            true
        }
    };
    Ok(InitializeResult {
        protocol_version,
        has_tools,
        server_name: o
            .get("serverInfo")
            .and_then(|s| s.get("name"))
            .and_then(Value::as_str)
            .map(String::from),
        instructions: o
            .get("instructions")
            .and_then(Value::as_str)
            .map(String::from),
    })
}

pub fn parse_tools_list(v: &Value) -> Result<ToolsListResult, CodecError> {
    let o = v
        .as_object()
        .ok_or_else(|| CodecError::InvalidShape("result 不是对象".into()))?;
    let tools_value = o.get("tools").ok_or(CodecError::MissingField("tools"))?;
    let arr = tools_value
        .as_array()
        .ok_or(CodecError::BadField("tools"))?;
    if too_many_tools(arr.len()) {
        return Err(CodecError::TooManyTools(arr.len()));
    }
    let mut tools = Vec::with_capacity(arr.len());
    for (i, t) in arr.iter().enumerate() {
        if !t.is_object() {
            return Err(CodecError::BadTool(format!("第 {} 个工具不是对象", i + 1)));
        }
        let name_value = t
            .get("name")
            .ok_or_else(|| CodecError::BadTool(format!("第 {} 个工具缺 name", i + 1)))?;
        let name = name_value
            .as_str()
            .ok_or_else(|| CodecError::BadTool(format!("第 {} 个工具的 name 不是字符串", i + 1)))?
            .to_string();
        if name_too_long(&name) {
            return Err(CodecError::BadTool(format!("第 {} 个工具名字太长", i + 1)));
        }
        let schema = t
            .get("inputSchema")
            .ok_or_else(|| CodecError::BadTool(format!("第 {} 个工具缺 inputSchema", i + 1)))?;
        // MCP 规定 inputSchema 是 JSON Schema 对象；不是对象就别当成合法工具往下带。
        if !schema.is_object() {
            return Err(CodecError::BadTool(format!(
                "第 {} 个工具的 inputSchema 不是对象",
                i + 1
            )));
        }
        tools.push(Tool {
            name,
            title: t.get("title").and_then(Value::as_str).map(String::from),
            description: t
                .get("description")
                .and_then(Value::as_str)
                .map(String::from),
            input_schema: schema.clone(),
        });
    }
    // nextCursor 存在但非字符串（含 null）⇒ 拒收，不能静默当「没有下一页」假装拿全。
    let next_cursor = match o.get("nextCursor") {
        None => None,
        Some(v) => Some(
            v.as_str()
                .ok_or(CodecError::BadField("nextCursor"))?
                .to_string(),
        ),
    };
    Ok(ToolsListResult { tools, next_cursor })
}

pub fn parse_call_tool_result(v: &Value) -> Result<CallToolResult, CodecError> {
    let o = v
        .as_object()
        .ok_or_else(|| CodecError::InvalidShape("result 不是对象".into()))?;
    // isError 存在但非 bool ⇒ 拒收，不能静默当 false。
    let is_error = match o.get("isError") {
        None => false,
        Some(x) => x.as_bool().ok_or(CodecError::BadField("isError"))?,
    };
    // content 是必填数组（规格 P9）。缺失 / 类型非法各有独立理由，
    // 绝不 `.unwrap_or_default()` 把畸形响应伪装成「工具执行成功、零输出」。
    let content_value = o
        .get("content")
        .ok_or(CodecError::MissingField("content"))?;
    let items = content_value
        .as_array()
        .ok_or(CodecError::BadField("content"))?;
    let mut content = Vec::with_capacity(items.len());
    for (i, c) in items.iter().enumerate() {
        if !c.is_object() {
            return Err(CodecError::InvalidShape(format!("content[{i}] 不是对象")));
        }
        let type_value = c
            .get("type")
            .ok_or(CodecError::MissingField("content.type"))?;
        let ty = type_value
            .as_str()
            .ok_or(CodecError::BadField("content.type"))?;
        // 与 decode_line 里 method 空串判 BadMethod 同一口径：空串不是合法内容类型。
        if ty.is_empty() {
            return Err(CodecError::InvalidShape(format!(
                "content[{i}].type 不能为空"
            )));
        }
        let kind = match ty {
            "text" => ContentKind::Text,
            "image" => ContentKind::Image,
            "audio" => ContentKind::Audio,
            "resource_link" => ContentKind::ResourceLink,
            "resource" => ContentKind::Resource,
            other => ContentKind::Unknown(other.to_string()),
        };
        // text 类型的 text 必填；其它类型不强求（data / mimeType 归 F4c）。
        let text = if kind == ContentKind::Text {
            let text_value = c
                .get("text")
                .ok_or(CodecError::MissingField("content.text"))?;
            Some(
                text_value
                    .as_str()
                    .ok_or(CodecError::BadField("content.text"))?
                    .to_string(),
            )
        } else {
            c.get("text").and_then(Value::as_str).map(String::from)
        };
        content.push(ToolContent { kind, text });
    }
    Ok(CallToolResult {
        content,
        // 工具执行失败是**正常响应**，不是传输错误（官方 spec 明确区分）。
        is_error,
    })
}
