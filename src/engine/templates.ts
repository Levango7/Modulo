import { addItem, moveItem, resizeItem } from './ops'
import { spreadLayout } from './spread'
import { emptyDoc } from './types'
import { findModule, resolveVariant } from './types'
import type { LayoutDoc, ModuleRegistry } from './types'

/**
 * 版面模板：给"不知道从哪开始排"的人一个**起点**，不是又一个功能开关。
 *
 * 为什么放在引擎层：模板的全部价值在于"排出来是满的"，而这句话必须能被纯函数测出来
 * （`tests/engine/templates.test.ts` 逐个数格子）。放进组件里就只能靠眼睛看，
 * 而"靠眼睛看排版"这件事这一轮已经翻过一次车 —— 出厂版面带着 37.9% 空洞上线了。
 *
 * 每张模板都手写坐标，且**同一横带里的卡必须同高**：`fillRows` 按"顶边相同"分组铺宽，
 * 带里只剩一张卡时会被拉成通栏横幅。所以宽度是设计出来的，`spreadLayout` 只当兜底。
 */
export interface TemplateCell {
  /** 模块 id，同时就是这张卡的 placement id */
  id: string
  variant: string
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutTemplate {
  id: string
  /** 卡片上那行大字 */
  name: string
  /** 一句话：说清"这排法在盯什么"，要短到不换行 */
  blurb: string
  /** 适用人群标签。选模板靠这个对号入座，比描述更有效 */
  audience: string
  cells: TemplateCell[]
}

/** 出厂默认。删掉它等于删掉"没存档时该看到什么"这个答案，所以单独命名。 */
export const DEFAULT_TEMPLATE_ID = 'general'

export const TEMPLATES: readonly LayoutTemplate[] = [
  {
    id: 'general',
    name: '通用',
    blurb: '时间、便签、待办、速记各就各位',
    audience: '第一次用 · 不知道选哪个就点它',
    cells: [
      { id: 'clock', variant: 'big', x: 0, y: 0, w: 5, h: 3 },
      { id: 'sticky', variant: 'note', x: 5, y: 0, w: 3, h: 3 },
      { id: 'todo', variant: 'list', x: 8, y: 0, w: 4, h: 6 },
      { id: 'notes', variant: 'overview', x: 0, y: 3, w: 4, h: 3 },
      { id: 'recent', variant: 'bar', x: 4, y: 3, w: 4, h: 3 },
    ],
  },
  {
    id: 'focus',
    name: '极简专注',
    blurb: '一张大清单 + 时间，别的都收起来',
    audience: '只想盯今天要做的事',
    cells: [
      { id: 'todo', variant: 'list', x: 0, y: 0, w: 8, h: 6 },
      { id: 'clock', variant: 'big', x: 8, y: 0, w: 4, h: 3 },
      { id: 'sticky', variant: 'note', x: 8, y: 3, w: 4, h: 3 },
    ],
  },
  {
    id: 'dev',
    name: '开发排障',
    blurb: '左侧长速记贴日志报错，右边待办与时间',
    audience: '写代码 / 运维 / 常贴长文本',
    cells: [
      { id: 'notes', variant: 'tall', x: 0, y: 0, w: 4, h: 8 },
      { id: 'todo', variant: 'list', x: 4, y: 0, w: 4, h: 6 },
      { id: 'clock', variant: 'big', x: 8, y: 0, w: 4, h: 3 },
      { id: 'sticky', variant: 'note', x: 8, y: 3, w: 4, h: 5 },
      { id: 'recent', variant: 'bar', x: 4, y: 6, w: 4, h: 2 },
    ],
  },
  {
    id: 'writer',
    name: '写作收集',
    blurb: '速记占满左边一整列，随时往下扔',
    audience: '写字 / 记灵感 / 采访整理',
    cells: [
      { id: 'notes', variant: 'tall', x: 0, y: 0, w: 8, h: 8 },
      { id: 'clock', variant: 'big', x: 8, y: 0, w: 4, h: 3 },
      { id: 'sticky', variant: 'note', x: 8, y: 3, w: 4, h: 2 },
      { id: 'todo', variant: 'compact', x: 8, y: 5, w: 4, h: 3 },
    ],
  },
  {
    id: 'study',
    name: '备考清单',
    blurb: '待办摊大成主卡，速记与最近改动当边栏',
    audience: '学生 / 备考 / 任务多到要排队',
    cells: [
      { id: 'todo', variant: 'list', x: 0, y: 0, w: 8, h: 6 },
      { id: 'clock', variant: 'big', x: 8, y: 0, w: 4, h: 3 },
      { id: 'notes', variant: 'overview', x: 8, y: 3, w: 4, h: 5 },
      { id: 'sticky', variant: 'note', x: 0, y: 6, w: 4, h: 2 },
      { id: 'recent', variant: 'bar', x: 4, y: 6, w: 4, h: 2 },
    ],
  },
  {
    id: 'dash',
    name: '效率仪表盘',
    blurb: '横幅时钟压顶，三张卡并排，底部通栏改动',
    audience: '常驻桌面当信息屏',
    cells: [
      { id: 'clock', variant: 'big', x: 0, y: 0, w: 12, h: 3 },
      { id: 'todo', variant: 'list', x: 0, y: 3, w: 4, h: 5 },
      { id: 'notes', variant: 'overview', x: 4, y: 3, w: 4, h: 5 },
      { id: 'sticky', variant: 'note', x: 8, y: 3, w: 4, h: 5 },
      { id: 'recent', variant: 'bar', x: 0, y: 8, w: 12, h: 2 },
    ],
  },
]

export function templateById(id: string): LayoutTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

/** 模板里的形态在注册表里存在吗。注册表会改，模板会漂移，所以运行时也要能查。 */
export function validateTemplate(t: LayoutTemplate, reg: ModuleRegistry): string[] {
  const warnings: string[] = []
  for (const c of t.cells) {
    const mod = findModule(reg, c.id)
    if (!mod) {
      warnings.push(`模板「${t.name}」用了未注册的模块 ${c.id}`)
      continue
    }
    if (!resolveVariant(mod, c.variant)) warnings.push(`模板「${t.name}」的 ${c.id} 形态 ${c.variant} 不存在`)
    const v = resolveVariant(mod, c.variant)
    if (v && (c.w < v.minW || c.h < v.minH)) warnings.push(`模板「${t.name}」的 ${c.id} 小于最小尺寸 ${v.minW}×${v.minH}`)
  }
  return warnings
}

/**
 * 把模板铺成一份 LayoutDoc。
 * 三步不能省：`addItem` 只按形态 ideal 找空位（给它 w/h 也没用），所以必须
 * add → resize → move；少了 move，宽卡会被塞到别处，行带就散了。
 * 最后过一遍 `spreadLayout` 兜底：正常模板铺满后它是恒等的（单测锁着这条）。
 */
export function buildTemplate(reg: ModuleRegistry, t: LayoutTemplate): LayoutDoc {
  let d = emptyDoc()
  for (const c of t.cells) {
    d = addItem(d, reg, c.id, c.x, c.y, c.variant) ?? d
    d = resizeItem(d, reg, c.id, c.w, c.h) ?? d
    d = moveItem(d, c.id, c.x, c.y) ?? d
  }
  return spreadLayout(d)
}
