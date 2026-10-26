//! WebDAV 同步通道（桌面侧）。**只被同步这一个特性使用**，能力刻意收窄。
//!
//! 为什么必须走 Rust：渲染层的 `fetch` 受 CSP 的 `connect-src` 约束，而那条白名单是从
//! `net-policy.json` 的固定域名清单生成的 —— "用户自带的任意网盘主机"进不了那张表，也不该进
//! （同一份清单就是前端可连的一切）。所以请求由 Rust 发；代价是这里必须自己守边界。
//!
//! ## 边界（与 `net.rs` 同一套，不另写一份）
//!
//! 1. **只收 https**、拒 userinfo、拒私有/保留网段与保留主机名 —— 直接调 `net::split_target`。
//!    凭据走 Basic 头，不塞进 URL。
//! 2. **不跟随重定向**（`Policy::none`）：3xx 原样报出，否则"一个看起来正常的公网 URL
//!    302 到内网"这条最常见的绕过路径就通了。
//! 3. **只有这几种动作**：PROPFIND（探测/列目录）、GET（读同步文件）、PUT（写同步文件）。
//!    没有 DELETE —— 历史副本的轮转改成"只写不删"会在网盘里无限长，所以**删也是要的**，
//!    但删只允许删**文件名能解析成我们自己的历史副本**（`safe_name` + 调用方先过滤），
//!    且永远不删 `live.json`。见 `webdav_delete` 的注释。
//! 4. **文件名字符集收紧**：`[A-Za-z0-9._-]`，不含 `/`、不含 `..`。目录名同理。
//! 5. 超时与响应体上限取自 `net-policy.json` 单源（`desktop_fetch_ms` / `http_body_bytes`）。
//!
//! ## 凭据
//!
//! 口令**不落盘成文件**：勾了「记住口令」才写系统凭据库（keyring，与 AI 密钥同一个
//! service 前缀、不同 service 名），否则只在本次运行的内存里。渲染层的数据目录里永远
//! 只有端点与用户名 —— 那个目录会被整份备份/搬走。
//!
//! 单测只覆盖纯函数（URL 判据、文件名、凭据条目名、PROPFIND 解析），**不碰真实凭据库、
//! 不发真实请求**。真实链路留给桌面探针。

use std::time::Duration;

use serde::Serialize;

use crate::net::split_target;
use crate::net_policy;

/// 同步文件的文件名判据：只允许 `[A-Za-z0-9._-]`，且不许是 `.`/`..`/含 `..`。
pub fn safe_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 128 {
        return Err("同步文件名长度不合法".into());
    }
    if !name
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
    {
        return Err(format!(
            "同步文件名只能用字母数字与 . _ -（拿到的是 {name}）"
        ));
    }
    if name == "." || name == ".." || name.contains("..") {
        return Err("同步文件名里不许有 ..".into());
    }
    Ok(())
}

/// 端点的完整校验：先在 `split_target` 的边界上过一遍，再补三条只属于同步的形状
/// （查询串、目录穿越、百分号编码里的穿越）。**与引擎 `sync.ts` 的 `validateSyncEndpoint`
/// 同一套判据**：那边管界面上的即时反馈，这边管真正发请求前的最后一道。
pub fn checked_endpoint(url: &str) -> Result<(), String> {
    split_target(url)?;
    if url.contains('?') {
        return Err("同步端点不该带查询串".into());
    }
    if url.contains('%') {
        return Err("同步端点里不要用百分号编码，直接写目录名".into());
    }
    for seg in url.split('/') {
        if seg == "." || seg == ".." {
            return Err("同步端点里有 ./ 或 ../，不允许目录穿越".into());
        }
    }
    Ok(())
}

fn client() -> Result<reqwest::Client, String> {
    // TLS provider：进程内装一次，已装（updater 可能先装）则忽略
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(Duration::from_millis(u64::from(
            net_policy::desktop_fetch_ms(),
        )))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("HTTP 客户端建不起来：{e}"))
}

fn humanize_status(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        401 => "网盘说口令不对或没有权限（401）".into(),
        403 => "网盘拒绝了这个操作（403）".into(),
        404 => "网盘上找不到这个目录或文件（404）".into(),
        405 => "这个网盘不支持该 WebDAV 动作（405）".into(),
        409 => "网盘的目录结构冲突（409）".into(),
        423 => "文件被网盘锁住了（423）".into(),
        507 => "网盘空间不足（507）".into(),
        301 | 302 | 303 | 307 | 308 => {
            format!("网盘给了重定向（{status}），同步不跟随重定向，请直接填最终地址")
        }
        _ => format!("网盘返回 {status}"),
    }
}

/// 读响应体，累计超过上限就停 —— 不把"无限流的大文件"读进内存
async fn read_capped(mut resp: reqwest::Response) -> Result<String, String> {
    let cap = net_policy::http_body_bytes();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("读网盘响应失败：{e}"))?
    {
        if buf.len() + chunk.len() > cap {
            return Err(format!("同步文件超过 {} KiB 上限，拒绝读取", cap / 1024));
        }
        buf.extend_from_slice(&chunk);
    }
    String::from_utf8(buf).map_err(|_| "同步文件不是 UTF-8 文本".to_string())
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct ProbeOutcome {
    pub status: u16,
    /// 目录存在且可达（207 / 200）；有的网盘对 depth-0 PROPFIND 回 200
    pub ok: bool,
}

/// 探测：对端点做 depth-0 PROPFIND，验地址可达 + 凭据可用
#[tauri::command]
pub async fn webdav_probe(
    endpoint: String,
    user: String,
    password: Option<String>,
) -> Result<ProbeOutcome, String> {
    let password = resolve_password(&endpoint, &user, password)?;
    checked_endpoint(&endpoint)?;
    let method = reqwest::Method::from_bytes(b"PROPFIND").map_err(|e| e.to_string())?;
    let resp = client()?
        .request(method, &endpoint)
        .header("Depth", "0")
        .basic_auth(&user, Some(&password))
        .send()
        .await
        .map_err(|e| format!("连不上网盘：{e}"))?;
    let status = resp.status();
    if !status.is_success() && status.as_u16() != 207 {
        return Err(humanize_status(status));
    }
    Ok(ProbeOutcome {
        status: status.as_u16(),
        ok: true,
    })
}

/// 读回来的文件：正文 + `ETag`（服务端给了才有）。
///
/// 把 ETag 一起带回去是**条件写的前提**：拿不到它就只能无条件覆盖，
/// 而"两台机器同刻同步"正是靠它才挡得住。
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct FileRead {
    pub body: String,
    pub etag: Option<String>,
}

/// 读一个同步文件。404 → None（"还没有"是合法状态，不是错误）
#[tauri::command]
pub async fn webdav_get(
    endpoint: String,
    name: String,
    user: String,
    password: Option<String>,
) -> Result<Option<FileRead>, String> {
    let password = resolve_password(&endpoint, &user, password)?;
    checked_endpoint(&endpoint)?;
    safe_name(&name)?;
    let url = format!("{endpoint}{name}");
    let resp = client()?
        .get(&url)
        .basic_auth(&user, Some(&password))
        .send()
        .await
        .map_err(|e| format!("连不上网盘：{e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(humanize_status(resp.status()));
    }
    // 头要在读正文之前取（`read_capped` 会消费掉响应）
    let etag = resp
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let body = read_capped(resp).await?;
    Ok(Some(FileRead { body, etag }))
}

/// 一次写的结果。**412 不是错误，是"有人先改了"** —— 把它和网络故障混在一个 Err 里，
/// 上层就只能猜；分开之后，冲突可以"什么都不动、让人重试"。
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct PutOutcome {
    /// 服务端用 `If-Match` 拒绝了这次写（412 Precondition Failed）
    pub conflict: bool,
}

/// 写一个同步文件（覆盖）。`if_match` 有值就带上 `If-Match`：服务端发现那一版已被改过会回 412。
#[tauri::command]
pub async fn webdav_put(
    endpoint: String,
    name: String,
    body: String,
    user: String,
    password: Option<String>,
    if_match: Option<String>,
) -> Result<PutOutcome, String> {
    let password = resolve_password(&endpoint, &user, password)?;
    checked_endpoint(&endpoint)?;
    safe_name(&name)?;
    let url = format!("{endpoint}{name}");
    let mut req = client()?
        .put(&url)
        .header("Content-Type", "application/json; charset=utf-8")
        .basic_auth(&user, Some(&password));
    if let Some(tag) = if_match.filter(|t| !t.trim().is_empty()) {
        // 带引号的强校验器原样透传；有的网盘给的是 W/"..." 弱校验器，也照传 ——
        // 服务端认不认由它决定（不认就退化成 412 或直接写成功，两种都被上层处理）。
        req = req.header("If-Match", tag.trim());
    }
    let resp = req
        .body(body)
        .send()
        .await
        .map_err(|e| format!("写网盘失败：{e}"))?;
    let status = resp.status();
    if is_conflict(status.as_u16()) {
        return Ok(PutOutcome { conflict: true });
    }
    // 201 Created / 204 No Content / 200 都算成功（各家实现不同）
    if status.is_success() {
        Ok(PutOutcome { conflict: false })
    } else {
        Err(humanize_status(status))
    }
}

/// 412 单独判成"冲突"。抽成纯函数是为了能进单测 —— 这条判据决定"会不会洗掉另一台机器的写入"。
pub fn is_conflict(code: u16) -> bool {
    code == 412
}

/// 列目录（depth-1 PROPFIND）→ 返回文件名（不含路径）
#[tauri::command]
pub async fn webdav_list(
    dir_url: String,
    user: String,
    password: Option<String>,
) -> Result<Vec<String>, String> {
    let password = resolve_password(&dir_url, &user, password)?;
    checked_endpoint(&dir_url)?;
    let method = reqwest::Method::from_bytes(b"PROPFIND").map_err(|e| e.to_string())?;
    let resp = client()?
        .request(method, &dir_url)
        .header("Depth", "1")
        .header("Content-Type", "application/xml; charset=utf-8")
        .basic_auth(&user, Some(&password))
        .body(PROPFIND_BODY)
        .send()
        .await
        .map_err(|e| format!("列网盘目录失败：{e}"))?;
    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(Vec::new());
    }
    if !status.is_success() && status.as_u16() != 207 {
        return Err(humanize_status(status));
    }
    let body = read_capped(resp).await?;
    Ok(parse_hrefs(&body))
}

/// 删一个文件。**只用于历史副本轮转**：调用方必须先按历史副本口径过滤，
/// 这里再守一道 —— 名字必须是 `sync-<数字>.json`，否则拒绝。`live.json` 永远不会被删。
///
/// 历史副本与 `live.json` **放在同一个目录**（不建子目录）：WebDAV 建目录要 MKCOL，
/// 而"目录不存在时 PUT 一个子路径"在多数服务器上是 409。把轮转文件放在端点根下，
/// 只要求用户填一个**专用目录**，少一个会失败的环节；文件名的 `sync-` 前缀就是它的身份。
#[tauri::command]
pub async fn webdav_delete(
    endpoint: String,
    name: String,
    user: String,
    password: Option<String>,
) -> Result<(), String> {
    let password = resolve_password(&endpoint, &user, password)?;
    checked_endpoint(&endpoint)?;
    safe_name(&name)?;
    if !is_history_name(&name) {
        return Err(format!(
            "只允许删除历史副本（sync-<毫秒>.json），不删 {name}"
        ));
    }
    let url = format!("{endpoint}{name}");
    let resp = client()?
        .delete(&url)
        .basic_auth(&user, Some(&password))
        .send()
        .await
        .map_err(|e| format!("删网盘文件失败：{e}"))?;
    let status = resp.status();
    if status.is_success() || status == reqwest::StatusCode::NOT_FOUND {
        Ok(())
    } else {
        Err(humanize_status(status))
    }
}

const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>"#;

/// `sync-<毫秒>.json` —— 与引擎 `sync.ts` 的 `historyName` 同一口径
pub fn is_history_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("sync-") else {
        return false;
    };
    let Some(digits) = rest.strip_suffix(".json") else {
        return false;
    };
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

/// 从 PROPFIND 的响应里取文件名：`<d:href>` 或 `<href>` 都要认（各家前缀不同），
/// 取最后一段路径。**不做百分号解码** —— 我们自己的名字只有 ASCII，出现编码过的名字
/// 说明不是我们写的，交给上层按"不认识"跳过。
pub fn parse_hrefs(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    for tag in ["<d:href>", "<href>"] {
        let close = if tag == "<d:href>" {
            "</d:href>"
        } else {
            "</href>"
        };
        let mut rest = xml;
        while let Some(start) = rest.find(tag) {
            let after = &rest[start + tag.len()..];
            let Some(end) = after.find(close) else { break };
            let href = after[..end].trim();
            let base = href.trim_end_matches('/').rsplit('/').next().unwrap_or("");
            if !base.is_empty() && !out.iter().any(|x: &String| x == base) {
                out.push(base.to_string());
            }
            rest = &after[end + close.len()..];
        }
    }
    out
}

// ---- 凭据（Windows Credential Manager，与 AI 密钥同一条纪律：不回传）----

const CRED_SERVICE: &str = "app.modulo.sync";

/// 凭据条目名：端点+用户名的定长摘要。
///
/// 为什么不用明文拼接：Windows 凭据条目的 target 名有长度与字符限制，而端点可以很长、
/// 用户名可以是邮箱；摘要定长且字符集固定，也顺手避免"用户名里带分隔符"造成的歧义。
/// 代价是系统凭据管理器里看到的是一个哈希 —— 面板上显示端点原文，用户不必靠凭据库认。
pub fn cred_account(endpoint: &str, user: &str) -> String {
    let seed = format!("{endpoint}\u{1}{user}");
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in seed.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("dav-{h:016x}")
}

fn cred_entry(endpoint: &str, user: &str) -> Result<keyring::v1::Entry, String> {
    if user.trim().is_empty() {
        return Err("用户名不能为空".into());
    }
    keyring::v1::Entry::new(CRED_SERVICE, &cred_account(endpoint, user))
        .map_err(|e| crate::ai::keys::humanize(&e))
}

#[tauri::command]
pub fn sync_cred_set(endpoint: String, user: String, password: String) -> Result<(), String> {
    checked_endpoint(&endpoint)?;
    if password.is_empty() {
        return Err("口令不能为空".into());
    }
    cred_entry(&endpoint, &user)?
        .set_password(&password)
        .map_err(|e| crate::ai::keys::humanize(&e))
}

/// 有没有存过口令（**不回传口令本身**，与 AI 密钥同一条契约）
#[tauri::command]
pub fn sync_cred_status(endpoint: String, user: String) -> Result<bool, String> {
    match cred_entry(&endpoint, &user)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::v1::Error::NoEntry) => Ok(false),
        Err(e) => Err(crate::ai::keys::humanize(&e)),
    }
}

#[tauri::command]
pub fn sync_cred_clear(endpoint: String, user: String) -> Result<(), String> {
    match cred_entry(&endpoint, &user)?.delete_credential() {
        Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
        Err(e) => Err(crate::ai::keys::humanize(&e)),
    }
}

/// 口令的来源：显式传了就用手输的，否则读系统凭据库。
///
/// **口令永不回传渲染层**（与 AI 密钥同一条纪律）：`sync_cred_status` 只说"存过没有"，
/// 真正的值只在这里被取出来组 Basic 头。所以"记住口令"的意义是「不必每次启动重输」，
/// 而不是「界面上能再看到它」。
fn resolve_password(
    endpoint: &str,
    user: &str,
    password: Option<String>,
) -> Result<String, String> {
    if let Some(p) = password {
        if !p.is_empty() {
            return Ok(p);
        }
    }
    match cred_entry(endpoint, user)?.get_password() {
        Ok(p) => Ok(p),
        Err(keyring::v1::Error::NoEntry) => {
            Err("还没有保存过口令，请先输入一次（或勾上「记住口令」）".into())
        }
        Err(e) => Err(crate::ai::keys::humanize(&e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 端点判据复用_net_边界() {
        for ok in [
            "https://dav.example.com/dav/modulo/",
            "https://cloud.example.org/",
        ] {
            assert!(checked_endpoint(ok).is_ok(), "{ok} 应该收");
        }
        for bad in [
            "http://dav.example.com/",
            "https://192.168.1.5/dav/",
            "https://127.0.0.1/",
            "https://localhost/dav/",
            "https://169.254.169.254/latest/",
            "https://dav.example.com/a/../b/",
            "https://dav.example.com/d?p=1",
            "https://dav.example.com/%2e%2e/",
            "https://user:pw@dav.example.com/",
        ] {
            assert!(checked_endpoint(bad).is_err(), "{bad} 应该被拒");
        }
        assert!(checked_endpoint("https://dav.example.com/a/../b/")
            .unwrap_err()
            .contains("穿越"));
        assert!(checked_endpoint("http://x.example.com/")
            .unwrap_err()
            .contains("https"));
    }

    #[test]
    fn 文件名与目录名字符集() {
        for ok in ["live.json", "sync-1700000000000.json", "a_b-c.1"] {
            assert!(safe_name(ok).is_ok(), "{ok} 应该收");
        }
        for bad in [
            "",
            "../x.json",
            "a/b.json",
            "中文.json",
            "%2e%2e.json",
            &"x".repeat(129),
        ] {
            assert!(safe_name(bad).is_err(), "{bad:?} 应该被拒");
        }
    }

    #[test]
    fn 历史副本名判据与引擎同口径() {
        assert!(is_history_name("sync-1700000000000.json"));
        for bad in [
            "live.json",
            "sync-.json",
            "sync-abc.json",
            "sync-1.json.bak",
            "SYNC-1.json",
        ] {
            assert!(!is_history_name(bad), "{bad} 不是历史副本名");
        }
    }

    #[test]
    fn 不认百分号编码的端点() {
        assert!(checked_endpoint("https://dav.example.com/%E4%B8%AD/").is_err());
    }

    #[test]
    fn propfind_解析两种前缀并取末段() {
        let xml = r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
          <d:response><d:href>/dav/modulo/history/</d:href></d:response>
          <d:response><d:href>/dav/modulo/history/sync-1700000000000.json</d:href></d:response>
          <d:response><d:href>/dav/modulo/history/notes.pdf</d:href></d:response>
        </d:multistatus>"#;
        assert_eq!(
            parse_hrefs(xml),
            vec!["history", "sync-1700000000000.json", "notes.pdf"]
        );
        let alt = r#"<multistatus><response><href>https://x.example.com/a/b.json</href></response></multistatus>"#;
        assert_eq!(parse_hrefs(alt), vec!["b.json"]);
        assert!(parse_hrefs("").is_empty());
    }

    #[test]
    fn 凭据条目名是定长且与输入一一对应() {
        let a = cred_account("https://dav.example.com/dav/", "me@example.com");
        assert_eq!(a.len(), 20, "dav- + 16 位十六进制");
        assert!(a.starts_with("dav-"));
        assert_eq!(
            a,
            cred_account("https://dav.example.com/dav/", "me@example.com")
        );
        assert_ne!(
            a,
            cred_account("https://dav.example.com/dav/", "other@example.com")
        );
        assert_ne!(
            a,
            cred_account("https://other.example.com/dav/", "me@example.com")
        );
    }

    #[test]
    fn 空用户名不许取凭据() {
        assert!(cred_entry("https://dav.example.com/", "  ").is_err());
    }

    /// 冲突判据只有一条：412。其余状态码（含 409 目录冲突、423 锁住）都还是"错误"，
    /// 混进来会让"另一台设备刚写过"这句人话出现在与它无关的故障上。
    #[test]
    fn 只有412算冲突() {
        assert!(is_conflict(412));
        for code in [200, 201, 204, 400, 401, 403, 404, 409, 423, 500, 507] {
            assert!(!is_conflict(code), "{code} 不该被判成冲突");
        }
    }

    #[test]
    fn http_状态码的人话能分得清() {
        assert!(humanize_status(reqwest::StatusCode::UNAUTHORIZED).contains("口令"));
        assert!(humanize_status(reqwest::StatusCode::NOT_FOUND).contains("找不到"));
        assert!(humanize_status(reqwest::StatusCode::FOUND).contains("重定向"));
        assert!(humanize_status(reqwest::StatusCode::INSUFFICIENT_STORAGE).contains("空间不足"));
    }
}
