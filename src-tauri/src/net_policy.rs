//! 网络策略的**唯一真源**：仓库根的 `net-policy.json`。
//!
//! ## 为什么要有这一层
//!
//! 超时与上限的数字此前散在六处：本 crate 的 `net.rs`（10s / 1 MiB）、`feeds.rs`
//! （256 KiB）、`ai/openai_compat.rs`（120s / 3s / 5s），加上前端引擎与 `src/vue/`
//! 的三处 8000，以及 `tauri.conf.json` 里两条 CSP 的 `connect-src`。它们互相靠注释
//! 维系同源 —— 而注释维系同源没有任何机器保证。同一类漂移已经造成过一个**用户可见的
//! bug**：CSP 的 `connect-src` 漏了 `https://push2.eastmoney.com`（`stock.ts` 的
//! `QUOTES_URL`），桌面壳里股票卡取数被实拦，网页版没有 CSP 所以一直没暴露。
//!
//! `include_str!` 让这份 JSON 在**编译期**进二进制：改了 JSON 就得重编，不存在
//! "运行时读到一份旧文件"的可能。前端侧读的是同一份 JSON 的生成产物
//! （`packages/engine/src/netPolicy.generated.ts`），`scripts/net-policy-check.mjs`
//! 断言三侧没有漂移。
//!
//! ## 解析失败为什么不回落
//!
//! `POLICY` 首次访问时解析，失败直接 panic —— 单源坏了就该当场炸，而不是悄悄用回
//! 旧数字（那正是这次要消灭的形状：两份数字并存，坏的那份还在生效）。
//! 下面那条 `#[cfg(test)]` 单测会在 `cargo test` 里先访问一遍，于是 CI 上这条
//! 链路是跑过的，不会等到用户机器上才第一次解析。

use std::sync::LazyLock;
use std::time::Duration;

/// 仓库根的 `net-policy.json`。路径相对**本文件**（`src-tauri/src/`）。
const POLICY_JSON: &str = include_str!("../../net-policy.json");

/// 解析后的策略。**解析失败即 panic**，不回落。
pub static POLICY: LazyLock<Policy> = LazyLock::new(|| {
    serde_json::from_str(POLICY_JSON)
        .unwrap_or_else(|e| panic!("net-policy.json 解析失败（{e}）—— 单源坏了，不回落旧数字"))
});

#[derive(serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub timeouts: Timeouts,
    pub limits: Limits,
}

#[derive(serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Timeouts {
    /// 网页端 `fetch` 超时（前端用，本 crate 不直接用）
    ///
    /// 字段必须留着：单源是**整份**解析的，少一个字段就是"两份真源"的开头。
    /// Rust 侧不读它，所以挂 `allow(dead_code)` —— 与"没接线就删掉"相反，
    /// 这里要的是"单源里有什么，两侧的结构体就有什么"。
    #[allow(dead_code)]
    pub fetch_ms: u64,
    /// 桌面壳 WinHTTP 取数超时
    pub desktop_fetch_ms: u64,
    /// AI 一次性摘要的整体超时
    pub ai_summarize_ms: u64,
    /// AI 就绪探测（GET /models）超时
    pub ai_probe_ms: u64,
    /// AI 客户端连接超时
    pub ai_connect_ms: u64,
}

#[derive(serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    /// URL 长度上限（与前端 `watch.ts` 的 `MAX_URL` 同源）
    ///
    /// 与 `fetch_ms` 同理：Rust 侧的 URL 判据不读它（判据是"是不是 https / 是不是私网"，
    /// 与长度无关），但它是单源的一部分，结构必须对齐。
    #[allow(dead_code)]
    pub url_length: usize,
    /// 通用网页 / JSON 取数的响应体上限（1 MiB）
    pub http_body_bytes: usize,
    /// RSS/Atom 正文上限（256 KiB）
    ///
    /// **刻意低于 `http_body_bytes`，不要为了"统一"而统一**：feed 是用户订阅的第三方
    /// 全文，走独立解析路径且一次解析多份（名单可能几十条），单个源体量小、数量多；
    /// 而网页取数是单条、一次一目的地。统一成同一个数会让"一次刷新 40 个订阅"
    /// 的峰值内存涨四倍。
    pub feed_body_bytes: usize,
}

/// 桌面壳取数超时。WinHTTP 的 `WinHttpSetOption` 要的是毫秒 `u32`。
pub fn desktop_fetch_ms() -> u32 {
    // 单源里的数超过 u32 就是单源写错了；这里截断会静默变成别的数，所以显式夹住并 panic。
    let ms = POLICY.timeouts.desktop_fetch_ms;
    u32::try_from(ms)
        .unwrap_or_else(|_| panic!("net-policy.json 的 desktopFetchMs（{ms}）超出 u32"))
}

/// 响应体上限（`net.rs` 一族的取数）。
pub fn http_body_bytes() -> usize {
    POLICY.limits.http_body_bytes
}

/// RSS/Atom 正文上限。
pub fn feed_body_bytes() -> usize {
    POLICY.limits.feed_body_bytes
}

/// AI 一次性摘要的整体超时。流式对话不设整体超时（长对话合法），只受 `ai_connect()` 约束。
pub fn ai_summarize_timeout() -> Duration {
    Duration::from_millis(POLICY.timeouts.ai_summarize_ms)
}

/// AI 就绪探测超时 —— 要快失败：填错地址时不该让人等。
pub fn ai_probe_timeout() -> Duration {
    Duration::from_millis(POLICY.timeouts.ai_probe_ms)
}

/// AI 客户端连接超时。
pub fn ai_connect() -> Duration {
    Duration::from_millis(POLICY.timeouts.ai_connect_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 这条是整条链的**探活**：`POLICY` 是惰性解析的，没人访问它就等于没验证过。
    /// CI 上 `cargo test` 会跑到这里，于是"JSON 解析不过"在 CI 就红，不会等到用户机器上。
    #[test]
    fn policy_parses() {
        let p = *POLICY;
        assert_eq!(p.timeouts.fetch_ms, 8000);
        assert_eq!(p.timeouts.desktop_fetch_ms, 10_000);
        assert_eq!(p.timeouts.ai_summarize_ms, 120_000);
        assert_eq!(p.timeouts.ai_probe_ms, 3000);
        assert_eq!(p.timeouts.ai_connect_ms, 5000);
        assert_eq!(p.limits.url_length, 300);
        assert_eq!(p.limits.http_body_bytes, 1024 * 1024);
        assert_eq!(p.limits.feed_body_bytes, 256 * 1024);
    }

    /// 两个响应体上限是**有意差异**（理由见 `Limits::feed_body_bytes` 的文档）。
    /// 这条断言钉住"没被误统一"，也钉住"没被误改成别的倍数"。
    #[test]
    fn feed_limit_is_deliberately_smaller() {
        assert!(
            feed_body_bytes() < http_body_bytes(),
            "feed 上限应当小于通用网页上限（{} vs {}）—— 这是有意差异，不是笔误",
            feed_body_bytes(),
            http_body_bytes()
        );
        assert_eq!(http_body_bytes() / feed_body_bytes(), 4);
    }

    #[test]
    fn duration_helpers_follow_the_source() {
        assert_eq!(ai_summarize_timeout(), Duration::from_secs(120));
        assert_eq!(ai_probe_timeout(), Duration::from_secs(3));
        assert_eq!(ai_connect(), Duration::from_secs(5));
        assert_eq!(desktop_fetch_ms(), 10_000);
    }
}
