//! capture 模块包（Phase 3，施工顺序 5-6）。
//!
//! 分包纪律：shot（xcap 截屏落盘）与 preview（WGC 窗口预览帧管线）各自成文件，
//! 单文件 ≤300 行，入口只装配。本文件随施工推进逐个挂子模块。

pub mod shot;
pub mod shot_geom;
