//! MCP 协议编解码层（F4b）+ stdio 客户端（F4c-2 第一笔）。
//!
//! 上半（`limits` / `protocol` / `state` / `types` / `views`）是**纯函数**：把「一行
//! JSON-RPC 消息」的合法性判定、`result` 形状解析、握手阶段机、截断与限额收起来 ——
//! 零 IO、零时钟、零存储，也没起任何子进程。
//!
//! 为什么先做纯的那半：F4a 把「填配置」做完了，但**还没连**任何 server。真连起来时第一个
//! 会咬人的不是进程管理，是**畸形响应** —— 多打一行日志、少一个字段、顺手 `unwrap_or(缺省)`
//! 兜一下，症状就变成"成功、零输出"，而且不报错。所以这一层先独立、用 58 条用例钉死边界，
//! 再由 F4c 接 stdio 与命令面（见 ARCHITECTURE §12.77 / §12.85）。
//!
//! 下半从 F4c-2 起，按职责拆成三块（每块都 ≤300 行）：
//! - `pure` —— 盘上配置的容错清洗、字段闸门、J4 确认判定（纯函数，可整段复制到仓外跑）；
//! - `wire` —— 一个子进程会话与一次 JSON-RPC 往返（`std::process` + 读线程 + mpsc）；
//! - `client` —— 进程表、懒连接、三条命令（**已注册进 IPC**，J1 执行半起；调用点
//!   `src/vue/useMcpExecution.ts`）。
//!
//! 两条纪律：
//! 1. **协议错误走 `error`、工具执行失败走 `result.isError`**，两者不许混 —— 混了就会
//!    把一个"工具说不"报成"协议坏了"，用户看到的处置完全不同。
//! 2. **必填字段缺失报 `MissingField`、类型或值域不对报 `BadField`**，绝不用缺省值把
//!    畸形响应当成合法的；展示类字段（`title` / `description` / `instructions`）取不到就当没有。

pub mod client;
pub mod limits;
pub mod protocol;
pub mod pure;
pub mod state;
pub mod types;
pub mod views;
pub mod wire;

#[cfg(test)]
mod acceptance;
#[cfg(test)]
mod split_mapping;
