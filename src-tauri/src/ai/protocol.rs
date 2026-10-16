//! AI 线协议纯函数集 —— URL 白名单 / SSE 行解析 / 错误人话化。
//!
//! 从 openai_compat 拆出（300 行纪律，同 D-01/D-02 手法）：这一层**不碰 IO、
//! 不持状态**，全部可在 cargo test 里跑；reqwest/tauri 相关的粘合留在外面。
//! 单测就在本文件——测试与实现同文件是仓库惯例（sysmon.rs 同模式）。

use serde::Deserialize;

// ---- URL 白名单（契约 ai_chat notes：https，或 localhost/127.0.0.1 的 http）----

/// 从 authority 段提取主机（去端口；IPv6 带 []）。空串不可能出现（调用方已保证）
pub(crate) fn extract_host(authority: &str) -> &str {
    if let Some(rest) = authority.strip_prefix('[') {
        return match rest.find(']') {
            // '[' 已耗 1 字节，']' 落在 rest 内偏移 end，即 authority 的 end+1（含）
            Some(end) => &authority[..end + 2],
            None => authority, // 未闭合的畸形串整段当主机，交给白名单去拒
        };
    }
    authority.split(':').next().unwrap_or(authority)
}

fn is_local_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

/// scheme 白名单。尾部 `/` 容忍。
pub(crate) fn validate_base_url(base: &str) -> Result<(), String> {
    let base = base.trim();
    if let Some(rest) = base.strip_prefix("https://") {
        let host = extract_host(rest.split('/').next().unwrap_or(""));
        if host.is_empty() {
            return Err("模型服务地址缺少主机名".into());
        }
        return Ok(());
    }
    if let Some(rest) = base.strip_prefix("http://") {
        let authority = rest.split('/').next().unwrap_or("");
        if is_local_host(extract_host(authority)) {
            return Ok(());
        }
        return Err("明文 http 只允许本机地址（localhost / 127.0.0.1），云端必须用 https".into());
    }
    Err("模型服务地址必须以 https:// 或 http:// 开头".into())
}

/// 是否本机端点——连接失败的人话要按这个分流
pub(crate) fn is_local_base(base: &str) -> bool {
    base.trim()
        .strip_prefix("http://")
        .or_else(|| base.trim().strip_prefix("https://"))
        .map(|rest| is_local_host(extract_host(rest.split('/').next().unwrap_or(""))))
        .unwrap_or(false)
}

// ---- HTTP 状态码 → 人话（架构文档 §6 错误分类总表）----

pub(crate) fn humanize_status(code: u16) -> String {
    match code {
        400 => "请求被服务端拒绝，检查模型名与参数".into(),
        401 | 403 => "API key 无效，去设置里重新填入".into(),
        404 => "这个模型在服务端不存在，换一个模型名".into(),
        402 | 429 => "额度不足或被限流，稍后再试".into(),
        other => format!("模型服务返回错误（HTTP {other}）"),
    }
}

pub(crate) fn humanize_connect(base: &str) -> String {
    if is_local_base(base) {
        "没连上本地模型服务，确认 Ollama 已启动".into()
    } else {
        "网络连不上模型服务，检查连接后重试".into()
    }
}

// ---- SSE 行解析 ----

/// 一行 `data:` 载荷 → 事件。忽略注释行/心跳/畸形行（诚实跳过，不中断流）
pub(crate) enum SseEvent {
    Delta(String),
    Done,
}

pub(crate) fn parse_sse_data_line(line: &str) -> Option<SseEvent> {
    let payload = line.trim().strip_prefix("data:")?.trim();
    if payload == "[DONE]" {
        return Some(SseEvent::Done);
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
    }
    let wire: Wire = serde_json::from_str(payload).ok()?;
    let delta = wire.choices.first()?.delta.content.clone()?;
    if delta.is_empty() {
        None // 空增量不推，省一次 IPC
    } else {
        Some(SseEvent::Delta(delta))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheme_白名单() {
        for ok in [
            "https://api.example.com/v1",
            "http://localhost:11434/v1",
            "http://127.0.0.1:11434/v1/",
            "http://[::1]:11434/v1",
            "https://api.deepseek.com",
        ] {
            assert!(validate_base_url(ok).is_ok(), "{ok} 应当放行");
        }
        for bad in [
            "http://api.example.com/v1",
            "ftp://x",
            "api.example.com",
            "https:///no-host",
            "",
        ] {
            assert!(validate_base_url(bad).is_err(), "{bad} 应当被拒");
        }
    }

    #[test]
    fn 提取主机_带端口与ipv6() {
        assert_eq!(extract_host("localhost:11434"), "localhost");
        assert_eq!(extract_host("127.0.0.1:8080"), "127.0.0.1");
        assert_eq!(extract_host("[::1]:11434"), "[::1]");
        assert_eq!(extract_host("api.example.com"), "api.example.com");
        // 畸形未闭合也不能 panic
        assert_eq!(extract_host("[::1"), "[::1");
    }

    #[test]
    fn 本地判定() {
        assert!(is_local_base("http://127.0.0.1:11434/v1"));
        assert!(is_local_base("https://localhost:8443"));
        assert!(!is_local_base("https://api.example.com/v1"));
    }

    #[test]
    fn sse_行解析() {
        let delta = parse_sse_data_line(r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#);
        assert_eq!(
            match delta {
                Some(SseEvent::Delta(d)) => d,
                _ => panic!("应是 Delta"),
            },
            "你好"
        );
        assert!(matches!(
            parse_sse_data_line("data: [DONE]"),
            Some(SseEvent::Done)
        ));
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

    #[test]
    fn 人话_状态码() {
        assert_eq!(humanize_status(401), "API key 无效，去设置里重新填入");
        assert_eq!(humanize_status(404), "这个模型在服务端不存在，换一个模型名");
        assert_eq!(humanize_status(429), "额度不足或被限流，稍后再试");
        assert!(humanize_status(500).contains("500"));
    }

    #[test]
    fn 人话_连接错误分本地与云端() {
        assert_eq!(
            humanize_connect("http://127.0.0.1:11434/v1"),
            "没连上本地模型服务，确认 Ollama 已启动"
        );
        assert_eq!(
            humanize_connect("https://api.example.com/v1"),
            "网络连不上模型服务，检查连接后重试"
        );
    }
}
