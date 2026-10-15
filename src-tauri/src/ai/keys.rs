//! AI 提供商密钥存取 —— Windows Credential Manager 封装（keyring v4，`v1` feature）。
//!
//! 纪律：
//! 1. **密钥只在 Rust 侧流转**。`get_key` 不是 tauri 命令，前端永远只见
//!    `keyConfigured` 布尔（IPC 契约 `ai_providers` 注记：密钥永不回传）。
//! 2. 错误一律人话（对齐 ai/openai_compat 错误分类总表），不把 keyring 的
//!    错误结构直接抛给前端。
//! 3. keyring v4 的 v1 feature 在 Windows 上自动选 Credential Manager
//!    （docs.rs 已核实，2026-10-15）；v4 **没有** BadCredentials 变体，
//!    错误枚举 non-exhaustive，match 必须留通配臂。
//!
//! 单测只测纯函数（校验 + 错误映射），**不碰真实凭据库**——往用户系统里
//! 写测试密钥是侵入，真实读写留给桌面探针。

use keyring::v1::{Entry, Error as KeyringError};

/// 全部 provider 密钥共用一个 service，user 位区分 provider（IPC 契约口径）
const SERVICE: &str = "app.modulo";

/// provider_id 合法性：非空，只允许小写字母/数字/连字符（如 `ollama-local`、
/// `openai-compatible`）。纯函数，可单测。
fn validate_provider_id(provider_id: &str) -> Result<(), String> {
    if provider_id.is_empty() {
        return Err("provider 标识不能为空".into());
    }
    if !provider_id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("provider 标识只能用小写字母、数字和连字符".into());
    }
    Ok(())
}

/// keyring 错误 → 人话。`NoEntry` 单独判：get 的「没存过」与 delete 的幂等
/// 都靠它分流，文案在调用方组织，这里只给中性描述。
fn humanize(e: &KeyringError) -> String {
    match e {
        KeyringError::NoEntry => "还没有保存过这个服务的密钥".into(),
        KeyringError::NoStorageAccess(_) => "系统凭据库被锁或拒绝访问，解锁 Windows 后再试".into(),
        KeyringError::PlatformFailure(_) => "系统凭据库出了问题，重试一次；仍失败请重启系统".into(),
        KeyringError::TooLong(_, _) => "密钥太长，系统凭据库存不下".into(),
        KeyringError::NoDefaultStore => "系统凭据库不可用，无法保存密钥".into(),
        other => format!("系统凭据库操作失败：{other}"),
    }
}

/// 取一个 provider 的凭据条目（含 provider_id 校验）
fn entry(provider_id: &str) -> Result<Entry, String> {
    validate_provider_id(provider_id)?;
    Entry::new(SERVICE, provider_id).map_err(|e| humanize(&e))
}

/// 存/更新密钥（tauri 命令 `ai_set_key` 的实现体）。空密钥拒绝，原样存储不做 trim
pub fn set_key(provider_id: &str, key: &str) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("密钥不能为空".into());
    }
    entry(provider_id)?
        .set_password(key)
        .map_err(|e| humanize(&e))
}

/// 读密钥。**仅 Rust 内部使用**（openai_compat 组请求头、ai_providers 算
/// keyConfigured）。没存过返回 `Ok(None)`，不是错误。
pub fn get_key(provider_id: &str) -> Result<Option<String>, String> {
    match entry(provider_id)?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(humanize(&e)),
    }
}

/// 删密钥（tauri 命令 `ai_delete_key` 的实现体）。没存过也算删除成功（幂等）
pub fn delete_key(provider_id: &str) -> Result<(), String> {
    match entry(provider_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(humanize(&e)),
    }
}

// ---- tauri 命令层（IPC 契约：ai_set_key / ai_delete_key；读密钥不设命令）----

/// 存/更新 provider 密钥。密钥不回传（契约注记）
#[tauri::command]
pub fn ai_set_key(provider_id: String, key: String) -> Result<(), String> {
    set_key(&provider_id, &key)
}

/// 删除 provider 密钥（幂等）
#[tauri::command]
pub fn ai_delete_key(provider_id: String) -> Result<(), String> {
    delete_key(&provider_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 合法：小写字母/数字/连字符
    #[test]
    fn provider_id_合法值() {
        for ok in ["ollama", "openai-compatible", "ollama-local", "gpt4o", "a"] {
            assert!(validate_provider_id(ok).is_ok(), "{ok} 应当合法");
        }
    }

    /// 非法：空串、大写、空格、下划线、中文
    #[test]
    fn provider_id_非法值() {
        for bad in ["", "OpenAI", "deep seek", "my_key", "本地模型"] {
            assert!(validate_provider_id(bad).is_err(), "{bad} 应当被拒");
        }
        let msg = validate_provider_id("").unwrap_err();
        assert!(msg.contains("不能为空"), "空串的人话要能看懂");
    }

    /// NoEntry 的人话是中性描述（get/delete 分流靠调用方，不在这里预设语气）
    #[test]
    fn 错误映射_no_entry() {
        let e = KeyringError::NoEntry;
        assert_eq!(humanize(&e), "还没有保存过这个服务的密钥");
    }

    /// 其余变体走通配臂：人话带前缀、非空、不含 panic
    #[test]
    fn 错误映射_通配臂() {
        let e = KeyringError::Invalid("service".into(), "bad".into());
        let msg = humanize(&e);
        assert!(
            msg.starts_with("系统凭据库操作失败"),
            "通配臂要给人话前缀: {msg}"
        );
    }

    /// set_key 对空/纯空白密钥的拒绝不碰凭据库（在 Entry 构造之前就返回）
    #[test]
    fn 空密钥先拒() {
        assert_eq!(set_key("ollama", "").unwrap_err(), "密钥不能为空");
        assert_eq!(set_key("ollama", "   ").unwrap_err(), "密钥不能为空");
        // 非法 provider_id 也先于凭据库被拒
        assert!(set_key("Bad ID", "sk-xxx").is_err());
    }
}
