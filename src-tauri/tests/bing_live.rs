//! 每日一图的网络实打验证。
//!
//! **默认全部跳过** —— CI 不该依赖 Bing 可达，也不该在网络抖动时变红。
//! 需要确认取数链路（改了 `web::bing_get`、换了域名、怀疑被限流）时手动跑：
//!
//! ```text
//! cargo test --test bing_live -- --ignored --nocapture
//! ```
//!
//! 为什么放在 `tests/` 而不是 `src/web.rs` 的 `#[cfg(test)]` 模块里：
//! 本 crate 的 lib 测试二进制在这台机器上会加载失败（STATUS_ENTRYPOINT_NOT_FOUND），
//! 单测跑不起来 —— 原因记在 CHANGELOG 的「每日一图」条目里。
//! integration test 是另一个可执行文件，不受那个问题影响。
//!
//! 需要 `web` 是 `pub`，所以那边也是 `pub mod`。

#[test]
#[ignore = "要联网，默认不跑"]
fn 真的能从_bing_取到当天的壁纸() {
    let got = modulo_lib::web::bing_daily().expect("取数应当成功");

    // 地址必须是拼好的绝对地址：卡片把它直接塞进 <img src>，
    // 留相对地址会 404，而那种 404 在界面上长得像"今天没图"。
    assert!(
        got.url.starts_with("https://www.bing.com/th?id="),
        "图片地址不对：{}",
        got.url
    );
    assert!(
        got.url.len() > "https://www.bing.com/th?id=".len(),
        "图片地址里没有 id：{}",
        got.url
    );
    assert!(
        got.start_date.len() == 8 && got.start_date.bytes().all(|b| b.is_ascii_digit()),
        "日期应为 YYYYMMDD，拿到的是 {:?}",
        got.start_date
    );

    println!("日期 {}", got.start_date);
    println!("版权 {}", got.copyright);
    println!("图片 {}", got.url);
}

#[test]
#[ignore = "要联网，默认不跑"]
fn 不存在的域名必须报错而不是返回空() {
    // 这条比上面那条更重要：网络失败要能被界面看见。
    // 如果这里返回 Ok(空)，卡片就会显示"今天没图"，而真相是"根本没取到"。
    let err = modulo_lib::web::bing_get("https://this-host-does-not-exist.invalid/x")
        .expect_err("应当报错");
    println!("报错内容：{err}");
    assert!(!err.is_empty(), "错误信息不能是空的");
}

#[test]
#[ignore = "要联网，默认不跑"]
fn 只接受_https() {
    let err = modulo_lib::web::bing_get("http://www.bing.com/HPImageArchive.aspx")
        .expect_err("http 应当被拒");
    assert!(
        err.contains("https"),
        "错误信息要说明只支持 https，实际是：{err}"
    );
}
