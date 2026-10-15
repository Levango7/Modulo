//! capture/shot.rs —— 截图采集与落盘（xcap 0.9.8）。
//!
//! 坐标换算纯函数在 `shot_geom.rs`（300 行纪律拆出）；本文件留采集、落盘、
//! 索引与命令。
//!
//! 落盘纪律：tmp + rename 原子写（同 storage.rs）；index.json 读改写同一把锁。
//! 最小化窗口不可截（xcap 文档明确）→ 人话错误，不静默失败。
//! 前端可见性：`convertFileSrc`（Windows = `http://asset.localhost/...`）+ CSP
//! 放行 + tauri `protocol-asset` feature（tauri.conf.json 已配，R-09 落地）。

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use image::RgbaImage;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use xcap::{Monitor, Window};

use super::shot_geom::{find_monitor_by_logical_point, logical_region_to_phys, PhysRect};

/// 单页条数上限，与 proc_list 同一口径（前端想要更多也不给）
const LIST_LIMIT_MAX: u32 = 200;
const LIST_LIMIT_DEFAULT: u32 = 50;

/// 一条截图记录（index 条目与命令返回同形）
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShotRef {
    pub id: String,
    /// 绝对路径（前端经 convertFileSrc 转 asset URL 后喂 <img>）
    pub path: String,
    pub width: u32,
    pub height: u32,
    /// Unix 秒
    pub created_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotPage {
    pub shots: Vec<ShotRef>,
    pub total: usize,
}

// ---- id / 落盘 / 索引 ----

static SHOT_SEQ: AtomicU64 = AtomicU64::new(0);

/// id：时间戳 + 会话内自增。本地单机场景足够（白名单字符集内）
fn new_shot_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = SHOT_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("shot-{nanos:x}-{seq:x}")
}

/// id 白名单校验：防路径穿越（同 storage safe_name 的思路，字符集更窄）
fn valid_shot_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// index.json 读改写全局锁：并发截图不能丢条目
static INDEX_LOCK: Mutex<()> = Mutex::new(());

fn shots_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("拿不到数据目录: {e}"))?
        .join("shots");
    fs::create_dir_all(&dir).map_err(|e| format!("建 shots 目录失败: {e}"))?;
    Ok(dir)
}

fn read_index(app: &AppHandle) -> Result<Vec<ShotRef>, String> {
    let path = shots_dir(app)?.join("index.json");
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("截图索引格式不对: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("读截图索引失败: {e}")),
    }
}

/// 写索引（原子）。调用方必须已持 INDEX_LOCK
fn write_index(app: &AppHandle, items: &[ShotRef]) -> Result<(), String> {
    let bytes = serde_json::to_vec(items).map_err(|e| format!("序列化截图索引失败: {e}"))?;
    let dir = shots_dir(app)?;
    let tmp = dir.join("index.json.tmp");
    fs::write(&tmp, &bytes).map_err(|e| format!("写索引临时文件失败: {e}"))?;
    fs::rename(&tmp, dir.join("index.json")).map_err(|e| format!("替换索引失败: {e}"))?;
    Ok(())
}

fn append_index(app: &AppHandle, item: &ShotRef) -> Result<(), String> {
    let _guard = INDEX_LOCK.lock().unwrap();
    let mut items = read_index(app)?;
    items.insert(0, item.clone()); // 新的在前，列表页第一屏就是最近的
    write_index(app, &items)
}

/// PNG 落盘（原子）+ 入索引。格式按扩展名推断，所以临时文件用 `<id>.tmp.png`，
/// rename 后仍是合法 png。
fn save_shot(app: &AppHandle, img: RgbaImage) -> Result<ShotRef, String> {
    let id = new_shot_id();
    let dir = shots_dir(app)?;
    let final_path = dir.join(format!("{id}.png"));
    let tmp_path = dir.join(format!("{id}.tmp.png"));
    img.save(&tmp_path).map_err(|e| format!("编码 PNG 失败: {e}"))?;
    fs::rename(&tmp_path, &final_path).map_err(|e| format!("替换截图文件失败: {e}"))?;

    let item = ShotRef {
        id,
        path: final_path.display().to_string(),
        width: img.width(),
        height: img.height(),
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };
    append_index(app, &item)?;
    Ok(item)
}

/// 收集 (物理矩形, scale_factor) —— 给纯函数用的中间形态。
/// scale_factor 取不到回退 1.0（不放大不缩小，比报错诚实）；下限 0.1 防除零
fn monitor_infos() -> Result<Vec<(PhysRect, f32)>, String> {
    Monitor::all()
        .map_err(|e| format!("枚举显示器失败: {e}"))?
        .into_iter()
        .map(|m| {
            Ok((
                PhysRect {
                    x: m.x().map_err(|e| format!("读显示器位置失败: {e}"))?,
                    y: m.y().map_err(|e| format!("读显示器位置失败: {e}"))?,
                    w: m.width().map_err(|e| format!("读显示器尺寸失败: {e}"))?,
                    h: m.height().map_err(|e| format!("读显示器尺寸失败: {e}"))?,
                },
                m.scale_factor().unwrap_or(1.0).max(0.1),
            ))
        })
        .collect()
}

// ---- tauri 命令（IPC 契约 shot_* 段）----

/// 全屏截主显示器。多屏逐屏截 Spec 未锁，MVP 只做确定性选择
#[tauri::command]
pub fn shot_full(app: AppHandle) -> Result<ShotRef, String> {
    let monitor = Monitor::all()
        .map_err(|e| format!("枚举显示器失败: {e}"))?
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or_else(|| "找不到主显示器".to_string())?;
    let img = monitor
        .capture_image()
        .map_err(|e| format!("截屏失败: {e}"))?;
    save_shot(&app, img)
}

/// 区域截图。入参为**逻辑坐标**（前端拖拽选区的 CSS px，绝对桌面坐标）
#[tauri::command]
pub fn shot_region(app: AppHandle, x: i32, y: i32, w: i32, h: i32) -> Result<ShotRef, String> {
    let monitors = Monitor::all().map_err(|e| format!("枚举显示器失败: {e}"))?;
    let infos = monitor_infos()?;
    let (idx, sf) =
        find_monitor_by_logical_point(&infos, x, y).ok_or("选区起点不在任何显示器上")?;
    let (cx, cy, cw, ch) = logical_region_to_phys(x, y, w, h, infos[idx].0, sf)
        .ok_or("选区太小或已超出屏幕，重画一次")?;
    let img = monitors[idx]
        .capture_region(cx, cy, cw, ch)
        .map_err(|e| format!("截屏失败: {e}"))?;
    save_shot(&app, img)
}

/// 窗口截图（hwnd 即 win_list 的 id）。最小化窗口不可截——人话错误
#[tauri::command]
pub fn shot_window(app: AppHandle, hwnd: isize) -> Result<ShotRef, String> {
    let win = Window::all()
        .map_err(|e| format!("枚举窗口失败: {e}"))?
        .into_iter()
        .find(|w| w.id().map(|id| id as isize == hwnd).unwrap_or(false))
        .ok_or_else(|| "找不到这个窗口，可能已关闭".to_string())?;
    if win.is_minimized().unwrap_or(false) {
        return Err("该窗口已最小化，无法截图".into());
    }
    let img = win.capture_image().map_err(|e| format!("截屏失败: {e}"))?;
    save_shot(&app, img)
}

/// 截图列表（新的在前）。limit 0 视同默认，超上限夹紧——同 proc_list 口径
#[tauri::command]
pub fn shot_list(app: AppHandle, limit: Option<u32>, offset: Option<u32>) -> Result<ShotPage, String> {
    let all = read_index(&app)?;
    let offset = offset.unwrap_or(0) as usize;
    let limit = match limit.unwrap_or(LIST_LIMIT_DEFAULT) {
        0 => LIST_LIMIT_DEFAULT,
        n => n.min(LIST_LIMIT_MAX),
    } as usize;
    Ok(ShotPage {
        shots: all.iter().skip(offset).take(limit).cloned().collect(),
        total: all.len(),
    })
}

/// 删一条（幂等）。索引条目与 PNG 都清；文件已不在也算成功
#[tauri::command]
pub fn shot_delete(app: AppHandle, id: &str) -> Result<(), String> {
    if !valid_shot_id(id) {
        return Err("截图 id 不合法".into());
    }
    let _guard = INDEX_LOCK.lock().unwrap();
    let mut items = read_index(&app)?;
    items.retain(|s| s.id != id);
    write_index(&app, &items)?;
    let png = shots_dir(&app)?.join(format!("{id}.png"));
    if png.exists() {
        fs::remove_file(&png).map_err(|e| format!("删除截图文件失败: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_白名单() {
        assert!(valid_shot_id("shot-abc123-0"));
        assert!(!valid_shot_id(""));
        assert!(!valid_shot_id("../etc/passwd"));
        assert!(!valid_shot_id("A.UPPER"));
        assert!(!valid_shot_id("a/b"));
        assert!(!valid_shot_id(&"x".repeat(97)));
    }

    #[test]
    fn id_生成不重复() {
        let a = new_shot_id();
        let b = new_shot_id();
        assert_ne!(a, b);
        assert!(a.starts_with("shot-"));
    }
}
