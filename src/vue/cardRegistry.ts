import type { ModuleRegistry } from '@modulo/engine'

/**
 * 模块目录：尺寸契约（min/ideal，逻辑列单位）在这里声明，引擎据此钳制与降档。
 * 这个文件刻意不 import 任何 .vue —— 起步版面的空洞率要靠单测拿**这份真契约**算，
 * 抄一份到测试里就等于装了个会撒谎的守卫。组件映射在 `cardComponents.ts`。
 *
 * `group` 是「添加卡片」菜单的分组（时间 / 记录 / 工具 / 联网）—— 卡片到 20 张时
 * 平铺菜单已经翻不动了，目录（docs/CARD-CATALOG.md）里后面还有 20 张等着进来。
 */
export const REGISTRY: ModuleRegistry = [
  // ---- 时间 ----
  {
    id: 'clock',
    title: '时钟',
    group: '时间',
    blurb: '看时间与日期，顺手一句摘抄',
    defaultVariant: 'big',
    variants: [
      { id: 'big', name: '大时钟', minW: 3, minH: 3, idealW: 4, idealH: 3 },
      { id: 'lunar', name: '日期卡', minW: 2, minH: 2, idealW: 3, idealH: 2 },
      { id: 'minimal', name: '极简时间', minW: 2, minH: 1, idealW: 2, idealH: 1 },
    ],
  },
  {
    id: 'calendar',
    title: '月历',
    group: '时间',
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
    group: '时间',
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
    group: '时间',
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
    group: '时间',
    blurb: '离那个日子还有几天',
    defaultVariant: 'days',
    variants: [
      { id: 'days', name: '大数字', minW: 2, minH: 2, idealW: 3, idealH: 3 },
      { id: 'row', name: '横向一行', minW: 4, minH: 2, idealW: 6, idealH: 2 },
    ],
  },
  {
    id: 'dtools',
    title: '日期工具',
    group: '时间',
    blurb: '星期几 / 相差几天 / 加减天数',
    defaultVariant: 'panel',
    variants: [{ id: 'panel', name: '查一查', minW: 2, minH: 3, idealW: 3, idealH: 4 }],
  },
  // ---- 记录 ----
  {
    id: 'sticky',
    title: '便签',
    group: '记录',
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
    group: '记录',
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
    group: '记录',
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
    group: '记录',
    blurb: '通栏一条：最近动过的内容',
    defaultVariant: 'bar',
    variants: [{ id: 'bar', name: '通栏', minW: 4, minH: 1, idealW: 12, idealH: 2 }],
  },
  {
    id: 'habit',
    title: '习惯打卡',
    group: '记录',
    blurb: '一周格子 + 连续天数',
    defaultVariant: 'week',
    variants: [{ id: 'week', name: '一周打卡', minW: 3, minH: 2, idealW: 4, idealH: 3 }],
  },
  // ---- 工具 ----
  {
    id: 'calc',
    title: '计算器',
    group: '工具',
    blurb: '四则 / 括号 / 百分比（无 eval）',
    defaultVariant: 'full',
    variants: [{ id: 'full', name: '面板', minW: 3, minH: 4, idealW: 4, idealH: 5 }],
  },
  {
    id: 'unitconv',
    title: '单位换算',
    group: '工具',
    blurb: '长度 / 重量 / 温度 / 面积 / 速度 / 数据量',
    defaultVariant: 'panel',
    variants: [{ id: 'panel', name: '换算面板', minW: 2, minH: 3, idealW: 3, idealH: 4 }],
  },
  {
    id: 'colorconv',
    title: '颜色工具',
    group: '工具',
    blurb: 'HEX / RGB / HSL 与对比度建议',
    defaultVariant: 'panel',
    variants: [{ id: 'panel', name: '取色面板', minW: 2, minH: 2, idealW: 3, idealH: 3 }],
  },
  {
    id: 'textstat',
    title: '文本统计',
    group: '工具',
    blurb: '字符 / 词 / 行，中英混排口径',
    defaultVariant: 'panel',
    variants: [{ id: 'panel', name: '计数器', minW: 2, minH: 3, idealW: 3, idealH: 4 }],
  },
  {
    id: 'randomnum',
    title: '随机数',
    group: '工具',
    blurb: '区间随机 / 骰子（不重复可勾）',
    defaultVariant: 'panel',
    variants: [{ id: 'panel', name: '抽号器', minW: 2, minH: 3, idealW: 3, idealH: 4 }],
  },
  {
    id: 'baseconv',
    title: '进制转换',
    group: '工具',
    blurb: '2–36 进制互转，大数不丢精度',
    defaultVariant: 'panel',
    variants: [{ id: 'panel', name: '转换器', minW: 2, minH: 3, idealW: 3, idealH: 4 }],
  },
  // ---- 联网 ----
  {
    id: 'weather',
    title: '天气',
    group: '联网',
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
    id: 'elapsed',
    title: '正计时',
    group: '专注',
    blurb: '自某个日子起，今天第 N 天',
    defaultVariant: 'days',
    variants: [{ id: 'days', name: '大数字', minW: 2, minH: 2, idealW: 3, idealH: 3 }],
  },
]
