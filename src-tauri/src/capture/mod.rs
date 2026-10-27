//! capture 模块包（Phase 3，施工顺序 5-6）。
//!
//! 分包纪律：shot（xcap 截屏落盘）/ preview（WGC 窗口预览帧管线）/ winlist
//! （可预览窗口枚举）各自成文件，单文件 ≤300 行，入口只装配。
//! 纯函数在 shot_geom / preview_geom。本文件随施工推进逐个挂子模块。
//!
//! shot / shot_geom 的五条命令（shot_full/region/window/list/delete）按 F-11②
//! 从 `generate_handler!` 撤了注册（前端卡未动工，注册面必须等于调用点面）；模块
//! 本体与单测保留，接线 PR 一来回注册是一行，所以这里挂着 `allow(dead_code)`。

pub mod preview;
pub mod preview_errors;
pub mod preview_geom;
#[allow(dead_code)]
pub mod shot;
#[allow(dead_code)]
pub mod shot_geom;
pub mod winlist;
