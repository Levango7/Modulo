use std::sync::Mutex;

use tauri::{AppHandle, Manager, WindowEvent};

mod storage;

/// 点关闭是「收进托盘」还是「直接退出」。默认退出 —— Windows 会把新出现的托盘图标
/// 塞进溢出浮层，默认藏进去等于把用户关在门外。开关由前端持久化并在启动时推过来。
#[derive(Default)]
struct HideOnClose(Mutex<bool>);

#[derive(Clone, serde::Serialize)]
pub struct ShortcutStatus {
    pub keys: String,
    pub label: String,
    pub registered: bool,
}

/// 注册结果要能被前端读到：全局快捷键失败是静默的（别的程序占了同一个组合），
/// 只在 stderr 打一行等于没有。设置页据此显示「已注册 / 被占用」。
#[derive(Default)]
struct Shortcuts(Mutex<Vec<ShortcutStatus>>);

#[tauri::command]
fn set_hide_on_close(app: AppHandle, on: bool) {
    *app.state::<HideOnClose>().0.lock().unwrap() = on;
}

#[tauri::command]
fn global_shortcuts(app: AppHandle) -> Vec<ShortcutStatus> {
    app.state::<Shortcuts>().0.lock().unwrap().clone()
}

fn toggle_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
    } else {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn toggle_always_on_top(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let next = !win.is_always_on_top().unwrap_or(false);
    let _ = win.set_always_on_top(next);
    if next {
        let _ = win.set_focus();
    }
}

#[cfg(desktop)]
mod desktop {
    use super::{toggle_always_on_top, toggle_window, AppHandle, Manager};
    use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
    use tauri::tray::{TrayIconBuilder, TrayIconEvent};
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
    };

    pub const SUMMON: &str = "Alt+Shift+M";
    pub const ON_TOP: &str = "Alt+Shift+T";

    pub fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
        if !matches!(event.state(), ShortcutState::Pressed) {
            return;
        }
        match shortcut.key {
            Code::KeyM => toggle_window(app),
            Code::KeyT => toggle_always_on_top(app),
            _ => {}
        }
    }

    /// 逐个注册而不是批量：快捷键被别的程序占用时只丢这一个，不能让整机启动失败。
    pub fn register_shortcuts(app: &AppHandle) {
        use super::{ShortcutStatus, Shortcuts};
        let gs = app.global_shortcut();
        let store = app.state::<Shortcuts>();
        for (keys, label, key) in [
            (SUMMON, "唤出 / 隐藏 Modulo", Code::KeyM),
            (ON_TOP, "窗口置顶", Code::KeyT),
        ] {
            let shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), key);
            let registered = match gs.register(shortcut) {
                Ok(()) => true,
                Err(err) => {
                    eprintln!("[modulo] 全局快捷键 {keys} 注册失败（多半被别的程序占用），其余功能不受影响: {err}");
                    false
                }
            };
            store.0.lock().unwrap().push(ShortcutStatus {
                keys: keys.into(),
                label: label.into(),
                registered,
            });
        }
    }

    /// 默认尺寸是「主流 IM 客户端那一档 + 12 列投影要求 ≥1200 宽」协调出来的：
    /// 微信/QQ/钉钉/飞书的默认窗口都在 1000–1200 × 700–800 区间，这里取上沿；
    /// 1080P 上左右各留 320、上下各留 120。
    /// 但 1366×768 这类屏装不下 800 高，所以启动时按显示器工作区夹一次。
    pub const DEFAULT_SIZE: (f64, f64) = (1280.0, 800.0);
    /// 与 tauri.conf.json 的 minWidth / minHeight 一致，夹的时候不要夹到窗口管理器还要再拦一道
    const MIN_SIZE: (f64, f64) = (380.0, 560.0);

    /// 纯函数便于单测：放得下（留 32px 边距）就用期望值，放不下才取工作区的 94%。
    /// 逐轴独立 —— 1366×768 只该压高度，不该连宽度一起缩。
    pub fn fit_size(avail: (f64, f64), want: (f64, f64)) -> (f64, f64) {
        let axis = |a: f64, w: f64, min: f64| {
            if w + 32.0 <= a {
                w
            } else {
                (a * 0.94).max(min)
            }
        };
        (
            axis(avail.0, want.0, MIN_SIZE.0),
            axis(avail.1, want.1, MIN_SIZE.1),
        )
    }

    /// 尺寸都按逻辑像素算：DPI 缩放会把它翻译成相应的物理尺寸，所以 4K@150% 上不用另设一套数字。
    pub fn fit_window(win: &tauri::WebviewWindow) -> tauri::Result<()> {
        let Some(monitor) = win.primary_monitor()? else {
            return Ok(());
        };
        let scale = monitor.scale_factor();
        let work = monitor.work_area();
        let avail = (
            work.size.width as f64 / scale,
            work.size.height as f64 / scale,
        );
        let size = fit_size(avail, DEFAULT_SIZE);
        if size != DEFAULT_SIZE {
            win.set_size(tauri::LogicalSize::new(size.0, size.1))?;
            win.center()?;
        }
        Ok(())
    }

    pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
        let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
        let on_top = MenuItem::with_id(app, "ontop", "窗口置顶", true, None::<&str>)?;
        let separator = PredefinedMenuItem::separator(app)?;
        let quit = MenuItem::with_id(app, "quit", "退出 Modulo", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&toggle, &on_top, &separator, &quit])?;

        let mut builder = TrayIconBuilder::with_id("modulo")
            .menu(&menu)
            // 左键留给「双击唤出」，菜单走右键；否则单击就会弹菜单，双击永远触发不了。
            .show_menu_on_left_click(false)
            .tooltip("Modulo —— 双击图标显示窗口")
            .on_menu_event(|app, event: MenuEvent| match event.id.as_ref() {
                "toggle" => toggle_window(app),
                "ontop" => toggle_always_on_top(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::DoubleClick { .. } = event {
                    toggle_window(tray.app_handle());
                }
            });

        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        builder.build(app)?;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(HideOnClose::default())
        .manage(Shortcuts::default())
        .invoke_handler(tauri::generate_handler![
            set_hide_on_close,
            global_shortcuts,
            storage::read_doc,
            storage::write_doc,
            storage::data_dir
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if *window.app_handle().state::<HideOnClose>().0.lock().unwrap() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(desktop::on_shortcut)
                    .build(),
            )
            .setup(|app| {
                let handle = app.handle().clone();
                if let Some(win) = app.get_webview_window("main") {
                    if let Err(err) = desktop::fit_window(&win) {
                        eprintln!(
                            "[modulo] 按工作区调整窗口尺寸失败，继续用配置里的默认尺寸: {err}"
                        );
                    }
                }
                desktop::build_tray(&handle)?;
                desktop::register_shortcuts(&handle);
                Ok(())
            });
    }

    builder
        .run(tauri::generate_context!())
        .expect("Modulo 启动失败");
}

#[cfg(all(test, desktop))]
mod tests {
    use super::desktop::{fit_size, DEFAULT_SIZE};

    #[test]
    fn keeps_default_size_when_it_fits() {
        // 1080P / 1440p@150% 的工作区都放得下 1280×800，不该动
        assert_eq!(fit_size((1920.0, 1040.0), DEFAULT_SIZE), DEFAULT_SIZE);
        assert_eq!(fit_size((1707.0, 1019.0), DEFAULT_SIZE), DEFAULT_SIZE);
        // 1600×900 也放得下（832 < 852）
        assert_eq!(fit_size((1600.0, 852.0), DEFAULT_SIZE), DEFAULT_SIZE);
    }

    #[test]
    fn shrinks_only_the_axis_that_does_not_fit() {
        let (w, h) = fit_size((1366.0, 728.0), DEFAULT_SIZE);
        assert_eq!(w, 1280.0, "宽度放得下就不该跟着缩");
        assert!(
            h < 728.0 && (h - 728.0 * 0.94).abs() < 1e-9,
            "高度应按工作区 94% 收: {h}"
        );
    }

    #[test]
    fn never_goes_below_the_configured_minimum() {
        assert_eq!(fit_size((300.0, 400.0), DEFAULT_SIZE), (380.0, 560.0));
    }
}
