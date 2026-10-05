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
    id: 'meeting',
    title: '会议规划',
    group: '时间',
    blurb: '我说几点开 · 各城几点该不该开',
    defaultVariant: 'rows',
    variants: [
      // rows 形态：时间行 + 最多 4 行对照 + 一句总评，3×4 起步
      { id: 'rows', name: '对照表', minW: 3, minH: 4, idealW: 4, idealH: 5 },
      // 窄形态砍掉城市选择按钮，只留时间 + 两行最关键的对照
      { id: 'mini', name: '只看时间', minW: 2, minH: 2, idealW: 3, idealH: 3 },
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
  {
    id: 'heatmap',
    title: '月度热力图',
    group: '记录',
    blurb: '当月打卡深浅（相对深浅，不是好坏）',
    defaultVariant: 'grid',
    variants: [
      // 6×7 网格 + 星期行 + 图例：4×4 起步
      { id: 'grid', name: '整月网格', minW: 4, minH: 4, idealW: 5, idealH: 5 },
      // 窄形态藏掉数字，只留格子
      { id: 'dots', name: '只留格子', minW: 3, minH: 3, idealW: 4, idealH: 4 },
    ],
  },
  {
    id: 'birthday',
    title: '生日提醒',
    group: '记录',
    blurb: '下一次是谁；填出生年才算年龄',
    defaultVariant: 'list',
    variants: [
      { id: 'list', name: '最近几位', minW: 3, minH: 3, idealW: 4, idealH: 4 },
      // 只报下一个：名字 + "还有 N 天" + 年龄，三行以内，2×2 装得下
      { id: 'next', name: '只报下一个', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'focus',
    title: '每日聚焦',
    group: '专注',
    blurb: '待办里第一条没做完的（读同一份清单）',
    defaultVariant: 'task',
    variants: [
      // task 形态要给一句话留 4 行 + 一行统计，3×2 起步
      { id: 'task', name: '一句话', minW: 3, minH: 2, idealW: 4, idealH: 3 },
      { id: 'list', name: '带完成数', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'monthstat',
    title: '月度统计',
    group: '记录',
    blurb: '本月完成率与欠账（按完成时刻算）',
    defaultVariant: 'panel',
    variants: [{ id: 'panel', name: '完成率', minW: 2, minH: 3, idealW: 3, idealH: 4 }],
  },
  {
    id: 'ledger',
    title: '记账',
    group: '记录',
    blurb: '本月花费与分类占比（金额存分，不碰浮点）',
    defaultVariant: 'panel',
    variants: [
      // panel 形态带分类条 + 14 天趋势 + 8 条明细，格子要多
      { id: 'panel', name: '带明细', minW: 3, minH: 4, idealW: 4, idealH: 6 },
      // 极简形态：总额 + 三类占比，2×3 装得下
      { id: 'sum', name: '只看总额', minW: 2, minH: 3, idealW: 3, idealH: 4 },
    ],
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
  {
    id: 'pick',
    title: '随机抽签',
    group: '工具',
    blurb: '一份名单抽一个，可加权（不联网）',
    defaultVariant: 'panel',
    variants: [
      // panel 形态带名单 + 每项权重输入框，3 行起步
      { id: 'panel', name: '带权重', minW: 3, minH: 4, idealW: 4, idealH: 5 },
      // 极简形态只留「抽一下 + 输入框」，一行名单
      { id: 'quick', name: '只抽一次', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'links',
    title: '快捷链接',
    group: '工具',
    // 明说"复制"而不是"打开"：桌面壳要新依赖 opener 插件，且链接去哪不可控
    blurb: '常用链接，点一下复制',
    defaultVariant: 'list',
    variants: [
      { id: 'list', name: '可增删', minW: 3, minH: 3, idealW: 4, idealH: 5 },
      { id: 'quick', name: '只复制', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'fixed',
    title: '整数位计算',
    group: '工具',
    blurb: '金额 × 率 / 税点（全程整数）',
    defaultVariant: 'panel',
    variants: [
      { id: 'panel', name: '成套结果', minW: 3, minH: 4, idealW: 4, idealH: 5 },
      { id: 'quick', name: '只出结果', minW: 2, minH: 3, idealW: 3, idealH: 4 },
    ],
  },
  {
    id: 'duty',
    title: '值班表',
    group: '时间',
    blurb: '一份名单按周期轮值（可手算验证）',
    defaultVariant: 'grid',
    variants: [
      { id: 'grid', name: '整月格子', minW: 3, minH: 4, idealW: 4, idealH: 5 },
      { id: 'now', name: '只看此刻', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'yearcalendar',
    title: '年历',
    group: '时间',
    blurb: '整年 12 个 mini 月历',
    defaultVariant: 'year',
    variants: [
      // 12 个 mini 月历按 3 列排，每格 4×4 才够：3 列 × 3 行 ≈ 需要 6 行高
      { id: 'year', name: '整年视图', minW: 4, minH: 6, idealW: 6, idealH: 8 },
      { id: 'grid', name: '2 列概览', minW: 3, minH: 5, idealW: 4, idealH: 7 },
    ],
  },
  {
    id: 'dailyimage',
    title: '每日一图',
    group: '时间',
    blurb: 'Bing 每日壁纸（桌面壳取数）',
    defaultVariant: 'poster',
    variants: [
      { id: 'poster', name: '海报', minW: 3, minH: 4, idealW: 4, idealH: 6 },
      { id: 'strip', name: '横条', minW: 3, minH: 2, idealW: 4, idealH: 3 },
    ],
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
  {
    id: 'stopwatch',
    title: '秒表',
    group: '专注',
    blurb: '从零往上数（后台不掉时间）',
    defaultVariant: 'clock',
    variants: [
      // HH:MM:SS 至少 5 个字符 + 按钮一行，2×2 起步
      { id: 'clock', name: '大数字', minW: 2, minH: 2, idealW: 3, idealH: 3 },
      { id: 'bar', name: '横条', minW: 3, minH: 1, idealW: 6, idealH: 2 },
    ],
  },
  {
    id: 'timer',
    title: '倒计时',
    group: '专注',
    blurb: '定 N 分钟，往下数到 0',
    defaultVariant: 'panel',
    variants: [
      // panel 带 6 个快捷时长 + ±5，两个数行 → 3 行起步
      { id: 'panel', name: '带快捷', minW: 3, minH: 3, idealW: 4, idealH: 4 },
      { id: 'clock', name: '只报剩余', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'interval',
    title: '间歇计时',
    group: '专注',
    // 刻意不叫"番茄钟"：那是一套预设值，不是一种计时机制。要番茄就选这里的「番茄 25/5」预设
    blurb: '专注一段休一段；含「番茄 25/5」预设',
    defaultVariant: 'panel',
    variants: [
      { id: 'panel', name: '带预设切换', minW: 3, minH: 3, idealW: 4, idealH: 4 },
      { id: 'bar', name: '只看进度', minW: 3, minH: 2, idealW: 4, idealH: 3 },
    ],
  },
  {
    id: 'breath',
    title: '呼吸计时',
    group: '专注',
    blurb: '方箱 4-4-4-4 / 助眠 4-7-8 / 平缓 4-6',
    defaultVariant: 'panel',
    variants: [
      // 要放下一个正圆 + 一行提示，3×3 起步
      { id: 'panel', name: '带节奏切换', minW: 3, minH: 3, idealW: 4, idealH: 4 },
      { id: 'orb', name: '只留圆', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'fx',
    title: '汇率',
    group: '联网',
    blurb: '常用币对美元的牌价 + 一行换算',
    defaultVariant: 'panel',
    variants: [{ id: 'panel', name: '牌价 + 换算', minW: 3, minH: 3, idealW: 4, idealH: 5 }],
  },
  {
    id: 'air',
    title: '空气质量',
    group: '联网',
    blurb: 'AQI 与 PM2.5 / PM10，城市跟天气卡走',
    defaultVariant: 'panel',
    variants: [{ id: 'panel', name: '读数卡', minW: 2, minH: 2, idealW: 3, idealH: 3 }],
  },
  {
    id: 'repo',
    title: 'GitHub 仓库',
    group: '联网',
    blurb: '星级 / 未决 issue / 最后推送（可换仓库）',
    defaultVariant: 'panel',
    variants: [{ id: 'panel', name: '仓库卡', minW: 3, minH: 3, idealW: 4, idealH: 4 }],
  },
  {
    id: 'hn',
    title: 'HN 热榜',
    group: '联网',
    blurb: '英文科技热榜前 5 条（要联网）',
    defaultVariant: 'list',
    variants: [{ id: 'list', name: '热榜列表', minW: 3, minH: 3, idealW: 4, idealH: 5 }],
  },
  {
    id: 'moon',
    title: '月相',
    group: '时间',
    blurb: '≈ 今晚的月亮（本地算，不联网）',
    defaultVariant: 'panel',
    variants: [{ id: 'panel', name: '月相卡', minW: 2, minH: 2, idealW: 3, idealH: 3 }],
  },
]
