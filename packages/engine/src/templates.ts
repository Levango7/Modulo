import { addItem, moveItem, resizeItem } from './ops.js'
import { spreadLayout } from './spread.js'
import { emptyDoc } from './types.js'
import { findModule } from './types.js'
import type { LayoutDoc, ModuleRegistry } from './types.js'

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
      /**
       * 坐标按"降档三档都要对齐"调过（2026-10-10，本地走查轮，改法见交接记录）。
       * 取整规则是 `pw = ceil(w / s)`、`px = floor(x / s)`（s = 12/N）：旧坐标
       * （clock 5 宽在 x0、sticky 3 宽在 x5、todo 4 宽在 x8）在 4 列档会让便签与
       * 时钟/待办互相压边、被"就近塞"顶下去 —— 屏幕上就是一张浮在中列的"楼梯"。
       * 现坐标在 N=12 / 8 / 4 三档投影后都**零空洞、零内部洞**（`templates.test.ts`
       * 的新守卫锁着）；N=6 一档受"sticky ≤3、recent ≥4、todo ≥4"三条硬约束夹住，
       * 五张卡排不成无洞两列（会有一次通道式折行），如实记档，不假装修好了。
       * todo 必须 ≥4 逻辑列：N=4 档 ceil(w/3) 只有到 2 物理列才不裁字（E2E 实测抓过）。
       */
      { id: 'clock', variant: 'big', x: 0, y: 0, w: 6, h: 3 },
      { id: 'todo', variant: 'list', x: 6, y: 0, w: 6, h: 6 },
      { id: 'sticky', variant: 'note', x: 0, y: 3, w: 3, h: 3 },
      { id: 'notes', variant: 'overview', x: 3, y: 3, w: 3, h: 3 },
      { id: 'recent', variant: 'bar', x: 0, y: 6, w: 12, h: 2 },
    ],
  },
  {
    id: 'clock-note',
    name: '大字时钟',
    blurb: '一半看时间，一半写一句话',
    audience: '只想摆着看，几乎不操作',
    cells: [
      { id: 'clock', variant: 'big', x: 0, y: 0, w: 6, h: 3 },
      { id: 'sticky', variant: 'wide', x: 6, y: 0, w: 6, h: 3 },
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
    id: 'meeting',
    name: '会议记录',
    blurb: '左边记要点，右上时间，右下行动项',
    audience: '开会 / 上课边听边记，还要收尾待办',
    cells: [
      { id: 'notes', variant: 'tall', x: 0, y: 0, w: 6, h: 8 },
      { id: 'clock', variant: 'big', x: 6, y: 0, w: 6, h: 3 },
      { id: 'todo', variant: 'list', x: 6, y: 3, w: 6, h: 5 },
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
    /**
     * 必须按 id 精确查，**不能用 `resolveVariant`**：那个函数在形态失效时刻意回退到
     * defaultVariant（对用户友好是对的），于是"模板写错了形态名"这种漂移永远查不出来 ——
     * 而模板要是被静默换成正方形形态，格子数就不对，铺满守卫跟着一起骗人。
     */
    const v = mod.variants.find((x) => x.id === c.variant)
    if (!v) {
      warnings.push(`模板「${t.name}」的 ${c.id} 形态 ${c.variant} 不存在`)
      continue
    }
    if (c.w < v.minW || c.h < v.minH) warnings.push(`模板「${t.name}」的 ${c.id} 小于最小尺寸 ${v.minW}×${v.minH}`)
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
