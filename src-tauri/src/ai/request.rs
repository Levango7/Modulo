//! `POST /chat/completions` 的请求体组装 —— 纯函数，可单测。
//!
//! 从 openai_compat 拆出来的理由不是行数，而是**这层形状要能被测**：
//! `tools` 在线上必须包一层 `{"type":"function","function":{…}}`，少这层服务端
//! 会把整条 `tools` 判成非法（400）；而"没有工具时整条字段不出现"同样是契约要求
//! （不认这个字段的服务端会因为一个多余的顶层字段直接拒掉整次请求）。
//! 这两件事都不该藏在 `run_chat` 的 reqwest 调用链里。
//!
//! 契约 §2.3：`ToolSpec` 是 **IPC 形状**（`name / description / parameters`），
//! 线上形状由 [`wire_tools`] 转换 —— 前端只交三样东西，不交 OpenAI 的包装。

use serde_json::{json, Value};

use super::events::ToolSpec;
use super::protocol::Msg;

/// 组装请求体。
///
/// `tools` 为 `None` **或空清单**时 `tools` 字段整条不出现：空数组与不传在语义上
/// 是同一件事（"这次不让模型调工具"），而有的服务端对空 `tools` 会 400 ——
/// 少发一个字段比多发一个空数组安全。
pub(crate) fn chat_body(
    model: &str,
    messages: &[Msg],
    stream: bool,
    tools: Option<&[ToolSpec]>,
) -> Value {
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": stream,
    });
    if let Some(list) = tools.filter(|l| !l.is_empty()) {
        body["tools"] = json!(wire_tools(list));
    }
    body
}

/// `ToolSpec` → OpenAI 线形状。`parameters` 原样透传（它是前端的 JSON Schema）。
pub(crate) fn wire_tools(list: &[ToolSpec]) -> Vec<Value> {
    list.iter()
        .map(|t| {
            json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                }
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_msg() -> Msg {
        Msg {
            role: "user".into(),
            content: "看看我的版面".into(),
        }
    }

    fn spec() -> ToolSpec {
        ToolSpec {
            name: "todo_add".into(),
            description: "加一条待办".into(),
            parameters: json!({
                "type": "object",
                "properties": { "title": { "type": "string" } },
                "required": ["title"],
            }),
        }
    }

    /// ④ 不传 tools 时请求体里**没有**这个字段（行为与 v0.8.12 逐字一致）
    #[test]
    fn 不传tools时请求体里没有这个字段() {
        let body = chat_body("gpt-x", &[user_msg()], true, None);
        let obj = body.as_object().expect("请求体是对象");
        assert!(
            !obj.contains_key("tools"),
            "不支持 tools 的 provider 收到多余顶层字段可能直接 400：{body}"
        );
        // 老三个字段一字不多一字不少
        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["messages", "model", "stream"]);
        assert_eq!(body["model"], "gpt-x");
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"][0]["role"], "user");
    }

    /// 空清单等同于不传：不许发一个空的 `tools: []`
    #[test]
    fn 空工具清单等同于不传() {
        let body = chat_body("gpt-x", &[user_msg()], true, Some(&[]));
        assert!(!body.as_object().unwrap().contains_key("tools"));
    }

    /// `tools` 必须按 OpenAI 线形状包一层 —— 少一层服务端直接 400
    #[test]
    fn tools按openai线形状包装() {
        let specs = [spec()];
        let body = chat_body("gpt-x", &[user_msg()], true, Some(&specs));
        let tools = body["tools"].as_array().expect("tools 是数组");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["type"], "function", "type 判别字段不能少");
        assert_eq!(tools[0]["function"]["name"], "todo_add");
        assert_eq!(tools[0]["function"]["description"], "加一条待办");
        // JSON Schema 原样透传：Rust 不替前端改结构
        assert_eq!(
            tools[0]["function"]["parameters"]["properties"]["title"]["type"],
            "string"
        );
        assert_eq!(tools[0]["function"]["parameters"]["required"][0], "title");
        // 顶层不许把三件平铺（平铺的形状服务端不认）
        assert!(tools[0].get("name").is_none(), "不许平铺：{tools:?}");
    }

    /// 摘要（非流式）走同一条组装，且永远不带 tools
    #[test]
    fn 非流式_摘要请求不带tools() {
        let body = chat_body("gpt-x", &[user_msg()], false, None);
        assert_eq!(body["stream"], false);
        assert!(!body.as_object().unwrap().contains_key("tools"));
    }
}
