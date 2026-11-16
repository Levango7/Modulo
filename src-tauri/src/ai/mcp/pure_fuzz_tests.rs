//! 安全 fuzz 用例：恶意字符串 / JSON 只喂纯解析函数，不碰进程、不读时钟。
//! 每条都断言「坏条目被丢、好条目逐字留下」，不写 `!list.is_empty()` 这种糊法。

use super::*;
use serde_json::json;

// 以下 11 条是加固笔的安全 fuzz：全部走真解析函数，断言「坏条目丢、好条目逐字留下」，
// 不用 `!list.is_empty()` 这种糊法。恶意输入只喂字符串 / JSON，不碰进程。

#[test]
fn 非法json一律空表() {
    for raw in ["{", "", "   ", "[", r#"{"servers":[}"#] {
        let list = parse_servers(raw);
        assert!(list.is_empty(), "非法 JSON 必须当没有服务：{raw:?}");
    }
}

#[test]
fn 顶层非数组一律空表() {
    for raw in ["{}", "null", "123", "\"x\"", "true"] {
        let list = parse_servers(raw);
        assert!(list.is_empty(), "顶层不是数组也不是 servers 对象：{raw:?}");
    }
}

#[test]
fn 数组元素非对象只丢自己() {
    let list = parse_servers(r#"[1,"x",null,[],{"name":"好","command":"node","args":[]},{}]"#);
    assert_eq!(list.len(), 1, "五个坏元素全丢、只留一个好条目");
    let c = &list[0];
    assert_eq!(
        (c.id.as_str(), c.name.as_str(), c.command.as_str()),
        ("s1", "好", "node")
    );
    assert!(
        c.args.is_empty() && !c.enabled,
        "好条目的其余字段必须逐字保留"
    );
}

#[test]
fn id缺失或非字符串按最小空位重排() {
    let list = parse_servers(
        r#"[
            {"name":"一","command":"node","args":[]},
            {"id":7,"name":"二","command":"node","args":[]},
            {"id":"","name":"三","command":"node","args":[]},
            {"id":"x9","name":"四","command":"node","args":[]}]"#,
    );
    let ids: Vec<&str> = list.iter().map(|s| s.id.as_str()).collect();
    let names: Vec<&str> = list.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(ids, ["s1", "s2", "s3", "s4"], "四种坏 id 都按最小空位补号");
    assert_eq!(names, ["一", "二", "三", "四"], "补号不能吞掉合法条目");
}

#[test]
fn id超长或含控制字符被重排() {
    let long_id = format!("s{}", "a".repeat(1001));
    let raw = json!([
        { "id": long_id, "name": "长", "command": "node", "args": [] },
        { "id": "s1\n", "name": "控", "command": "node", "args": [] }
    ]);
    let list = parse_servers(&raw.to_string());
    assert_eq!(list.len(), 2, "坏 id 不能让整条配置消失");
    assert_eq!((list[0].id.as_str(), list[0].name.as_str()), ("s1", "长"));
    assert_eq!((list[1].id.as_str(), list[1].name.as_str()), ("s2", "控"));
}

#[test]
fn 撞号重排不吞掉合法条目() {
    let list = parse_servers(
        r#"[
            {"id":"s1","name":"一","command":"node","args":[]},
            {"id":"s1","name":"二","command":"node","args":[]},
            {"id":"s1","name":"三","command":"node","args":[]}]"#,
    );
    let ids: Vec<&str> = list.iter().map(|s| s.id.as_str()).collect();
    let names: Vec<&str> = list.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(ids, ["s1", "s2", "s3"], "撞号必须重排，不能覆盖");
    assert_eq!(names, ["一", "二", "三"], "重排不能吞条目");
}

#[test]
fn enabled非布尔一律停用() {
    let list = parse_servers(
        r#"[
            {"name":"串","command":"node","args":[],"enabled":"true"},
            {"name":"数","command":"node","args":[],"enabled":1},
            {"name":"空","command":"node","args":[],"enabled":null},
            {"name":"缺","command":"node","args":[]},
            {"name":"真","command":"node","args":[],"enabled":true}]"#,
    );
    let got: Vec<bool> = list.iter().map(|s| s.enabled).collect();
    assert_eq!(
        got,
        [false, false, false, false, true],
        "只有字面 true 才算启用"
    );
}

#[test]
fn command非法一律丢_好条目留下() {
    let long_cmd = format!("n{}", "x".repeat(300));
    let raw = json!([
        { "name": "控", "command": "node\0x", "args": [] },
        { "name": "空", "command": "", "args": [] },
        { "name": "长", "command": long_cmd, "args": [] },
        { "name": "好", "command": "node", "args": [] }
    ]);
    let list = parse_servers(&raw.to_string());
    assert_eq!(list.len(), 1, "三种坏命令必须全丢");
    assert_eq!(
        (list[0].name.as_str(), list[0].command.as_str()),
        ("好", "node")
    );
}

#[test]
fn args非数组或含非字符串一律丢() {
    let raw = json!([
        { "name": "串", "command": "node", "args": "x" },
        { "name": "数", "command": "node", "args": [1] },
        { "name": "控", "command": "node", "args": ["ok", "bad\0arg"] },
        { "name": "缺", "command": "node" },
        { "name": "好", "command": "node", "args": ["--a", "b"] }
    ]);
    let list = parse_servers(&raw.to_string());
    assert_eq!(list.len(), 1, "四种坏 args 必须全丢");
    assert_eq!(list[0].name.as_str(), "好");
    assert_eq!(list[0].args, ["--a".to_string(), "b".to_string()]);
}

#[test]
fn pick注入式id报错且不panic() {
    let list = parse_servers(
        r#"[
            {"id":"s1","name":"好","command":"node","args":[],"enabled":true},
            {"id":"s2","name":"停","command":"node","args":[],"enabled":false}]"#,
    );
    for bad in ["s1\n", "s1\0", "s1/../../x", "", "s1\r"] {
        let err = pick(&list, bad).expect_err("注入式 id 必须报错");
        assert!(err.contains("找不到"), "未知 id 应当报找不到：{err}");
    }
    let err = pick(&list, "s2").expect_err("停用服务必须报错");
    assert!(err.contains("停用"), "停用要给独立理由：{err}");
    assert_eq!(pick(&list, "s1").expect("正常 id 应当取到").name, "好");
}

#[test]
fn require_confirmed拒绝信息不含敏感信息() {
    let err = require_confirmed(false, "甲服务").expect_err("未确认必须拒");
    assert!(
        err.contains("甲服务"),
        "错误里要留下服务名供用户定位：{err}"
    );
    assert!(err.contains("确认"), "错误信息要说明下一步：{err}");
    let low = err.to_lowercase();
    for leak in [
        "token", "password", "secret", "apikey", "command", "args", "node", "/",
    ] {
        assert!(!low.contains(leak), "错误信息不该带 {leak}：{err}");
    }
    assert!(require_confirmed(true, "甲服务").is_ok(), "确认过就放行");
}
