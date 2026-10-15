//! AI 模块包（Phase 3，施工顺序 3-4）。
//!
//! 分包纪律：keys（凭据库）与 openai_compat（HTTP/SSE）与 history（会话
//! 历史落盘，D-02 拆分）各自成文件，单文件 ≤300 行，入口只装配。
//! 本文件随施工推进逐个挂子模块，不提前引用还没写的文件。

pub mod keys;
pub mod openai_compat;
