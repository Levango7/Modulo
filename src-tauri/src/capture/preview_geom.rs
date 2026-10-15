//! capture/preview_geom.rs —— 预览帧管线纯函数（300 行纪律拆出，同 shot_geom 手法）。
//!
//! 三个夹取决策的集中地：fps（契约 1-15，默认 6）、maxWidth（契约 320-1920，
//! 默认 1280）、等比缩放封顶（只缩不放，AC-25 的"720p/1280px 封顶"）。
//!
//! 关于 fps 的实话：`MinimumUpdateIntervalSettings` 是 **OS 侧节流，不是帧率
//! 承诺**（windows-capture 文档原话：不保证恒定速率）。所以 fps 只用来算节流
//! 间隔，真正的 pacing 由 preview.rs 的"编码忙丢帧"兜——前端收到多少算多少，
//! 不为凑恒定帧率复制帧（那会骗人）。

use std::time::Duration;

/// fps 默认档（契约 default: 6）
pub const FPS_DEFAULT: u8 = 6;
/// fps 上下界（契约 minimum/maximum）
pub const FPS_MIN: u8 = 1;
pub const FPS_MAX: u8 = 15;

/// maxWidth 默认档（契约 default: 1280，即 720p 封顶）
pub const MAX_WIDTH_DEFAULT: u32 = 1280;
/// maxWidth 上下界（契约 minimum/maximum）
pub const MAX_WIDTH_MIN: u32 = 320;
pub const MAX_WIDTH_MAX: u32 = 1920;

/// 夹取 fps：0/缺省 → 默认档；越界夹到界上（前端传飞了也兜得住，不报错）
pub fn clamp_fps(fps: u8) -> u8 {
    if fps == 0 {
        FPS_DEFAULT
    } else {
        fps.clamp(FPS_MIN, FPS_MAX)
    }
}

/// 夹取 maxWidth：同上口径
pub fn clamp_max_width(w: u32) -> u32 {
    if w == 0 {
        MAX_WIDTH_DEFAULT
    } else {
        w.clamp(MAX_WIDTH_MIN, MAX_WIDTH_MAX)
    }
}

/// fps → OS 节流间隔。1fps = 1s；6fps ≈ 166.67ms。
/// 先夹取再算——fps=0 用默认档，不会除零
pub fn fps_interval(fps: u8) -> Duration {
    Duration::from_secs_f64(1.0 / clamp_fps(fps) as f64)
}

/// 等比缩放封顶：宽超 max_width 才缩，高度按比例四舍五入（+w/2 再除），
/// 下限 1px（极端细长窗也不能缩成 0 高）。宽不超原样返回——**预览不放大**，
/// 放大是浪费带宽，用户要看细节会去点唤起真窗口（AC-28）。
pub fn scale_dims(w: u32, h: u32, max_width: u32) -> (u32, u32) {
    if w == 0 || h == 0 || w <= max_width {
        return (w, h);
    }
    let nh = ((h as u64 * max_width as u64 + w as u64 / 2) / w as u64).max(1);
    (max_width, nh as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fps_缺省与越界都夹得住() {
        assert_eq!(clamp_fps(0), FPS_DEFAULT);
        assert_eq!(clamp_fps(6), 6);
        assert_eq!(clamp_fps(1), 1);
        assert_eq!(clamp_fps(99), FPS_MAX);
        // 契约上下界本身不变
        assert_eq!(FPS_MIN, 1);
        assert_eq!(FPS_MAX, 15);
    }

    #[test]
    fn max_width_缺省与越界都夹得住() {
        assert_eq!(clamp_max_width(0), MAX_WIDTH_DEFAULT);
        assert_eq!(clamp_max_width(1280), 1280);
        assert_eq!(clamp_max_width(100), MAX_WIDTH_MIN);
        assert_eq!(clamp_max_width(9999), MAX_WIDTH_MAX);
    }

    #[test]
    fn fps_间隔按夹取后的值算() {
        assert_eq!(fps_interval(1), Duration::from_secs(1));
        // 6fps ≈ 166.67ms：不逐 ns 钉死，夹一个毫秒级窗口
        let six = fps_interval(6);
        assert!((six.as_millis() as i64 - 167).abs() <= 1, "6fps 间隔 {six:?}");
        // 0 走默认档而不是除零 panic
        assert_eq!(fps_interval(0), fps_interval(FPS_DEFAULT));
    }

    #[test]
    fn 缩放只缩不放且保比例() {
        // 1920×1080 → 1280×720（AC-25 封顶档）
        assert_eq!(scale_dims(1920, 1080, 1280), (1280, 720));
        // 宽不超原样返回——不放大
        assert_eq!(scale_dims(640, 480, 1280), (640, 480));
        assert_eq!(scale_dims(1280, 720, 1280), (1280, 720));
        // 非整除按四舍五入：1000×333 → 1280 封顶时高 426.24 → 426
        assert_eq!(scale_dims(1000, 333, 1280), (1000, 333));
        assert_eq!(scale_dims(2000, 667, 1280), (1280, 427));
        // 极端细长：高下限 1px，不出 0
        assert_eq!(scale_dims(1290, 1, 1280), (1280, 1));
        // 脏尺寸不炸
        assert_eq!(scale_dims(0, 0, 1280), (0, 0));
    }
}
