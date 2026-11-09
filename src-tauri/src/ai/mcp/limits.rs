//! MCP 一期的全部上限常量与校验纯函数。
//!
//! 口径纪律（项目铁律 20）：**入库闸门与进提示词的预算必须同一把尺子**。
//! 工具结果按**码点**截断，与 `src-tauri/src/ai/protocol.rs` 的 `ATTACH_CHARS_MAX=8000`
//! 同口径；截断必须**记账并明说**，不静默截。
//!
//! 另一条踩过的坑：这里用 `char_indices()` 找切点，**不用**
//! `chars().take(n).collect::<String>()` —— 后者在本仓 `Cargo.toml`:65-74 被记过
//! 「lib 测试壳启动即退 0xC0000139」的账。

use serde_json::Value;

/// 单行字节上限（stdio 一行一条消息，防 server 输出失控吃光内存）。
pub const MCP_LINE_MAX: usize = 1024 * 1024;
/// 一次 `tools/list` 最多接受多少个工具。
pub const MCP_TOOLS_MAX: usize = 64;
/// 工具名字的码点上限（名字要进提示词）。
pub const MCP_TOOL_NAME_MAX: usize = 128;
/// `tools/call` 的 `arguments` 序列化后字节上限。
pub const MCP_ARGS_MAX: usize = 64 * 1024;
/// 工具结果进提示词的码点上限，与 `ATTACH_CHARS_MAX` 对齐。
pub const MCP_RESULT_MAX: usize = 8000;

pub fn point_count(s: &str) -> usize {
    s.chars().count()
}

/// 按码点截断，返回 `(文本, 是否截断)`。切点必然落在字符边界上。
pub fn truncate_by_points(s: &str, max: usize) -> (String, bool) {
    if point_count(s) <= max {
        return (s.to_string(), false);
    }
    let cut = s.char_indices().nth(max).map(|(i, _)| i).unwrap_or(s.len());
    (s[..cut].to_string(), true)
}

pub fn line_too_long(line: &str) -> bool {
    line.len() > MCP_LINE_MAX
}

pub fn name_too_long(name: &str) -> bool {
    point_count(name) > MCP_TOOL_NAME_MAX
}

/// `arguments` 序列化后的字节数是否超限；序列化失败按超限处理（不静默放行）。
pub fn args_too_long(args: &Value) -> bool {
    serde_json::to_string(args)
        .map(|s| s.len() > MCP_ARGS_MAX)
        .unwrap_or(true)
}

pub fn too_many_tools(n: usize) -> bool {
    n > MCP_TOOLS_MAX
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 正好到上限不截断() {
        let s = "字".repeat(MCP_RESULT_MAX);
        let (out, truncated) = truncate_by_points(&s, MCP_RESULT_MAX);
        assert_eq!(out, s);
        assert!(!truncated);
    }

    #[test]
    fn 超一个码点就截断并记账() {
        let s = "字".repeat(MCP_RESULT_MAX + 1);
        let (out, truncated) = truncate_by_points(&s, MCP_RESULT_MAX);
        assert_eq!(point_count(&out), MCP_RESULT_MAX);
        assert!(truncated);
    }

    #[test]
    fn emoji按码点算而不是按utf16单元算() {
        // 一个 emoji = 1 码点 / 2 个 UTF-16 单元。8000 个 emoji 正好 8000 码点，不该截。
        let s = "😀".repeat(MCP_RESULT_MAX);
        assert_eq!(s.len(), MCP_RESULT_MAX * 4);
        assert_eq!(point_count(&s), MCP_RESULT_MAX);
        let (out, truncated) = truncate_by_points(&s, MCP_RESULT_MAX);
        assert!(!truncated);
        assert_eq!(out, s);

        // 8001 个：切点必须落在字符边界，不能劈开最后一个 emoji。
        let longer = "😀".repeat(MCP_RESULT_MAX + 1);
        let (cut, flag) = truncate_by_points(&longer, MCP_RESULT_MAX);
        assert!(flag);
        assert_eq!(cut, s);
        assert!(cut.is_char_boundary(cut.len()));
    }

    #[test]
    fn 混合字符的切点不劈开代理对() {
        let mut s = String::from("前");
        s.push_str(&"😀".repeat(100));
        s.push_str("后");
        let (cut, flag) = truncate_by_points(&s, 50);
        assert!(flag);
        assert_eq!(point_count(&cut), 50);
        assert!(cut.chars().all(|c| !c.is_control()));
    }

    #[test]
    fn 空串与零上限() {
        assert_eq!(
            truncate_by_points("", MCP_RESULT_MAX),
            (String::new(), false)
        );
        assert_eq!(truncate_by_points("abc", 0), (String::new(), true));
    }

    #[test]
    fn 名字按码点判而不是按字节判() {
        assert!(!name_too_long(&"😀".repeat(128)));
        assert!(name_too_long(&"😀".repeat(129)));
    }

    #[test]
    fn 参数按序列化字节判() {
        let big = serde_json::json!({ "blob": "x".repeat(MCP_ARGS_MAX) });
        assert!(args_too_long(&big));
        assert!(!args_too_long(&serde_json::json!({"a": 1})));
    }

    #[test]
    fn 变异钉子_结果上限必须与attach常量同值() {
        // 改动 MCP_RESULT_MAX 会红在这条，而不是别处 —— 变异抽查的目标断言。
        assert_eq!(MCP_RESULT_MAX, 8000);
        assert_eq!(MCP_LINE_MAX, 1024 * 1024);
        assert_eq!(MCP_TOOLS_MAX, 64);
    }
}
