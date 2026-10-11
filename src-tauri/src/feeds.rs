//! RSS/Atom 订阅：取一份**带响应体**的文本。
//!
//! 取数与边界都在 [`crate::net`]（`get` 早已带回响应体，只是监控命令层按设计丢弃）；
//! 这里是它的"要正文"版本，加一条自己的上限（RSS 源不需要 1 MiB）。
//! **不保存取到的内容到备份** —— 备份是要外发的，别人的文章正文不该跟着走；
//! 订阅名单（用户写的）在 cardData 里跟着备份。

use crate::net;

/// RSS 正文比网页小得多：256 KiB 放得下任何正常 feed，
/// 又能挡住「把订阅指到一个无限流」的意外。
const MAX_FEED_BYTES: usize = 256 * 1024;

/// 一次文本取数。序列化给前端。
#[derive(serde::Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TextFetch {
    /// 原样回显请求的 URL —— 前端靠它把结果对上号（异步回来时列表可能已经变了）
    pub url: String,
    /// HTTP 状态码；本机查不到时为 `None`（见 net.rs 的 HttpResult）
    pub status: Option<u16>,
    /// 解好码的正文（按内容声明嗅探 charset，见 net::sniff_charset）；失败时为空串
    pub text: String,
    pub elapsed_ms: u64,
    /// 失败原因；成功时为空串
    pub error: String,
}

/// 取一份文本。与 monitor::web_probe 同一套语义：成功失败都返回 `Ok`，
/// 「取到了」和「取不到」对卡片是两件事，都要能显示。
#[tauri::command]
pub fn fetch_text(url: &str) -> TextFetch {
    match net::get(url) {
        Ok(got) => TextFetch {
            url: url.to_string(),
            status: got.status,
            // 上限在这里截而不是截好再传出来：String 的字节上限要精确
            text: truncate_chars(&got.body, MAX_FEED_BYTES),
            elapsed_ms: got.elapsed_ms,
            error: String::new(),
        },
        Err(e) => TextFetch {
            url: url.to_string(),
            status: None,
            text: String::new(),
            elapsed_ms: 0,
            error: e,
        },
    }
}

/// 按字符截断（不从 UTF-8 序列中间劈开半个字）
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

    /// 失败也是 Ok：URL 原样回显，错误进 error 字段（与 web_probe 同一套语义）。
    #[test]
    fn 取不到时是_ok_而不是_err() {
        let r = fetch_text("https://this-host-does-not-exist.invalid/feed");
        assert_eq!(r.url, "https://this-host-does-not-exist.invalid/feed");
        assert!(!r.error.is_empty());
        assert!(r.text.is_empty());
    }

    /// 边界必须生效：私网地址进不了取数（测试壳里 winhttp 是替身、必然 Err，
    /// 这里守的是 split_target 这一层先把明文/私网拒掉）。
    #[test]
    fn 明文与私网被边界挡住() {
        for bad in [
            "http://example.com/",
            "https://192.168.1.1/feed",
            "https://10.0.0.1/feed",
        ] {
            let r = fetch_text(bad);
            assert!(!r.error.is_empty(), "{bad} 应当被边界拒绝");
            assert!(r.text.is_empty());
        }
    }

    /// 字符边界截断：不劈开多字节字符
    #[test]
    fn 截断不劈半个字() {
        let s = "中文字符串很长很长";
        assert_eq!(truncate_chars(s, 6), "中文");
        assert_eq!(truncate_chars(s, 7), "中文"); // 7 字节劈第 3 个字 → 退回 6
        assert_eq!(truncate_chars(s, 0), "");
        assert_eq!(truncate_chars(s, 999), s);
    }
}
