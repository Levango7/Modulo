//! 网页取数（声明式扩展）：取一份 **JSON** 响应体。
//!
//! 与 `feeds.rs` 同构（同一个 `net::get`，只是这里要正文并**校验它是 JSON**）。
//! `net::get` 那套安全边界（只 https、拒私网/保留主机名、不跟随重定向、无自定义头）
//! 原样适用 —— 本模块只做"这确实是 JSON 吗"这一件事，绝不绕过那里。
//!
//! 为什么在 Rust 侧也校验一次 JSON：前端拿到 `text` 还要 `JSON.parse`，解析失败会在
//! 卡片里显示成错误 —— 但**"这不是 JSON"与"取不到"是两件事**（前者说明 URL 指错了
//! 东西，后者是网络/边界问题），所以在这里当场分开报。

use crate::net;

/// 取数上限与 feed 同档（256 KiB）：JSON 接口的正常响应远小于它，
/// 再大就不是"取一个数"，而是"下载一个数据集"了。
const MAX_JSON_BYTES: usize = 256 * 1024;

/// 一次 JSON 取数。序列化给前端（字段名走 camelCase，与 feeds 的约定一致）。
#[derive(serde::Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JsonFetch {
    /// 原样回显 URL —— 前端靠它把异步结果对上号
    pub url: String,
    pub status: Option<u16>,
    /// 校验通过的 JSON 原文（compact 序列化后）；失败时为空串
    pub json: String,
    pub elapsed_ms: u64,
    /// 失败原因；成功时为空串。含"不是 JSON"这一类
    pub error: String,
}

/// 取一份 JSON。与 web_probe / fetch_text 同一套语义：成功失败都返回 `Ok`，
/// 「取到了但不是 JSON」与「取不到」在 `error` 里分开说。
#[tauri::command]
pub fn fetch_json(url: &str) -> JsonFetch {
    let got = match net::get(url) {
        Ok(g) => g,
        Err(e) => {
            return JsonFetch {
                url: url.to_string(),
                status: None,
                json: String::new(),
                elapsed_ms: 0,
                error: e,
            };
        }
    };
    // 空响应体在 JSON.parse 眼里也是错，这里先给出更直白的说法
    if got.body.trim().is_empty() {
        return JsonFetch {
            url: url.to_string(),
            status: got.status,
            json: String::new(),
            elapsed_ms: got.elapsed_ms,
            error: "响应是空的（这不是 JSON）".to_string(),
        };
    }
    let text = truncate_chars(&got.body, MAX_JSON_BYTES);
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) => JsonFetch {
            url: url.to_string(),
            status: got.status,
            json: serde_json::to_string(&v).unwrap_or(text),
            elapsed_ms: got.elapsed_ms,
            error: String::new(),
        },
        Err(e) => JsonFetch {
            url: url.to_string(),
            status: got.status,
            json: String::new(),
            elapsed_ms: got.elapsed_ms,
            error: format!("响应不是 JSON：{e}"),
        },
    }
}

/// 按字符截断（不从 UTF-8 序列中间劈开半个字）—— 与 feeds.rs 同实现。
/// 两处各自持有一份是有意的：它们的上限不同（feed 256KiB / 这里同值但语义独立），
/// 合成一个共享工具函数会让"改 feed 的上限"顺手改了这张卡的。
fn truncate_chars(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 取不到时是 Ok + error 字段（与 web_probe / fetch_text 同一套语义）。
    #[test]
    fn 取不到时是_ok_而不是_err() {
        let r = fetch_json("https://this-host-does-not-exist.invalid/data.json");
        assert_eq!(r.url, "https://this-host-does-not-exist.invalid/data.json");
        assert!(r.json.is_empty());
        assert!(!r.error.is_empty());
    }

    /// 非 https 一律拒（边界在 net 层，本模块不绕过 —— 这里守的是"确实没绕"）。
    #[test]
    fn 明文与私网地址都被拒() {
        for bad in [
            "http://example.com/a.json",
            "https://127.0.0.1/a.json",
            "https://router.local/a.json",
        ] {
            let r = fetch_json(bad);
            assert!(r.json.is_empty(), "{bad} 不该取到内容");
            assert!(!r.error.is_empty(), "{bad} 应给出原因");
        }
    }

    #[test]
    fn 截断不劈字() {
        let s = "汉字".repeat(100_000);
        // 5 字节放不下两个汉字（各 3 字节）：只能切出一个，且不劈开第二个的字节序列
        assert_eq!(truncate_chars(&s, 5), "汉");
        assert_eq!(truncate_chars(&s, 6), "汉字");
        assert_eq!(truncate_chars(&s, 4), "汉");
    }
}
