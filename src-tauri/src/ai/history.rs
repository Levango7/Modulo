//! ai/history.rs —— 对话历史落盘（D-02 拆分；Spec §6：`ai/history.json` 原子写）。
//!
//! **谁写**：`ai_chat` 流式正常结束后 upsert（幂等，按 conversationId 覆盖）。
//! ai_chat 入参就是全量消息，流式期间后端另行累积 assistant 增量——两侧合起来
//! 才是完整一轮，历史由后端单点落盘，前端不需要自己存。
//! **title**：取首条 user 消息前 24 字（确定性生成，不花一次 AI 调用，不假装智能）。
//! **不进备份、不进同步**（2026-10-30 定，与四决策第④条一致）：`backup.ts` 的包只带
//! 版面 / 方案册 / 卡片内容与非敏感设置；历史含对话原文，体积与隐私都不该顺手带走。
//! 一键清除已落地为 `ai_history_clear`（D-11，Spec §6），幂等，与 delete 共用 HISTORY_LOCK。

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// title 截断长度（字）。超了截断加省略号，不花 AI
const TITLE_MAX_CHARS: usize = 24;

/// 一条消息（落盘形态；ts 为 Unix 秒）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMsg {
    pub role: String,
    pub content: String,
    pub ts: u64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
    #[serde(default)]
    pub messages: Vec<HistoryMsg>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HistoryDoc {
    #[serde(default)]
    conversations: Vec<Conversation>,
}

/// ai_history_list 条目（不带消息体，列表页只吃摘要）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub title: String,
    pub updated_at: u64,
    pub message_count: usize,
}

/// ai_history_get 返回（契约形态）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDetail {
    pub id: String,
    pub messages: Vec<HistoryMsg>,
}

/// 读改写全局锁：并发两个会话收尾不能互相覆盖
static HISTORY_LOCK: Mutex<()> = Mutex::new(());

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("拿不到数据目录: {e}"))?
        .join("ai");
    fs::create_dir_all(&dir).map_err(|e| format!("建 ai 目录失败: {e}"))?;
    Ok(dir.join("history.json"))
}

fn read_history(app: &AppHandle) -> Result<HistoryDoc, String> {
    let path = history_path(app)?;
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("对话历史格式不对: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HistoryDoc::default()),
        Err(e) => Err(format!("读对话历史失败: {e}")),
    }
}

/// 原子写（tmp + rename，同 storage.rs 纪律）。调用方必须已持 HISTORY_LOCK
fn write_history(app: &AppHandle, doc: &HistoryDoc) -> Result<(), String> {
    let bytes = serde_json::to_vec(doc).map_err(|e| format!("序列化对话历史失败: {e}"))?;
    let path = history_path(app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &bytes).map_err(|e| format!("写历史临时文件失败: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("替换历史文件失败: {e}"))?;
    Ok(())
}

/// title 从消息列表派生：首条 user 消息前 24 字；没有 user 消息（异常输入）给中性兜底
fn title_from(messages: &[(String, String)]) -> String {
    let first_user = messages
        .iter()
        .find(|(role, _)| role == "user")
        .map(|(_, content)| content.trim())
        .filter(|c| !c.is_empty());
    match first_user {
        Some(text) => {
            let mut out: String = text.chars().take(TITLE_MAX_CHARS).collect();
            if text.chars().count() > TITLE_MAX_CHARS {
                out.push('…');
            }
            out
        }
        None => "新对话".to_string(),
    }
}

/// upsert 一轮对话（ai_chat 收尾调用；前端/后端双保险都可再调，幂等）。
/// messages 为**全量**消息 [(role, content)]；ts 统一用当前时刻（消息级精确
/// 时间戳需要 ai_chat 逐条带出，MVP 不做——updatedAt 已足够列表排序）
pub(crate) fn upsert_conversation(
    app: &AppHandle,
    id: &str,
    messages: &[(String, String)],
) -> Result<(), String> {
    let _guard = HISTORY_LOCK.lock().unwrap();
    let mut doc = read_history(app)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let msgs: Vec<HistoryMsg> = messages
        .iter()
        .map(|(role, content)| HistoryMsg {
            role: role.clone(),
            content: content.clone(),
            ts: now,
        })
        .collect();
    match doc.conversations.iter_mut().find(|c| c.id == id) {
        Some(existing) => {
            existing.title = title_from(messages);
            existing.updated_at = now;
            existing.messages = msgs;
        }
        None => doc.conversations.insert(
            0,
            Conversation {
                id: id.to_string(),
                title: title_from(messages),
                updated_at: now,
                messages: msgs,
            },
        ),
    }
    write_history(app, &doc)
}

#[tauri::command]
pub fn ai_history_list(app: AppHandle) -> Result<Vec<HistoryItem>, String> {
    let doc = read_history(&app)?;
    let mut items: Vec<HistoryItem> = doc
        .conversations
        .iter()
        .map(|c| HistoryItem {
            id: c.id.clone(),
            title: c.title.clone(),
            updated_at: c.updated_at,
            message_count: c.messages.len(),
        })
        .collect();
    // 最近更新的在前（upsert 不换位，这里排序保证）
    items.sort_by_key(|c| std::cmp::Reverse(c.updated_at));
    Ok(items)
}

#[tauri::command]
pub fn ai_history_get(app: AppHandle, id: &str) -> Result<HistoryDetail, String> {
    let doc = read_history(&app)?;
    doc.conversations
        .into_iter()
        .find(|c| c.id == id)
        .map(|c| HistoryDetail {
            id: c.id,
            messages: c.messages,
        })
        .ok_or_else(|| "找不到这条对话，可能已删除".to_string())
}

/// 删一条（幂等）。Spec §6 的"一键清除"是另一条命令 ai_history_clear（D-11）
#[tauri::command]
pub fn ai_history_delete(app: AppHandle, id: &str) -> Result<(), String> {
    let _guard = HISTORY_LOCK.lock().unwrap();
    let mut doc = read_history(&app)?;
    doc.conversations.retain(|c| c.id != id);
    write_history(&app, &doc)
}

/// 一键清除全部对话（Spec §6，D-11 落地）。幂等：没有历史也是成功。
/// 与 delete 的区别是粒度——delete 按 id 删一条，clear 清空整个列表；
/// 清空后文件仍在（空 conversations 数组），备份/导出面不受影响。
#[tauri::command]
pub fn ai_history_clear(app: AppHandle) -> Result<(), String> {
    let _guard = HISTORY_LOCK.lock().unwrap();
    let mut doc = read_history(&app)?;
    doc.conversations.clear();
    write_history(&app, &doc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_取首条user消息并截断() {
        let msgs = vec![
            ("system".to_string(), "你是助手".to_string()),
            (
                "user".to_string(),
                "帮我把这份会议纪要整理成三条要点，控制在两百字以内".to_string(),
            ),
        ];
        let title = title_from(&msgs);
        assert_eq!(title.chars().count(), TITLE_MAX_CHARS + 1); // 24 字 + 省略号
        assert!(title.starts_with("帮我把这份会议纪要"));
        assert!(title.ends_with('…'));
    }

    #[test]
    fn title_短消息不截断() {
        let msgs = vec![("user".to_string(), "你好".to_string())];
        assert_eq!(title_from(&msgs), "你好");
    }

    #[test]
    fn title_没有user消息给中性兜底() {
        assert_eq!(title_from(&[]), "新对话");
        let only_system = vec![("system".to_string(), "x".to_string())];
        assert_eq!(title_from(&only_system), "新对话");
        // 空 user 内容也走兜底，不出空 title
        let empty_user = vec![("user".to_string(), "   ".to_string())];
        assert_eq!(title_from(&empty_user), "新对话");
    }
}
