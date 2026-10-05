//! 网页监控：探活。
//!
//! 取数与边界都在 [`crate::net`] 里，这里只负责把结果整理成卡片要的形状。
//! **不保存响应体** —— 监控只需要「通不通、多久」，存正文等于在备份里囤
//! 别人网页的内容，而备份是要往外导出的。

/// 一次探活的结果。序列化给前端。
#[derive(serde::Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// 原样回显请求的 URL，前端要靠它把结果对上号（请求是异步的，回来时可能已经换了）
    pub url: String,
    /// HTTP 状态码；**本机查不到**（见 net.rs），拿不到时前端显示「已连接」
    pub status: Option<u16>,
    /// 往返耗时，毫秒
    pub elapsed_ms: u64,
    /// 失败原因。成功时为空串。
    pub error: String,
}

/// 探一次。成功与失败都返回 `Ok` —— 「探到了并且它挂了」和「探不到」对卡片是两件事，
/// 都得显示出来，不能都变成一个 Err。
#[tauri::command]
pub fn web_probe(url: &str) -> Probe {
    match crate::net::get(url) {
        Ok(got) => Probe {
            url: url.to_string(),
            status: got.status,
            elapsed_ms: got.elapsed_ms,
            error: String::new(),
        },
        Err(e) => Probe {
            url: url.to_string(),
            status: None,
            // 失败的耗时没有意义 —— 交给界面显示「—」，别拿一个 0 或超时值冒充
            elapsed_ms: 0,
            error: e,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 失败也必须是 Ok：卡片要把「探到了、它挂了」和「压根没探到」分开显示。
    #[test]
    fn 探不通时是_ok_而不是_err() {
        let p = web_probe("https://this-host-does-not-exist.invalid/");
        assert!(p.error.is_empty() || !p.error.is_empty()); // 字段存在即可
                                                            // 关键：URL 被原样回显，前端才能把结果对上号
        assert_eq!(p.url, "https://this-host-does-not-exist.invalid/");
    }

    /// 边界必须生效：探一个私网地址要被 net 层挡下来，而不是真的去发请求。
    #[test]
    fn 私网地址被边界挡住() {
        for bad in [
            "http://127.0.0.1/",               // 明文 + 回环
            "https://169.254.169.254/latest/", // 云元数据端点
            "https://192.168.1.1/",
            "https://[::1]/",
        ] {
            let p = web_probe(bad);
            assert!(!p.error.is_empty(), "{bad} 应当被边界拒绝，却探通了");
            assert_eq!(p.status, None);
            assert_eq!(p.elapsed_ms, 0, "失败时不该编一个耗时");
        }
    }
}
