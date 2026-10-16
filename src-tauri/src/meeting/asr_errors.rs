//! meeting/asr_errors.rs —— 把 ASR 链路的失败翻成人话（300 行纪律分包）。
//!
//! 只做「错误 → 人话」的映射，不碰 IO、不碰 tauri。
//!
//! **为什么单独成文件**：下载 155MB 的模型这件事，失败方式比成功方式多得多
//! （代理挡了、盘满了、校验和不匹配、解压到一半崩了）。全塞进 asr.rs 会顶穿
//! 300 行，而且这些文案要能被单独改、单独看。

/// HTTP 状态码 → 人话。下载走 GitHub release，最常见的两类是代理拦截与 404。
pub fn humanize_status(status: u16) -> String {
    match status {
        404 => "模型地址已失效（404）——可能是上游换了版本标签，请检查更新".into(),
        403 => "下载被拒绝（403）——多为网络代理或企业网关拦了 GitHub 附件".into(),
        407 => "需要代理认证（407）——当前网络要求先登录代理".into(),
        429 => "下载被限流（429）——稍等几分钟再试".into(),
        500..=599 => format!("模型服务器出错（{status}）——稍后再试"),
        _ => format!("下载失败（HTTP {status}）"),
    }
}

/// 传输层失败（连不上 / 超时 / 中断）。`reqwest` 不细分，只能靠关键字认。
pub fn humanize_transport(msg: &str) -> String {
    let m = msg.to_lowercase();
    if m.contains("timed out") || m.contains("timeout") {
        return "下载超时——155MB 的模型在弱网下容易断，换个网络再试".into();
    }
    if m.contains("dns") || m.contains("resolve") {
        return "域名解析失败——请检查网络或代理设置".into();
    }
    if m.contains("connection reset") || m.contains("connection aborted") {
        return "连接被中断——多为代理掐断了大文件传输，换个网络再试".into();
    }
    if m.contains("proxy") {
        return "代理连接失败——请检查系统代理设置".into();
    }
    if m.contains("certificate") || m.contains("tls") || m.contains("ssl") {
        return "TLS 证书校验失败——企业网络做了 HTTPS 中间人解密时会这样".into();
    }
    format!("下载失败：{msg}")
}

/// 校验和不匹配。**这是最要紧的一条**——说明拿到的不是官方那份，
/// 必须明确告诉用户「已丢弃」，避免他以为装好了。
pub fn verify_mismatch(id: &str, expected: &str, actual: &str) -> String {
    format!(
        "{id} 模型校验失败，已丢弃下载内容（防篡改/防损坏）。\n\
         期望 sha256：{expected}\n\
         实际 sha256：{actual}\n\
         常见原因：下载被代理截断、或上游更新了模型文件。请重试；\
         反复失败请检查网络代理。"
    )
}

/// 磁盘写不进去。155MB 起步，磁盘满是很现实的失败。
pub fn humanize_io(msg: &str, ctx: &str) -> String {
    let m = msg.to_lowercase();
    if m.contains("no space") || m.contains("not enough space") || m.contains("disk") {
        return "磁盘空间不足——模型解压后约 220MB，请清理后再试".into();
    }
    if m.contains("permission") || m.contains("denied") || m.contains("access") {
        return format!(
            "没有写入权限（{ctx}）——若安装在 Program Files 下请以管理员运行，\
                        或改装到用户目录"
        );
    }
    if m.contains("os error 32") {
        return format!("文件被占用（{ctx}）——请关闭正在使用的程序后重试");
    }
    format!("{ctx}失败：{msg}")
}

/// 引擎起不来（模型加载失败）。`sherpa-onnx` 的底层只返回空指针，
/// 真正的抱怨打在 stderr 上，这里给出可自查的方向。
pub fn engine_failure(which: &str) -> String {
    format!(
        "{which} 引擎加载失败。常见原因：模型文件不完整（重新下载）、\
         onnxruntime 缺少运行库、或模型与 sherpa-onnx 1.13.8 版本不匹配。"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 状态码覆盖主要几类() {
        assert!(humanize_status(404).contains("失效"));
        assert!(humanize_status(403).contains("代理"));
        assert!(humanize_status(429).contains("限流"));
        assert!(humanize_status(503).contains("服务器"));
        assert!(humanize_status(302).contains("302"));
    }

    #[test]
    fn 传输错误认得出超时与代理() {
        assert!(humanize_transport("operation timed out").contains("超时"));
        assert!(humanize_transport("dns resolve failed").contains("域名"));
        assert!(humanize_transport("connection reset by peer").contains("中断"));
        assert!(humanize_transport("proxy connect failed").contains("代理"));
        assert!(humanize_transport("certificate verify failed").contains("证书"));
        // 认不出的就原样带上，不吞信息
        assert!(humanize_transport("weird").contains("weird"));
    }

    #[test]
    fn 磁盘与权限分开说() {
        assert!(humanize_io("No space left on device", "写模型").contains("磁盘"));
        assert!(humanize_io("permission denied", "写模型").contains("权限"));
        assert!(humanize_io("os error 32", "写模型").contains("占用"));
        assert!(humanize_io("boom", "写模型").contains("boom"));
    }

    #[test]
    fn 校验失败文案带上两个值且说清已丢弃() {
        let s = verify_mismatch("asr", "a".repeat(64).as_str(), "b".repeat(64).as_str());
        assert!(s.contains("已丢弃"));
        assert!(s.contains(&"a".repeat(64)));
        assert!(s.contains(&"b".repeat(64)));
    }
}
