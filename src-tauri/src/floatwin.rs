//! 卡片脱离浮窗（2026-10-13 第一批，参考 x-hub 的「便签/倒计时脱离主窗」机制）。
//!
//! 语义：**被脱离的卡从工作台消失、变成桌面上一个无边框置顶小窗**，位置与开关都持久化；
//! 关掉浮窗（或点「还原」）卡片回到工作台原坐标。与 x-hub 的差别在"卡片本体是宿主的"：
//! 浮窗里渲染的是同一个原生卡组件，不是 iframe 里的网页 —— 观感与主窗逐像素一致。
//!
//! 持久化放 Rust 侧而不是前端 localStorage：浮窗几何是窗口的属性，由窗口事件驱动写盘，
//! 前端只需要知道**哪些卡在浮动**（通过 `floats-changed` 事件广播 + `list_floats` 拉取）。

use std::fs;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// 一条浮动记录：卡 id + 窗口几何。`pos` 为 None 表示还没量过（首次创建时居中）。
#[derive(Clone, Serialize, Deserialize)]
pub struct FloatEntry {
    pub card_id: String,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub w: u32,
    pub h: u32,
}

#[derive(Default, Serialize, Deserialize)]
pub struct FloatStore {
    floats: Vec<FloatEntry>,
}

pub struct Floats(pub Mutex<FloatStore>);

fn label_of(card_id: &str) -> String {
    // 窗口 label 只允许 [a-zA-Z0-9-/:_]，卡 id 里可能有 `.`（如 ext 扩展卡），替换掉
    format!("float-{}", card_id.replace(['.', ' '], "_"))
}

fn card_of_label(label: &str) -> Option<String> {
    label.strip_prefix("float-").map(|s| s.to_string())
}

/// `data_root/detached.json` —— 与 `storage.rs` 同目录，随数据根迁移。
fn store_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("LOCATE_FAILED: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("MKDIR_FAILED: {e}"))?;
    Ok(dir.join("detached.json"))
}

fn load(app: &tauri::AppHandle) -> FloatStore {
    let Ok(p) = store_path(app) else {
        return FloatStore::default();
    };
    match fs::read_to_string(&p) {
        // 读坏了就当空 —— 浮窗是附属状态，绝不因为它让应用起不来
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => FloatStore::default(),
    }
}

fn save(app: &tauri::AppHandle, store: &FloatStore) -> Result<(), String> {
    let p = store_path(app)?;
    let s = serde_json::to_string_pretty(store).map_err(|e| format!("ENCODE_FAILED: {e}"))?;
    // 临时文件 + rename：与 storage.rs 同一套原子写，崩溃不落半份
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, s).map_err(|e| format!("WRITE_FAILED: {e}"))?;
    fs::rename(&tmp, &p).map_err(|e| format!("RENAME_FAILED: {e}"))
}

fn broadcast(app: &tauri::AppHandle, store: &FloatStore) {
    let _ = app.emit("modulo:floats-changed", store.floats.clone());
}

/// 把窗口几何写回存储（Moved / Resized 事件里调；窗口可能已销毁，失败就算了）
fn remember_geometry(app: &tauri::AppHandle, card_id: &str, x: i32, y: i32, w: u32, h: u32) {
    let snapshot = {
        let state = app.state::<Floats>();
        let Ok(mut store) = state.0.lock() else {
            return;
        };
        let Some(e) = store.floats.iter_mut().find(|e| e.card_id == card_id) else {
            return;
        };
        e.x = Some(x);
        e.y = Some(y);
        e.w = w;
        e.h = h;
        FloatStore {
            floats: store.floats.clone(),
        }
    };
    let _ = save(app, &snapshot);
}

/// 当前在浮动的卡（前端启动时拉一次，之后靠 `modulo:floats-changed` 事件增量同步）
#[tauri::command]
pub fn list_floats(state: State<'_, Floats>) -> Vec<FloatEntry> {
    state.0.lock().map(|s| s.floats.clone()).unwrap_or_default()
}

/// 把某张卡的浮窗提到最前（F-08 里「置顶 / 定位」那一半）。
///
/// **为什么必须由 Rust 做**：浮窗是独立 WebView，主窗的 JS 拿不到别的窗口句柄，
/// 换不了别人的 z 序 —— 这是"渲染层只管渲染"的边界，不是没做。
///
/// 语义三条：
/// - **最小化了就先还原再聚焦**：Windows 上对被最小化的窗口 `set_focus` 只会在任务栏闪一下，
///   人会以为"点了没反应"。
/// - **窗口已经不在了 ⇒ `Ok(false)`，不报错**。前端点的是清单里的一行，而在它渲染到点击之间
///   那张浮窗可能已经被关掉（它自己的 × / 另一台窗口的收回）；这跟"已浮动就只聚焦"是同一种幂等，
///   不是失败。前端据返回值决定要不要重拉清单。
/// - **不改登记、不写盘**：置顶不是状态变更，只是把已有的窗提到前面。
///
/// 本命令没有自己的单测：它 100% 是 Tauri 窗口 API 的胶水，唯一可测的那一半（label 映射）
/// 由 `label_of` / `card_of_label` 的既有单测守着；前端的整链（点一行 → 发这条命令）由 E2E 钉。
#[tauri::command]
pub fn focus_float(app: tauri::AppHandle, card_id: String) -> Result<bool, String> {
    let Some(win) = app.get_webview_window(&label_of(&card_id)) else {
        return Ok(false);
    };
    if win.is_minimized().unwrap_or(false) {
        let _ = win.unminimize();
    }
    let _ = win.show();
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(true)
}

/// 把某张卡的浮窗移到指定位置（F-08 里「定位」的收官：按版面重摆窗口位置，2026-10-29）。
///
/// 坐标是**逻辑像素**，与 `float_card` 建窗时 `builder.position` 同一口径。
/// 「摆到哪」的映射是纯函数 `src/vue/floatArrange.ts`（受测层锁 100）；
/// 这里只做搬运 —— 纯前端拿不到别的窗口句柄，与 `focus_float` 同一条边界。
///
/// 语义与 `focus_float` 同款：
/// - **窗口已经不在了 ⇒ `Ok(false)`，不报错**：点的是清单里的一行，而在它渲染到点击
///   之间那张浮窗可能已经被关掉；
/// - **落盘不在这里做**：`set_position` 会触发 `Moved` 事件，走既有的 `remember_geometry`
///   链（与用户手拖同一条路），重启后回到重摆后的位置；
/// - **不广播**：清单里"有哪些卡"没变（`list_floats` 的几何变了，但清单只消费 id 与标题），
///   与"置顶不改登记"是同一条边界。
///
/// 本命令没有自己的单测：它 100% 是 Tauri 窗口 API 的胶水，唯一可测的那一半（label 映射）
/// 由 `label_of` / `card_of_label` 的既有单测守着；前端的整链（点「按版面重摆」→ 逐张
/// `move_float`）由 E2E 钉。
#[tauri::command]
pub fn move_float(app: tauri::AppHandle, card_id: String, x: f64, y: f64) -> Result<bool, String> {
    let Some(win) = app.get_webview_window(&label_of(&card_id)) else {
        return Ok(false);
    };
    win.set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// 把某张卡脱离成浮窗。已浮动则只 show + focus（幂等）。
/// 返回 false 表示"没有创建新窗、只是聚焦了已有的"。
#[tauri::command]
pub async fn float_card(
    app: tauri::AppHandle,
    card_id: String,
    default_w: u32,
    default_h: u32,
) -> Result<bool, String> {
    if let Some(existing) = app.get_webview_window(&label_of(&card_id)) {
        // 已存在：恢复显示并聚焦（同语义：重复脱离不报错、不建第二个窗）
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(false);
    }
    let (x, y, w, h) = {
        let state = app.state::<Floats>();
        let store = state.0.lock().map_err(|_| "LOCK_FAILED".to_string())?;
        let found = store
            .floats
            .iter()
            .find(|e| e.card_id == card_id)
            .map(|e| (e.x, e.y, e.w.max(180), e.h.max(120)));
        found.unwrap_or((None, None, default_w.max(180), default_h.max(120)))
    };

    let mut b = WebviewWindowBuilder::new(
        &app,
        label_of(&card_id),
        WebviewUrl::App(format!("float.html?card={card_id}").into()),
    )
    .title("Modulo 浮窗")
    .inner_size(w as f64, h as f64)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .resizable(true);
    if let (Some(x), Some(y)) = (x, y) {
        b = b.position(x as f64, y as f64);
    }
    let win = b.build().map_err(|e| format!("WINDOW_FAILED: {e}"))?;

    // 首次创建时记下几何；已有记录则沿用（位置记忆 = 同款行为）
    let snapshot = {
        let state = app.state::<Floats>();
        let mut store = state.0.lock().map_err(|_| "LOCK_FAILED".to_string())?;
        if store.floats.iter().any(|e| e.card_id == card_id) {
            None
        } else {
            store.floats.push(FloatEntry {
                card_id: card_id.clone(),
                x,
                y,
                w,
                h,
            });
            Some(FloatStore {
                floats: store.floats.clone(),
            })
        }
    };
    if let Some(snapshot) = snapshot {
        save(&app, &snapshot)?;
        broadcast(&app, &snapshot);
    }
    let _ = win.set_focus();
    Ok(true)
}

/// 关掉某张卡的浮窗（「还原」与窗口 × 都走这里）。卡片回到工作台由前端按 `floats-changed` 处理。
#[tauri::command]
pub fn unfloat_card(app: tauri::AppHandle, card_id: String) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&label_of(&card_id)) {
        let _ = win.destroy();
    }
    let state = app.state::<Floats>();
    let mut store = state.0.lock().map_err(|_| "LOCK_FAILED".to_string())?;
    store.floats.retain(|e| e.card_id != card_id);
    let snapshot = FloatStore {
        floats: store.floats.clone(),
    };
    drop(store);
    save(&app, &snapshot)?;
    broadcast(&app, &snapshot);
    Ok(())
}

/// 窗口关闭（× 或系统关窗）时：从登记里摘掉 + 广播，让卡片回到工作台。
/// 几何在关闭前先记住，下次脱离回到原位。
pub fn on_float_window_event(app: &tauri::AppHandle, label: &str, event: &tauri::WindowEvent) {
    let Some(card_id) = card_of_label(label) else {
        return;
    };
    match event {
        tauri::WindowEvent::Moved(pos) => {
            if let Some(win) = app.get_webview_window(label) {
                if let Ok(size) = win.inner_size() {
                    remember_geometry(app, &card_id, pos.x, pos.y, size.width, size.height);
                }
            }
        }
        tauri::WindowEvent::Resized(size) => {
            if let Some(win) = app.get_webview_window(label) {
                if let (Ok(pos), true) = (win.outer_position(), size.width > 0 && size.height > 0) {
                    remember_geometry(app, &card_id, pos.x, pos.y, size.width, size.height);
                }
            }
        }
        tauri::WindowEvent::Destroyed => {
            // 快照在独立作用域里取：guard 必须早于 save/broadcast 释放（借用检查会盯着这条）
            let clamped: Option<FloatStore> = {
                let state = app.state::<Floats>();
                let Ok(mut store) = state.0.lock() else {
                    return;
                };
                store.floats.retain(|e| e.card_id != card_id);
                Some(FloatStore {
                    floats: store.floats.clone(),
                })
            };
            let snapshot = clamped;
            if let Some(snapshot) = snapshot {
                let _ = save(app, &snapshot);
                broadcast(app, &snapshot);
            }
        }
        _ => {}
    }
}

/// 启动时把登记过的浮窗全部恢复出来（x-hub 的 `restore_all` 同款语义）。
/// 恢复失败（例如显示器拔了导致坐标在屏外）也保留登记，由用户下次手动拖回。
pub fn restore_all(app: &tauri::AppHandle) {
    let store = load(app);
    let entries = store.floats.clone();
    {
        let state = app.state::<Floats>();
        let Ok(mut cur) = state.0.lock() else {
            return;
        };
        cur.floats = entries.clone();
    }
    // 逐条取出再 move 进闭包（闭包要求 'static，不能借 &entries）
    for e in entries {
        let card_id = e.card_id.clone();
        let app2 = app.clone();
        let (w, h) = (e.w, e.h);
        let (px, py) = (e.x, e.y);
        // 恢复走 fire-and-forget：单个窗失败不能拖住应用启动
        let _ = app.run_on_main_thread(move || {
            let mut b = WebviewWindowBuilder::new(
                &app2,
                label_of(&card_id),
                WebviewUrl::App(format!("float.html?card={card_id}").into()),
            )
            .title("Modulo 浮窗")
            .inner_size(w as f64, h as f64)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .resizable(true);
            if let (Some(x), Some(y)) = (px, py) {
                b = b.position(x as f64, y as f64);
            }
            let _ = b.build();
        });
    }
}

/// 供外部（lib.rs 的 setup）构造初始状态用：空登记，restore_all 会填
pub fn initial_state() -> Floats {
    Floats(Mutex::new(FloatStore { floats: vec![] }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_roundtrip_is_stable() {
        // 窗口 label 只允许 [a-zA-Z0-9-/:_]：卡 id 里的点（扩展卡以后会有）必须被替换
        assert_eq!(label_of("clock"), "float-clock");
        assert_eq!(label_of("com.ext.card"), "float-com_ext_card");
        assert_eq!(card_of_label("float-clock").as_deref(), Some("clock"));
        // 非浮窗 label 一律不认（主窗 "main"、托盘 "notice" 等）
        assert_eq!(card_of_label("main"), None);
        assert_eq!(card_of_label("float-"), Some(String::new()));
    }

    #[test]
    fn store_json_roundtrip() {
        let store = FloatStore {
            floats: vec![
                FloatEntry {
                    card_id: "sticky".into(),
                    x: Some(120),
                    y: None,
                    w: 320,
                    h: 280,
                },
                FloatEntry {
                    card_id: "clock".into(),
                    x: None,
                    y: None,
                    w: 400,
                    h: 264,
                },
            ],
        };
        let json = serde_json::to_string(&store).unwrap();
        let back: FloatStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back.floats.len(), 2);
        assert_eq!(back.floats[0].card_id, "sticky");
        assert_eq!(back.floats[0].x, Some(120));
        assert_eq!(back.floats[0].y, None);
        assert_eq!(back.floats[1].w, 400);
    }

    #[test]
    fn corrupt_store_falls_back_to_empty() {
        // 读坏了当空 —— 浮窗是附属状态，绝不能因为它让应用起不来
        let back: FloatStore = serde_json::from_str("{not json").unwrap_or_default();
        assert!(back.floats.is_empty());
    }
}
