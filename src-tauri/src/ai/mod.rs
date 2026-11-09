//! AI 模块包（Phase 3，施工顺序 3-4）。
//!
//! 分包纪律：keys（凭据库）与 openai_compat（HTTP/SSE）与 history（会话
//! 历史落盘，D-02 拆分）各自成文件，单文件 ≤300 行，入口只装配。
//! 本文件随施工推进逐个挂子模块，不提前引用还没写的文件。

pub mod history;
pub mod keys;
// MCP 协议编解码层（F4b，第十六笔）：纯函数，零 IO / 零时钟 / 零存储，也**没起子进程**。
// 这一版只有「判定 + 解析 + 握手阶段机」，还没有 stdio 与命令面（F4c 才接）—— 所以
// 整棵子树的公开面暂时没有调用点，死代码告警由 `src/lib.rs` 那行 `#[allow(dead_code)]`
// 统一罩住（与 `ai` 下其余无调用点的命令面同一条处置，别在这里单独再写一遍）。
pub mod mcp;
pub mod openai_compat;
pub mod protocol;
pub mod settings;
