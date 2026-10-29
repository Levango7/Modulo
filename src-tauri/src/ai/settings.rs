//! AI provider 配置的读写层 —— 文档 `ai-settings.v1`（缺口 D-07 的落点）。
//!
//! **provider 配置本体住在这里**：前端 AI 设置面板经 `storage::write_doc`
//! 写，Rust 侧经 `storage::read_doc_raw` 读。密钥永不进这份文档（AC-09），
//! 只在钥匙串（keys.rs）。schema 见 IPC 契约 yaml 的 AI 段注记。

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::storage::read_doc_raw;

/// provider 配置文档名（文件名白名单内：小写+点+数字）
pub(crate) const SETTINGS_DOC: &str = "ai-settings.v1";

/// 一条 provider 配置（camelCase 存盘，与前端设置面板同一份 schema）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderCfg {
    pub id: String,
    /// ollama | openai-compatible（契约枚举）
    pub kind: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SettingsDoc {
    #[serde(default)]
    providers: Vec<ProviderCfg>,
}

/// ai_providers 回给前端的条目（契约：只给布尔，不给密钥）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderView {
    pub id: String,
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub key_configured: bool,
    pub ready: bool,
}

/// 读全部配置。文档不存在 = 空配置（AC-10 引导空状态由前端渲染），不是错误
pub(crate) fn load_settings(app: &AppHandle) -> Result<Vec<ProviderCfg>, String> {
    match read_doc_raw(app, SETTINGS_DOC)? {
        None => Ok(Vec::new()),
        Some(text) => serde_json::from_str::<SettingsDoc>(&text)
            .map(|d| d.providers)
            .map_err(|e| format!("AI 配置文档格式不对（{SETTINGS_DOC}）：{e}")),
    }
}

/// 按 id 找一条配置。找不到给人话，不带文件路径
pub(crate) fn load_provider(app: &AppHandle, provider_id: &str) -> Result<ProviderCfg, String> {
    load_settings(app)?
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| "找不到这个模型配置：去「设置 → 实验室」检查".to_string())
}
