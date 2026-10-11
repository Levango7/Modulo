use std::sync::Mutex;

/**
 * `pub` 是为了让 `tests/` 里的集成测试能直接调 `bing_daily`。
 *
 * 注意 `web` 里的 **FFI 层**（`#[link(name = "winhttp")]`）带 `cfg(not(test))` ——
 * 只要 lib 的测试壳链接了它，整个测试二进制就会在启动时退出 0xC0000139
 * （STATUS_ENTRYPOINT_NOT_FOUND），一个测试都跑不了。已排除的原因见 `src/web.rs`
 * 里 winhttp 模块的注释。纯解析函数不受影响，仍在测试壳里正常跑单测。
 */
pub mod monitor;
pub mod net;
mod sysmon;
pub mod web;

use tauri::{AppHandle, Manager, WindowEvent};

mod storage;

/// 点关闭是「收进托盘」还是「直接退出」。默认退出 —— Windows 会把新出现的托盘图标
/// 塞进溢出浮层，默认藏进去等于把用户关在门外。开关由前端持久化并在启动时推过来。
#[derive(Default)]
struct HideOnClose(Mutex<bool>);

#[derive(Clone, serde::Serialize)]
pub struct ShortcutStatus {
    /// 稳定标识（summon / ontop）：前端要按它定位某一条，不能靠中文 label 匹配
    pub kind: String,
    pub keys: String,
    pub label: String,
    pub registered: bool,
}

/// 注册结果要能被前端读到：全局快捷键失败是静默的（别的程序占了同一个组合），
/// 只在 stderr 打一行等于没有。设置页据此显示「已注册 / 被占用」。
#[derive(Default)]
struct Shortcuts(Mutex<Vec<ShortcutStatus>>);

/// 当前生效的全局快捷键：kind →（展示用字符串, 解析后的 Shortcut）。
/// 回调要靠它把收到的 Shortcut 对回是哪一条 —— 一旦允许用户改键，
/// 再按 `shortcut.key` 猜就不成立了（两条可以共用字母、只改修饰键）。
#[cfg(desktop)]
#[derive(Default)]
struct Chords(Mutex<Vec<(&'static str, String, tauri_plugin_global_shortcut::Shortcut)>>);

#[tauri::command]
fn set_hide_on_close(app: AppHandle, on: bool) {
    *app.state::<HideOnClose>().0.lock().unwrap() = on;
}

#[tauri::command]
fn global_shortcuts(app: AppHandle) -> Vec<ShortcutStatus> {
    app.state::<Shortcuts>().0.lock().unwrap().clone()
}

/// 改键：前端录制完组合键后调用，成功才由前端落盘（失败保持原键并返回原因）。
/// 桌面壳之外没有系统级快捷键，直接报错而不是假装成功。
#[tauri::command]
fn set_shortcut(app: AppHandle, kind: String, chord: String) -> Result<ShortcutStatus, String> {
    #[cfg(desktop)]
    {
        desktop::rebind(&app, &kind, &chord)
    }
    #[cfg(not(desktop))]
    {
        let _ = (&app, &kind, &chord);
        Err("只有桌面壳支持系统级快捷键".to_string())
    }
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
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

    /// 默认档选 **三个修饰键**（Ctrl+Alt+Shift），是两轮实测逼出来的：
    ///
    /// - `Alt+Shift+M`（最初的默认）能被系统接受，但本机 `HKCU\Keyboard Layout\Toggle\HotKey = 1`
    ///   即「左 Alt+Shift 切换输入法」，中文环境下这个前缀会被输入法吃掉，探针投递收不到。
    /// - `Ctrl+Alt+M` / `Ctrl+Alt+T` 在本机直接 `RegisterHotKey` 失败（`ERROR_HOTKEY_ALREADY_REGISTERED`
    ///   =1409，被别的程序占了；`Win+Alt+M` / `Win+Alt+T` 同样 1409）。
    ///
    /// 三修饰的组合占用的程序极少，仍留 M/T 好记；真撞上还有设置页改键兜底（注册失败会在设置页显示出来）。
    pub const SUMMON: &str = "Ctrl+Alt+Shift+M";
    pub const ON_TOP: &str = "Ctrl+Alt+Shift+T";

    /// 解析组合键字符串（`"Ctrl+Alt+M"`）。global-hotkey 允许裸键（`"M"` 也解析得过），
    /// 但全局裸键会吞掉系统里所有该键的输入 —— 所以这里强制要求至少一个修饰键。
    ///
    /// 为什么这条没有 Rust 单测：一旦测试引用它，windows-gnu 下的测试二进制就
    /// 加载失败（`STATUS_ENTRYPOINT_NOT_FOUND`，去掉这条测试立刻恢复 6/6）。
    /// 改由桌面探针端到端验证：`set_shortcut` 传裸键必须被拒、传合法组合必须注册成功。
    pub fn parse_chord(raw: &str) -> Result<Shortcut, String> {
        let trimmed = raw.trim();
        let shortcut: Shortcut = trimmed
            .parse()
            .map_err(|err| format!("无法解析组合键「{raw}」：{err}"))?;
        if shortcut.mods.is_empty() {
            return Err(format!(
                "「{raw}」缺少修饰键：全局快捷键必须带 Ctrl / Alt / Shift / Win，否则会吞掉系统里所有「{raw}」的输入"
            ));
        }
        Ok(shortcut)
    }

    pub fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
        if !matches!(event.state(), ShortcutState::Pressed) {
            return;
        }
        let chords = app.state::<super::Chords>();
        let kind = chords
            .0
            .lock()
            .unwrap()
            .iter()
            .find(|(_, _, s)| s == shortcut)
            .map(|(k, _, _)| *k);
        match kind {
            Some("summon") => toggle_window(app),
            Some("ontop") => toggle_always_on_top(app),
            _ => {}
        }
    }

    /// 逐个注册而不是批量：快捷键被别的程序占用时只丢这一个，不能让整机启动失败。
    pub fn register_shortcuts(app: &AppHandle) {
        use super::{ShortcutStatus, Shortcuts};
        let gs = app.global_shortcut();
        let store = app.state::<Shortcuts>();
        let chords = app.state::<super::Chords>();
        for (kind, keys, label) in [
            ("summon", SUMMON, "唤出 / 隐藏 Modulo"),
            ("ontop", ON_TOP, "窗口置顶"),
        ] {
            let shortcut = match parse_chord(keys) {
                Ok(s) => s,
                Err(err) => {
                    eprintln!("[modulo] 默认快捷键 {keys} 解析失败，跳过注册: {err}");
                    continue;
                }
            };
            let registered = match gs.register(shortcut) {
                Ok(()) => true,
                Err(err) => {
                    eprintln!("[modulo] 全局快捷键 {keys} 注册失败（多半被别的程序占用），其余功能不受影响: {err}");
                    false
                }
            };
            chords.0.lock().unwrap().push((kind, keys.into(), shortcut));
            store.0.lock().unwrap().push(ShortcutStatus {
                kind: kind.into(),
                keys: keys.into(),
                label: label.into(),
                registered,
            });
        }
    }

    /// 改键：先解掉旧的再注册新的；新键注册失败（多半被占用）就把旧的滚回去，
    /// 绝不能留下「两条都没绑上」的状态。持久化不在这里 —— 和 hide-on-close 一样，
    /// 前端存盘、启动时推给 Rust。
    pub fn rebind(
        app: &AppHandle,
        kind: &str,
        chord: &str,
    ) -> Result<super::ShortcutStatus, String> {
        use super::{ShortcutStatus, Shortcuts};
        let label = match kind {
            "summon" => "唤出 / 隐藏 Modulo",
            "ontop" => "窗口置顶",
            other => return Err(format!("未知的快捷键类型「{other}」")),
        };
        let wanted = chord.trim().to_string();
        let shortcut = parse_chord(&wanted)?;
        let chords = app.state::<super::Chords>();
        let old = {
            let guard = chords.0.lock().unwrap();
            if guard.iter().any(|(k, _, s)| *k != kind && *s == shortcut) {
                return Err("两条全局快捷键不能是同一个组合".to_string());
            }
            guard.iter().find(|(k, _, _)| *k == kind).cloned()
        };
        let (old_chord, old_shortcut) = match old {
            Some((_, c, s)) => (c, s),
            None => return Err(format!("快捷键「{kind}」还没注册成功，无法改键")),
        };
        if old_chord.eq_ignore_ascii_case(&wanted) {
            return Ok(ShortcutStatus {
                kind: kind.into(),
                keys: old_chord,
                label: label.into(),
                registered: true,
            });
        }
        let gs = app.global_shortcut();
        let _ = gs.unregister(old_shortcut);
        if let Err(err) = gs.register(shortcut) {
            if let Err(back) = gs.register(old_shortcut) {
                eprintln!("[modulo] 回滚旧快捷键 {old_chord} 也失败，这条已不可用: {back}");
            }
            return Err(format!("注册 {wanted} 失败（多半被别的程序占用）: {err}"));
        }
        {
            let mut guard = chords.0.lock().unwrap();
            if let Some(entry) = guard.iter_mut().find(|(k, _, _)| *k == kind) {
                *entry = (entry.0, wanted.clone(), shortcut);
            }
        }
        {
            let store = app.state::<Shortcuts>();
            let mut list = store.0.lock().unwrap();
            if let Some(item) = list.iter_mut().find(|s| s.kind == kind) {
                item.keys = wanted.clone();
                item.registered = true;
            }
        }
        Ok(ShortcutStatus {
            kind: kind.into(),
            keys: wanted,
            label: label.into(),
            registered: true,
        })
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

    /// 测试接缝：`MODULO_WANT_SIZE="宽x高"` 可以顶掉默认档，用来在正常屏幕上实测夹取
    /// 分支（本机工作区放不下 2600×1500，就会被逐轴夹住）。不设时产品路径零变化。
    pub fn parse_size(raw: &str) -> Option<(f64, f64)> {
        let mut it = raw.split('x');
        let w: f64 = it.next()?.trim().parse().ok()?;
        let h: f64 = it.next()?.trim().parse().ok()?;
        if it.next().is_some() || w <= 0.0 || h <= 0.0 {
            return None;
        }
        Some((w, h))
    }

    fn wanted_size() -> (f64, f64) {
        match std::env::var("MODULO_WANT_SIZE") {
            Ok(raw) => match parse_size(&raw) {
                Some(size) => size,
                None => {
                    eprintln!("[modulo] 忽略无法解析的 MODULO_WANT_SIZE={raw}（应写成 宽x高）");
                    DEFAULT_SIZE
                }
            },
            Err(_) => DEFAULT_SIZE,
        }
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
        let want = wanted_size();
        let size = fit_size(avail, want);
        if size != want {
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
            set_shortcut,
            storage::read_doc,
            storage::write_doc,
            storage::data_dir,
            web::bing_daily,
            monitor::web_probe,
            sysmon::sys_stats
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
            .manage(Chords::default())
            // 应用内更新：查 `plugins.updater.endpoints` 指向的 latest.json，下载后按
            // 内嵌的 minisign 公钥验签（验签发生在 download 里，见插件 updater.rs），
            // NSIS 走 `/P /UPDATE` 静默升级。**与代码签名是两件事** —— 这里的签名是
            // 更新包的完整性校验（自己生成密钥对，免费），SmartScreen 那个 Authenticode
            // 证书仍然没有。密钥与发布步骤见 docs/ARCHITECTURE.md §11.6。
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
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

    #[test]
    fn parses_the_size_seam_strictly() {
        use super::desktop::parse_size;
        assert_eq!(parse_size(" 2600x1500 "), Some((2600.0, 1500.0)));
        assert_eq!(parse_size("1280x800x24"), None);
        assert_eq!(parse_size("1280"), None);
        assert_eq!(parse_size("宽x高"), None);
        // 0 与负数会让「夹到 94%」失去意义，宁可回落到默认档
        assert_eq!(parse_size("0x800"), None);
        assert_eq!(parse_size("-1x800"), None);
    }

    /// 这组曾经**写不了**：文档里记的是「一引用 `parse_chord`，windows-gnu 的测试二进制就
    /// `STATUS_ENTRYPOINT_NOT_FOUND`，去掉立刻恢复」。
    /// 真因与那条测试无关 —— 测试壳**从来没成功启动过**（见 build.rs 的注释：tauri → muda →
    /// windows crate 静态导入 `comctl32.dll` 的 `TaskDialogIndirect`，而它只由 comctl32 v6
    /// 导出；测试壳没嵌清单，loader 绑到 System32 的 v5 就缺入口）。补了 build.rs 的链接后
    /// 就能写了，那条历史记录里的因果是错的。
    #[test]
    fn 裸键被拒_因为会吞掉系统里所有该键的输入() {
        assert!(super::desktop::parse_chord("M").is_err());
        assert!(super::desktop::parse_chord("  A  ").is_err());
    }

    #[test]
    fn 带修饰键的组合解析得过() {
        for raw in [
            super::desktop::SUMMON,
            super::desktop::ON_TOP,
            "Ctrl+Alt+M",
            "Super+Shift+T",
        ] {
            let got = super::desktop::parse_chord(raw)
                .unwrap_or_else(|e| panic!("「{raw}」本该合法：{e}"));
            // 有修饰键才允许注册，所以这里同时盯住 mods 非空
            assert!(!got.mods.is_empty(), "「{raw}」解析出来却没有修饰键");
        }
    }

    #[test]
    fn 解析失败时错误信息里带得下原文() {
        let err = super::desktop::parse_chord("Ctrl+ Nope").unwrap_err();
        assert!(err.contains("Ctrl+ Nope"), "错误信息丢了原文：{err}");
        let err = super::desktop::parse_chord("M").unwrap_err();
        assert!(err.contains('M'), "裸键的拒绝理由里没有那个键：{err}");
    }

    /// 前后端对「Win 键叫什么」必须一致：前端 `chord.ts` 的 `toChord` 发的是 **`Super`**
    /// （muda 只认 `COMMAND` / `CMD` / `SUPER`），**不认 `Win`**。
    /// 这条钉住的是那个契约 —— 哪天有人把 `toChord` 改成发 `Win`，录制出来的组合会一律注册失败，
    /// 而症状是设置页报一句「无法解析」，很难联想到是前端改了一个词。
    #[test]
    fn win_键的写法是_super_不是_win() {
        assert!(super::desktop::parse_chord("Super+M").is_ok());
        let err = super::desktop::parse_chord("Win+M").unwrap_err();
        assert!(
            err.contains("无法解析组合键"),
            "「Win+M」本该解析失败（前端发的是 Super）：{err}"
        );
    }
}
