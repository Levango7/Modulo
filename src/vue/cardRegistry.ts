import type { ModuleRegistry } from '@modulo/engine'

/**
 * 模块目录：尺寸契约（min/ideal，逻辑列单位）在这里声明，引擎据此钳制与降档。
 * 这个文件刻意不 import 任何 .vue —— 起步版面的空洞率要靠单测拿**这份真契约**算，
 * 抄一份到测试里就等于装了个会撒谎的守卫。组件映射在 `cardComponents.ts`。
 */
export const REGISTRY: ModuleRegistry = [
  {
    id: 'clock',
    title: '时钟',
    blurb: '看时间与日期，顺手一句摘抄',
    defaultVariant: 'big',
    variants: [
      { id: 'big', name: '大时钟', minW: 3, minH: 3, idealW: 4, idealH: 3 },
      { id: 'lunar', name: '日期卡', minW: 2, minH: 2, idealW: 3, idealH: 2 },
      { id: 'minimal', name: '极简时间', minW: 2, minH: 1, idealW: 2, idealH: 1 },
    ],
  },
  {
    id: 'sticky',
    title: '便签',
    blurb: '随手写两行，不归档',
    defaultVariant: 'note',
    variants: [
      { id: 'note', name: '便签', minW: 2, minH: 2, idealW: 2, idealH: 3 },
      { id: 'wide', name: '宽便签', minW: 4, minH: 2, idealW: 5, idealH: 3 },
    ],
  },
  {
    id: 'todo',
    title: '待办',
    blurb: '清单：今天要做的事',
    defaultVariant: 'list',
    variants: [
      { id: 'list', name: '清单', minW: 3, minH: 3, idealW: 4, idealH: 6 },
      { id: 'compact', name: '紧凑', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'notes',
    title: '速记',
    blurb: '长一点的记录，多条留档',
    defaultVariant: 'overview',
    variants: [
      { id: 'overview', name: '概览', minW: 2, minH: 2, idealW: 4, idealH: 4 },
      { id: 'tall', name: '长列表', minW: 3, minH: 4, idealW: 4, idealH: 8 },
    ],
  },
  {
    id: 'recent',
    title: '最近改动',
    blurb: '通栏一条：最近动过的内容',
    defaultVariant: 'bar',
    variants: [{ id: 'bar', name: '通栏', minW: 4, minH: 1, idealW: 12, idealH: 2 }],
  },
  {
    id: 'weather',
    title: '天气',
    blurb: '当前天气 + 三天预报（要联网）',
    defaultVariant: 'card',
    variants: [
      // 尺寸契约来自卡片内容的真实下限：card 要放「城市 + 温度 + 高低温 + 日出日落 + 三天预报」，
      // 3×3 是能塞下这些的最小格；mini 只报当前（2×2）。
      { id: 'card', name: '天气卡', minW: 3, minH: 3, idealW: 4, idealH: 4 },
      { id: 'mini', name: '只报当前', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'calendar',
    title: '月历',
    blurb: '当月日历，今天高亮；可翻月',
    defaultVariant: 'month',
    variants: [
      // 7 列数字要在 3 逻辑列里排得下（每个数字位约 2 字符宽），所以 minW 不能低于 3
      { id: 'month', name: '月历', minW: 3, minH: 3, idealW: 4, idealH: 4 },
      { id: 'today', name: '只报今天', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'progress',
    title: '时间进度',
    blurb: '今天 / 本月 / 今年各过去多少',
    defaultVariant: 'bars',
    variants: [
      { id: 'bars', name: '三条进度', minW: 3, minH: 2, idealW: 4, idealH: 3 },
      { id: 'year', name: '只报今年', minW: 2, minH: 2, idealW: 3, idealH: 2 },
    ],
  },
  {
    id: 'worldclock',
    title: '世界时钟',
    blurb: '几个城市的当前时间与时差',
    defaultVariant: 'list',
    variants: [
      // 最多 4 个城市：每一行是「城市 + 时间 + 时差」，2 逻辑列就能排下，但 3 个城市要 3 行 → minH 3
      { id: 'list', name: '多城列表', minW: 2, minH: 3, idealW: 3, idealH: 4 },
      { id: 'mini', name: '只报一个城市', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'countdown',
    title: '倒数日',
    blurb: '离那个日子还有几天',
    defaultVariant: 'days',
    variants: [
      { id: 'days', name: '大数字', minW: 2, minH: 2, idealW: 3, idealH: 3 },
      { id: 'row', name: '横向一行', minW: 4, minH: 2, idealW: 6, idealH: 2 },
    ],
  },
]
