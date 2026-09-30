/**
 * 实测每张卡"内容需要几行"，供 fitHeights 使用。
 *
 * 刻意用真实测量而不是给每种卡片写"行数成本"模型：模型会随字号、皮肤、
 * 语言换行漂移，测出来的数才是对的。
 *
 * 注意不能用 scrollHeight 判断"内容比盒子矮" —— scrollHeight 恒 ≥ clientHeight，
 * 那样只会得出"不用收紧"。所以要量内容子元素的实际排布范围。
 */
export function measureWantedRows(grid: HTMLElement | null): Record<string, number> {
  const out: Record<string, number> = {}
  if (!grid) return out
  for (const cell of grid.querySelectorAll<HTMLElement>('.cell')) {
    const id = cell.dataset.module
    const card = cell.querySelector<HTMLElement>('.card')
    const body = cell.querySelector<HTMLElement>('.card-body')
    if (!id || !card || !body) continue
    const span = parseRowSpan(cell.style.gridRow)
    const cellH = cell.clientHeight
    if (!span || cellH <= 0) continue
    const rowPx = cellH / span
    if (rowPx <= 0) continue
    const neededPx = card.offsetHeight - body.clientHeight + naturalBodyHeight(body)
    out[id] = Math.max(1, Math.ceil(neededPx / rowPx))
  }
  return out
}

/** 内容子元素的实际占位高度 + 容器上下内边距 */
function naturalBodyHeight(body: HTMLElement): number {
  const kids = [...body.children] as HTMLElement[]
  if (!kids.length) return 0
  const rects = kids.map((k) => k.getBoundingClientRect())
  const top = Math.min(...rects.map((r) => r.top))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  const cs = getComputedStyle(body)
  return bottom - top + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
}

/** 兼容 "1 / span 6" 与 "span 6" 两种写法 */
function parseRowSpan(value: string): number {
  const m = /span\s+(\d+)/i.exec(value)
  return m ? Number(m[1]) : 0
}
