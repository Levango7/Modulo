//! meeting/asr_models.rs —— 模型清单、sha256 校验、归档解压（模型层）。
//!
//! **全是实证（2026-10-16），没有一条是凭印象写的**：
//! - 三个 sha256 **取自 sherpa-onnx 官方 release 的 `checksum.txt`**
//!   （`asr-models` 与 `punctuation-models` 两个 release 各一份，逐行核对复制），
//!   不是手算、不是抄博客。这是 R-01（供应链）能站住的唯一依据。
//! - **体积实测推翻了原估**（R-02 红线）：SenseVoice fp32 **999MB** / int8 **155MB**，
//!   标点 fp32 **266MB** / int8 **61.7MB**，Silero VAD int8 **0.2MB**。
//!   → **本批全量选 int8**。按 fp32 走，首次运行要下 1.2GB，MVP 不现实。
//! - **diarization 本批不做**：`speaker-segmentation-models` release **没有 checksum
//!   文件**，pyannote 分割模型（6.6MB）无权威校验源。按 R-01「不无校验下载」的口径
//!   剥离，留到 session 批另议（已登记 D-14，契约 `meeting_stop` 的 D7 回填条款
//!   因此顺延）。
//! - **解压后不硬编码模型文件名**：官方示例里 SenseVoice 是 `model.int8.onnx`、
//!   标点档是 `model.onnx`，两档命名不一致且 int8 档可能改名 —— 统一改成
//!   **扫描目录找 `.onnx`**，猜错一个字符就白下 155MB，不冒这个险。

use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// `asr-models` release 的下载地址前缀（模型与 VAD 都挂在这个 tag 下）
const BASE_ASR: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models";
/// 标点模型挂在另一个 tag 下，别混用
const BASE_PUNC: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models";

/// 归档（需解压）还是单文件（下载即用）
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Archive,
    Single,
}

/// 一个模型制品。`sha256` 必须与官方 `checksum.txt` 逐字符一致。
#[derive(Clone, Copy, Debug)]
pub struct ModelSpec {
    /// 本地目录名 / 标识
    pub id: &'static str,
    /// 制品文件名（归档名或单文件名）
    pub file: &'static str,
    pub base: &'static str,
    pub sha256: &'static str,
    pub kind: Kind,
}

/// Silero VAD（int8，0.2MB）—— 断句用
pub const VAD: ModelSpec = ModelSpec {
    id: "vad",
    file: "silero_vad.int8.onnx",
    base: BASE_ASR,
    sha256: "c36d490aff5ab924ca6c7aeec4d8f6bd3d22db6fa17611b9c5b17eae58ac3a20",
    kind: Kind::Single,
};

/// SenseVoice-Small 中英日韩粤（int8，155MB）—— 转写用
pub const ASR: ModelSpec = ModelSpec {
    id: "asr",
    file: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2",
    base: BASE_ASR,
    sha256: "7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63",
    kind: Kind::Archive,
};

/// CT-Transformer 中英标点（int8，61.7MB）—— 给转写结果补标点
pub const PUNC: ModelSpec = ModelSpec {
    id: "punc",
    file: "sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2",
    base: BASE_PUNC,
    sha256: "c0d5aa5f8eeb686032345e180bedf39319dc2e0556781c6264bcadba8328a6e1",
    kind: Kind::Archive,
};

/// 本批要管的三件。`vad` 排第一：它最小（0.2MB），先就绪先可用。
pub fn all() -> [ModelSpec; 3] {
    [VAD, ASR, PUNC]
}

/// 完整下载 URL
pub fn url(spec: &ModelSpec) -> String {
    format!("{}/{}", spec.base, spec.file)
}

/// 归档名去掉 `.tar.bz2`（解压后的顶层目录名）。单文件原样返回。
pub fn stem(file: &str) -> &str {
    match file.strip_suffix(".tar.bz2") {
        Some(s) => s,
        None => file,
    }
}

/// 该模型落地后的路径：归档是**目录**，单文件是**文件本身**
pub fn target(root: &Path, spec: &ModelSpec) -> PathBuf {
    match spec.kind {
        Kind::Archive => root.join(stem(spec.file)),
        Kind::Single => root.join(spec.file),
    }
}

/// 在目录里找模型文件。排序后取第一个，保证多次调用结果稳定
/// （`read_dir` 的顺序在不同文件系统上不保证一致）。
pub fn find_ext(dir: &Path, ext: &str) -> Option<PathBuf> {
    let mut hits: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some(ext))
        .collect();
    hits.sort();
    hits.into_iter().next()
}

/// 该模型是否已就位可加载。
///
/// 归档档要求目录里真有 `.onnx`，只建了个空目录不算 —— 下载中途被杀会留下空壳。
pub fn is_ready(root: &Path, spec: &ModelSpec) -> bool {
    let t = target(root, spec);
    match spec.kind {
        Kind::Archive => t.is_dir() && find_ext(&t, "onnx").is_some(),
        Kind::Single => t.is_file(),
    }
}

/// 三个全就绪才算 `ready`
pub fn all_ready(root: &Path) -> bool {
    all().iter().all(|s| is_ready(root, s))
}

/// 计算字节流的 sha256 十六进制（小写）
pub fn sha256_hex(bytes: &[u8]) -> String {
    to_hex(Sha256::digest(bytes).iter())
}

/// digest 0.11 的 `Output` 不再实现 `LowerHex`（0.10 有），为打印十六进制
/// 多引一个 base16ct 不值得 —— 手动拼，顺带锁死"必须是 64 位小写"。
fn to_hex<'a>(bytes: impl Iterator<Item = &'a u8>) -> String {
    let mut s = String::with_capacity(64);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
    }
    s
}

/// 是不是 64 位十六进制。用来防「把空串或截断值当校验和」这类静默失效。
pub fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// 边读边算文件 sha256（155MB 不能整体读进内存）
pub fn sha256_file(path: &Path) -> Result<String, String> {
    let f = File::open(path).map_err(|e| format!("打不开 {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut reader = BufReader::with_capacity(256 * 1024, f);
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("读 {} 失败：{e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(to_hex(hasher.finalize().iter()))
}

/// 解压 `.tar.bz2` 到 `root`，返回顶层目录路径。
///
/// 官方归档解压后自带一层与归档同名的目录，所以直接解到 `root` 即可，
/// 产物路径与 [`target`] 一致 —— 这两处必须对齐，否则 `is_ready` 永远假。
pub fn extract(archive: &Path, root: &Path) -> Result<PathBuf, String> {
    let f = File::open(archive).map_err(|e| format!("打不开归档：{e}"))?;
    let dec = bzip2::read::BzDecoder::new(f);
    let mut ar = tar::Archive::new(dec);
    ar.unpack(root)
        .map_err(|e| format!("解压 {} 失败：{e}", archive.display()))?;
    let name = archive
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "归档名不是合法 UTF-8".to_string())?;
    Ok(root.join(stem(name)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stem_去掉归档后缀() {
        assert_eq!(stem("a-1.0.tar.bz2"), "a-1.0");
        // 单文件不该被动刀
        assert_eq!(stem("silero_vad.int8.onnx"), "silero_vad.int8.onnx");
        assert_eq!(stem("no-suffix"), "no-suffix");
    }

    #[test]
    fn is_sha256_hex_认得出也对付得了假货() {
        assert!(is_sha256_hex(VAD.sha256));
        assert!(is_sha256_hex(&"a".repeat(64)));
        assert!(is_sha256_hex(&"ABCDEF0123456789".repeat(4)));
        assert!(!is_sha256_hex("")); // 空串是最常见的静默失效
        assert!(!is_sha256_hex(&"a".repeat(63)));
        assert!(!is_sha256_hex(&"a".repeat(65)));
        assert!(!is_sha256_hex(&format!("{}z", "a".repeat(63))));
    }

    #[test]
    fn sha256_hex_对上已知向量() {
        // "abc" 的经典值，锁死实现没换算法
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn 清单里的校验和都是合法_hex() {
        for s in all() {
            assert!(is_sha256_hex(s.sha256), "{} 的 sha256 不是 64 位 hex", s.id);
        }
    }

    #[test]
    fn url_拼得对() {
        assert_eq!(
            url(&VAD),
            format!("{BASE_ASR}/silero_vad.int8.onnx")
        );
        assert!(url(&PUNC).starts_with(BASE_PUNC));
    }

    #[test]
    fn find_ext_稳定且不认错扩展名() {
        let d = std::env::temp_dir().join(format!("modulo-asr-ext-{}", std::process::id()));
        let _ = fs::create_dir_all(&d);
        let _ = fs::write(d.join("b.onnx"), b"");
        let _ = fs::write(d.join("a.onnx"), b"");
        let _ = fs::write(d.join("tokens.txt"), b"");
        // 排序后取第一个 → 稳定地是 a.onnx
        assert_eq!(find_ext(&d, "onnx").unwrap().file_name().unwrap(), "a.onnx");
        assert!(find_ext(&d, "bin").is_none());
        assert_eq!(find_ext(&d, "txt").unwrap().file_name().unwrap(), "tokens.txt");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn is_ready_空目录不算就绪() {
        let d = std::env::temp_dir().join(format!("modulo-asr-ready-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(target(&d, &ASR)).unwrap();
        // 目录建了但里面没有 onnx —— 下载被杀的典型残留
        assert!(!is_ready(&d, &ASR));
        fs::write(target(&d, &ASR).join("model.int8.onnx"), b"").unwrap();
        assert!(is_ready(&d, &ASR));
        assert!(!all_ready(&d)); // 另两个还没下
        let _ = fs::remove_dir_all(&d);
    }
}
