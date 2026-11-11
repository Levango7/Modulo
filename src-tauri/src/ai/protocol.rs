//! AI 线协议纯函数集 —— URL 白名单 / 人话化 / composer 参数折文字。
//!
//! 从 openai_compat 拆出（300 行纪律，同 D-01/D-02 手法）：这一层**不碰 IO、
//! 不持状态**，全部可在 cargo test 里跑；reqwest/tauri 相关的粘合留在外面。
//! 单测就在本文件——测试与实现同文件是仓库惯例（sysmon.rs 同模式）。
//!
//! **SSE 行解析搬到 `sse.rs`**（F-15 §2.3）：工具调用的分片形状让那一块自己长成了
//! 一个子功能，留在这里会把本文件继续撑大。

use serde::{Deserialize, Serialize};

// ---- URL 白名单（契约 ai_chat notes：https，或 localhost/127.0.0.1 的 http）----

/// 从 authority 段提取主机（去端口；IPv6 带 []）。空串不可能出现（调用方已保证）
pub(crate) fn extract_host(authority: &str) -> &str {
    // userinfo 先剥：`https://evil.com@169.254.169.254/` 的实际主机是后面那个，
    // 不剥就会按 `evil.com` 判成公网地址放行 —— 而请求会打到云元数据端点。
    // `net::split_target` 那边是直接拒 userinfo，这里保留它（rc 可带），只保证看的是真主机。
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    if let Some(rest) = authority.strip_prefix('[') {
        return match rest.find(']') {
            // '[' 已耗 1 字节，']' 落在 rest 内偏移 end，即 authority 的 end+1（含）
            Some(end) => &authority[..end + 2],
            None => authority, // 未闭合的畸形串整段当主机，交给白名单去拒
        };
    }
    authority.split(':').next().unwrap_or(authority)
}

fn is_local_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

/// scheme 白名单 + 私网/保留地址黑名单。尾部 `/` 容忍。
///
/// 黑名单**不是自己抄一份**，直接用 `net::blocked_reason`（同一个函数守着 feeds 抓取与
/// webdav 同步）。AI 这条线的特别之处只有一条：它**允许连本机**（Ollama / LM Studio 是
/// 一期的主要用法），所以 `localhost` / `127.0.0.1` / `[::1]` 三个写法先豁免，
/// 剩下的 10/8、169.254（云元数据）、`*.internal` 之类一律拒 —— 用户在"模型服务地址"
/// 里填 `https://169.254.169.254/` 就能让桌面壳带着本机身份去敲元数据端点，这是这条线
/// 独有的风险（外网抓取那条线本来就不允许任何私有地址）。
pub(crate) fn validate_base_url(base: &str) -> Result<(), String> {
    let base = base.trim();
    let rest = if let Some(rest) = base.strip_prefix("https://") {
        rest
    } else if let Some(rest) = base.strip_prefix("http://") {
        let authority = rest.split('/').next().unwrap_or("");
        if is_local_host(&extract_host(authority).to_ascii_lowercase()) {
            return Ok(());
        }
        return Err("明文 http 只允许本机地址（localhost / 127.0.0.1），云端必须用 https".into());
    } else {
        return Err("模型服务地址必须以 https:// 或 http:// 开头".into());
    };
    let raw = extract_host(rest.split('/').next().unwrap_or(""));
    if raw.is_empty() {
        return Err("模型服务地址缺少主机名".into());
    }
    let host = raw.to_ascii_lowercase();
    if is_local_host(&host) {
        return Ok(());
    }
    // 带方括号的 IPv6 交给黑名单前要剥掉，否则 `[fe80::1]` 解析不成地址、按主机名放行
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if let Some(reason) = crate::net::blocked_reason(bare) {
        return Err(format!(
            "{reason}（{raw}）—— 模型服务要么是公网 https 地址，要么是本机地址"
        ));
    }
    Ok(())
}

/// 是否本机端点——连接失败的人话要按这个分流
pub(crate) fn is_local_base(base: &str) -> bool {
    base.trim()
        .strip_prefix("http://")
        .or_else(|| base.trim().strip_prefix("https://"))
        .map(|rest| is_local_host(extract_host(rest.split('/').next().unwrap_or(""))))
        .unwrap_or(false)
}

// ---- HTTP 状态码 → 人话（架构文档 §6 错误分类总表）----

pub(crate) fn humanize_status(code: u16) -> String {
    match code {
        400 => "请求被服务端拒绝，检查模型名与参数".into(),
        401 | 403 => "API key 无效，去设置里重新填入".into(),
        404 => "这个模型在服务端不存在，换一个模型名".into(),
        402 | 429 => "额度不足或被限流，稍后再试".into(),
        other => format!("模型服务返回错误（HTTP {other}）"),
    }
}

pub(crate) fn humanize_connect(base: &str) -> String {
    if is_local_base(base) {
        "没连上本地模型服务，确认 Ollama 已启动".into()
    } else {
        "网络连不上模型服务，检查连接后重试".into()
    }
}

// ---- 聊天消息 · composer 的思考等级与附件（改天换地 E3）----
//
// 这两件 composer 参数在线上都**没有对应的协议字段**，全部在这里折成文字：
// 思考等级是给模型的一句指令，附件是接在消息前的 `## 附件：文件名` 块。
//
// 为什么不发 `reasoning_effort` / 顶层 `temperature` 之类的参数：这条线连的是
// "OpenAI 兼容"的各种服务 —— 官方、DeepSeek、千问、vLLM、Ollama、还有各种网关。
// 未知的顶层字段有的被服务端默默忽略，有的直接 400（千问的兼容层对不认识的字段很严）。
// 一句话指令是**谁都能收、收不到也不报错**的那种形状；它换不来真的推理预算，
// 这个差别不许在界面上说成"深度思考"糊弄人（§12.65 如实记）。

/// 发给 OpenAI 兼容端点的一条消息。`role` / `content` 就是线上的字面字段
#[derive(Serialize, Deserialize)]
pub struct Msg {
    pub role: String,
    pub content: String,
}

/// composer「添加文件」带上来的一份附件：文件名 + 正文。
///
/// **不带路径** —— 前端把文件读成文本后只交正文，Rust 这边不需要、也不该知道它
/// 从哪个目录来。少一个"传进来一个路径就照着读"的入口。
#[derive(Deserialize)]
pub struct Attachment {
    pub name: String,
    pub content: String,
}

/// 单个文件带进上下文的字数上限。与前端 `ATTACH_CHARS_MAX` 同一口径 ——
/// 前端那份只管显示「已截断」，真正的闸门在这里（手搓的 invoke 一样按这个数来）。
pub(crate) const ATTACH_CHARS_MAX: usize = 8_000;

/// 一次请求所有附件合计的字数上限：两个顶格文件。再多就不是"带几份材料"，
/// 是拿文件灌提示词 —— 那件事不该由一条隐形的 composer 动作替用户做。
pub(crate) const ATTACH_TOTAL_MAX: usize = 16_000;

/// 按**字符**取前 `max` 个（返回切片与实际字符数）。中文在 UTF-8 里 3 字节，
/// 按字节切会 panic；`chars().take().collect()` 在这台机器上会让测试壳启动即退
/// （见 Cargo.toml `[profile.test]` 那段），所以这里走 `char_indices` 取边界。
fn cut_chars(s: &str, max: usize) -> (&str, usize) {
    match s.char_indices().nth(max) {
        Some((i, _)) => (&s[..i], max),
        None => (s, s.chars().count()),
    }
}

/// 思考等级 → 给模型的一句指令。
///
/// **未知值一律 None**（不猜、不兜底）：`off` 与拼错的值都落进这里 —— 前者是
/// "用户没要"，后者是"版本错位"，两种情况下"不替他改语气"都比"按最像的那档来"安全。
pub(crate) fn thinking_directive(level: &str) -> Option<&'static str> {
    match level {
        "low" => Some("先给结论，再用一两句话说明理由，不要展开推演。"),
        "medium" => Some("回答前先在内部把问题拆成几步；先给结论，再给必要的推理，不要复述思考过程。"),
        "high" => Some("慢一点想：先列出你的关键假设与边界，再分步推理，最后给结论；不确定的地方直接说不确定。"),
        _ => None,
    }
}

/// 附件块。每个文件各自封顶 `ATTACH_CHARS_MAX`、合计封顶 `ATTACH_TOTAL_MAX`。
///
/// 三条都是"如实"：截断要写明截到哪、预算用完的文件要留名字和一句"没有带入"、
/// 空文件要说是空的。静默丢弃/静默截断会让模型以为文件就到这儿 —— 比不带更糟。
pub(crate) fn fold_attachments(items: &[Attachment]) -> Option<String> {
    if items.is_empty() {
        return None;
    }
    let mut out = String::from(
        "用户在这条消息里附上了下面这些文件，把它们当作已知内容来回答；文件里没写的，不要编。",
    );
    let mut budget = ATTACH_TOTAL_MAX;
    for it in items {
        let name = if it.name.trim().is_empty() {
            "未命名文件"
        } else {
            it.name.trim()
        };
        let body = it.content.trim_end();
        if budget == 0 {
            out.push_str(&format!(
                "\n\n## 附件：{name}\n（本次附件字数已到上限，这个文件没有带入）"
            ));
            continue;
        }
        let total = body.chars().count();
        let (cut, used) = cut_chars(body, ATTACH_CHARS_MAX.min(budget));
        budget -= used;
        out.push_str(&format!("\n\n## 附件：{name}\n{cut}"));
        if cut.is_empty() {
            out.push_str("\n（这个文件没有文字内容）");
        } else if used < total {
            // 封顶的是单文件还是合计预算，用户该看到的原因不一样
            if used < ATTACH_CHARS_MAX {
                out.push_str("\n（本次附件合计已到上限，这个文件只带入了前面一部分）");
            } else {
                out.push_str(&format!("\n（文件较长，只带入了前 {ATTACH_CHARS_MAX} 字）"));
            }
        }
    }
    Some(out)
}

/// 两件 composer 参数合成**一条** system 前缀（都没有就 None）。
///
/// 为什么必须合成一条：有的网关只认开头一条 system（后出现的会被当普通输入或直接 400），
/// 而前端已经会为引用的卡片带一条 system —— 再多一条就把"卡片内容"挤到了非 system 位。
pub(crate) fn preamble(thinking: Option<&str>, attachments: &[Attachment]) -> Option<String> {
    let directive = thinking.and_then(thinking_directive);
    let files = fold_attachments(attachments);
    match (directive, files) {
        (None, None) => None,
        (Some(d), None) => Some(d.to_string()),
        (None, Some(f)) => Some(f),
        (Some(d), Some(f)) => Some(format!("{d}\n\n{f}")),
    }
}

/// 把 composer 的两件参数并进消息序列：只在**最前面**有一条 system，且不新增第二条。
/// 原有的那条（引用卡片的 contextBlock）正文一字不动，只是被顶到后面。
pub(crate) fn compose_messages(
    mut messages: Vec<Msg>,
    thinking: Option<&str>,
    attachments: &[Attachment],
) -> Vec<Msg> {
    let Some(head) = preamble(thinking, attachments) else {
        return messages;
    };
    if let Some(first) = messages.first_mut() {
        if first.role == "system" {
            first.content = format!("{head}\n\n{}", first.content);
            return messages;
        }
    }
    messages.insert(
        0,
        Msg {
            role: "system".to_string(),
            content: head,
        },
    );
    messages
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheme_白名单() {
        for ok in [
            "https://api.example.com/v1",
            "http://localhost:11434/v1",
            "http://127.0.0.1:11434/v1/",
            "http://[::1]:11434/v1",
            "https://api.deepseek.com",
        ] {
            assert!(validate_base_url(ok).is_ok(), "{ok} 应当放行");
        }
        for bad in [
            "http://api.example.com/v1",
            "ftp://x",
            "api.example.com",
            "https:///no-host",
            "",
        ] {
            assert!(validate_base_url(bad).is_err(), "{bad} 应当被拒");
        }
    }

    #[test]
    fn 提取主机_带端口与ipv6() {
        assert_eq!(extract_host("localhost:11434"), "localhost");
        assert_eq!(extract_host("127.0.0.1:8080"), "127.0.0.1");
        assert_eq!(extract_host("[::1]:11434"), "[::1]");
        assert_eq!(extract_host("api.example.com"), "api.example.com");
        // userinfo 不是主机：带 `@` 时看的是后面那个
        assert_eq!(extract_host("user:pw@ai.example.com"), "ai.example.com");
        assert_eq!(
            extract_host("evil.com@169.254.169.254:80"),
            "169.254.169.254"
        );
        // 畸形未闭合也不能 panic
        assert_eq!(extract_host("[::1"), "[::1");
    }

    #[test]
    fn 本地判定() {
        assert!(is_local_base("http://127.0.0.1:11434/v1"));
        assert!(is_local_base("https://localhost:8443"));
        assert!(!is_local_base("https://api.example.com/v1"));
    }

    #[test]
    fn 人话_状态码() {
        assert_eq!(humanize_status(401), "API key 无效，去设置里重新填入");
        assert_eq!(humanize_status(404), "这个模型在服务端不存在，换一个模型名");
        assert_eq!(humanize_status(429), "额度不足或被限流，稍后再试");
        assert!(humanize_status(500).contains("500"));
    }

    #[test]
    fn 私网与保留地址一律拒_本机三写法除外() {
        // 本机服务是这条线的主要用法，http/https 都放行（大小写不论 —— DNS 名不区分）
        for ok in [
            "https://localhost:8443/v1",
            "https://LOCALHOST/v1",
            "https://127.0.0.1:11434/v1",
            "https://[::1]:11434/v1",
        ] {
            assert!(validate_base_url(ok).is_ok(), "{ok} 应当放行");
        }
        // 云元数据端点是这条线最要命的一条：填进来就能带着本机身份去敲
        for (bad, hint) in [
            ("https://169.254.169.254/latest", "169.254"),
            ("https://10.0.0.5/v1", "10/8"),
            ("https://192.168.1.10:8080/v1", "192.168"),
            ("https://172.20.1.1/v1", "172.16"),
            ("https://[fe80::1]/v1", "fe80"),
            ("https://[fd00::1]/v1", "fc00"),
            ("https://metadata.internal/v1", "internal"),
            ("https://router.local/v1", "local"),
            ("https://api.home.arpa/v1", "home.arpa"),
        ] {
            let err = validate_base_url(bad).expect_err(bad);
            assert!(
                err.contains(hint),
                "{bad} 的拒绝理由应提到 {hint}，实为：{err}"
            );
        }
    }

    #[test]
    fn 黑名单与本机豁免不互相蚕食() {
        // 豁免的是"整个主机等于本机三写法"，不是"包含 localhost" ——
        // 子串型豁免会把 *包含* 这些字的公网域名一起放进来
        assert!(validate_base_url("https://localhost.example.com/v1").is_ok());
        assert!(validate_base_url("https://api.localhost.evil.com/v1").is_ok());
        // 反过来，公网域名里的 local 前缀不能被当成 *.local
        assert!(validate_base_url("https://local.example.com/v1").is_ok());
        // userinfo 里塞什么都改不了真正要连的主机：这个地址会打到元数据端点
        let err =
            validate_base_url("https://evil.com@169.254.169.254/latest").expect_err("绕不过去");
        assert!(err.contains("169.254"), "实为：{err}");
        // 带 userinfo 的本机地址仍然放行（http 判据看的是剥掉 userinfo 之后的主机）
        assert!(validate_base_url("http://user:pw@localhost:11434/v1").is_ok());
    }

    #[test]
    fn 人话_连接错误分本地与云端() {
        assert_eq!(
            humanize_connect("http://127.0.0.1:11434/v1"),
            "没连上本地模型服务，确认 Ollama 已启动"
        );
        assert_eq!(
            humanize_connect("https://api.example.com/v1"),
            "网络连不上模型服务，检查连接后重试"
        );
    }

    #[test]
    fn 思考等级_未知值一律不加指令() {
        for id in ["low", "medium", "high"] {
            assert!(thinking_directive(id).is_some(), "{id} 应当有指令");
        }
        // off 是"用户没要"，拼错是"版本错位"：两者都不能替用户猜一档
        for id in ["off", "", "HIGH", "deep"] {
            assert!(thinking_directive(id).is_none(), "{id} 不该有指令");
        }
        // 三档文案互不相同 —— 相同就是复制粘贴漏改，界面上的档位成了摆设
        let mut seen = std::collections::HashSet::new();
        for id in ["low", "medium", "high"] {
            assert!(
                seen.insert(thinking_directive(id).unwrap()),
                "{id} 的文案与别的档重复"
            );
        }
    }

    #[test]
    fn 附件_单文件封顶且明说截断() {
        let big = "字".repeat(ATTACH_CHARS_MAX + 2_000);
        let block = fold_attachments(&[Attachment {
            name: "笔记.md".into(),
            content: big,
        }])
        .expect("有附件就该有块");
        assert!(block.contains("## 附件：笔记.md"));
        assert!(
            block.contains(&format!("只带入了前 {ATTACH_CHARS_MAX} 字")),
            "单文件截断要说明：{block}"
        );
        // 正文按字符裁到上限，不是按字节（中文 3 字节/字）
        let body = block.split("## 附件：笔记.md\n").nth(1).unwrap();
        assert_eq!(
            body.split('\n').next().unwrap().chars().count(),
            ATTACH_CHARS_MAX
        );
    }

    #[test]
    fn 附件_合计封顶且不静默丢文件() {
        let full = "字".repeat(ATTACH_CHARS_MAX);
        let items: Vec<Attachment> = ["a.md", "b.md", "c.md"]
            .iter()
            .map(|n| Attachment {
                name: (*n).into(),
                content: full.clone(),
            })
            .collect();
        let block = fold_attachments(&items).expect("有附件就该有块");
        assert!(block.contains("## 附件：a.md"));
        assert!(block.contains("## 附件：b.md"));
        // 预算用完的第三个：名字要在，正文进不来也要说清
        assert!(block.contains("## 附件：c.md"), "第三个不能被静默丢弃");
        assert!(block.contains("没有带入"), "要说清没带入，而不是留个空标题");
        // 整体（含说明句）不该明显超出合计预算
        assert!(
            block.chars().count() < ATTACH_TOTAL_MAX + 1_000,
            "预算被撑破了"
        );
    }

    #[test]
    fn 附件_空名单与空文件() {
        assert!(fold_attachments(&[]).is_none());
        let empty = fold_attachments(&[Attachment {
            name: "  ".into(),
            content: "   \n".into(),
        }])
        .unwrap();
        assert!(empty.contains("未命名文件"), "没名字也要有个称呼：{empty}");
        assert!(
            empty.contains("没有文字内容"),
            "空文件不能装成有内容：{empty}"
        );
    }

    #[test]
    fn 前缀_合成一条且空参数不出前缀() {
        assert!(preamble(None, &[]).is_none());
        assert!(preamble(Some("off"), &[]).is_none());
        // 只有思考等级
        assert_eq!(
            preamble(Some("medium"), &[]).unwrap(),
            thinking_directive("medium").unwrap()
        );
        // 只有附件
        let only_file = preamble(
            None,
            &[Attachment {
                name: "x.txt".into(),
                content: "正文".into(),
            }],
        )
        .unwrap();
        assert!(only_file.starts_with("用户在这条消息里"));
        // 两件都有：同一段里，指令在前，之间只隔一个空行
        let both = preamble(
            Some("high"),
            &[Attachment {
                name: "x.txt".into(),
                content: "正文".into(),
            }],
        )
        .unwrap();
        assert!(both.starts_with(thinking_directive("high").unwrap()));
        assert!(both.contains("\n\n## 附件：x.txt"));
        assert!(!both.contains("\n\n\n"), "不该出现三连换行：{both}");
    }

    #[test]
    fn 消息组装_system永远只有一条且在最前() {
        let user = || Msg {
            role: "user".into(),
            content: "看这张".into(),
        };
        // 原本没有 system：插一条，原有消息顺序不动
        let plain = compose_messages(vec![user()], Some("high"), &[]);
        assert_eq!(plain.len(), 2);
        assert_eq!(plain[0].role, "system");
        assert_eq!(plain[1].content, "看这张");
        // 已有 system（引用卡片的 contextBlock）：并进去，不新增第二条，原正文不丢
        let with_ctx = compose_messages(
            vec![
                Msg {
                    role: "system".into(),
                    content: "卡片内容".into(),
                },
                user(),
            ],
            Some("high"),
            &[],
        );
        assert_eq!(with_ctx.len(), 2, "不能出现两条 system");
        assert!(with_ctx[0]
            .content
            .starts_with(thinking_directive("high").unwrap()));
        assert!(
            with_ctx[0].content.ends_with("卡片内容"),
            "原有 system 正文不能丢"
        );
        // 两件都没给：原样返回，不插空 system
        let untouched = compose_messages(vec![user()], None, &[]);
        assert_eq!(untouched.len(), 1);
        assert_eq!(untouched[0].role, "user");
    }
}
