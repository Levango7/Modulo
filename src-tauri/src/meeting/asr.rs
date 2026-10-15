//! meeting/asr.rs —— 转写引擎 + 模型下载编排（sherpa-onnx 1.13.8，AC-13/14/19）。
//!
//! **先证机制，再写实现**（本机实证 2026-10-16，不是推测）：
//! - **必须 `default-features = false, features = ["shared"]`**。默认档是 `static`
//!   （13 个 MSVC `.lib`、123MB），本机只有 GNU 工具链（MSVC 不可用）**必然链接失败**；
//!   shared 档（8MB）已用最小探针实测：GNU ld 能吃它的 `.lib` 导入库，
//!   `CircularBuffer` 读写正确、VAD 空配置按预期返回 `None` 而不崩。
//! - build.rs 会把 4 个 DLL 自动复制到产物目录（合计约 23MB，onnxruntime.dll 17.8MB），
//!   打包时这些 DLL 必须随行 —— 漏了就是"装完打不开"。
//! - 模型清单与 sha256 在 `asr_models.rs`，体积与选型的实证同见该文件头。
//! - **diarization 本批不做**（`speaker-segmentation-models` 无官方 checksum，见 D-14）。
//!
//! 采样率口径与 `audio.rs` 一致：**16kHz 单声道 f32**，ASR 直吃不用重采样。
//!
//! 本文件只管**状态机与下载编排**；引擎本体（VAD/转写/标点）在 `asr_engine.rs`
//! （300 行纪律拆分），会话层应直接用 `meeting::asr_engine::AsrEngine`。

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use super::asr_errors::{humanize_io, humanize_status, humanize_transport, verify_mismatch};
use super::asr_models;

/// 模型在 app data 下的子目录
const MODEL_SUBDIR: &str = "models/asr";

/// 契约 `asr_model_status` 的 state 枚举
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AsrState {
    Missing,
    Downloading,
    Verifying,
    Ready,
    Failed,
}

impl AsrState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Downloading => "downloading",
            Self::Verifying => "verifying",
            Self::Ready => "ready",
            Self::Failed => "failed",
        }
    }
}

/// 下载进度（契约 `onProgress` 载荷）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrProgress {
    pub state: String,
    pub received_bytes: u64,
    pub total_bytes: u64,
    pub id: String,
}

/// 契约 `asr_model_status` 返回体
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrStatus {
    pub state: String,
    pub progress: f64,
    pub bytes_total: u64,
    pub error: Option<String>,
}

fn status_slot() -> &'static Mutex<AsrStatus> {
    static S: OnceLock<Mutex<AsrStatus>> = OnceLock::new();
    S.get_or_init(|| {
        Mutex::new(AsrStatus {
            state: AsrState::Missing.as_str().into(),
            progress: 0.0,
            bytes_total: 0,
            error: None,
        })
    })
}

fn set_status(state: AsrState, progress: f64, bytes_total: u64, error: Option<String>) {
    if let Ok(mut s) = status_slot().lock() {
        *s = AsrStatus {
            state: state.as_str().into(),
            progress,
            bytes_total,
            error,
        };
    }
}

/// 模型根目录：`<app data>/models/asr`
pub fn models_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("拿不到应用数据目录：{e}"))?;
    Ok(base.join(MODEL_SUBDIR))
}

/// 刷新全局状态（进程启动时若模型已在盘上，应直接是 ready 而不是 missing）
pub fn refresh_status(root: &Path) {
    let st = if asr_models::all_ready(root) {
        AsrState::Ready
    } else {
        AsrState::Missing
    };
    set_status(st, if st == AsrState::Ready { 1.0 } else { 0.0 }, 0, None);
}


/// 契约 `asr_model_status`
#[tauri::command]
pub fn asr_model_status(app: AppHandle) -> AsrStatus {
    match models_root(&app) {
        Ok(root) => refresh_status(&root),
        Err(e) => set_status(AsrState::Failed, 0.0, 0, Some(e)),
    }
    status_slot()
        .lock()
        .map(|s| s.clone())
        .unwrap_or(AsrStatus {
            state: AsrState::Missing.as_str().into(),
            progress: 0.0,
            bytes_total: 0,
            error: None,
        })
}

/// 契约 `asr_model_download`：逐个下载 → sha256 校验 → 解压。
///
/// **校验不过就删掉重来**，绝不留半个坏模型在盘上（R-01）。
#[tauri::command]
pub async fn asr_model_download(
    app: AppHandle,
    on_progress: Channel<AsrProgress>,
) -> Result<(), String> {
    let root = models_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| humanize_io(&e.to_string(), "建模型目录"))?;

    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败：{e}"))?;

    let specs = asr_models::all();
    for (i, spec) in specs.iter().enumerate() {
        if asr_models::is_ready(&root, spec) {
            continue;
        }
        fetch_one(&client, &root, spec, &on_progress).await?;
        set_status(
            AsrState::Downloading,
            (i + 1) as f64 / specs.len() as f64,
            0,
            None,
        );
    }
    refresh_status(&root);
    Ok(())
}

/// 下载单个制品：写 `.part` → 校验 → 解压（或改名）→ 清 `.part`
async fn fetch_one(
    client: &reqwest::Client,
    root: &Path,
    spec: &asr_models::ModelSpec,
    chan: &Channel<AsrProgress>,
) -> Result<(), String> {
    let url = asr_models::url(spec);
    let part = root.join(format!("{}.part", spec.file));
    let dest = root.join(spec.file);

    let mut resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| humanize_transport(&e.to_string()))?;
    if !resp.status().is_success() {
        return Err(humanize_status(resp.status().as_u16()));
    }
    let total = resp.content_length().unwrap_or(0);
    set_status(AsrState::Downloading, 0.0, total, None);

    let mut file =
        File::create(&part).map_err(|e| humanize_io(&e.to_string(), "创建临时文件"))?;
    let mut got: u64 = 0;
    // 用 `chunk()` 而不是 `bytes_stream()`：后者要引 futures-util 才能 `.next()`，
    // 为本就够用的一件事多加一个依赖不划算。155MB 是分块落盘的，不进内存。
    loop {
        let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| humanize_transport(&e.to_string()))?
        else {
            break;
        };
        file.write_all(&chunk)
            .map_err(|e| humanize_io(&e.to_string(), "写模型文件"))?;
        got += chunk.len() as u64;
        let _ = chan.send(AsrProgress {
            state: AsrState::Downloading.as_str().into(),
            received_bytes: got,
            total_bytes: total,
            id: spec.id.into(),
        });
    }
    drop(file);

    set_status(AsrState::Verifying, 1.0, total, None);
    let _ = chan.send(AsrProgress {
        state: AsrState::Verifying.as_str().into(),
        received_bytes: got,
        total_bytes: total,
        id: spec.id.into(),
    });

    let actual = asr_models::sha256_file(&part)?;
    if actual != spec.sha256 {
        let _ = fs::remove_file(&part);
        let err = verify_mismatch(spec.id, spec.sha256, &actual);
        set_status(AsrState::Failed, 1.0, total, Some(err.clone()));
        return Err(err);
    }

    match spec.kind {
        asr_models::Kind::Single => {
            fs::rename(&part, &dest).map_err(|e| humanize_io(&e.to_string(), "安装模型"))?;
        }
        asr_models::Kind::Archive => {
            asr_models::extract(&part, root)
                .map_err(|e| humanize_io(&e, "解压模型"))?;
            let _ = fs::remove_file(&part);
        }
    }
    Ok(())
}
