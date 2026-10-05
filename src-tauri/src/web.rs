//! 每日一图：取 Bing 的当日壁纸元信息，解析成卡片要的几个字段。
//!
//! 取数本身在 [`crate::net`] 里（WinHTTP + 那套 SSRF 边界），这里只负责解析 ——
//! 解析是纯函数，所以字段缺失、结构不符这些情况能被单测压住，网络反而不是单测的事。

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
    parse_bing_wallpaper(&crate::net::get(endpoint)?.body)
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
