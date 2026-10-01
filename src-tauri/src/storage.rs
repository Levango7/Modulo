//! 把前端那份同步的 StorageAdapter 落到 appData 下的 JSON 文件。
//!
//! 为什么不用现成的 store 插件：这里要的只是"一个 key 一个文件、能自己备份"，
//! 两条命令 + 原子写比引一个插件更好解释，也少一层版本耦合。

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// 文件名白名单：只允许小写字母/数字/点/下划线/连字符，再统一加 .json 后缀。
/// 关键是挡掉 `/` `\` `:`，这样无论前端传什么都出不了数据目录。
fn safe_name(name: &str) -> Result<&str, String> {
  if name.is_empty() || name.len() > 64 {
    return Err(format!("数据名长度必须在 1..=64，收到 {}", name.len()));
  }
  // 点单独允许（key 里有 modulo.layout.v1 这种），但纯点或连续点不行
  if name.starts_with('.') || name.contains("..") {
    return Err(format!("数据名不能以点开头或含连续点: {name}"));
  }
  if !name
    .chars()
    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
  {
    return Err(format!("数据名含非法字符: {name}"));
  }
  Ok(name)
}

fn doc_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
  let name = safe_name(name)?;
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("拿不到数据目录: {e}"))?
    .join("data");
  Ok(dir.join(format!("{name}.json")))
}

#[tauri::command]
pub fn read_doc(app: AppHandle, name: String) -> Result<Option<String>, String> {
  let path = doc_path(&app, &name)?;
  match std::fs::read_to_string(&path) {
    Ok(text) => Ok(Some(text)),
    // 首次启动没有文件是正常状态，不是错误
    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(err) => Err(format!("读 {} 失败: {err}", path.display())),
  }
}

#[tauri::command]
pub fn write_doc(app: AppHandle, name: String, content: String) -> Result<(), String> {
  let path = doc_path(&app, &name)?;
  let dir = path.parent().ok_or_else(|| "数据路径没有父目录".to_string())?;
  std::fs::create_dir_all(dir).map_err(|err| format!("建数据目录失败: {err}"))?;

  // 原子写：先写同目录的临时文件再 rename。直接截断写会在崩溃/断电时留下半份 JSON，
  // 而这个文件就是用户的全部版面，坏一半等于全丢。
  let tmp = dir.join(format!("{name}.json.tmp"));
  std::fs::write(&tmp, content.as_bytes()).map_err(|err| format!("写临时文件失败: {err}"))?;
  std::fs::rename(&tmp, &path).map_err(|err| format!("替换目标文件失败: {err}"))?;
  Ok(())
}

#[tauri::command]
pub fn data_dir(app: AppHandle) -> Result<String, String> {
  app
    .path()
    .app_data_dir()
    .map(|p| p.join("data").display().to_string())
    .map_err(|e| format!("拿不到数据目录: {e}"))
}

#[cfg(test)]
mod tests {
  use super::safe_name;

  #[test]
  fn accepts_plain_names() {
    assert!(safe_name("modulo.layout.v1").is_ok());
    assert!(safe_name("a-b_c.1").is_ok());
  }

  /// 文件名来自前端，必须假定它可以是任意字符串
  #[test]
  fn rejects_traversal_and_separators() {
    for bad in [
      "../../Windows/system32/calc",
      "a/b",
      "a\\b",
      "C:/evil",
      "..",
      "大写UPPER",
      "",
      &"x".repeat(65),
    ] {
      assert!(safe_name(bad).is_err(), "{bad} 应该被拒绝");
    }
  }
}
