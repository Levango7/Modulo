//! MCP 协议编解码层（F4b）：把「一行 JSON-RPC 消息」的合法性判定、`result` 形状解析、
//! 握手阶段机、截断与限额收成**纯函数** —— 零 IO、零时钟、零存储，也没起任何子进程。
//!
//! 为什么先只做这一层：F4a 把「填配置」做完了，但**还没连**任何 server。真连起来时第一个
//! 会咬人的不是进程管理，是**畸形响应** —— 多打一行日志、少一个字段、顺手 `unwrap_or(缺省)`
//! 兜一下，症状就变成"成功、零输出"，而且不报错。所以这一层先独立、用 58 条用例钉死边界，
//! 再由 F4c 接 stdio 与命令面（见 ARCHITECTURE §12.77）。
//!
//! 两条纪律：
//! 1. **协议错误走 `error`、工具执行失败走 `result.isError`**，两者不许混 —— 混了就会
//!    把一个"工具说不"报成"协议坏了"，用户看到的处置完全不同。
//! 2. **必填字段缺失报 `MissingField`、类型或值域不对报 `BadField`**，绝不用缺省值把
//!    畸形响应当成合法的；展示类字段（`title` / `description` / `instructions`）取不到就当没有。

pub mod limits;
pub mod protocol;
pub mod state;
pub mod types;
pub mod views;

#[cfg(test)]
mod acceptance;
#[cfg(test)]
mod split_mapping;
