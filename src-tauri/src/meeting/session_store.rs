//! meeting/session_store.rs —— 会议转写的落盘与读取（transcript.json）。
//!
//! **为什么不用 storage.rs 的 write_doc**：`transcript.json` 是**每会一份**、
//! 契约要求回传 `transcriptPath` 的独立文件，走文档接口（`data/<name>`）会把
//! 所有会议挤进同一个命名空间，也让"按 id 删一个"变成"改整份文档"。
//! 原子写纪律与 storage.rs / history.rs 一致（tmp + rename）。
//!
//! **安全**：`id` 来自前端，`transcript_path` 直接拼进路径 —— 必须过
//! [`is_safe_id`]，否则 `meeting_get("../../evil")` 就是任意文件读。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// 转写段。契约 `meeting_get.segments` 的字段。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    /// diarization 回填后的说话人 id。**D-14：本批恒为 null**（无校验源不落地）
    pub speaker: Option<String>,
}

/// 一份会议记录。`speaker_names` 是 `spk1 -> "说话人 1"` 的显示名映射（用户可改）。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub id: String,
    pub created_at: u64,
    pub duration_ms: u64,
    #[serde(default)]
    pub segments: Vec<Segment>,
    #[serde(default)]
    pub speaker_names: HashMap<String, String>,
    pub summary: Option<String>,
}

/// 契约 `meeting_list` 的一项
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingItem {
    pub id: String,
    pub title: String,
    pub created_at: u64,
    pub duration_ms: u64,
    pub has_summary: bool,
}

/// 会话 id 白名单：只放行 `[A-Za-z0-9_-]`，1..64 字符。
///
/// 拼进路径前必过这一关。别用"去掉 `..`"这种黑名单写法 —— 黑名单永远漏。
pub fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// 生成一个新会话 id：`<毫秒时间戳>-<纳秒低 4 位十六进制>`。
///
/// 不引 rand 依赖：这个 id 只要"不撞"就行，不是安全令牌。
pub fn new_id() -> String {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:x}-{:04x}", d.as_millis(), d.subsec_nanos() & 0xffff)
}

/// 会议根目录：`<app data>/meetings`
pub fn meetings_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("拿不到应用数据目录：{e}"))?;
    Ok(base.join("meetings"))
}

/// `<root>/<id>/transcript.json`。调用前必须先过 `is_safe_id`。
pub fn transcript_path(root: &Path, id: &str) -> PathBuf {
    root.join(id).join("transcript.json")
}

/// 原子写。返回落盘绝对路径（契约 `meeting_stop.transcriptPath`）。
pub fn write_transcript(root: &Path, t: &Transcript) -> Result<String, String> {
    if !is_safe_id(&t.id) {
        return Err(format!("会话 id 不合法：{}", t.id));
    }
    let dir = root.join(&t.id);
    fs::create_dir_all(&dir).map_err(|e| format!("建会话目录失败：{e}"))?;
    let path = dir.join("transcript.json");
    let bytes = serde_json::to_vec_pretty(t).map_err(|e| format!("序列化转写失败：{e}"))?;
    let tmp = dir.join("transcript.json.tmp");
    fs::write(&tmp, &bytes).map_err(|e| format!("写转写临时文件失败：{e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("替换转写文件失败：{e}"))?;
    path.to_str().map(str::to_string).ok_or_else(|| {
        "转写路径不是合法 UTF-8（数据目录含非 UTF-8 字符？）".to_string()
    })
}

/// 读一份转写。**id 不合法直接拒绝**，不给文件系统任何机会。
pub fn read_transcript(root: &Path, id: &str) -> Result<Transcript, String> {
    if !is_safe_id(id) {
        return Err(format!("会话 id 不合法：{id}"));
    }
    let path = transcript_path(root, id);
    let raw = fs::read_to_string(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("找不到会话 {id}")
        } else {
            format!("读转写失败：{e}")
        }
    })?;
    serde_json::from_str(&raw).map_err(|e| format!("转写文件已损坏（{id}）：{e}"))
}

/// 列表标题：优先首句（截 24 字），没内容就退回时间戳。
///
/// 纯函数，单独单测 —— 空会议也要有个能看的标题，不然列表里一片空白。
pub fn title_of(t: &Transcript) -> String {
    if let Some(first) = t.segments.iter().find(|s| !s.text.trim().is_empty()) {
        let s = first.text.trim();
        let n = s.chars().count();
        if n <= 24 {
            return s.to_string();
        }
        return format!("{}…", s.chars().take(24).collect::<String>());
    }
    let secs = t.created_at / 1000;
    format!("{}-{:02}-{:02} {:02}:{:02}", 1970 + secs / 31_557_600, 1 + (secs / 2_630_000) % 12, 1 + (secs / 86_400) % 31, (secs / 3600) % 24, (secs / 60) % 60)
}

/// 列出全部会议。**单份损坏不牵连整表**：解析失败的那条跳过并在 stderr 留痕，
/// 其余照常返回 —— 一份坏 JSON 不该让用户的所有会议都消失。
pub fn list_meetings(root: &Path) -> Vec<MeetingItem> {
    let Ok(rd) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut items: Vec<MeetingItem> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|id| is_safe_id(id))
        .filter_map(|id| match read_transcript(root, &id) {
            Ok(t) => Some(MeetingItem {
                title: title_of(&t),
                created_at: t.created_at,
                duration_ms: t.duration_ms,
                has_summary: t.summary.as_ref().map(|s| !s.is_empty()).unwrap_or(false),
                id,
            }),
            Err(e) => {
                eprintln!("[meeting] 跳过损坏的会话记录：{e}");
                None
            }
        })
        .collect();
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    items
}

/// 删一个会议（连目录一起）。不存在也算成功（幂等，和 `ai_chat_cancel` 同口径）。
pub fn delete_meeting(root: &Path, id: &str) -> Result<(), String> {
    if !is_safe_id(id) {
        return Err(format!("会话 id 不合法：{id}"));
    }
    let dir = root.join(id);
    if !dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("删除会话失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_safe_id_挡住路径穿越() {
        assert!(is_safe_id("abc-123_XYZ"));
        assert!(is_safe_id("a"));
        // 穿越与分隔符，一个都不能放过
        for bad in [
            "",
            "../evil",
            "..",
            "a/b",
            "a\\b",
            ".",
            "a b",
            "a;b",
            "中文id",
            &"a".repeat(65),
        ] {
            assert!(!is_safe_id(bad), "{bad} 不该被放行");
        }
    }

    #[test]
    fn new_id_两次不同且都合法() {
        let a = new_id();
        let b = new_id();
        assert!(is_safe_id(&a));
        assert!(is_safe_id(&b));
        assert_ne!(a, b, "同一毫秒内连开两次会不能撞 id");
    }

    #[test]
    fn title_of_优先首句_空会议退时间戳() {
        let mut t = Transcript {
            id: "x".into(),
            created_at: 0,
            duration_ms: 0,
            segments: vec![],
            speaker_names: HashMap::new(),
            summary: None,
        };
        assert!(title_of(&t).starts_with("1970-"));

        t.segments.push(Segment {
            start_ms: 0,
            end_ms: 1000,
            text: "今天讨论发布计划".to_string(),
            speaker: None,
        });
        assert_eq!(title_of(&t), "今天讨论发布计划");

        let long: String = "一".repeat(40);
        t.segments[0].text = long;
        let title = title_of(&t);
        assert!(title.ends_with('…'));
        assert_eq!(title.chars().count(), 25); // 24 字 + 省略号
    }

    #[test]
    fn title_of_跳过空白段() {
        let t = Transcript {
            id: "x".into(),
            created_at: 0,
            duration_ms: 0,
            segments: vec![
                Segment { start_ms: 0, end_ms: 10, text: "   ".into(), speaker: None },
                Segment { start_ms: 10, end_ms: 20, text: "正经内容".into(), speaker: None },
            ],
            speaker_names: HashMap::new(),
            summary: None,
        };
        assert_eq!(title_of(&t), "正经内容");
    }

    #[test]
    fn 读写往返_且不合法_id_被拒() {
        let d = std::env::temp_dir().join(format!("modulo-sess-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();

        let t = Transcript {
            id: "sess-1".into(),
            created_at: 1_700_000_000_000,
            duration_ms: 60_000,
            segments: vec![Segment {
                start_ms: 0,
                end_ms: 2000,
                text: "你好".into(),
                speaker: None,
            }],
            speaker_names: HashMap::new(),
            summary: None,
        };
        let p = write_transcript(&d, &t).unwrap();
        assert!(p.ends_with("transcript.json"));
        let back = read_transcript(&d, "sess-1").unwrap();
        assert_eq!(back.segments.len(), 1);
        assert_eq!(back.segments[0].text, "你好");

        // 穿越 id 写不进去也读不出来
        assert!(write_transcript(&d, &Transcript { id: "../evil".into(), ..t.clone() }).is_err());
        assert!(read_transcript(&d, "../evil").is_err());

        // 不存在 → not found 人话
        assert!(read_transcript(&d, "nope").unwrap_err().contains("找不到会话"));

        let items = list_meetings(&d);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "sess-1");
        assert!(!items[0].has_summary);

        delete_meeting(&d, "sess-1").unwrap();
        assert!(!transcript_path(&d, "sess-1").exists());
        // 幂等：删第二次不报错
        delete_meeting(&d, "sess-1").unwrap();
        let _ = fs::remove_dir_all(&d);
    }
}
