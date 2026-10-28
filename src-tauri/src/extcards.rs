//! 原生卡扩展的「cards 目录」：列出并读取用户放进 `appData/cards` 的卡包文件夹。
//!
//! 为什么 Rust 只做列读、不碰 JSON 语义：判定层（manifest 校验 / 清洗 / 权限声明）
//! 全在 TS 引擎（`packages/engine/src/extcard.ts`）—— 它是桌面壳与网页版共享的
//! 唯一真源；Rust 侧再解析一遍就是第二份会漂的校验。本模块的契约只有三条：
//! **固定目录**（命令没有路径参数 ⇒ 零外部输入，无遍历面，与 F-11① 的 UNC 收紧
//! 同一条边界）、**固定文件名 `card.json`**（文件名不来自前端）、**两道读取侧上限**。
//!
//! 子目录读不出 / 没有 card.json / 超过字节上限 / 不是 UTF-8 —— 一律跳过该子目录：
//! 它未必是卡包（卡包文件夹里可以有别的资源），而且合不合法、装不装得下是前端引擎
//! 的事，这边不替它做决定。整个目录层面只剩一个病理情形会报错：卡包数超过上限。

use std::path::Path;

use tauri::{AppHandle, Manager};

/// 一次扫描最多收多少个卡包。引擎侧 `MAX_EXT_CARDS` 是 8，这里留 4 倍余量：
/// 「跳过 N 个」的判定在前端（Rust 不碰 JSON 语义），扫回来的合法条数得多于
/// 可装数，用户才看得到完整的「装 N 个 / 跳 M 个」清单，而不是被截断的列表。
const MAX_SCAN_PACKS: usize = 32;
/// 单个 card.json 的读取上限。引擎对入口 html 的上限是 16 000 字符，整份 manifest
/// 连同 html 不会超过这个量的 4 倍；挡在读这一侧，是不把可能几 MB 的损坏文件
/// 搬过 IPC —— 真超限的卡包前端也装不进去，没有理由把它传过去。
const MAX_CARD_JSON_BYTES: usize = 64 * 1024;

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct ScannedPack {
    /// 子目录名：只作来源信息展示与前端排重提示，不参与路径拼接（id 以 manifest 为准）
    pub dir: String,
    /// card.json 的原始内容：解析与校验全部交给 TS 引擎
    pub json: String,
}

/// 扫描 cards 目录。纯函数（不依赖 AppHandle）—— 与 `storage.rs` 的 `safe_name`
/// 同一种 carve-out：命令壳是薄壳，可测的判定都在这里。
fn scan_cards_dir(dir: &Path) -> Result<Vec<ScannedPack>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(it) => it,
        // 目录不存在是正常状态（第一次用还没有 cards 目录），不是错误
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(err) => return Err(format!("扫 cards 目录失败: {err}")),
    };
    let mut packs = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("读目录条目失败: {e}"))?;
        // 符号链接的 is_dir() 是 false（file_type 不跟随）—— 不跟就不跟，跳过更安全
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let bytes = match std::fs::read(entry.path().join("card.json")) {
            Ok(b) => b,
            // 没有 card.json（或读不动）：这个子目录不是卡包，跳过
            Err(_) => continue,
        };
        if bytes.len() > MAX_CARD_JSON_BYTES {
            continue;
        }
        let json = match String::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => continue,
        };
        packs.push(ScannedPack {
            dir: entry.file_name().to_string_lossy().to_string(),
            json,
        });
        if packs.len() > MAX_SCAN_PACKS {
            return Err(format!("cards 目录里的卡包超过 {} 个", MAX_SCAN_PACKS));
        }
    }
    Ok(packs)
}

#[tauri::command]
pub fn extcards_scan(app: AppHandle) -> Result<Vec<ScannedPack>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("拿不到数据目录: {e}"))?
        .join("cards");
    scan_cards_dir(&dir)
}

#[cfg(test)]
mod tests {
    use super::scan_cards_dir;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// 每条测试一个独立名字：Rust 测试默认并行，共享同一个临时路径会互相踩。
    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "modulo-extcards-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn drop_fixture(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    /// 目录不存在（第一次启动）是空列表，不是错误 —— 与 read_doc 的 NotFound 口径一致
    #[test]
    fn missing_dir_is_empty() {
        let missing = std::env::temp_dir().join("modulo-extcards-does-not-exist-987654");
        assert_eq!(scan_cards_dir(&missing).unwrap(), vec![]);
    }

    /// 只有「一级子目录里的 card.json」算卡包：散文件、空子目录、别的内容都跳过
    #[test]
    fn reads_card_json_from_subdirs() {
        let root = fixture("reads");
        fs::write(root.join("loose.json"), "{}").unwrap();
        fs::create_dir_all(root.join("a")).unwrap();
        fs::write(root.join("a").join("card.json"), "{\"id\":\"a\"}").unwrap();
        fs::create_dir_all(root.join("b")).unwrap();
        fs::write(root.join("b").join("card.json"), "{\"id\":\"b\"}").unwrap();
        fs::create_dir_all(root.join("empty")).unwrap();

        let packs = scan_cards_dir(&root).unwrap();
        assert_eq!(packs.len(), 2);
        let dirs: Vec<&str> = packs.iter().map(|p| p.dir.as_str()).collect();
        assert!(dirs.contains(&"a") && dirs.contains(&"b"));
        let jsons: Vec<&str> = packs.iter().map(|p| p.json.as_str()).collect();
        assert!(jsons.contains(&"{\"id\":\"a\"}") && jsons.contains(&"{\"id\":\"b\"}"));

        drop_fixture(&root);
    }

    /// 卡包数超过上限：整个目录是病理状态，报错而不是截断 —— 截断会让用户
    /// 以为装全了
    #[test]
    fn too_many_packs_errors() {
        let root = fixture("too_many");
        for i in 0..33 {
            let sub = root.join(format!("p{i}"));
            fs::create_dir_all(&sub).unwrap();
            fs::write(sub.join("card.json"), "{}").unwrap();
        }
        assert!(scan_cards_dir(&root).is_err());
        drop_fixture(&root);
    }

    /// 超 64 KiB 的 card.json 跳过（该子目录），别的卡包不受影响
    #[test]
    fn oversized_card_json_is_skipped() {
        let root = fixture("oversized");
        let big = root.join("big");
        fs::create_dir_all(&big).unwrap();
        fs::write(big.join("card.json"), vec![b' '; 64 * 1024 + 1]).unwrap();
        let ok = root.join("ok");
        fs::create_dir_all(&ok).unwrap();
        fs::write(ok.join("card.json"), "{}").unwrap();

        let packs = scan_cards_dir(&root).unwrap();
        assert_eq!(packs.len(), 1);
        assert_eq!(packs[0].dir, "ok");

        drop_fixture(&root);
    }

    /// 非 UTF-8 的 card.json 跳过：反正 JSON.parse 也不会要它
    #[test]
    fn invalid_utf8_is_skipped() {
        let root = fixture("utf8");
        let bad = root.join("bad");
        fs::create_dir_all(&bad).unwrap();
        fs::write(bad.join("card.json"), &[0xFFu8, 0xFE, 0x00, 0x01]).unwrap();

        assert_eq!(scan_cards_dir(&root).unwrap(), vec![]);

        drop_fixture(&root);
    }
}
