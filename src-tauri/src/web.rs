//! 桌面侧联网取数。WebView2 前端的 `fetch` 会被 CORS 拦（没有 ACAO 的 JSON 端点
//! 如 Bing 每日一图），所以必须由桌面端发起请求后再把结果透给前端。
//!
//! **为什么是 WinHTTP 而不是 reqwest**：给本 crate 加 `reqwest` 依赖会让 lib 的测试
//! 二进制在 windows-gnu 下加载失败（STATUS_ENTRYPOINT_NOT_FOUND / 0xC0000139，
//! `cargo test` 一个测试都跑不了），而 `Cargo.lock` 只多一行、没引入任何新 crate ——
//! 是链接结果的临界跳变，没法从项目侧修。WinHTTP 属于系统 DLL，`#[link]` 一下就行，
//! 不往链接里加新代码，本项目只有桌面端（见 Cargo.toml 的 crate-type 说明）。
//!
//! 取数被拆成两层：`parse_bing_wallpaper` 是纯函数（能单测），`http_get` 才碰网络。

/// 每日一图的响应（只保留成卡用的字段，原样返回其余信息没有必要）。
#[derive(serde::Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DailyBing {
    /// 当日图片地址（已拼好前端可直接 `<img>` 用的完整 URL）
    pub url: String,
    /// 图片的版权/描述文案
    pub copyright: String,
    /// `YYYYMMDD` 字符串，来自 Bing 的 startdate
    pub start_date: String,
}

/// 解析 Bing 的 `HPImageArchive.aspx` 响应。拆成纯函数是为了让字段缺失、
/// 结构不符这些情况有单测能压 —— 网络才是不能进 CI 的那部分。
pub fn parse_bing_wallpaper(text: &str) -> Result<DailyBing, String> {
    // 截一段响应体塞进错误信息。被限流 / 404 时 Bing 回的往往不是 JSON，
    // 而「解析失败：expected value at line 1 column 1」这句话对谁都没有用 ——
    // 把真正拿到的那几十个字显示出来，才能区分「限流」「被墙」「改了接口」。
    //
    // ⚠️ 这里按**字节**切、而不是 `text.trim().chars().take(n).collect::<String>()`：
    // 写成后者时，本机的 lib 测试二进制会启动即退 0xC0000139（STATUS_ENTRYPOINT_NOT_FOUND），
    // `cargo test` 一个测试都跑不了。已实测排除体积 / incremental / 静态导入 / DLL 位置 /
    // PATH 版本 / 产物损坏等原因，且「只把这一个闭包换成返回常量」即可恢复 ——
    // 具体是哪个单态化实例触发的没查出来，只知道绕开它代价很小。
    // 不要为了「写法更好看」改回去；真改回去请先跑一遍 `cargo test`。
    let head = |n: usize| -> String {
        let t = text.trim();
        if t.is_empty() {
            return String::from("（空响应体）");
        }
        let bytes = t.as_bytes();
        let mut end = n.min(bytes.len());
        // 不能在 UTF-8 多字节字符中间切，否则 String 的切片会 panic
        while end < bytes.len() && (bytes[end] & 0xC0) == 0x80 {
            end += 1;
        }
        t[..end].replace(['\n', '\r'], " ")
    };

    let v: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| format!("解析失败：{e}；响应开头是「{}」", head(120)))?;
    let first = v
        .get("images")
        .and_then(|a| a.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| format!("响应里没有 images[0]；响应开头是「{}」", head(120)))?;

    // url 是必需项：缺了它整张卡就没有内容，早失败比渲染一张空卡好
    let relative = first
        .get("url")
        .and_then(|u| u.as_str())
        .ok_or_else(|| "images[0] 里缺少 url 字段".to_string())?;

    // 这两个只是图注，缺了就留空，不值得因此让整张卡失败
    let text_of = |k: &str| {
        first
            .get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    Ok(DailyBing {
        // Bing 给的是相对地址（`/th?id=OHR...`），必须补全 —— 否则浏览器会拿卡片的
        // 地址去解析它，得到一个 404。
        //
        // ⚠️ 域名写死在这里，**不要提成 `const` 再用 `format!("{HOST}{relative}")`**：
        // 那样写出来的二进制在 windows-gnu 下会加载失败（STATUS_ENTRYPOINT_NOT_FOUND），
        // `cargo test` 一个测试都跑不了。换成本文件里的写法（字面量 + 捕获局部变量）就正常。
        url: format!("https://www.bing.com{relative}"),
        copyright: text_of("copyright"),
        start_date: text_of("startdate"),
    })
}

/// `invoke('bing_daily')` —— 向 Bing 请求当日壁纸元信息。
///
/// **同步命令，不开 `spawn_blocking`**：Tauri v2 里前端 UI 跑在独立的 WebView2 进程，
/// Rust 端阻塞的是自己的 tokio worker，界面不会跟着卡；同步命令与既有的
/// `read_doc` / `write_doc` 一个写法，也省掉一整条 blocking pool 的链接代码。
/// 桌面壳之外没有理由发这个请求，调用方（卡片）自己会判 `isDesktop`。
#[tauri::command]
pub fn bing_daily() -> Result<DailyBing, String> {
    let endpoint = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN";
    parse_bing_wallpaper(&bing_get(endpoint)?)
}

// ---------------------------------------------------------------- WinHTTP

/**
 * ⚠️ 这一层带 `#[link(name = "winhttp")]`，**故意排除在 lib 的测试壳之外**。
 *
 * 只要它被链进 `cargo test` 产出的测试二进制，那个二进制就会在启动时退出
 * 0xC0000139（STATUS_ENTRYPOINT_NOT_FOUND）—— 一个测试都跑不了，`cargo test` 直接红。
 * 本机可稳定复现，`cargo clean -p modulo` 后重编依然如此。
 *
 * 已逐项实测排除的原因（都不是）：
 * - 二进制体积：98.9 MB 也失败、119 MB 通过、127 MB 失败 —— 非单调，与体积无关
 * - `[profile.test] debug = 1`、`CARGO_INCREMENTAL=0`、`cargo clean` 后完整重编：都无效
 * - 静态导入：逐个 `GetProcAddress` 验证，**全部可解析**（含 WebView2Loader.dll）
 * - `WebView2Loader.dll`：deps/、target/debug/、build 输出目录三份 MD5 完全一致
 * - 导出目录为空、入口点 RVA 落在 .text 内、镜像 127 MB 远低于任何阈值
 * - PATH 上的 mingw runtime 版本冲突：把 mingw 从 PATH 移除后照旧失败
 *
 * 现象本身也很怪：`LoadLibraryExW` 能成功加载那个二进制（说明导入没问题），
 * 但 `CreateProcess` 之后进程立刻以同一个码退出。根因未定位，属本机环境级问题。
 *
 * 所以：真实取数只存在于**桌面 app** 里，由真机探针验证
 * （`scripts/desktop-probe.mjs`，`PROBE_NET=1` 时通过 CDP 真调 `invoke('bing_daily')`）——
 * 那比这里的单测更有说服力，因为它跑的是真正的 WebView2 + 真正的网络。
 * lib 测试壳里只留下面的 stub 和纯函数单测。
 *
 * **别为了「让代码更统一」把 `not(test)` 去掉**：那会让 `cargo test` 整个红掉。
 */
#[cfg(target_os = "windows")]
mod winhttp {
    /// WinHTTP 官方文档里的句柄类型名就是 `HINTERNET`。
    /// 改名成 `InternetHandle` 能过 clippy，但查 MS 文档时对不上名字更费事，
    /// 而这份代码的读者正是在对着文档写 FFI。局部 allow，不动 crate 级 lint。
    #[allow(clippy::upper_case_acronyms)]
    type HINTERNET = *mut core::ffi::c_void;

    // WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY：走系统代理设置，而不是假定直连
    const ACCESS_AUTOMATIC_PROXY: u32 = 0x0000_0004;
    const FLAG_SECURE: u32 = 0x0080_0000;
    const OPTION_CONNECT_TIMEOUT: u32 = 0x0000_0002;
    const OPTION_SEND_TIMEOUT: u32 = 0x0000_0005;
    const OPTION_RECEIVE_TIMEOUT: u32 = 0x0000_0006;

    #[link(name = "winhttp")]
    extern "system" {
        fn WinHttpOpen(
            agent: *const u16,
            access: u32,
            proxy: *const u16,
            proxy_bypass: *const u16,
            flags: u32,
        ) -> HINTERNET;
        fn WinHttpConnect(
            session: HINTERNET,
            server: *const u16,
            port: u16,
            reserved: u32,
        ) -> HINTERNET;
        fn WinHttpOpenRequest(
            connect: HINTERNET,
            verb: *const u16,
            object: *const u16,
            version: *const u16,
            referrer: *const u16,
            accept: *const u16,
            flags: u32,
        ) -> HINTERNET;
        fn WinHttpSendRequest(
            request: HINTERNET,
            headers: *const u16,
            headers_len: u32,
            optional: *const core::ffi::c_void,
            optional_len: u32,
            total_len: u32,
            context: usize,
        ) -> i32;
        fn WinHttpReceiveResponse(request: HINTERNET, reserved: *mut core::ffi::c_void) -> i32;
        fn WinHttpQueryDataAvailable(request: HINTERNET, available: *mut u32) -> i32;
        fn WinHttpReadData(
            request: HINTERNET,
            buffer: *mut core::ffi::c_void,
            to_read: u32,
            read: *mut u32,
        ) -> i32;
        fn WinHttpSetOption(
            internet: HINTERNET,
            option: u32,
            buffer: *const core::ffi::c_void,
            buffer_len: u32,
        ) -> i32;
        fn WinHttpCloseHandle(internet: HINTERNET) -> i32;
        fn GetLastError() -> u32;
    }

    /// RAII：WinHTTP 的句柄不会自动释放，漏一次就是内核句柄泄漏。
    struct Handle(HINTERNET);

    impl Handle {
        /// 构造失败时返回 `Err`，成功时句柄由 `Drop` 负责关。
        fn acquire(raw: HINTERNET, what: &str) -> Result<Self, String> {
            if raw.is_null() {
                Err(format!("{what} 失败（Win32 错误 {}）", last_error_code()))
            } else {
                Ok(Self(raw))
            }
        }
        fn get(&self) -> HINTERNET {
            self.0
        }
    }

    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { WinHttpCloseHandle(self.0) };
            }
        }
    }

    fn last_error_code() -> u32 {
        // SAFETY: GetLastError 无参数、无副作用，是纯读线程的 last-error 值。
        unsafe { GetLastError() }
    }

    /// 同步 GET，只支持 https。返回响应体文本。
    ///
    /// 证书校验用 WinHTTP 的默认行为（会验）：这张卡连的是固定域名，
    /// 没必要为省一次握手把校验关掉。
    pub fn get(url: &str) -> Result<String, String> {
        let (host, target) = split_https(url)?;

        // SAFETY: 下面每个指针都指向本函数里活着的 Vec<u16>，长度以 NUL 结尾，
        // 且句柄都由 Handle 持有并在退出时关闭。
        unsafe {
            let agent = wide("Modulo/0.5");
            let session = Handle::acquire(
                WinHttpOpen(
                    agent.as_ptr(),
                    ACCESS_AUTOMATIC_PROXY,
                    std::ptr::null(),
                    std::ptr::null(),
                    0,
                ),
                "打开 WinHTTP 会话",
            )?;

            // 超时：默认 connect 是 60s、send/receive 是 30s，对一张卡片太久了。
            // 10s 足够取到 1KB 级别的 JSON；超时必须显式报错，不能静默转成"今天没图"。
            for option in [
                OPTION_CONNECT_TIMEOUT,
                OPTION_SEND_TIMEOUT,
                OPTION_RECEIVE_TIMEOUT,
            ] {
                let ms: u32 = 10_000;
                WinHttpSetOption(
                    session.get(),
                    option,
                    (&ms as *const u32).cast(),
                    std::mem::size_of::<u32>() as u32,
                );
            }

            let host_w = wide(host);
            let connect = Handle::acquire(
                WinHttpConnect(session.get(), host_w.as_ptr(), 443, 0),
                &format!("连接 {host}"),
            )?;

            let verb = wide("GET");
            let target_w = wide(target);
            let request = Handle::acquire(
                WinHttpOpenRequest(
                    connect.get(),
                    verb.as_ptr(),
                    target_w.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    FLAG_SECURE,
                ),
                &format!("向 {host} 发起请求"),
            )?;

            if WinHttpSendRequest(
                request.get(),
                std::ptr::null(),
                0,
                std::ptr::null(),
                0,
                0,
                0,
            ) == 0
            {
                return Err(format!("发送请求失败（Win32 错误 {}）", last_error_code()));
            }
            if WinHttpReceiveResponse(request.get(), std::ptr::null_mut()) == 0 {
                return Err(format!("接收响应失败（Win32 错误 {}）", last_error_code()));
            }

            // ⚠️ 这里**刻意不查 HTTP 状态码**。
            // `WinHttpQueryHeaders` 在实测环境（Win11 + WebView2 154）上对
            // WINHTTP_QUERY_STATUS_CODE 及其带 NUMBER flag 的各种变体一律返回 FALSE +
            // ERROR_WINHTTP_SECURE_FAILURE(12150)，而同一次请求的 Send/Receive 都是成功的、
            // body 也能完整读出来。用 curl 与 WinHttpRequest COM 各验一遍都正常，
            // 所以这是该机器 WinHTTP 层的毛病，不是参数写错。
            //
            // 不查也能活：真正的失败信号是 body 解析不出 `images[0]`，
            // 而解析失败时会把 body 前 120 字节带进错误信息 —— 被限流时 Bing 回的
            // HTML/短文本会直接出现在界面上，比一个「HTTP 429」还具体。
            // 少依赖一个在本机就坏的 API，比围着它做兼容更划算。
            let mut body: Vec<u8> = Vec::new();
            loop {
                let mut available = 0u32;
                if WinHttpQueryDataAvailable(request.get(), &mut available) == 0 {
                    return Err(format!(
                        "查询数据长度失败（Win32 错误 {}）",
                        last_error_code()
                    ));
                }
                if available == 0 {
                    break;
                }
                let mut chunk = vec![0u8; available as usize];
                let mut read = 0u32;
                if WinHttpReadData(
                    request.get(),
                    chunk.as_mut_ptr().cast(),
                    available,
                    &mut read,
                ) == 0
                {
                    return Err(format!(
                        "读取响应体失败（Win32 错误 {}）",
                        last_error_code()
                    ));
                }
                if read == 0 {
                    break;
                }
                body.extend_from_slice(&chunk[..read as usize]);
                if body.len() > 2 * 1024 * 1024 {
                    return Err("响应体超过 2 MiB，不像是一份 wallpaper 元信息".to_string());
                }
            }

            String::from_utf8(body).map_err(|_| "响应体不是合法的 UTF-8".to_string())
        }
    }

    /// 拆出 host 与 path。只认 `https://` —— 这张卡不需要 http，也省掉明文降级。
    pub(super) fn split_https(url: &str) -> Result<(&str, &str), String> {
        let rest = url
            .strip_prefix("https://")
            .ok_or_else(|| format!("只支持 https，拿到的是 {url}"))?;
        let host = rest
            .split('/')
            .next()
            .filter(|h| !h.is_empty())
            .unwrap_or(rest);
        // 根路径要显式给 "/"：空目标名不是合法请求行
        let target = match rest.find('/') {
            Some(i) => &rest[i..],
            None => "/",
        };
        Ok((host, target))
    }

    /// NUL 结尾的 UTF-16。WinHTTP 全部接口要这个形状。
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

/// 同步 GET 一个 https 地址，返回响应体文本。
///
/// `pub` 是为了集成测试与排查脚本能直接打它 —— 要验证的不只是「Bing 今天有图」，
/// 还有「取不到的时候确实会报错」。后者更要紧：取数失败若悄悄变成空结果，
/// 界面上就只剩一句「今天没图」，用户没法判断该不该重试。
pub fn bing_get(url: &str) -> Result<String, String> {
    winhttp::get(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    const OK: &str = r#"{"images":[{"url":"/th?id=OHR.Some2026_EN-US123","copyright":"© 某人","startdate":"20261006"}]}"#;

    #[test]
    fn 相对地址被补成绝对地址() {
        let got = parse_bing_wallpaper(OK).unwrap();
        assert_eq!(
            got,
            DailyBing {
                url: "https://www.bing.com/th?id=OHR.Some2026_EN-US123".to_string(),
                copyright: "© 某人".to_string(),
                start_date: "20261006".to_string(),
            }
        );
    }

    #[test]
    fn 图注缺失不牵连整张卡() {
        let got = parse_bing_wallpaper(r#"{"images":[{"url":"/th?id=x"}]}"#).unwrap();
        assert_eq!(got.url, "https://www.bing.com/th?id=x");
        assert_eq!(got.copyright, "");
        assert_eq!(got.start_date, "");
    }

    #[test]
    fn 没有图片就报错而不是给一张空卡() {
        // 限流时 Bing 会回结构完好的空 JSON，这个形状最容易蒙混过去
        assert!(parse_bing_wallpaper(r#"{"images":[]}"#).is_err());
        assert!(parse_bing_wallpaper("{}").is_err());
        // 缺 url 同样不能接受：没有它就没有内容
        assert!(parse_bing_wallpaper(r#"{"images":[{"copyright":"x"}]}"#).is_err());
    }

    /// 不查状态码的代价是「取不到」全靠解析失败暴露 —— 那错误信息就必须真能说明原因。
    /// 这两条盯的就是「错误信息里有没有把响应体带出来」。
    #[test]
    fn 解析失败时错误信息里带得下响应开头() {
        let html = "<html><head><title>429 Too Many Requests</title></head></html>";
        let err = parse_bing_wallpaper(html).unwrap_err();
        assert!(err.contains("429"), "限流原因应当出现在错误里：{err}");

        let err = parse_bing_wallpaper("").unwrap_err();
        assert!(err.contains("空响应体"), "空响应要说明是空的：{err}");

        let err = parse_bing_wallpaper(r#"{"toolbar":"x"}"#).unwrap_err();
        assert!(err.contains("images[0]"), "要说清缺的是哪一段：{err}");
    }
    // 这里**没有**网络实打测试：真实取数只在桌面壳里发生，而桌面壳的验证方式是
    // 真机探针 —— `npm run desktop:probe`（带 PROBE_NET=1）会在真 app 里通过 CDP
    // 真调 `invoke('bing_daily')` 并断言拿到了当天的壁纸。
    // 那比这里的 `#[ignore]` 单测强：跑的是真正的 WebView2、真正的网络、真正的 WinHTTP。
}
