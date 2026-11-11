//! AI 事件契约（F-15 §2.2）—— 「两端唯一真相」的 Rust 一半。
//!
//! 为什么单独成文件：事件形状是**契约**，不是某个命令的实现细节。
//! 前端那份 TS 类型（`src/vue/aiChat.ts` 的 `AiEvent`）必须与此处逐字对应：
//! 变体名或字段名改一处，前端拿到的是 `undefined` —— 不报错、只是界面空了，
//! 属于最难发现的那类缺陷。所以这里的形状由 `cargo test` 逐字对拍锁死。
//!
//! 纪律：`Error` 与 `ToolEnd{ok:false}` **必须分开**（F4b 同一条）——
//! 前者是"这条通道破了"，后者是"工具跑了但没成功"。把协议错误说成工具失败，
//! 用户会去重试一个根本不会成功的动作。

use serde::{Deserialize, Serialize};

/// 本轮结束的原因（契约 §2.2：`stop | tool | error`）。
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DoneReason {
    /// 模型把话说完了
    Stop,
    /// 模型要调工具，本地接棒
    Tool,
    /// 通道出错收尾（之前一定已经发过一条 `Error`）
    Error,
}

/// 一个可用工具（契约 §2.3）—— 前端从动作白名单生成后随命令传入。
///
/// `parameters` 是**任意** JSON Schema：Rust 不认识任何具体业务动作名，
/// 也不在这里做参数闸门（那在前端 `aiActions.ts`）。少一个入口就少一条绕过路径。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub name: String,
    /// 给模型看的一句话说明。OpenAI 该字段可选；缺省按空串发（语义就是"没写说明"，
    /// 不是"拿一个默认话术顶上去"）
    #[serde(default)]
    pub description: String,
    /// 参数 JSON Schema，原样透传
    pub parameters: serde_json::Value,
}

/// 流式通道上的一条事件（契约 §2.2）。
///
/// 序列化形状：`{"t":"text","delta":"…"}` —— `t` 是判别标签，值取变体名的
/// camelCase。字段名同样 camelCase（本文件的字段都是单词，两种写法重合，
/// 但每个变体仍显式标了 `rename_all`，将来加多词字段时不会悄悄变成 snake_case）。
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum AiEvent {
    /// 正文增量
    #[serde(rename_all = "camelCase")]
    Text { delta: String },
    /// 工具调用开始（模型已给出 name + arguments，arguments 已解析成对象）
    #[serde(rename_all = "camelCase")]
    ToolStart {
        id: String,
        name: String,
        args: serde_json::Value,
    },
    /// 工具调用结束（本地执行完，或 Rust 侧拒收 —— 例如模型要了一个没提供的工具）
    #[serde(rename_all = "camelCase")]
    ToolEnd {
        id: String,
        ok: bool,
        result: Option<String>,
        error: Option<String>,
    },
    /// agent 循环进入第 n 轮
    #[serde(rename_all = "camelCase")]
    Round { n: u32 },
    /// 本轮结束。**每条流有且只有一条** `Done`，错误路径也是（`reason: error`）
    #[serde(rename_all = "camelCase")]
    Done { reason: DoneReason },
    /// 通道级错误（≠ 工具失败，见文件头）
    #[serde(rename_all = "camelCase")]
    Error { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 契约 §2.2 的六个变体逐字对拍：字段名、标签值、字段顺序、None 落成 `null`。
    /// 这条测试是给前端 TS 类型的锚点 —— 它红了就说明两端已经对不上，
    /// 不许改断言去迁就实现。
    #[test]
    fn 事件形状与契约逐字对拍() {
        let cases: Vec<(AiEvent, &str)> = vec![
            (
                AiEvent::Text {
                    delta: "…".into()
                },
                r#"{"t":"text","delta":"…"}"#,
            ),
            (
                AiEvent::ToolStart {
                    id: "c1".into(),
                    name: "todo_add".into(),
                    args: json!({ "title": "买菜" }),
                },
                r#"{"t":"toolStart","id":"c1","name":"todo_add","args":{"title":"买菜"}}"#,
            ),
            (
                AiEvent::ToolEnd {
                    id: "c1".into(),
                    ok: true,
                    result: Some("已加".into()),
                    error: None,
                },
                r#"{"t":"toolEnd","id":"c1","ok":true,"result":"已加","error":null}"#,
            ),
            (
                AiEvent::ToolEnd {
                    id: "c2".into(),
                    ok: false,
                    result: None,
                    error: Some("没执行".into()),
                },
                r#"{"t":"toolEnd","id":"c2","ok":false,"result":null,"error":"没执行"}"#,
            ),
            (AiEvent::Round { n: 2 }, r#"{"t":"round","n":2}"#),
            (
                AiEvent::Done {
                    reason: DoneReason::Tool,
                },
                r#"{"t":"done","reason":"tool"}"#,
            ),
            (
                AiEvent::Error {
                    message: "已中止".into(),
                },
                r#"{"t":"error","message":"已中止"}"#,
            ),
        ];
        for (ev, want) in cases {
            assert_eq!(serde_json::to_string(&ev).unwrap(), want);
        }
    }

    #[test]
    fn 结束原因三个值一个字都不许差() {
        for (reason, want) in [
            (DoneReason::Stop, r#""stop""#),
            (DoneReason::Tool, r#""tool""#),
            (DoneReason::Error, r#""error""#),
        ] {
            assert_eq!(serde_json::to_string(&reason).unwrap(), want);
        }
    }

    /// 前端传来的 ToolSpec 缺 `description` 是合法的（OpenAI 侧该字段可选），
    /// 不能因为少一句话就把整条工具清单判死。
    #[test]
    fn 工具清单_说明可省略但名字与schema必须给() {
        let ok: ToolSpec =
            serde_json::from_str(r#"{"name":"todo_add","parameters":{"type":"object"}}"#)
                .expect("缺 description 应当照样收");
        assert_eq!(ok.name, "todo_add");
        assert_eq!(ok.description, "");
        assert_eq!(ok.parameters["type"], "object");
        // 名字缺失不是"省略"，是畸形：不许兜底成空名去发给服务端
        assert!(serde_json::from_str::<ToolSpec>(r#"{"parameters":{}}"#).is_err());
        assert!(serde_json::from_str::<ToolSpec>(r#"{"name":"x"}"#).is_err());
    }
}
