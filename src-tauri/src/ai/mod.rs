//! AI 模块包（Phase 3，施工顺序 3-4）。
//!
//! 分包纪律：keys（凭据库）与 openai_compat（HTTP/SSE）与 history（会话
//! 历史落盘，D-02 拆分）各自成文件，单文件 ≤300 行，入口只装配。
//! 本文件随施工推进逐个挂子模块，不提前引用还没写的文件。

pub mod history;
pub mod keys;
// F-15 §2.2：「两端唯一真相」的事件契约（AiEvent / DoneReason / ToolSpec）。
// 单独成文件是为了让「形状」有一处可指认的家：前端 `src/vue/aiChat.ts` 那份 TS
// 类型与它逐字对应，改这里必须同时改那边。
pub mod events;
// MCP：F4b 的编解码层（纯函数，零 IO / 零时钟 / 零存储）+ F4c-2 第一笔的 stdio
// 客户端（`mcp::client`，会起子进程）。客户端的子树内部已有调用点，但三条命令
// **还没注册进 `generate_handler!`**（规格 §11.8 裁决 C），公开面整体仍无外部调用点，
// 死代码告警继续由 `src/lib.rs` 那行 `#[allow(dead_code)]` 统一罩住
//（与 `ai` 下其余无调用点的命令面同一条处置，别在这里单独再写一遍）。
pub mod mcp;
pub mod openai_compat;
pub mod protocol;
// 原生 tool-calling 的请求体组装（F-15 §2.3）与增量累积（§2.4）。两者都是纯逻辑，
// 从 openai_compat 拆出来才测得动（那边连的是 reqwest 与 Channel，本机编不了）。
pub mod request;
pub mod settings;
// SSE 行解析（原 protocol.rs 的一段，F-15 §2.3 因工具调用分片而独立成文件）
pub mod sse;
pub mod tools;
