//! MCP 服务配置的**纯判定层**（F4c-2 第一笔拆出）。
//!
//! 只吃字符串与 JSON：盘上文档的容错解析、三格字段闸门、`pick`、J4 的确认闸门、
//! `tools/call` 的参数体。**不读盘、不起进程、不看时钟** —— 所以能整段复制到仓外跑
//! （`/f/tmp/f4c2-pure2` 的 `include!` 就是这一份原文），因此这里不许出现 `super::` / `crate::`。
//!
//! 判据与 `src/vue/mcp.ts` 的 `parseServers` / `checkFields` 逐条对齐：同一条坏数据
//! 两边都得丢，否则「界面里看不见、Rust 却会去跑」就成了暗门。

use serde_json::Value;

// 与 `src/vue/mcp.ts` 同名常量逐个同值，改这里必须同步改那边。
pub const MCP_MAX: usize = 8;
pub const MCP_NAME_MAX: usize = 40;
pub const MCP_CMD_MAX: usize = 260;
pub const MCP_ARGS_MAX: usize = 12;
pub const MCP_ARG_MAX: usize = 260;

#[derive(Debug, Clone, PartialEq)]
pub struct ServerCfg {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub enabled: bool,
}

/// 码点计数。尺子只用 `.count()`（本仓为 `chars().take().collect()` 栽过 0xC0000139）。
fn point_count(s: &str) -> usize {
    s.chars().count()
}

/// 换行 / 回车 / NUL 一律拒收：命令要交给进程执行，静默改写 argv 比报错更危险。
fn has_control(s: &str) -> bool {
    s.chars().any(|c| c == '\n' || c == '\r' || c == '\0')
}

/// `s` + 数字且首位非 0（TS 侧 `/^s[1-9][0-9]*$/`）。
fn valid_id(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 2 && b[0] == b's' && b[1] != b'0' && b[1..].iter().all(u8::is_ascii_digit)
}

/// 取最小空位：`s1`、`s2`……删了再加不会一路涨。
fn next_id(taken: &[ServerCfg]) -> String {
    let mut n = 1usize;
    while taken.iter().any(|x| x.id == format!("s{n}")) {
        n += 1;
    }
    format!("s{n}")
}

/// 单条清洗。三格字段与 TS 侧 `checkFields` 同判（名字 / 命令 / 参数，全角空格与
/// 双引号都拒收）；给不出合法的一条就 `None`，不替用户补。
fn parse_one(row: &Value, taken: &[ServerCfg]) -> Option<ServerCfg> {
    let o = row.as_object()?;
    let name = o.get("name")?.as_str()?.trim();
    let command = o.get("command")?.as_str()?.trim();
    let mut args = Vec::new();
    for a in o.get("args")?.as_array()? {
        args.push(a.as_str()?.to_string());
    }
    if name.is_empty()
        || command.is_empty()
        || point_count(name) > MCP_NAME_MAX
        || point_count(command) > MCP_CMD_MAX
        || has_control(name)
        || has_control(command)
        || command.contains('"')
        || command.contains('\u{3000}')
        || args.len() > MCP_ARGS_MAX
    {
        return None;
    }
    for a in &args {
        let bad = has_control(a)
            || a.contains('"')
            || a.contains('\u{3000}')
            || point_count(a) > MCP_ARG_MAX;
        if bad {
            return None;
        }
    }
    let id = match o.get("id").and_then(Value::as_str) {
        Some(s) if valid_id(s) && !taken.iter().any(|x| x.id == s) => s.to_string(),
        _ => next_id(taken),
    };
    // `enabled` 缺失 / 非 bool 一律按 false：宁可少跑一个进程，也不替用户把没
    // 确认过的东西打开（TS 侧 `r.enabled === true` 同口径）。
    Some(ServerCfg {
        id,
        name: name.to_string(),
        command: command.to_string(),
        args,
        enabled: o.get("enabled").and_then(Value::as_bool) == Some(true),
    })
}

/// 逐条清洗、坏条目丢弃，最多留前 `MCP_MAX` 条。容忍空串 / 裸数组 / `{servers}` 三种形态。
pub fn parse_servers(raw: &str) -> Vec<ServerCfg> {
    if raw.trim().is_empty() {
        return Vec::new();
    }
    let data: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let rows: &[Value] = match &data {
        Value::Array(a) => a.as_slice(),
        _ => match data.get("servers").and_then(Value::as_array) {
            Some(a) => a.as_slice(),
            None => return Vec::new(),
        },
    };
    let mut out: Vec<ServerCfg> = Vec::new();
    for row in rows {
        if out.len() >= MCP_MAX {
            break;
        }
        if let Some(cfg) = parse_one(row, &out) {
            out.push(cfg);
        }
    }
    out
}

/// 按 id 取一条已启用的配置。找不到 / 停用各给独立理由，不共用一句话。
pub fn pick<'a>(list: &'a [ServerCfg], id: &str) -> Result<&'a ServerCfg, String> {
    let cfg = list
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("找不到这个 MCP 服务（{id}），刷新一下列表"))?;
    if !cfg.enabled {
        return Err(format!("「{}」现在是停用状态，先启用再调用", cfg.name));
    }
    Ok(cfg)
}

/// J4 硬闸门：没确认过的服务，**连子进程都不许起**（`mcp_list_tools` 与 `mcp_call`
/// 都要先过）。闸门守的不是「执行」一个动作，而是「不替用户拉起没确认过的进程」——
/// 首次列工具就会 spawn，那正是拉起；放过它等于给确认闸门开后门，而这个后门恰好是
/// 外部命令执行的前置步骤。
pub fn require_confirmed(confirmed: bool, name: &str) -> Result<(), String> {
    if confirmed {
        return Ok(());
    }
    Err(format!(
        "「{name}」还没有确认过。第一次用它之前需要你点一次确认 —— 这一步不能被跳过。"
    ))
}

/// `tools/call` 的参数体。`arguments` 缺省是 `{}`（MCP 规定它是对象，不是 null）。
pub fn call_params(tool: &str, args: Option<Value>) -> Value {
    match args {
        Some(v) => serde_json::json!({ "name": tool, "arguments": v }),
        None => serde_json::json!({ "name": tool, "arguments": {} }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 坏条目只丢自己_且撞号重排() {
        let raw = r#"{"servers":[
            {"id":"s1","name":"好一","command":"npx","args":[],"enabled":true},
            {"id":"s2","name":"坏","command":"","args":[]},
            {"id":"s1","name":"好二","command":"npx","args":[]}]}"#;
        let list = parse_servers(raw);
        assert_eq!(list.len(), 2);
        assert!(list[0].enabled);
        // 第三条显式写了 s1（已被第一条占）⇒ 按 mcp.ts 的 nextId 取最小空位 s2
        assert_eq!((list[1].name.as_str(), list[1].id.as_str()), ("好二", "s2"));
    }

    #[test]
    fn 未确认即拒() {
        assert!(require_confirmed(false, "甲").is_err());
        assert!(require_confirmed(true, "甲").is_ok());
    }
}

/// 安全 fuzz：11 条恶意输入用例，因为 182 行的 `pure.rs` 再加 160 行会越过「≤300」
/// 纪律而拆出；`#[path]` 让它仍是 `pure::tests` 的同级测试模块，直接吃本文件的纯函数。
/// 仓外对拍 crate 复制本文件时必须把这份一起复制，否则 `#[path]` 找不到文件。
#[cfg(test)]
#[path = "pure_fuzz_tests.rs"]
mod fuzz_tests;
