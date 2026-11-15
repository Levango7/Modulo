//! MCP 客户端（F4c-2 第一笔）：进程表 + 命令面。
//!
//! 三层分工，各守 300 行（`ai/mod.rs` 头注释的项目纪律）：
//! - [`super::pure`]：配置清洗 / 字段闸门 / J4 确认判定 —— 纯函数，不碰进程；
//! - [`super::wire`]：一个子进程会话与一次 JSON-RPC 往返（`std::process` + 读线程 + mpsc）；
//! - 本文件：进程表、懒连接、三条 `#[tauri::command]`。
//!
//! 命令面**本笔不注册进 `generate_handler!`**（规格 §11.8 裁决 C：注册面必须等于调用点面，
//! 前端 J1 留第二笔）；`lib.rs` 只 `.manage(McpState)`，命令表保持 50 条。
//!
//! `tools/call` 的往返由 `wire` 里 `tokio::time::timeout(net_policy::mcp_call_timeout(), ...)`
//! 包住：`mcpCallMs` 真参与判定，`net-policy-check.mjs` 的 `wired` 断言钉着那行。
//!
//! 本笔不做：`env` / 钥匙串、清单翻页、服务主动请求、并发多请求、确认记录落盘。

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as AsyncMutex;

use super::limits::{args_too_long, name_too_long, truncate_by_points, MCP_RESULT_MAX};
use super::pure;
use super::types::{CallToolResult, ContentKind};
use super::views::{parse_call_tool_result, parse_tools_list};
use super::wire::Session;

/// 与 `src/vue/mcp.ts` 的 `MCP_DOC_KEY` 同值，且已在 `fileStorage.ts` 的 `DATA_KEYS` 登记。
pub const MCP_DOC_KEY: &str = "modulo.mcp.v1";

/// 进程表 + 确认记录。由 `lib.rs` 的 `.manage()` 挂上；本笔命令没注册，它只是空状态。
#[derive(Default)]
pub struct McpState {
    table: Mutex<HashMap<String, Arc<AsyncMutex<Session>>>>,
    /// J4：按 `server_id` 记，**默认全空 = 全都未确认**。本笔只存内存（重启清零）。
    confirmed: Mutex<HashSet<String>>,
}

fn is_confirmed(state: &McpState, server_id: &str) -> bool {
    // 锁中毒按「未确认」处理 —— 失败方向必须是更保守的那一边。
    state
        .confirmed
        .lock()
        .map(|s| s.contains(server_id))
        .unwrap_or(false)
}

/// J4 闸门：**列工具与调工具都要先过**，因为两者的第一步都是「起子进程」。
fn gate(state: &McpState, server_id: &str, name: &str) -> Result<(), String> {
    pure::require_confirmed(is_confirmed(state, server_id), name)
}

/// 取一个可用会话：**phase 没判死、进程还活着、握手也过**才复用，否则重起（J2）。
/// 崩溃 / 超时之后的重建只试一次，新会话再失败就把真实理由交给上层。
async fn session_for(
    state: &McpState,
    cfg: &pure::ServerCfg,
) -> Result<Arc<AsyncMutex<Session>>, String> {
    let existing = {
        let table = state
            .table
            .lock()
            .map_err(|_| "MCP 进程表锁坏了".to_string())?;
        table.get(&cfg.id).cloned()
    };
    if let Some(slot) = existing {
        let reusable = {
            let mut s = slot.lock().await;
            // 重建判据**先看 phase、再看进程**：超时分支已经 kill + `wait` 收尸，但
            // `kill` 是异步的，刚 kill 完 `try_wait` 仍可能返回 `Ok(None)`（`alive()`
            // 还是 true）—— 只信进程状态就会把这条废会话再复用一次、再白等一次超时。
            !s.is_failed() && s.alive() && s.ensure_ready().await.is_ok()
        };
        if reusable {
            return Ok(slot);
        }
    }
    let mut fresh = Session::spawn(cfg)?;
    fresh.ensure_ready().await?; // 新会话也失败 ⇒ 把真实理由交给上层，不无限重试
    let slot = Arc::new(AsyncMutex::new(fresh));
    state
        .table
        .lock()
        .map_err(|_| "MCP 进程表锁坏了".to_string())?
        .insert(cfg.id.clone(), slot.clone());
    Ok(slot)
}

fn load_servers(app: &AppHandle) -> Result<Vec<pure::ServerCfg>, String> {
    // 文档不存在 = 没有服务（不是错误），与 `load_settings` 同一口径。
    let raw = crate::storage::read_doc_raw(app, MCP_DOC_KEY)?;
    Ok(pure::parse_servers(raw.as_deref().unwrap_or("")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOut {
    pub server_id: String,
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsOut {
    pub tools: Vec<ToolOut>,
    /// 一期不翻页：还有下一页时如实标注「没拿全」，不假装完整。
    pub notice: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallOut {
    pub text: String,
    /// 工具自己报的执行失败（`result.isError: true`）。**与协议错误分开**：
    /// 它为 true 时 RPC 是成功的，只是「跑了但没成」，不能折成传输错误。
    pub is_error: bool,
    pub truncated: bool,
    pub notice: Option<String>,
}

/// 把工具结果整成给界面看的文案。非文字内容只留计数提示（判据 11）。
fn shape_call(r: CallToolResult) -> CallOut {
    let mut text = String::new();
    for c in &r.content {
        if c.kind == ContentKind::Text {
            if let Some(t) = &c.text {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(t);
            }
        }
    }
    let (text, truncated) = truncate_by_points(&text, MCP_RESULT_MAX);
    let mut notices: Vec<String> = Vec::new();
    if truncated {
        notices.push(format!("结果太长，只显示前 {MCP_RESULT_MAX} 个字"));
    }
    if let Some(n) = r.notice() {
        notices.push(n);
    }
    CallOut {
        text,
        is_error: r.is_error,
        truncated,
        notice: if notices.is_empty() {
            None
        } else {
            Some(notices.join("；"))
        },
    }
}

/// 列一个服务的工具清单。**首次也会起子进程，所以要过 J4 闸门**（同 `mcp_call`）。
#[tauri::command]
#[allow(dead_code)]
pub async fn mcp_list_tools(app: AppHandle, server_id: String) -> Result<ToolsOut, String> {
    let servers = load_servers(&app)?;
    let cfg = pure::pick(&servers, &server_id)?;
    let state = app.state::<McpState>();
    gate(&state, &server_id, &cfg.name)?;
    let slot = session_for(&state, cfg).await?;
    let mut s = slot.lock().await;

    let v = s
        .request("tools/list", Some(json!({})))
        .await
        .map_err(|e| format!("列工具失败：{e}"))?;
    let list = parse_tools_list(&v).map_err(|e| format!("工具清单不合法：{e}"))?;
    let notice = list.notice();
    let tools = list
        .tools
        .into_iter()
        .map(|t| ToolOut {
            server_id: cfg.id.clone(),
            name: t.name,
            title: t.title,
            description: t.description,
            input_schema: t.input_schema,
        })
        .collect();
    Ok(ToolsOut { tools, notice })
}

/// 调一个工具。**J4：没确认过的服务一律拒，且拒绝发生在起进程之前。**
#[tauri::command]
#[allow(dead_code)]
pub async fn mcp_call(
    app: AppHandle,
    server_id: String,
    tool: String,
    args: Option<Value>,
) -> Result<CallOut, String> {
    let servers = load_servers(&app)?;
    let cfg = pure::pick(&servers, &server_id)?;
    if name_too_long(&tool) {
        return Err("工具名太长，不像是这个服务会有的工具".to_string());
    }
    let arguments = args.unwrap_or_else(|| json!({}));
    if args_too_long(&arguments) {
        return Err("这次调用带的参数太大（上限 64 KiB）".to_string());
    }
    let state = app.state::<McpState>();
    gate(&state, &server_id, &cfg.name)?;

    let slot = session_for(&state, cfg).await?;
    let mut s = slot.lock().await;
    let v = s
        .request(
            "tools/call",
            Some(pure::call_params(&tool, Some(arguments))),
        )
        .await
        .map_err(|e| format!("调用「{tool}」失败：{e}"))?;
    let r = parse_call_tool_result(&v).map_err(|e| format!("工具返回的数据不合法：{e}"))?;
    Ok(shape_call(r))
}

/// 记下「用户确认过这个服务」。第一次真正列工具 / 调工具之前必须先调它一次。
/// 未知 id 如实报错 —— 不能「确认成功」但什么都没记。
#[tauri::command]
#[allow(dead_code)]
pub fn mcp_confirm(app: AppHandle, server_id: String) -> Result<(), String> {
    let servers = load_servers(&app)?;
    pure::pick(&servers, &server_id)?;
    let state = app.state::<McpState>();
    let mut set = state
        .confirmed
        .lock()
        .map_err(|_| "确认记录锁坏了".to_string())?;
    set.insert(server_id);
    Ok(())
}
