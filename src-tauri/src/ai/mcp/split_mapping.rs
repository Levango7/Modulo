//! F4b 步骤 B 的「改一个不碰另一个」定点映射用例（铁律 19）。
//!
//! 拆分后三层职责：`protocol.rs` 只管「这一行是不是合法 JSON-RPC 消息」，
//! `views.rs` 才管 `result` 的形状，`types.rs` 只管错误文案，`limits.rs` 只管截断。
//! 这组用例钉住：动其中一层的判据，不该改变另一层对同一段输入的结论。

use super::limits::{truncate_by_points, MCP_RESULT_MAX};
use super::protocol::*;
use super::types::*;
use super::views::*;
use serde_json::json;

#[test]
fn 定点映射_帧层认得的响应视图层可以拒收() {
    // 同一段 JSON：帧层只解析信封，视图层才判定 result 形状。
    let line = r#"{"jsonrpc":"2.0","id":7,"result":{"content":123}}"#;
    let msg = decode_line(line).unwrap();
    assert_eq!(
        msg,
        Incoming::Response {
            id: Id::Num(7),
            result: Some(json!({"content":123})),
            error: None,
        }
    );
    let Incoming::Response { result, .. } = msg else {
        panic!("应当是响应")
    };
    assert_eq!(
        parse_call_tool_result(result.as_ref().unwrap()).unwrap_err(),
        CodecError::BadField("content")
    );
}

#[test]
fn 定点映射_视图层不截断限额层才截断() {
    let long = "字".repeat(MCP_RESULT_MAX + 100);
    let v = json!({"content": [{"type": "text", "text": long.clone()}]});
    let r = parse_call_tool_result(&v).unwrap();
    assert_eq!(
        r.content[0].text.as_ref().unwrap().chars().count(),
        MCP_RESULT_MAX + 100
    );
    let (cut, truncated) = truncate_by_points(&long, MCP_RESULT_MAX);
    assert!(truncated);
    assert_eq!(cut.chars().count(), MCP_RESULT_MAX);
}

#[test]
fn 定点映射_错误文案只在types层帧层解析不拼文案() {
    let line = r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Unknown tool"}}"#;
    let Incoming::Response { error: Some(e), .. } = decode_line(line).unwrap() else {
        panic!("应当解析出 error")
    };
    assert_eq!(e.code, -32602);
    assert_eq!(e.message, "Unknown tool");
    assert!(describe_rpc_error(&e).contains("参数不合法"));
    assert_eq!(
        label_incoming(&Incoming::Notification {
            method: "notifications/initialized".into(),
            params: None,
        }),
        "通知"
    );
}
