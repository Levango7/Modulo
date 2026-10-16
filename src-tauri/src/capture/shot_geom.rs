//! capture 截图坐标换算纯函数（从 shot.rs 拆出，300 行纪律，同 ai/protocol 手法）。
//!
//! **单位口径（2026-10-15 读 xcap 0.9.8 源码实证）**：xcap 在 Windows 上全物理
//! 像素（MonitorFromPoint / rcMonitor / capture_region 都吃物理坐标），
//! scale_factor() 只是暴露出来的逻辑↔物理换算因子。前端拖拽选区给的是
//! **逻辑坐标**（CSS px，绝对桌面坐标），物理 = 逻辑 × 所在屏 scale_factor（AC-07，
//! 多屏各自换算）。本文件只回答"逻辑选区在哪个屏、相对该屏的物理像素是多少"，
//! 不碰 xcap、不碰 IO，全部可单测。

/// 显示器物理矩形（xcap 口径：物理像素）
#[derive(Clone, Copy)]
pub(crate) struct PhysRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// 逻辑选区 → **显示器相对**物理像素，越界夹紧。
/// 夹到空（选区太小/完全在屏外）返回 None，由调用方给人话错误。
pub(crate) fn logical_region_to_phys(
    lx: i32,
    ly: i32,
    lw: i32,
    lh: i32,
    mon: PhysRect,
    sf: f32,
) -> Option<(u32, u32, u32, u32)> {
    let px = (lx as f32 * sf) - mon.x as f32;
    let py = (ly as f32 * sf) - mon.y as f32;
    let pw = lw as f32 * sf;
    let ph = lh as f32 * sf;
    if pw < 1.0 || ph < 1.0 {
        return None;
    }
    // 夹紧到显示器边界（选区允许部分越界——压扁而非报错，符合拖拽直觉）
    let cx = px.max(0.0);
    let cy = py.max(0.0);
    let cw = pw.min(mon.w as f32 - cx);
    let ch = ph.min(mon.h as f32 - cy);
    if cw < 1.0 || ch < 1.0 {
        return None;
    }
    Some((cx as u32, cy as u32, cw as u32, ch as u32))
}

/// 在全部显示器里按**逻辑坐标**找包含该点的；返回下标与该屏 scale_factor。
/// 点不在任何屏上（点击了任务栏外的幽灵区）返回 None。
///
/// 注：不同缩放率的屏在"物理起点 / sf"换算下逻辑区可能重叠（如主屏 sf=1 的
/// [0,1920) 与副屏 sf=1.5 的 [1280,2560)），重叠带命中哪个都合理——first-match
/// 保证确定性；现实里 Windows 不会这么排布。
pub(crate) fn find_monitor_by_logical_point(
    monitors: &[(PhysRect, f32)],
    lx: i32,
    ly: i32,
) -> Option<(usize, f32)> {
    monitors.iter().enumerate().find_map(|(i, (m, sf))| {
        let in_x = (lx as f32) >= m.x as f32 / sf && (lx as f32) < (m.x + m.w as i32) as f32 / sf;
        let in_y = (ly as f32) >= m.y as f32 / sf && (ly as f32) < (m.y + m.h as i32) as f32 / sf;
        (in_x && in_y).then_some((i, *sf))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 换算_无缩放() {
        // 单屏 1920x1080 @ (0,0) sf=1.0：选区逻辑 (100,50,400,300) → 同值
        let mon = PhysRect {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
        };
        assert_eq!(
            logical_region_to_phys(100, 50, 400, 300, mon, 1.0),
            Some((100, 50, 400, 300))
        );
    }

    #[test]
    fn 换算_各缩放档() {
        // 副屏物理 (1920,0,1600,900) sf=1.25。入参是**绝对逻辑坐标**：
        // 逻辑 2120 × 1.25 = 物理 2650，减显示器物理原点 1920 → 显示器相对 730
        let mon = PhysRect {
            x: 1920,
            y: 0,
            w: 1600,
            h: 900,
        };
        assert_eq!(
            logical_region_to_phys(1920 + 200, 100, 400, 200, mon, 1.25),
            Some((730, 125, 500, 250))
        );
        // 1.5 档：逻辑宽 300 → 物理 450
        let mon = PhysRect {
            x: 0,
            y: 0,
            w: 2880,
            h: 1800,
        };
        assert_eq!(
            logical_region_to_phys(0, 0, 300, 200, mon, 1.5),
            Some((0, 0, 450, 300))
        );
        // 2.0 档
        let mon = PhysRect {
            x: 0,
            y: 0,
            w: 3840,
            h: 2160,
        };
        assert_eq!(
            logical_region_to_phys(10, 20, 100, 50, mon, 2.0),
            Some((20, 40, 200, 100))
        );
    }

    #[test]
    fn 换算_越界夹紧与退化() {
        let mon = PhysRect {
            x: 0,
            y: 0,
            w: 1000,
            h: 1000,
        };
        // 选区一半在屏外 → 压扁到屏内，不是报错
        assert_eq!(
            logical_region_to_phys(900, 900, 400, 400, mon, 1.0),
            Some((900, 900, 100, 100))
        );
        // 起点在负坐标（主屏左侧的幽灵区）→ cx 夹 0；右边沿未越界，宽度不变
        assert_eq!(
            logical_region_to_phys(-100, 0, 600, 400, mon, 1.0),
            Some((0, 0, 600, 400))
        );
        // 完全在屏外 → None
        assert_eq!(logical_region_to_phys(2000, 2000, 100, 100, mon, 1.0), None);
        // 零面积选区 → None
        assert_eq!(logical_region_to_phys(0, 0, 0, 0, mon, 1.0), None);
    }

    #[test]
    fn 找屏_按逻辑坐标() {
        // 主屏物理 (0,0,1920,1080) sf=1；副屏物理右移 1920，sf=1.5
        // （公式下副屏逻辑区 [1280,2560) 与主屏 [0,1920) 有重叠带 1280-1920：
        //  现实里 Windows 不会这么排布，重叠带命中哪个都合理，first-match 确定性即可）
        let monitors = vec![
            (
                PhysRect {
                    x: 0,
                    y: 0,
                    w: 1920,
                    h: 1080,
                },
                1.0,
            ),
            (
                PhysRect {
                    x: 1920,
                    y: 0,
                    w: 1920,
                    h: 1080,
                },
                1.5,
            ),
        ];
        // 主屏内一点
        assert_eq!(
            find_monitor_by_logical_point(&monitors, 100, 100),
            Some((0, 1.0))
        );
        // 副屏无歧义区（>1920）
        assert_eq!(
            find_monitor_by_logical_point(&monitors, 2000, 100),
            Some((1, 1.5))
        );
        // 两屏之外
        assert_eq!(find_monitor_by_logical_point(&monitors, 9999, 9999), None);
    }
}
