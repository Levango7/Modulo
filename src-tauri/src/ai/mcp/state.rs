//! MCP 初始化状态机（纯判定，不读时钟 / 不做 IO）。
//!
//! 与《F4b 规格》§5 的一处**如实偏离**：规格里 `AwaitingInitialize` 是单元变体，
//! 这里带上 `request_id`，否则判据 1「id 必须与发出去的 initialize 精确匹配」无法
//! 逐字可断言。判据语义不变，只是把期望 id 记在状态里。
//!
//! 超时不做：由 F4c 的 spawn 层注入并复用 `CancellationToken`。
//! 关闭顺序（先关 stdin → 等退出 → SIGTERM → SIGKILL）也归 F4c。
//!
//! 步骤 B 拆分只改了 import 来源：类型来自 `types`、版本常量来自 `protocol`、
//! `parse_initialize_result` 来自 `views`，**函数体逐字未动**。

use serde_json::json;

use super::protocol::{PROTOCOL_VERSION, SUPPORTED_VERSIONS};
use super::types::{describe_rpc_error, label_incoming, CodecError, Id, Incoming, Outgoing};

#[derive(Debug, Clone, PartialEq)]
pub enum Phase {
    AwaitingInitialize { request_id: Id },
    Ready,
    Failed(String),
}

/// 一期只发一个 `initialize` 请求，id 固定为 1。
/// `clientInfo.version` 用本 crate 的版本号（`modulo` 包里就是发布版本），别写死字符串。
pub fn initialize_request() -> (Phase, Outgoing) {
    let id = Id::Num(1);
    let req = Outgoing::Request {
        id: id.clone(),
        method: "initialize".to_string(),
        params: Some(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "Modulo", "version": env!("CARGO_PKG_VERSION") }
        })),
    };
    (Phase::AwaitingInitialize { request_id: id }, req)
}

pub fn on_incoming(phase: &Phase, msg: Incoming) -> (Phase, Vec<Outgoing>) {
    match phase {
        Phase::AwaitingInitialize { request_id } => match msg {
            Incoming::Response { id, result, error } if id == *request_id => {
                if let Some(e) = error {
                    return (
                        Phase::Failed(format!("初始化失败：{}", describe_rpc_error(&e))),
                        vec![],
                    );
                }
                // 与 B1 同族：解析失败的具体理由必须带给上层，不能折成一句笼统文案。
                let info = match result.as_ref() {
                    Some(v) => match super::views::parse_initialize_result(v) {
                        Ok(i) => i,
                        Err(e) => {
                            return (Phase::Failed(format!("初始化响应不合法：{e}")), vec![])
                        }
                    },
                    None => {
                        return (Phase::Failed("初始化响应里没有 result".to_string()), vec![])
                    }
                };
                if !SUPPORTED_VERSIONS.contains(&info.protocol_version.as_str()) {
                    return (
                        Phase::Failed(format!(
                            "这个服务用的是 MCP {}，这一版还没支持",
                            info.protocol_version
                        )),
                        vec![],
                    );
                }
                if !info.has_tools {
                    return (Phase::Failed("这个服务没有声明工具能力".to_string()), vec![]);
                }
                (
                    Phase::Ready,
                    vec![Outgoing::Notification {
                        method: "notifications/initialized".to_string(),
                        params: None,
                    }],
                )
            }
            Incoming::ServerRequest { method, .. } => (
                Phase::Failed(format!("初始化还没完成，服务却发来了请求：{method}")),
                vec![],
            ),
            other => (
                Phase::Failed(format!(
                    "初始化还没完成，先收到的是{}（id 与 initialize 不匹配）",
                    label_incoming(&other)
                )),
                vec![],
            ),
        },
        Phase::Ready => match msg {
            Incoming::ServerRequest { method, .. } => (
                Phase::Failed(format!("这一版不处理服务主动发来的请求：{method}")),
                vec![],
            ),
            // 运行期的响应 / 通知交给 F4c 分派，本笔不假设优先级与顺序。
            _ => (Phase::Ready, vec![]),
        },
        Phase::Failed(reason) => (Phase::Failed(reason.clone()), vec![]),
    }
}

pub fn on_outgoing(phase: &Phase, msg: &Outgoing) -> Result<(), CodecError> {
    match phase {
        Phase::Ready => Ok(()),
        Phase::AwaitingInitialize { .. } => {
            // 唯一的例外是 initialized 通知本身；ping 一期不实现，其余请求一律拒发。
            if let Outgoing::Notification { method, .. } = msg {
                if method == "notifications/initialized" {
                    return Ok(());
                }
            }
            Err(CodecError::NotReady)
        }
        Phase::Failed(reason) => Err(CodecError::SessionFailed(reason.clone())),
    }
}
