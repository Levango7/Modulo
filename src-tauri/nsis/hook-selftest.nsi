; 「卸载器不删用户数据」钩子的编译级自检（CI 用，不参与产品打包）。
;
; 为什么要有它：门禁只断言「hooks.nsh 里有那行 StrCpy」是死断言 —— 宏写坏了、
; 变量名打错、或者以后有人把清零挪出宏体，文本断言都可能照样绿。这里用 runner 自带的
; makensis 真编一个小安装器，把**模板里那条判据**复刻出来跑两遍：
;   A 反例（不调钩子）→ DELETE —— 证明判据本身有射程（真勾了就会删）
;   B 正例（先调 NSIS_HOOK_PREUNINSTALL）→ KEEP
; 两个结果都写进 %TEMP%\modulo-hook-selftest.txt，CI 断言 A=DELETE 且 B=KEEP。
; 只验「宏语义」；「Tauri 是否把这份 hooks.nsh include 进产物」由配置接线与
; 发布前的真装/卸载人工门看着（模板里的 include 是 CLI 行为，本地无法编译 NSIS 时没法验）。

!include "LogicLib.nsh"

Name "modulo-hook-selftest"
OutFile "hook-selftest.exe"
RequestExecutionLevel user
SilentInstall silent
InstallDir "$TEMP\modulo-hook-selftest"

; 模板里这两个 Var 是全局的；钩子宏引用它们，所以自检也要先声明
Var DeleteAppDataCheckboxState
Var UpdateMode

!include "hooks.nsh"

Section
  ; A. 反例：模板原判据（没有钩子）
  StrCpy $DeleteAppDataCheckboxState 1
  StrCpy $UpdateMode 0
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    StrCpy $1 "DELETE"
  ${Else}
    StrCpy $1 "KEEP"
  ${EndIf}

  ; B. 正例：同样勾了删数据，但先过钩子
  StrCpy $DeleteAppDataCheckboxState 1
  StrCpy $UpdateMode 0
  !insertmacro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    StrCpy $2 "DELETE"
  ${Else}
    StrCpy $2 "KEEP"
  ${EndIf}

  FileOpen $0 "$TEMP\modulo-hook-selftest.txt" w
  FileWrite $0 "withoutHook=$1 withHook=$2"
  FileClose $0
SectionEnd
