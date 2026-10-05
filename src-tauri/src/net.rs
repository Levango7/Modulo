//! 桌面侧的 HTTP 取数层。用系统自带的 WinHTTP，**不引入任何 crate**。
//!
//! 两张联网卡共用它：每日一图（取 Bing 的当日壁纸元信息）、网页监控（探活）。
//!
//! ## 边界（这是本文件存在的全部理由）
//!
//! 前端的 `fetch` 会被 CORS 拦（没有 ACAO 的 JSON 端点如 Bing），所以请求必须由
//! 桌面端发起。但一旦有了"桌面端能替前端发任意请求"这条能力，它就成了 SSRF 的入口 ——
//! 尤其本应用的 CSP 正是它自己配的，而 CSP 拦不住走 Rust 侧的请求：WebView 一旦被
//! XSS 攻破，就能借这条通道探测内网，而那是 CSP 唯一想防的事。
//!
//! 于是把能力收窄到最小，并对**会被别人塞进来的 URL**（备份导入）保持同一套判据：
//!
//! 1. **只允许 https** —— 明文 http 一律拒绝。没有明文信道，也就没有被动嗅探和
//!    中间人改包的机会。
//! 2. **IP 字面量落在私有/保留网段就拒绝** —— `169.254.169.254`（云实例元数据端点，
//!    拿到它等于拿到临时凭据）、`127.x`（本机服务）、`10/8`、`172.16/12`、`192.168/16`、
//!    `100.64/10`（CGNAT）、`0.0.0.0`，以及 IPv6 的 `::1` / `fc00::/7` / `fe80::/10`。
//! 3. **不跟随重定向** —— 3xx 原样报出。否则"一个看起来正常的公网 URL 302 到内网"
//!    这条最常见的绕过路径就通了，也避免把请求扇出到用户没填过的 host。
//! 4. **只有 URL** —— 没有自定义 header、没有方法可选、没有请求体、不带 Cookie 与
//!    Authorization。能力从"请求构造器"缩成"一个字符串"，可审计。
//! 5. 10s 超时、响应体上限 1 MiB。
//!
//! ## 明确不挡的：DNS rebinding
//!
//! `evil.com` 解析到 `127.0.0.1` 这种，靠域名绕开第 2 条的情形，这里**不防**。
//! 理由：请求本来就是以用户身份发出的，本机任何进程都能做同样的事，边际风险很小；
//! 而真正会被误伤的是"顺手填了个内网地址"和"云元数据端点"这两类实际会踩的坑。
//! 真要防就得自己解析 DNS、校验解析结果、再把 IP 钉进连接 —— 那要在 WinHTTP 上另开
//! 一条自定义连接的路径，代价远大于收益。
//!
//! **代价要说清楚**：因为第 2 条，监控不了自家 NAS / 路由器。这是刻意的 —— 那是另一个
//! 特性、另一套边界，不该顺手塞进来。

use std::time::Instant;

/**
 * ⚠️ **整个 winhttp 模块被排除在 lib 的测试壳之外**（`not(test)`）。
 *
 * 这不是"测试不方便"，是**不得不**：只要这层 FFI + HTTP 代码被链进 `cargo test` 产出的
 * 测试二进制，那个二进制就会在启动时退出 `0xC0000139`（STATUS_ENTRYPOINT_NOT_FOUND），
 * `cargo test` 一个测试都跑不了。本机可稳定复现，`cargo clean -p modulo` 后重编依然如此。
 *
 * 定位过程见 git 历史里 web.rs 那条注释：二分到最后真凶是某段"看起来无害"的代码
 * （`chars().take().collect::<String>()`），体积 / incremental / 静态导入 / DLL 位置 /
 * PATH 版本 / 产物损坏都排除过了，机制仍未查明。既然触发点无法预测，稳妥做法是
 * **把整层 FFI 关在测试壳外面**，而不是继续赌下一段代码会不会踩中。
 *
 * 于是本文件的职责被切成两半：
 * - **边界判定（`split_target` / `blocked_ip_reason`）是纯函数，留在测试壳里** ——
 *   它才是最该被测的部分，下面十几条单测盯的就是它
 * - **取数本身（winhttp）只在桌面 app 里存在**，由真机探针验证
 *   （`scripts/desktop-probe.mjs`，`PROBE_NET=1`）：那跑的是真正的 WebView2、
 *   真正的网络、真正的 TLS 握手，比单测有说服力
 */
#[cfg(all(target_os = "windows", not(test)))]
mod winhttp;

#[cfg(any(not(target_os = "windows"), test))]
mod winhttp {
    pub fn get(host: &str, _target: &str, _url: &str) -> Result<(Option<u16>, String), String> {
        Err(format!(
            "{host}：联网取数只在真正的桌面壳里发生（测试壳里是替身）"
        ))
    }
}

/// 一次 HTTP 请求的结果。
///
/// `status` 是 `Option`：**本机查不到状态码**（见 `winhttp::query_status`），
/// 所以拿不到时是 `None` 而不是编一个。网页监控因此能回答「通不通、多久」，
/// 但回答不了「是不是 404」—— 这是已知限制，别拿它当状态码面板用。
#[derive(serde::Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HttpResult {
    /// HTTP 状态码；本机查不到时为 `None`
    pub status: Option<u16>,
    /// 响应体（已截断到上限）
    pub body: String,
    /// 从发起请求到读完响应体的耗时，毫秒
    pub elapsed_ms: u64,
}

/// 响应体上限。监控只需要状态与可达性，1 MiB 足够任何正常页面塞下一个小片段，
/// 又能挡住「指向一个无限流的大文件」把内存吃光。
#[cfg(all(target_os = "windows", not(test)))]
const MAX_BODY: usize = 1024 * 1024;

/// 取出 host 与请求目标，并套用上面第 1、2 条边界。
///
/// 纯函数，不碰网络 —— 所以这些边界能进单测，而边界是最该被测的部分。
pub fn split_target(url: &str) -> Result<(String, String), String> {
    let rest = url
        .strip_prefix("https://")
        .ok_or_else(|| format!("只支持 https（拿到的是 {url}）"))?;

    // host 之后第一个字符开始就是 path/query；`/` 前为空时要给 "/"
    let slash = rest.find('/').unwrap_or(rest.len());
    let authority = &rest[..slash];
    let path = if slash == rest.len() {
        "/"
    } else {
        &rest[slash..]
    };

    // authority 形如 host 或 host:port。端口不参与边界判定，但空 host 要拒绝。
    let host_port = authority.split('@').next_back().unwrap_or(authority);
    let host = host_port
        .split(':')
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']');
    if host.is_empty() {
        return Err(format!("URL 里没有主机名：{url}"));
    }
    if host.contains(char::is_whitespace) {
        return Err(format!("主机名里有空白字符：{url}"));
    }
    if let Some(reason) = blocked_ip_reason(host) {
        return Err(format!("{reason}（{host}）"));
    }
    Ok((host.to_string(), path.to_string()))
}

/// 私有/保留网段给出理由；公网地址返回 `None`。
///
/// 只对 **IP 字面量** 生效 —— 域名一律放行（DNS rebinding 不防，见文件头）。
fn blocked_ip_reason(host: &str) -> Option<&'static str> {
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        return blocked_v4(ip.octets());
    }
    if let Ok(ip) = host.parse::<std::net::Ipv6Addr>() {
        if ip.is_loopback() {
            return Some("拒绝 ::1（本机回环）");
        }
        if (ip.octets()[0] & 0xFE) == 0xFC {
            return Some("拒绝 fc00::/7（唯一本地地址）");
        }
        if (ip.octets()[0] & 0xC0) == 0x80 {
            return Some("拒绝 fe80::/10（链路本地）");
        }
        // IPv4-mapped（::ffff:a.b.c.d）要看被映射的那个 v4，否则 ::ffff:127.0.0.1 会漏网
        if let Some(v4) = ip.to_ipv4_mapped().or_else(|| ip.to_ipv4()) {
            return blocked_v4(v4.octets());
        }
        return None;
    }
    None
}

fn blocked_v4(o: [u8; 4]) -> Option<&'static str> {
    match o {
        [0, _, _, _] => Some("拒绝 0.0.0.0/8"),
        [10, _, _, _] => Some("拒绝 10/8（私有网段）"),
        [100, b, _, _] if (64..128).contains(&b) => Some("拒绝 100.64/10（CGNAT）"),
        [127, _, _, _] => Some("拒绝 127/8（本机回环）"),
        [169, 254, _, _] => Some("拒绝 169.254/16（含云实例元数据端点）"),
        [172, b, _, _] if (16..32).contains(&b) => Some("拒绝 172.16/12（私有网段）"),
        [192, 168, _, _] => Some("拒绝 192.168/16（私有网段）"),
        [192, 0, 0, _] => Some("拒绝 192.0.0/24"),
        [198, 18, _, _] => Some("拒绝 198.18/15（基准测试网段）"),
        [198, 51, 100, _] => Some("拒绝 198.51.100/24（文档示例网段）"),
        [203, 0, 113, _] => Some("拒绝 203.0.113/24（文档示例网段）"),
        [224..=239, _, _, _] => Some("拒绝组播地址"),
        _ => None,
    }
}

/// 同步 GET。桌面壳之外没有理由发这个请求，调用方自己会判 `isDesktop`。
///
/// 边界 5 的响应体上限在这里生效（`MAX_BODY`），超了截断而不是报错 ——
/// 监控只关心可达性，把一个正常但很大的页面判成失败是错的。
pub fn get(url: &str) -> Result<HttpResult, String> {
    let (host, target) = split_target(url)?;
    let t0 = Instant::now();
    let (status, body) = winhttp::get(&host, &target, url)?;
    Ok(HttpResult {
        status,
        body,
        elapsed_ms: t0.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 只收_https() {
        assert!(split_target("http://example.com/").is_err());
        assert!(split_target("example.com").is_err());
        assert!(split_target("ftp://example.com/").is_err());
        assert!(split_target("https://").is_err());
        assert!(split_target("https:///path").is_err());
    }

    #[test]
    fn 拆出主机与目标路径() {
        assert_eq!(
            split_target("https://www.bing.com/HPImageArchive.aspx?format=js&idx=0").unwrap(),
            (
                "www.bing.com".into(),
                "/HPImageArchive.aspx?format=js&idx=0".into()
            )
        );
        // 根路径必须补成 "/"，空目标名不是合法请求行
        assert_eq!(
            split_target("https://example.com").unwrap(),
            ("example.com".into(), "/".into())
        );
        // 端口不参与判定，host 里要去掉
        assert_eq!(
            split_target("https://example.com:8443/x").unwrap(),
            ("example.com".into(), "/x".into())
        );
        // IPv6 字面量带方括号
        assert_eq!(
            split_target("https://[2001:db8::1]/x").unwrap(),
            ("2001:db8::1".into(), "/x".into())
        );
    }

    /// 边界 2 的核心断言。这些网段每一个都对应一类真实攻击或真实误伤。
    #[test]
    fn 私有与保留网段一律拒绝() {
        for bad in [
            "https://127.0.0.1/", // 本机服务
            "https://127.1.2.3/admin",
            "https://169.254.169.254/latest/meta-data/", // 云元数据端点 = 临时凭据
            "https://10.0.0.5/",
            "https://172.16.0.1/",     // 私有的下沿
            "https://172.31.255.254/", // 私有的上沿
            "https://192.168.1.1/",
            "https://0.0.0.0/",
            "https://100.64.0.1/", // CGNAT 下沿
            "https://[::1]/",
            "https://[fc00::1]/",
            "https://[fe80::1]/",
            "https://[::ffff:127.0.0.1]/", // IPv4-mapped 绕过
        ] {
            let r = split_target(bad);
            assert!(r.is_err(), "{bad} 应当被拒绝，实际 {r:?}");
        }
    }

    /// 边界最容易写错的地方：上下沿之外必须放行，否则会误伤正常公网地址。
    #[test]
    fn 附近的公网地址必须放行() {
        for ok in [
            "https://172.15.0.1/", // 172.16 的前一格
            "https://172.32.0.1/", // 172.31 的后一格
            "https://100.63.255.255/",
            "https://100.128.0.1/",
            "https://11.0.0.1/",
            "https://9.255.255.255/",
            "https://1.1.1.1/",
            "https://[2606:4700::1111]/",
        ] {
            assert!(split_target(ok).is_ok(), "{ok} 不该被拒");
        }
    }

    /// 域名一律放行 —— DNS rebinding 明确不防（见文件头），所以这里不该有例外。
    #[test]
    fn 域名不走_ip_判定() {
        assert!(split_target("https://localhost/").is_ok());
        assert!(split_target("https://router.local/").is_ok());
        assert!(split_target("https://metadata.google.internal/").is_ok());
        // 长得像 IP 也不是 IP 字面量
        assert!(split_target("https://1.1.1.1.example.com/").is_ok());
    }
}
