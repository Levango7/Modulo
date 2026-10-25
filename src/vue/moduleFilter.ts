/**
 * 模块库搜索的**纯判定层**（F-09，2026-10-26）。
 *
 * 为什么单独成文件：这段判定原来是"组件里 `.filter()` 一行"的量级，但它要满足两件事 ——
 * ① **不开浏览器也能断言**（本仓受测层的纳入判据，见 `vitest.config.ts` 文件头）；
 * ② 匹配口径得有个地方写清楚并钉住，否则"搜不到"永远是玄学。
 * 组件只负责把输入接进来、把结果渲染出去。
 *
 * 匹配口径（**刻意朴素，别自作聪明**）：
 *   - 查询串按空白切成若干词，**每个词都要命中**（AND；`时钟 宽` 是"既是时钟又有宽版"）。
 *   - 大小写不敏感（中文无大小写，但标题里夹英文时 `Clock` 与 `clock` 要一样）。
 *   - 命中范围 = 标题 + 一句话说明（`blurb`）+ 分组名（`group`）+ 所有形态名。
 *     **说明与分组算命中**是有意的：卡片到 50 张后，人记得的是"那个倒计时的"，
 *     不一定记得它叫「倒数日」。
 *   - 命中的是**模块**，不是形态：一个模块命中就整条留下（形态照旧全显示）——
 *     只显示命中的那条形态会让人以为"这张卡只有这一种尺寸"。
 *   - 空查询（含纯空白）返回**原数组本身**，不是一份拷贝 —— 调用方拿它和"清空搜索"
 *     比引用即可，且不给 `v-for` 换一批 key。
 *
 * 不做的事（别在这里加）：拼音 / 首字母、模糊匹配、打分排序。要的是"输入即缩小范围"，
 * 不是"猜你想要什么" —— 后者在 50 张卡的量级上只增加不可预测的排序。
 */
import type { ModuleDef } from '../../packages/engine/src/types'

/** 一个模块的检索串：标题 + 说明 + 分组 + 形态名，一次性压平并转小写 */
function haystack(m: ModuleDef): string {
  const parts: string[] = [m.title, m.blurb ?? '', m.group ?? '']
  for (const v of m.variants) parts.push(v.name)
  return parts.join(' ').toLowerCase()
}

/**
 * 按查询串过滤模块清单。
 *
 * @param list  模块库完整清单（`store.available`，多开之后不再剔除已放置的模块）
 * @param query 搜索框原文（未 trim、可能含连续空白、可能是空串）
 */
export function filterModules(list: readonly ModuleDef[], query: string): readonly ModuleDef[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return list
  return list.filter((m) => {
    const h = haystack(m)
    return terms.every((t) => h.includes(t))
  })
}
