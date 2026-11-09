//! F4b 验收用例（对应《F4b 规格》§8 的 15 条，拆成可定位的独立断言）。
//! 变异抽查的三颗「钉子」也在这里：放宽版本集合 / 把 `\r` trim 改成全局 trim /
//! 把 `isError` 当错误处理，都必须红在各自目标断言上。

use super::limits::{truncate_by_points, MCP_LINE_MAX, MCP_RESULT_MAX};
use super::protocol::*;
use super::state::*;
use super::types::*;
use super::views::*;
use serde_json::json;

fn init_ok() -> String {
    json!({
        "jsonrpc": "2.0", "id": 1,
        "result": {
            "protocolVersion": "2025-06-18",
            "capabilities": { "tools": { "listChanged": true } },
            "serverInfo": { "name": "demo", "version": "1.0" }
        }
    })
    .to_string()
}

// ---------- 验收 1：编码 ----------

#[test]
fn 编码输出不含裸换行且换行参数被转义() {
    let msg = Outgoing::Request {
        id: Id::Num(1),
        method: "tools/call".to_string(),
        params: Some(json!({"text": "第一行\n第二行"})),
    };
    let line = encode_line(&msg).unwrap();
    assert!(!line.contains('\n'));
    assert!(!line.contains('\r'));
    assert!(line.contains("\\n"));
    assert!(line.contains("\"jsonrpc\":\"2.0\""));
    // 转义是无损的：解析回 Value 后仍是真正的换行字符，不是字面量 "\\n"。
    let v: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(v["params"]["text"], "第一行\n第二行");
}

#[test]
fn 通知不带id() {
    let line = encode_line(&Outgoing::Notification {
        method: "notifications/initialized".to_string(),
        params: None,
    })
    .unwrap();
    assert_eq!(line, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
}

// ---------- 验收 2：六种畸形各报各自理由 ----------

#[test]
fn 畸形状逐条独立理由() {
    let cases: Vec<(&str, CodecError)> = vec![
        ("", CodecError::EmptyLine),
        (r#"[{"jsonrpc":"2.0"}]"#, CodecError::BatchNotSupported),
        (r#"{"jsonrpc":"1.0","id":1,"result":{}}"#, CodecError::WrongVersion("1.0".into())),
        (r#"{"jsonrpc":"2.0","id":null,"result":{}}"#, CodecError::NullId),
        (r#"{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":-1,"message":"x"}}"#, CodecError::ResultAndError),
        (r#"{"jsonrpc":"2.0","id":1}"#, CodecError::NeitherResultNorError),
        (r#"{"id":1,"result":{}}"#, CodecError::MissingField("jsonrpc")),
    ];
    for (line, want) in cases {
        let got = decode_line(line).unwrap_err();
        assert_eq!(got, want, "输入：{line}");
    }
    assert!(matches!(decode_line("not json").unwrap_err(), CodecError::Parse(_)));
}

#[test]
fn 未知字段前向兼容() {
    let got = decode_line(r#"{"jsonrpc":"2.0","id":"abc","result":{},"future":123}"#).unwrap();
    assert_eq!(
        got,
        Incoming::Response {
            id: Id::Str("abc".into()),
            result: Some(json!({})),
            error: None
        }
    );
}

#[test]
fn 服务主动请求带得出方法名() {
    let got = decode_line(
        r#"{"jsonrpc":"2.0","id":9,"method":"sampling/createMessage","params":{}}"#,
    )
    .unwrap();
    assert_eq!(
        got,
        Incoming::ServerRequest {
            id: Id::Num(9),
            method: "sampling/createMessage".into()
        }
    );
}

// ---------- 验收 3：LineReader ----------

#[test]
fn 切行处理lf与crlf且保留半包() {
    let mut r = LineReader::new();
    assert_eq!(r.push("a\nb\r\n").unwrap(), vec!["a", "b"]);
    assert_eq!(r.push("c").unwrap(), Vec::<String>::new());
    assert_eq!(r.take_pending(), Some("c"));
    assert_eq!(r.push("d\n").unwrap(), vec!["cd"]);
    assert_eq!(r.take_pending(), None);
}

#[test]
fn 变异钉子_不做全局trim() {
    let mut r = LineReader::new();
    // 若把「只 trim 行尾单个 \r」改成全局 trim()，这两行会被改掉 ⇒ 红在本条。
    assert_eq!(
        r.push("  {\"x\":1}\n\t{\"y\":2}\n").unwrap(),
        vec!["  {\"x\":1}", "\t{\"y\":2}"]
    );
    assert_eq!(r.push("tail  \r\n").unwrap(), vec!["tail  "]);
}

#[test]
fn 空行作为可断言结果交给解码层() {
    let mut r = LineReader::new();
    assert_eq!(r.push("a\n\nb\n").unwrap(), vec!["a", "", "b"]);
    assert_eq!(decode_line("").unwrap_err(), CodecError::EmptyLine);
}

#[test]
fn 超长行与超长半包都立即报错() {
    let big = "x".repeat(MCP_LINE_MAX + 1);
    assert_eq!(
        decode_line(&big).unwrap_err(),
        CodecError::LineTooLong { bytes: MCP_LINE_MAX + 1, max: MCP_LINE_MAX }
    );
    let mut r = LineReader::new();
    assert!(matches!(r.push(&big).unwrap_err(), CodecError::LineTooLong { .. }));
}

// ---------- 验收 4 / 9 / 10 / 11：类型视图 ----------

#[test]
fn initialize请求三要素齐全() {
    let (_, req) = initialize_request();
    let line = encode_line(&req).unwrap();
    let v: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(v["method"], "initialize");
    assert_eq!(v["params"]["protocolVersion"], PROTOCOL_VERSION);
    assert!(v["params"]["capabilities"].is_object());
    assert_eq!(v["params"]["clientInfo"]["name"], "Modulo");
}

#[test]
fn initialize响应解析出能力与服务名() {
    let v: serde_json::Value = serde_json::from_str(&init_ok()).unwrap();
    let info = parse_initialize_result(&v["result"]).unwrap();
    assert_eq!(info.protocol_version, "2025-06-18");
    assert!(info.has_tools);
    assert_eq!(info.server_name.as_deref(), Some("demo"));
}

#[test]
fn 分页未翻页要如实标注() {
    let v = json!({
        "tools": [{"name":"a","inputSchema":{"type":"object"}}],
        "nextCursor": "page-2"
    });
    let r = parse_tools_list(&v).unwrap();
    assert_eq!(r.tools.len(), 1);
    assert!(r.is_partial());
    assert_eq!(r.notice().unwrap(), "还有下一页工具，这一版只取第一页");
}

#[test]
fn 工具太多或缺名字都拒收() {
    let arr: Vec<_> = (0..65)
        .map(|i| json!({"name": format!("t{i}"), "inputSchema": {}}))
        .collect();
    assert_eq!(
        parse_tools_list(&json!({"tools": arr})).unwrap_err(),
        CodecError::TooManyTools(65)
    );
    assert!(matches!(
        parse_tools_list(&json!({"tools":[{"inputSchema":{}}]})).unwrap_err(),
        CodecError::BadTool(_)
    ));
}

#[test]
fn 变异钉子_iserror是真值不是错误响应() {
    // 把 isError 当协议错误处理，会红在本条的 is_error 断言上。
    let v = json!({
        "content": [{"type":"text","text":"API 限流了"}],
        "isError": true
    });
    let r = parse_call_tool_result(&v).unwrap();
    assert!(r.is_error);
    assert_eq!(r.content.len(), 1);
    assert_eq!(r.content[0].text.as_deref(), Some("API 限流了"));
}

#[test]
fn 非文字内容保留类型不静默丢() {
    let v = json!({"content": [
        {"type":"text","text":"ok"},
        {"type":"image","data":"AAAA","mimeType":"image/png"},
        {"type":"mystery"}
    ]});
    let r = parse_call_tool_result(&v).unwrap();
    assert_eq!(r.content.len(), 3);
    assert_eq!(r.content[0].kind, ContentKind::Text);
    assert_eq!(r.content[1].kind, ContentKind::Image);
    assert_eq!(r.content[1].text, None);
    assert_eq!(r.content[2].kind, ContentKind::Unknown("mystery".into()));
}

#[test]
fn 错误映射保留原始code与message() {
    let e = RpcError { code: -32602, message: "Unknown tool: x".into(), data: None };
    let s = describe_rpc_error(&e);
    assert!(s.contains("参数不合法"));
    assert!(s.contains("-32602"));
    assert!(s.contains("Unknown tool: x"));
}

// ---------- 验收 5 / 6 / 7 / 8 / 13：状态机 ----------

#[test]
fn 成功路径只发一条initialized通知() {
    let (phase, _) = initialize_request();
    let msg = decode_line(&init_ok()).unwrap();
    let (next, outs) = on_incoming(&phase, msg);
    assert_eq!(next, Phase::Ready);
    assert_eq!(outs.len(), 1);
    assert_eq!(
        outs[0],
        Outgoing::Notification { method: "notifications/initialized".into(), params: None }
    );
    assert_eq!(
        encode_line(&outs[0]).unwrap(),
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#
    );
}

#[test]
fn 变异钉子_版本集合只能有一个值() {
    // 放宽 SUPPORTED_VERSIONS 会红在这条，且下面的 2026-07-28 用例也会红。
    assert_eq!(SUPPORTED_VERSIONS, &["2025-06-18"]);
    assert_eq!(PROTOCOL_VERSION, "2025-06-18");
}

#[test]
fn 版本不匹配文案逐字可断言() {
    let line = init_ok().replace("2025-06-18", "2026-07-28");
    let (phase, _) = initialize_request();
    let (next, outs) = on_incoming(&phase, decode_line(&line).unwrap());
    assert_eq!(
        next,
        Phase::Failed("这个服务用的是 MCP 2026-07-28，这一版还没支持".into())
    );
    assert!(outs.is_empty());
}

#[test]
fn 未声明工具能力文案逐字可断言() {
    // 直接构造，别用 replace 去猜 `json!` 宏的紧凑输出格式。
    let line = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"demo"}}}"#;
    let (phase, _) = initialize_request();
    let (next, _) = on_incoming(&phase, decode_line(&line).unwrap());
    assert_eq!(next, Phase::Failed("这个服务没有声明工具能力".into()));
}

#[test]
fn initialize返回错误时不吞错误码() {
    let line = r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Unsupported protocol version"}}"#;
    let (phase, _) = initialize_request();
    let (next, _) = on_incoming(&phase, decode_line(line).unwrap());
    let Phase::Failed(s) = next else { panic!("应当失败") };
    assert!(s.contains("-32602"));
    assert!(s.contains("Unsupported protocol version"));
}

#[test]
fn id不匹配不认领响应() {
    let line = init_ok().replace("\"id\":1", "\"id\":2");
    let (phase, _) = initialize_request();
    let (next, _) = on_incoming(&phase, decode_line(&line).unwrap());
    assert!(matches!(next, Phase::Failed(_)));
}

#[test]
fn ready之前拒发tools请求() {
    let (phase, _) = initialize_request();
    for method in ["tools/list", "tools/call"] {
        let req = Outgoing::Request { id: Id::Num(2), method: method.into(), params: None };
        assert_eq!(on_outgoing(&phase, &req).unwrap_err(), CodecError::NotReady);
    }
}

#[test]
fn initialized通知在初始化期放行且ready后全放行() {
    let (phase, _) = initialize_request();
    let note = Outgoing::Notification { method: "notifications/initialized".into(), params: None };
    assert!(on_outgoing(&phase, &note).is_ok());
    let req = Outgoing::Request { id: Id::Num(2), method: "tools/list".into(), params: None };
    assert!(on_outgoing(&Phase::Ready, &req).is_ok());
}

#[test]
fn ready期服务主动请求被明确拒绝() {
    let msg = Incoming::ServerRequest { id: Id::Num(9), method: "elicitation/create".into() };
    let (next, _) = on_incoming(&Phase::Ready, msg);
    assert!(matches!(next, Phase::Failed(ref s) if s.contains("elicitation/create")));
}

#[test]
fn 失败态不再放行任何外发() {
    let p = Phase::Failed("版本不支持".into());
    let req = Outgoing::Request { id: Id::Num(2), method: "tools/list".into(), params: None };
    assert_eq!(
        on_outgoing(&p, &req).unwrap_err(),
        CodecError::SessionFailed("版本不支持".into())
    );
}

// ---------- 验收 12：与 limits 的联合口径 ----------

#[test]
fn 工具结果超长截断并记账() {
    let long = "😀".repeat(MCP_RESULT_MAX + 10);
    let (cut, truncated) = truncate_by_points(&long, MCP_RESULT_MAX);
    assert!(truncated);
    assert_eq!(cut.chars().count(), MCP_RESULT_MAX);
    assert_eq!(cut, "😀".repeat(MCP_RESULT_MAX));
}

// ---------- 独立 QA 首轮 fail 的 3 条 blocking 回归 ----------

#[test]
fn b1回归_错误data里的supported版本不被吞() {
    let line = r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Unsupported protocol version","data":{"supported":["2025-03-26","2024-11-05"]}}}"#;
    let (phase, _) = initialize_request();
    let (next, _) = on_incoming(&phase, decode_line(line).unwrap());
    let Phase::Failed(s) = next else { panic!("应当失败") };
    assert!(s.contains("-32602"));
    assert!(s.contains("Unsupported protocol version"));
    // 版本协商失败时，data.supported 是唯一能告诉上层该降到哪版的字段。
    assert!(s.contains("2025-03-26"), "实际文案：{s}");
    assert!(s.contains("2024-11-05"));
    // 也直接钉住纯函数本身
    let e = RpcError {
        code: -32602,
        message: "Unsupported protocol version".into(),
        data: Some(json!({"supported": ["2025-03-26"]})),
    };
    assert!(describe_rpc_error(&e).contains("2025-03-26"));
}

#[test]
fn b2回归_method非字符串绝不降级成响应() {
    // 首轮 QA 复现：这条曾让状态机误判握手完成并发出 initialized。
    let line = r#"{"jsonrpc":"2.0","id":1,"method":123,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}}}}"#;
    assert_eq!(decode_line(line).unwrap_err(), CodecError::BadMethod);
    for bad in ["null", "{}", "[]", "true", "\"\""] {
        let s = format!(
            r#"{{"jsonrpc":"2.0","id":1,"method":{bad},"result":{{}}}}"#
        );
        assert_eq!(decode_line(&s).unwrap_err(), CodecError::BadMethod, "输入：{s}");
    }
    // 合法 method 又带 result：矛盾形状，独立理由拒收。
    let contradictory = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","result":{}}"#;
    assert_eq!(
        decode_line(contradictory).unwrap_err(),
        CodecError::RequestHasResult
    );
}

#[test]
fn b3回归_字段类型非法不能静默当缺省值() {
    // nextCursor 畸形 ⇒ 不能假装「已拿全」
    for bad in ["123", "null", "{}", "true"] {
        let v: serde_json::Value =
            serde_json::from_str(&format!(r#"{{"tools":[],"nextCursor":{bad}}}"#)).unwrap();
        assert_eq!(
            parse_tools_list(&v).unwrap_err(),
            CodecError::BadField("nextCursor"),
            "nextCursor={bad}"
        );
    }
    // isError 畸形 ⇒ 不能静默当 false
    for bad in ["\"true\"", "1", "null", "{}"] {
        let v: serde_json::Value =
            serde_json::from_str(&format!(r#"{{"content":[],"isError":{bad}}}"#)).unwrap();
        assert_eq!(
            parse_call_tool_result(&v).unwrap_err(),
            CodecError::BadField("isError"),
            "isError={bad}"
        );
    }
    // params 非 Array/Object ⇒ 拒收
    for bad in ["123", "\"oops\"", "null", "true"] {
        let s = format!(r#"{{"jsonrpc":"2.0","method":"notifications/x","params":{bad}}}"#);
        assert_eq!(
            decode_line(&s).unwrap_err(),
            CodecError::BadField("params"),
            "输入：{s}"
        );
    }
    // error 缺 message / code 越界 ⇒ 拒收（不再静默 "" 或 as i32 环绕）
    let no_msg = r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32603}}"#;
    assert_eq!(
        decode_line(no_msg).unwrap_err(),
        CodecError::MissingField("error.message")
    );
    let big_code = r#"{"jsonrpc":"2.0","id":1,"error":{"code":2147483648,"message":"x"}}"#;
    assert_eq!(decode_line(big_code).unwrap_err(), CodecError::BadErrorCode);
    // 工具缺 inputSchema ⇒ 拒收，不静默补 {}
    assert!(matches!(
        parse_tools_list(&json!({"tools":[{"name":"a"}]})).unwrap_err(),
        CodecError::BadTool(_)
    ));
}

// ---------- QA advisory 的补强 ----------

#[test]
fn 判据11_非文字内容产出可展示文案() {
    let v = json!({"content": [
        {"type":"text","text":"ok"},
        {"type":"image","data":"AAAA"},
        {"type":"audio","data":"BBBB"}
    ]});
    let r = parse_call_tool_result(&v).unwrap();
    assert_eq!(
        r.notice(),
        Some("这一版只收文字结果，另有 2 项非文字内容未展示".into())
    );
    let text_only = parse_call_tool_result(&json!({"content":[{"type":"text","text":"ok"}]})).unwrap();
    assert_eq!(text_only.notice(), None);
}

#[test]
fn 补钉子_badid() {
    for bad in ["1.5", "1.0", "{}", "true", "false", "[]"] {
        let s = format!(r#"{{"jsonrpc":"2.0","id":{bad},"result":{{}}}}"#);
        assert_eq!(decode_line(&s).unwrap_err(), CodecError::BadId, "输入：{s}");
    }
}

#[test]
fn 补钉子_crlf跨chunk边界() {
    let mut r = LineReader::new();
    assert_eq!(r.push("{\"a\":1}\r").unwrap(), Vec::<String>::new());
    assert_eq!(r.take_pending(), Some("{\"a\":1}\r"));
    assert_eq!(r.push("\nNEXT\n").unwrap(), vec!["{\"a\":1}", "NEXT"]);
    assert_eq!(r.take_pending(), None);
}

#[test]
fn 补钉子_初始化期服务主动请求被拒绝() {
    let (phase, _) = initialize_request();
    let msg = Incoming::ServerRequest { id: Id::Num(9), method: "sampling/createMessage".into() };
    let (next, outs) = on_incoming(&phase, msg);
    assert!(matches!(next, Phase::Failed(ref s) if s.contains("sampling/createMessage")));
    assert!(outs.is_empty());
}

#[test]
fn 如实登记_截断按码点而非字素簇() {
    // ZWJ family emoji 是 7 个码点。按码点截断**会**切开字素簇 —— 这是规格选定的口径，
    // 不假装「emoji 不被劈开」；这一条把这个行为如实钉住，避免以后有人误以为是 bug 又改回去。
    let family = "👨‍👩‍👧‍👦";
    assert_eq!(family.chars().count(), 7);
    let s = family.repeat(3);
    let (cut, truncated) = truncate_by_points(&s, 8);
    assert!(truncated);
    assert_eq!(cut.chars().count(), 8);
    // 组合字符同理：e + U+0301 是两个码点。
    let combo = "e\u{301}".repeat(10);
    let (c2, _) = truncate_by_points(&combo, 3);
    assert_eq!(c2.chars().count(), 3);
}

#[test]
fn 如实登记_f4b本层不截断由f4c负责() {
    // 「折进提示词时截断」归 F4c（见 §12.76「没做的」）；本层只保留全文。
    // 这条契约钉住「不是漏调用」，免得搬运后有人以为要在 parse 里截断。
    let long = "字".repeat(MCP_RESULT_MAX + 100);
    let r = parse_call_tool_result(&json!({"content":[{"type":"text","text": long}]})).unwrap();
    assert_eq!(r.content[0].text.as_ref().unwrap().chars().count(), MCP_RESULT_MAX + 100);
    assert_eq!(r.notice(), None);
}

// ---------- 独立 QA 二次 fail 的 1 条 blocking 回归 + 同族系统排查 ----------

#[test]
fn b4回归_content缺失或类型非法绝不静默当成功零输出() {
    // 二次 QA 复现：这五种输入原本全部返回 Ok(CallToolResult { content: [], is_error: false })，
    // 等于把畸形响应伪装成「工具执行成功、零输出」。
    for bad in [
        r#"{"content":123}"#,
        r#"{"content":null}"#,
        r#"{"content":"oops"}"#,
        r#"{"content":{}}"#,
        r#"{"content":true}"#,
    ] {
        let v: serde_json::Value = serde_json::from_str(bad).unwrap();
        assert_eq!(
            parse_call_tool_result(&v).unwrap_err(),
            CodecError::BadField("content"),
            "输入：{bad}"
        );
    }
    // 整字段缺失另给独立理由，不与「类型非法」混为一谈。
    let v: serde_json::Value = serde_json::from_str(r#"{}"#).unwrap();
    assert_eq!(
        parse_call_tool_result(&v).unwrap_err(),
        CodecError::MissingField("content")
    );
    // 合法空数组当然仍是「成功、零输出」，但必须显式给过 content，不是靠缺省兜底伪造。
    let r = parse_call_tool_result(&json!({"content": []})).unwrap();
    assert!(r.content.is_empty());
    assert!(!r.is_error);
}

#[test]
fn b4回归_content数组里的项形状逐条严查() {
    let cases: Vec<(&str, CodecError)> = vec![
        (r#"{"content":[123]}"#, CodecError::InvalidShape("content[0] 不是对象".into())),
        (r#"{"content":[{"data":"x"}]}"#, CodecError::MissingField("content.type")),
        (r#"{"content":[{"type":123}]}"#, CodecError::BadField("content.type")),
        (r#"{"content":[{"type":"text"}]}"#, CodecError::MissingField("content.text")),
        (r#"{"content":[{"type":"text","text":123}]}"#, CodecError::BadField("content.text")),
    ];
    for (line, want) in cases {
        let v: serde_json::Value = serde_json::from_str(line).unwrap();
        assert_eq!(parse_call_tool_result(&v).unwrap_err(), want, "输入：{line}");
    }
    // 非 text 类型不强求 text（image 的 data / mimeType 归 F4c）。
    let v = json!({"content":[{"type":"image","data":"AAAA"}]});
    let r = parse_call_tool_result(&v).unwrap();
    assert_eq!(r.content[0].kind, ContentKind::Image);
    assert_eq!(r.content[0].text, None);
}

#[test]
fn 补强_error字段存在性与类型分流() {
    for (line, want) in [
        (r#"{"jsonrpc":"2.0","id":1,"error":{"message":"x"}}"#, CodecError::MissingField("error.code")),
        (r#"{"jsonrpc":"2.0","id":1,"error":{"code":"-1","message":"x"}}"#, CodecError::BadField("error.code")),
        (r#"{"jsonrpc":"2.0","id":1,"error":{"code":-1}}"#, CodecError::MissingField("error.message")),
        (r#"{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":123}}"#, CodecError::BadField("error.message")),
    ] {
        assert_eq!(decode_line(line).unwrap_err(), want, "输入：{line}");
    }
}

#[test]
fn 补强_tools与inputschema形状分流() {
    assert_eq!(
        parse_tools_list(&json!({})).unwrap_err(),
        CodecError::MissingField("tools")
    );
    for bad in ["123", "null", "{}", "\"oops\""] {
        let v: serde_json::Value =
            serde_json::from_str(&format!(r#"{{"tools":{bad}}}"#)).unwrap();
        assert_eq!(
            parse_tools_list(&v).unwrap_err(),
            CodecError::BadField("tools"),
            "tools={bad}"
        );
    }
    // inputSchema 存在但不是对象：不能当合法 JSON Schema 往下带。
    for bad in ["123", "null", "[]", "\"oops\""] {
        let v: serde_json::Value = serde_json::from_str(&format!(
            r#"{{"tools":[{{"name":"a","inputSchema":{bad}}}]}}"#
        ))
        .unwrap();
        assert!(
            matches!(parse_tools_list(&v).unwrap_err(), CodecError::BadTool(ref s) if s.contains("inputSchema")),
            "inputSchema={bad}"
        );
    }
    // 数组项不是对象 ⇒ 独立理由，不是含糊的「缺 name」。
    assert!(matches!(
        parse_tools_list(&json!({"tools":[123]})).unwrap_err(),
        CodecError::BadTool(ref s) if s.contains("不是对象")
    ));
}

#[test]
fn 补强_capabilities与protocolversion形状分流() {
    // capabilities 非对象：不能静默判成「这个服务没有声明工具能力」。
    for bad in ["123", "null", "[]", "\"oops\""] {
        let v: serde_json::Value = serde_json::from_str(&format!(
            r#"{{"protocolVersion":"2025-06-18","capabilities":{bad}}}"#
        ))
        .unwrap();
        assert_eq!(
            parse_initialize_result(&v).unwrap_err(),
            CodecError::BadField("capabilities"),
            "capabilities={bad}"
        );
    }
    assert_eq!(
        parse_initialize_result(&json!({"protocolVersion":"2025-06-18"})).unwrap_err(),
        CodecError::MissingField("capabilities")
    );
    assert_eq!(
        parse_initialize_result(&json!({"protocolVersion":123,"capabilities":{}})).unwrap_err(),
        CodecError::BadField("protocolVersion")
    );
    assert_eq!(
        parse_initialize_result(&json!({"capabilities":{}})).unwrap_err(),
        CodecError::MissingField("protocolVersion")
    );
}

#[test]
fn 补强_初始化响应解析失败时理由不被吞() {
    // 与 B1 同族：状态机不能把 parse 的具体错误折成一句笼统文案。
    let line = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":123}}"#;
    let (phase, _) = initialize_request();
    let (next, outs) = on_incoming(&phase, decode_line(line).unwrap());
    let Phase::Failed(s) = next else { panic!("应当失败") };
    assert!(s.contains("capabilities"), "实际文案：{s}");
    assert!(outs.is_empty());
}

#[test]
fn 补强_result与error并存的理由优先于带method的矛盾() {
    let line = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","result":{},"error":{"code":-1,"message":"x"}}"#;
    assert_eq!(decode_line(line).unwrap_err(), CodecError::ResultAndError);
}

#[test]
fn 如实登记_可选不可信展示字段宽松忽略() {
    // 分级：必填 / 影响判定的字段严查；server 给的可选展示字段本就不可信（P11），
    // 取不到就当没有，不把畸形值塞进上层。这条把「宽松」也钉住，避免被误改成硬拒。
    let v = json!({
        "protocolVersion": "2025-06-18",
        "capabilities": { "tools": {} },
        "serverInfo": { "name": 123 },
        "instructions": 456
    });
    let info = parse_initialize_result(&v).unwrap();
    assert_eq!(info.server_name, None);
    assert_eq!(info.instructions, None);
    assert!(info.has_tools);
    let t = json!({"tools":[{"name":"a","title":123,"description":[],"inputSchema":{}}]});
    let r = parse_tools_list(&t).unwrap();
    assert_eq!(r.tools[0].title, None);
    assert_eq!(r.tools[0].description, None);
}

// ---------- 第三次 QA 的 A1/A2/A3 回归（本笔提前补掉，不留到搬运） ----------

#[test]
fn a1回归_capabilities_tools值非法不驱动握手完成() {
    for bad in [json!(false), json!(null), json!(123), json!("x"), json!([])] {
        let v = json!({
            "jsonrpc": "2.0", "id": 1,
            "result": {
                "protocolVersion": "2025-06-18",
                "capabilities": { "tools": bad }
            }
        });
        let (phase, _) = initialize_request();
        let (next, outs) = on_incoming(&phase, decode_line(&v.to_string()).unwrap());
        let Phase::Failed(s) = next else { panic!("tools={bad} 竟让握手完成") };
        assert!(s.contains("capabilities.tools"), "实际文案：{s}");
        assert!(outs.is_empty());
    }
    // 合法形态：空对象 / 带 listChanged ⇒ 仍 Ready，不能被值域校验误伤。
    for good in [json!({}), json!({"listChanged": true})] {
        let v = json!({
            "jsonrpc": "2.0", "id": 1,
            "result": {
                "protocolVersion": "2025-06-18",
                "capabilities": { "tools": good }
            }
        });
        let (phase, _) = initialize_request();
        let (next, outs) = on_incoming(&phase, decode_line(&v.to_string()).unwrap());
        assert_eq!(next, Phase::Ready);
        assert_eq!(outs.len(), 1);
    }
    // 缺 tools key 仍是「没声明工具能力」，不是「字段类型非法」。
    let line = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}"#;
    let (phase, _) = initialize_request();
    let (next, _) = on_incoming(&phase, decode_line(line).unwrap());
    assert_eq!(next, Phase::Failed("这个服务没有声明工具能力".into()));
}

#[test]
fn a2回归_jsonrpc类型非法给独立理由() {
    for bad in [json!(123), json!(null), json!({}), json!(true), json!([])] {
        let v = json!({"jsonrpc": bad, "id": 1, "result": {}});
        assert_eq!(
            decode_line(&v.to_string()).unwrap_err(),
            CodecError::BadField("jsonrpc")
        );
    }
    assert_eq!(
        decode_line(r#"{"id":1,"result":{}}"#).unwrap_err(),
        CodecError::MissingField("jsonrpc")
    );
    assert_eq!(
        decode_line(r#"{"jsonrpc":"1.0","id":1,"result":{}}"#).unwrap_err(),
        CodecError::WrongVersion("1.0".into())
    );
}

#[test]
fn a3回归_content的type空串与method空串同口径() {
    let v = json!({"content": [{"type": "", "text": "x"}]});
    assert!(matches!(
        parse_call_tool_result(&v).unwrap_err(),
        CodecError::InvalidShape(ref s) if s.contains("不能为空")
    ));
    assert_eq!(
        decode_line(r#"{"jsonrpc":"2.0","method":"","params":{}}"#).unwrap_err(),
        CodecError::BadMethod
    );
}
