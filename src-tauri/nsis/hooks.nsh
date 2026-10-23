; Modulo 的 NSIS 钩子（Tauri `bundle.windows.nsis.installerHooks`）。
;
; 这个文件解决的是 **v0.8.4 时代就存在、2026-10-23 在本机被两次踩中的数据丢失路径**：
; Tauri 默认模板的卸载确认页有一颗「删除应用程序数据」勾选框，勾上会在卸载时
; `RmDir /r "$APPDATA\${BUNDLEID}"`，并把 `HKCU\Software\Modulo\Modulo`（安装目录记忆）一起删掉。
; 而**交互升级**（双击安装包）会先走「卸载旧版本」分支 —— 用户很容易顺手勾上，
; 版面和卡片内容就整体没了。静默 / `/P` / `/UPDATE` 不会碰数据，但交互路径会。
;
; 处理方式：在卸载段**所有删除动作之前**（模板把 NSIS_HOOK_PREUNINSTALL 插在 Section Uninstall
; 的第一行，早于 CheckIfAppIsRunning 与任何 Delete/RmDir）把它清零。卸载器从此只删程序，
; 不动用户数据。真要清数据，请手动删 `%APPDATA%\app.modulo`（文档见 ARCHITECTURE.md §11.4）。
;
; 守门：CI 的 desktop job 用 runner 自带的 makensis 编 `hook-selftest.nsi`（复刻模板判据，
; 反例必须 DELETE、过钩子必须 KEEP）—— 只断言这段文本存在是死断言，验宏语义要真编真跑。
!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $DeleteAppDataCheckboxState 0
  DetailPrint "Modulo: keep user data on uninstall (deleteAppData disabled)"
!macroend
