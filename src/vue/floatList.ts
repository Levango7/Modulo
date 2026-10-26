/**
 * 「桌面浮窗清单」的**纯判定层**（F-08，2026-10-27）。
 *
 * 为什么单独成文件，理由与 `moduleFilter.ts` 同款：这段判定要满足**不开浏览器也能断言**
 * （本仓受测层的纳入判据，见 `vitest.config.ts` 文件头），而顶栏那半是纯展示组件 ——
 * 判定留在组件里，它就只剩 E2E 一层兜底。
 *
 * 它回答两件事：**现在有几个浮窗**、**分别是哪几张卡**。
 *
 * 两条刻意的选择：
 *   - **顺序按版面**（`items` 数组顺序），不按脱离先后 —— 浮窗在桌面上的位置与版面无关，
 *     人只能靠"这张卡在版面的哪个位置"认出它，所以清单跟着版面走。
 *   - **同模块的第二张标序号**（`待办 2`）：多实例之后同一个模块可以有第二张卡，
 *     两条都叫「待办」的清单等于没写。序号按该模块在**整个版面**里出现的次序算，
 *     不是"在浮动集合里排第几" —— 后者会让序号随另一张卡脱离/收回而跳变。
 *
 * 不做的事：**置顶 / 定位到某个浮窗**需要 Rust 侧新增命令（把已存在的浮窗提到最前），
 * 这一版没有 —— 纯前端拿不到别的窗口句柄。空缺写在 `docs/ARCHITECTURE.md` §12.30 里。
 */
import type { Placement } from '@levango7/engine'
import { moduleIdOf } from '@levango7/engine'

export interface FloatItem {
  /** 实例 id（`todo` 或 `todo:2`） —— 收回时按它调 `unfloat_card` */
  id: string
  /** 清单里显示的标题（同模块第二个起带序号） */
  title: string
  /** 该模块在版面里的第几个实例（从 1 起） */
  seq: number
}

/**
 * 当前在浮动的卡片清单。
 *
 * @param items    版面条目（`store.doc.value.items`）
 * @param titleOf  模块 id → 模块标题（调用方注入，本文件不认识注册表）
 * @param detached 在浮动的实例 id 集合（`useDetached()` 的那个 `detached`）
 */
export function floatItems(
  items: readonly Placement[],
  titleOf: (moduleId: string) => string,
  detached: ReadonlySet<string>,
): FloatItem[] {
  const out: FloatItem[] = []
  const seen = new Map<string, number>()
  for (const p of items) {
    const mid = moduleIdOf(p)
    const n = (seen.get(mid) ?? 0) + 1
    seen.set(mid, n)
    if (!detached.has(p.id)) continue
    const base = titleOf(mid)
    out.push({ id: p.id, title: n > 1 ? `${base} ${n}` : base, seq: n })
  }
  return out
}
