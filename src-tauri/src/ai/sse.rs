//! SSE 行解析（OpenAI 兼容流）—— 纯函数，零 IO。
//!
//! 从 `protocol.rs` 拆出来（同 D-01/D-02 手法）：一帧 SSE 载荷里可能同时带
//! **几件正交的事**（正文增量 / 工具调用增量 / 收尾标记），每件都要各自成立；
//! 工具调用的分片形状（`delta.tool_calls[i].function.arguments` 是分片拼接的）
//! 让它值得单独一处安放 —— 拼接与解析在 `tools.rs`，这里只负责"这一帧带了什么"。
//!
//! 单测与实现同文件（仓库惯例）。

use serde::Deserialize;

use super::tools::ToolCallDelta;

// ---- SSE 行解析 ----

/// 一帧 SSE 载荷里可能同时带**几件正交的事**：正文增量、工具调用增量、收尾标记。
///
/// 所以这里是一帧一个结构，不是一个"要么…要么…"的枚举 —— 枚举迟早会在某一帧
/// 同时出现两种时丢掉其中一种，而丢掉的那一半不会报错，只会让工具调用凭空消失
/// （正交结果各自上报，别把一个事实藏进另一个分支）。
#[derive(Default, Debug)]
pub(crate) struct SseFrame {
    /// `data: [DONE]`
    pub done: bool,
    /// 正文增量（空串不算增量）
    pub content: Option<String>,
    /// 工具调用增量（一帧可能带多个 index 的片）
    pub tool_calls: Vec<ToolCallDelta>,
}

/// 一行 `data:` 载荷 → 一帧。忽略注释行/心跳/畸形行（诚实跳过，不中断流）；
/// 什么都没带的帧（role 帧、空增量）返回 `None`，省一次 IPC。
pub(crate) fn parse_sse_data_line(line: &str) -> Option<SseFrame> {
    let payload = line.trim().strip_prefix("data:")?.trim();
    if payload == "[DONE]" {
        return Some(SseFrame {
            done: true,
            ..SseFrame::default()
        });
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
        /// 原生 tool-calling（F-15 §2.3）：`arguments` 是**分片**下发的，
        /// 这里只负责把这一帧带了什么如实搬出来，拼接与解析在 `tools.rs`
        #[serde(default)]
        tool_calls: Vec<WireToolCall>,
    }
    #[derive(Deserialize)]
    struct WireToolCall {
        #[serde(default)]
        index: u32,
        id: Option<String>,
        #[serde(default)]
        function: WireFunction,
    }
    #[derive(Deserialize, Default)]
    struct WireFunction {
        name: Option<String>,
        arguments: Option<String>,
    }
    let wire: Wire = serde_json::from_str(payload).ok()?;
    let delta = wire.choices.into_iter().next()?.delta;
    // 空串不是增量：每轮开头都有一帧只带 role 的 delta，推给前端只是白跑一次 IPC
    let content = delta.content.filter(|c| !c.is_empty());
    let tool_calls: Vec<ToolCallDelta> = delta
        .tool_calls
        .into_iter()
        .map(|t| ToolCallDelta {
            index: t.index,
            // 空 id / 空 name 等于没带：`None` 的意思是"这一片没说"，
            // 不能落成空串让上层以为"说了一个空名字"
            id: t.id.filter(|s| !s.is_empty()),
            name: t.function.name.filter(|s| !s.is_empty()),
            args: t.function.arguments,
        })
        .collect();
    if content.is_none() && tool_calls.is_empty() {
        return None;
    }
    Some(SseFrame {
        done: false,
        content,
        tool_calls,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_行解析() {
        let frame = parse_sse_data_line(r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#)
            .expect("应当解析出正文增量");
        assert_eq!(frame.content.as_deref(), Some("你好"));
        assert!(frame.tool_calls.is_empty());
        assert!(!frame.done);
        let done = parse_sse_data_line("data: [DONE]").expect("DONE 帧");
        assert!(done.done);
        assert!(done.content.is_none());
        // 忽略类：注释、无 data 前缀、畸形 JSON、role 帧（无 content）、空增量
        for ignored in [
            ": keep-alive",
            "event: ping",
            "data: {oops",
            r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#,
            r#"data: {"choices":[{"delta":{"content":""}}]}"#,
        ] {
            assert!(parse_sse_data_line(ignored).is_none(), "{ignored} 应被忽略");
        }
    }

    /// 工具调用增量：一帧只带一片 arguments 时也要如实搬出来（不在这一层拼接）
    #[test]
    fn sse_工具调用增量逐片给出() {
        let frame = parse_sse_data_line(
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"todo_add","arguments":"{\"ti"}}]}}]}"#,
        )
        .expect("工具调用帧");
        assert!(frame.content.is_none());
        assert_eq!(frame.tool_calls.len(), 1);
        let call = &frame.tool_calls[0];
        assert_eq!(call.index, 0);
        assert_eq!(call.id.as_deref(), Some("call_1"));
        assert_eq!(call.name.as_deref(), Some("todo_add"));
        assert_eq!(call.args.as_deref(), Some("{\"ti"));
        // 后续片只带 arguments：id / name 必须是 None（"这一片没说"，
        // 不许落成空串让上层以为"说了个空名字"）
        let later = parse_sse_data_line(
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"tle\":\"买菜\"}"}}]}}]}"#,
        )
        .expect("后续片");
        assert_eq!(later.tool_calls.len(), 1);
        assert!(later.tool_calls[0].id.is_none());
        assert!(later.tool_calls[0].name.is_none());
        assert_eq!(later.tool_calls[0].args.as_deref(), Some("tle\":\"买菜\"}"));
    }

    /// 一帧里同时带正文与工具调用：两件正交的事都不许丢
    #[test]
    fn sse_正文与工具同帧都留下() {
        let frame = parse_sse_data_line(
            r#"data: {"choices":[{"delta":{"content":"好","tool_calls":[{"index":1,"function":{"arguments":"{}"}}]}}]}"#,
        )
        .expect("同帧");
        assert_eq!(frame.content.as_deref(), Some("好"));
        assert_eq!(frame.tool_calls.len(), 1);
        assert_eq!(frame.tool_calls[0].index, 1);
        assert!(frame.tool_calls[0].id.is_none());
        assert_eq!(frame.tool_calls[0].args.as_deref(), Some("{}"));
    }
}
