//! 原生 tool-calling 的搬运层（F-15 §2.3 / §2.4）—— 纯状态机，零 IO。
//!
//! 这里只做三件事，一件业务判断都不做：
//! 1. 记住模型给的工具名与参数分片（按 `index` 归位）；
//! 2. 分片全部到齐后**才**把 arguments 解析成 JSON 对象；
//! 3. 把「开始 / 拒收」发成事件帧，交给命令层推给前端。
//!
//! 三条纪律（§2.4，与 F4b 同一条）：
//!
//! - **参数分片未闭合 ⇒ 不解析**（半个 JSON 是畸形，不是空参数）。流收尾时仍未闭合
//!   ⇒ `Err`，命令层发 `Error`（协议错误）。
//! - **没提供的工具名 ⇒ `ToolEnd{ok:false}`**（工具失败），绝不升级成 `Error` ——
//!   两者在界面上是两种东西：前者"这个动作没做成"，后者"这条通道破了"。
//! - **不替前端执行**：模型要的工具有效时只发 `ToolStart`，`ToolEnd` 由前端在真正
//!   跑完（走过动作白名单与参数闸门）之后补。Rust 手里没有执行权，也就没有写盘路径。

use std::collections::BTreeMap;

use super::events::AiEvent;

/// 一帧 SSE 里的一段工具调用增量（由 `protocol::parse_sse_data_line` 解析出来）。
///
/// 三个字段都是"这一片带了什么"，不是"到这里为止是什么"——累积在
/// [`ToolCallAccumulator`] 里做。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct ToolCallDelta {
    /// 同一次回复里第几个调用；分片靠它归位
    pub index: u32,
    /// 只在首片出现（有的服务端每片都带，取第一个非空的）
    pub id: Option<String>,
    /// 同上
    pub name: Option<String>,
    /// arguments 的分片。`None` = 这一帧没带参数（不是"空参数"）
    pub args: Option<String>,
}

#[derive(Default)]
struct Slot {
    id: String,
    name: String,
    args: String,
}

/// 按 `index` 累积一次回复里的全部工具调用。
pub(crate) struct ToolCallAccumulator {
    /// BTreeMap 而不是 HashMap：输出顺序必须稳定（HashMap 的遍历序在两次运行间可能不同，
    /// 前端时间线的行序会跟着抖，测试也没法对拍）
    slots: BTreeMap<u32, Slot>,
    /// 这次请求允许的工具名。`None` = 没传 tools（provider 不支持）⇒ 不校验、也不拒收
    allowed: Option<Vec<String>>,
}

impl ToolCallAccumulator {
    pub(crate) fn new(allowed: Option<Vec<String>>) -> Self {
        Self {
            slots: BTreeMap::new(),
            allowed,
        }
    }

    /// 收下分片。**不解析、不判断**：这里看不到"完整"，只有 `finish` 才知道。
    pub(crate) fn push(&mut self, delta: ToolCallDelta) {
        let slot = self.slots.entry(delta.index).or_default();
        if let Some(id) = delta.id.filter(|s| !s.is_empty()) {
            if slot.id.is_empty() {
                slot.id = id;
            }
        }
        if let Some(name) = delta.name.filter(|s| !s.is_empty()) {
            if slot.name.is_empty() {
                slot.name = name;
            }
        }
        if let Some(frag) = delta.args {
            slot.args.push_str(&frag);
        }
    }

    /// 流收尾：把所有槽结清成事件。
    ///
    /// 返回 `(事件, 这次回复有没有要工具)`。
    /// `Err` = 有槽的参数没闭合（协议错误），调用方发 `Error` 而不是 `ToolEnd{ok:false}`。
    pub(crate) fn finish(self) -> Result<(Vec<AiEvent>, bool), String> {
        // 先拆开：`slots` 被消费，`allowed` 还要在循环里读
        let Self { slots, allowed } = self;
        let mut events = Vec::new();
        for (index, slot) in slots {
            if slot.name.is_empty() {
                // 缺名字连"要调什么"都不知道，没法给它一个人话名字，也不能瞎猜
                return Err(format!(
                    "模型返回的工具调用缺少工具名（第 {} 个），这次调用没法执行",
                    index + 1
                ));
            }
            let args = parse_args(&slot.args, &slot.name)?;
            // id 缺失时给一个稳定编号：前端时间线要拿它把起止两行对起来
            let id = if slot.id.is_empty() {
                format!("call-{index}")
            } else {
                slot.id
            };
            events.push(AiEvent::ToolStart {
                id: id.clone(),
                name: slot.name.clone(),
                args,
            });
            if let Some(list) = &allowed {
                if !list.iter().any(|n| n == &slot.name) {
                    // 拒收：工具本身没跑，所以 result 是 None，话写在 error 里
                    events.push(AiEvent::ToolEnd {
                        id,
                        ok: false,
                        result: None,
                        error: Some(format!(
                            "模型请求了这次没有提供的工具「{}」，已跳过",
                            slot.name
                        )),
                    });
                }
            }
        }
        let used = !events.is_empty();
        Ok((events, used))
    }
}

/// arguments 字符串 → JSON 对象。
///
/// 空串是**协议里零参数工具的正常写法**（OpenAI 就是这么发的：`arguments: ""`），
/// 所以空串按 `{}` 收 —— 这与"把畸形参数兜底成空参数"是两件事：
/// 任何非空但不完整的 JSON 在这里一律 `Err`，不会被悄悄当成没有参数。
fn parse_args(raw: &str, name: &str) -> Result<serde_json::Value, String> {
    if raw.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(raw)
        .map_err(|e| format!("工具「{name}」的参数不是完整 JSON（{e}），这次调用没法执行"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// index 0 的一片
    fn d(id: Option<&str>, name: Option<&str>, args: Option<&str>) -> ToolCallDelta {
        at(0, id, name, args)
    }

    fn at(i: u32, id: Option<&str>, name: Option<&str>, args: Option<&str>) -> ToolCallDelta {
        ToolCallDelta {
            index: i,
            id: id.map(str::to_string),
            name: name.map(str::to_string),
            args: args.map(str::to_string),
        }
    }

    /// ① 三片 arguments 拼成完整 JSON 后才解析
    #[test]
    fn 三片参数拼成完整json后解析() {
        let mut acc = ToolCallAccumulator::new(None);
        // 三片：`{"title":"` + `买` + `菜"}` —— 中文字被劈在分片边界上
        acc.push(d(Some("call_1"), Some("todo_add"), Some("{\"title\":\"")));
        acc.push(d(None, None, Some("买")));
        acc.push(d(None, None, Some("菜\"}")));
        let (events, used) = acc.finish().expect("三片拼起来是完整 JSON");
        assert!(used, "有工具调用就得说用了");
        assert_eq!(events.len(), 1, "有效工具只发 ToolStart，剩下的交给前端");
        match &events[0] {
            AiEvent::ToolStart { id, name, args } => {
                assert_eq!(id, "call_1");
                assert_eq!(name, "todo_add");
                // 中文被劈在分片边界上也不能坏：拼的是字符串，不是字节
                assert_eq!(args["title"], "买菜");
            }
            other => panic!("第一条应当是 ToolStart，实为 {other:?}"),
        }
    }

    /// ② 未闭合不解析；流结束仍是半截 ⇒ Err（命令层据此发 Error）
    ///
    /// 表驱动的反例组：截断在字符串、截断在值、缺右括号、根本不是 JSON、尾部有垃圾。
    /// 任何一条被兜底成 `{}`，等于把畸形参数当空参数送去执行（F4b 轮返工过的同一个坑）。
    #[test]
    fn 参数没闭合一次都不许解析_流结束报协议错误() {
        let cases = [
            "{\"title\":\"买",
            "{\"a\":",
            "{\"a\":1",
            "{oops",
            "\"",
            "{\"a\":1}x",
        ];
        for bad in cases {
            let mut acc = ToolCallAccumulator::new(None);
            acc.push(d(Some("call_1"), Some("todo_add"), Some(bad)));
            let err = acc.finish().expect_err(bad);
            assert!(err.contains("参数不是完整 JSON"), "{bad} 应当报错：{err}");
            assert!(err.contains("todo_add"), "要指出是哪个工具的参数：{err}");
        }
    }

    /// ③ 未知工具名 ⇒ ToolEnd{ok:false}，不是 Error
    #[test]
    fn 未知工具名给toolend而不是error() {
        let mut acc = ToolCallAccumulator::new(Some(vec!["todo_add".to_string()]));
        acc.push(d(Some("call_9"), Some("rm_rf"), Some("{}")));
        let (events, used) = acc.finish().expect("未知工具名不是协议错误");
        assert!(used, "拒收也占了时间线一行，算用到了工具");
        assert_eq!(events.len(), 2, "Start + End(拒收) 成对");
        let (start_id, start_name) = match &events[0] {
            AiEvent::ToolStart { id, name, .. } => (id.as_str(), name.as_str()),
            other => panic!("应当是 ToolStart，实为 {other:?}"),
        };
        assert_eq!(start_id, "call_9");
        assert_eq!(start_name, "rm_rf");
        match &events[1] {
            AiEvent::ToolEnd {
                id,
                ok,
                result,
                error,
            } => {
                assert_eq!(id, "call_9", "起止两行必须用同一个 id 对起来");
                assert!(!ok, "没执行的工具不能报成功");
                assert!(result.is_none(), "没执行就没有结果可给");
                assert!(
                    error.as_ref().unwrap().contains("rm_rf"),
                    "要点名是哪个工具：{error:?}"
                );
            }
            other => panic!("应当是 ToolEnd，实为 {other:?}"),
        }
    }

    /// 有多个调用时按 index 归位、且顺序稳定
    #[test]
    fn 多个调用按index归位且顺序稳定() {
        let mut acc =
            ToolCallAccumulator::new(Some(vec!["todo_add".to_string(), "memory_add".to_string()]));
        // 交错到达：两个 index 的片混在一起
        acc.push(at(1, Some("c2"), Some("memory_add"), Some("{\"text\":\"")));
        acc.push(at(0, Some("c1"), Some("todo_add"), Some("{\"title\":\"")));
        acc.push(at(1, None, None, Some("偏好四象限\"}")));
        acc.push(at(0, None, None, Some("浇花\"}")));
        let (events, _) = acc.finish().expect("两片都闭合了");
        assert_eq!(events.len(), 2);
        match (&events[0], &events[1]) {
            (
                AiEvent::ToolStart {
                    id: a, args: aa, ..
                },
                AiEvent::ToolStart {
                    id: b, args: bb, ..
                },
            ) => {
                assert_eq!(a, "c1", "index 0 在前");
                assert_eq!(b, "c2");
                assert_eq!(aa["title"], "浇花");
                assert_eq!(bb["text"], "偏好四象限");
            }
            other => panic!("应当是两条 ToolStart，实为 {other:?}"),
        }
    }

    /// 零参数工具：`arguments: ""` 是正常写法，不能当作畸形
    #[test]
    fn 零参数工具的空arguments按空对象收() {
        let mut acc = ToolCallAccumulator::new(None);
        acc.push(d(Some("c1"), Some("context_read"), Some("")));
        let (events, _) = acc.finish().expect("空 arguments 是零参数工具的正常写法");
        match &events[0] {
            AiEvent::ToolStart { args, .. } => assert_eq!(args, &serde_json::json!({})),
            other => panic!("应当是 ToolStart，实为 {other:?}"),
        }
    }

    /// 没传 tools（provider 不支持）：不校验、不拒收，只把模型给的东西如实报上去
    #[test]
    fn 没传工具清单时不拒收也不认名字() {
        let mut acc = ToolCallAccumulator::new(None);
        acc.push(d(None, Some("any_tool"), Some(r#"{"a":1}"#)));
        let (events, used) = acc.finish().expect("没清单就没有拒收这回事");
        assert!(used);
        assert_eq!(events.len(), 1, "不该凭空补一条 ToolEnd");
        match &events[0] {
            AiEvent::ToolStart { id, .. } => assert_eq!(id, "call-0", "缺 id 时给稳定编号"),
            other => panic!("应当是 ToolStart，实为 {other:?}"),
        }
    }

    /// 一帧都没有 = 没要工具（纯文本回复的老路径，行为不变）
    #[test]
    fn 没有工具调用时既不报错也不产出事件() {
        let acc = ToolCallAccumulator::new(None);
        let (events, used) = acc.finish().expect("空着收尾不是错误");
        assert!(events.is_empty());
        assert!(!used);
    }

    /// 缺工具名是协议破了口，不是"空名字的工具"
    #[test]
    fn 缺工具名报协议错误() {
        let mut acc = ToolCallAccumulator::new(None);
        acc.push(d(Some("c1"), None, Some("{}")));
        let err = acc.finish().expect_err("没名字不能瞎猜");
        assert!(err.contains("缺少工具名"), "实为：{err}");
    }
}
