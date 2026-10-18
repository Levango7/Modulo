import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'
import ClockCard from '../app/cards/ClockCard.vue'
import StickyCard from '../app/cards/StickyCard.vue'
import TodoCard from '../app/cards/TodoCard.vue'
import NotesCard from '../app/cards/NotesCard.vue'

/**
 * 模块 id → 渲染组件。单独一个文件是因为 `cardRegistry.ts` 只放尺寸契约、必须能被
 * node 环境的单测直接 import（vitest 默认环境没装 vue 插件，碰 .vue 就解析不了），
 * 而这张表偏偏要 import 五十四张 .vue。
 *
 * **2026-10-17 懒加载化（#11/#12 同根）**：此前 54 张卡全静态 import —— 而默认模板
 * `general` 只用 clock / todo / sticky / notes 四张（recent 复用 NotesCard），
 * 首屏白白解析 50 张卡的代码。实测（CDP 探针，生产构建）：首次导航 141ms 单条
 * longtask，缓存后 reload 归零、CPU 剖面里 JS self time 仅 ~40ms —— 大头是
 * **首次解析编译**，抠业务代码没用，只能减负。于是除首屏四兄弟外全部改
 * `defineAsyncComponent`：用户真把某张卡放上画布（或换模板带上它）时才下载解析。
 * 桌面端 chunk 走本地协议、网页版随部署一起上传，两种形态都是本地毫秒级。
 */

/**
 * 懒加载占位。卡片外壳（GridLayout 的 .cell）管尺寸与 hover 反馈，这里只填内容区。
 * 刻意**不造骨架屏**：本地 chunk 毫秒级到位，骨架闪一帧反而碍眼；一行小字说清
 * 「在加载」就够。失败态同理如实说，不摆重试按钮 —— 真失败了重试也大概率还是失败，
 * 刷新页面（清掉坏的 chunk 缓存）才是正确动作，文案直接指路。
 */
const cardLoading = defineComponent({
  name: 'CardLoading',
  setup: () => () => h('div', { class: 'card-fallback' }, '加载中…'),
})
const cardError = defineComponent({
  name: 'CardError',
  setup: () => () => h('div', { class: 'card-fallback card-fallback--error' }, '这个卡没加载上，刷新页面试试'),
})

/**
 * 除首屏四兄弟外，其余卡统一走懒加载。显式字面量路径而不是模板字符串 ——
 * bundler 对字面量 import() 做静态分析，一张卡一个 chunk，产物形态确定可预期；
 * 模板字符串要靠 glob 展开，反而不可控。
 */
function lazy(loader: () => Promise<{ default: Component }>): Component {
  return defineAsyncComponent({
    loader,
    loadingComponent: cardLoading,
    errorComponent: cardError,
    // 200ms 内到位就不闪占位 —— 本地 chunk 常态，免得内容区无故跳一下
    delay: 200,
  })
}

export const CARD_COMPONENTS: Record<string, Component> = {
  // 首屏四兄弟：默认模板 general 的五张卡（clock / todo / sticky / notes / recent），
  // 保持静态 import —— 首屏就要见面的代码没有理由晚一帧。
  clock: ClockCard,
  sticky: StickyCard,
  todo: TodoCard,
  notes: NotesCard,
  recent: NotesCard,
  // 其余 50 张按需加载。
  weather: lazy(() => import('../app/cards/WeatherCard.vue')),
  calendar: lazy(() => import('../app/cards/CalendarCard.vue')),
  progress: lazy(() => import('../app/cards/ProgressCard.vue')),
  worldclock: lazy(() => import('../app/cards/WorldClockCard.vue')),
  meeting: lazy(() => import('../app/cards/MeetingCard.vue')),
  countdown: lazy(() => import('../app/cards/CountdownCard.vue')),
  dtools: lazy(() => import('../app/cards/DateToolsCard.vue')),
  elapsed: lazy(() => import('../app/cards/ElapsedCard.vue')),
  stopwatch: lazy(() => import('../app/cards/StopwatchCard.vue')),
  timer: lazy(() => import('../app/cards/TimerCard.vue')),
  interval: lazy(() => import('../app/cards/IntervalCard.vue')),
  breath: lazy(() => import('../app/cards/BreathCard.vue')),
  heatmap: lazy(() => import('../app/cards/HeatmapCard.vue')),
  links: lazy(() => import('../app/cards/LinksCard.vue')),
  fixed: lazy(() => import('../app/cards/FixedCard.vue')),
  duty: lazy(() => import('../app/cards/DutyCard.vue')),
  yearcalendar: lazy(() => import('../app/cards/YearCalendarCard.vue')),
  dailyimage: lazy(() => import('../app/cards/DailyImageCard.vue')),
  webmonitor: lazy(() => import('../app/cards/WebMonitorCard.vue')),
  habit: lazy(() => import('../app/cards/HabitCard.vue')),
  birthday: lazy(() => import('../app/cards/BirthdayCard.vue')),
  focus: lazy(() => import('../app/cards/FocusCard.vue')),
  monthstat: lazy(() => import('../app/cards/MonthStatCard.vue')),
  ledger: lazy(() => import('../app/cards/LedgerCard.vue')),
  calc: lazy(() => import('../app/cards/CalculatorCard.vue')),
  unitconv: lazy(() => import('../app/cards/UnitCard.vue')),
  colorconv: lazy(() => import('../app/cards/ColorCard.vue')),
  textstat: lazy(() => import('../app/cards/TextStatCard.vue')),
  randomnum: lazy(() => import('../app/cards/RandomCard.vue')),
  baseconv: lazy(() => import('../app/cards/BaseCard.vue')),
  pick: lazy(() => import('../app/cards/PickCard.vue')),
  fx: lazy(() => import('../app/cards/FxCard.vue')),
  air: lazy(() => import('../app/cards/AirCard.vue')),
  repo: lazy(() => import('../app/cards/RepoCard.vue')),
  hn: lazy(() => import('../app/cards/HnCard.vue')),
  moon: lazy(() => import('../app/cards/MoonCard.vue')),
  holiday: lazy(() => import('../app/cards/HolidayCard.vue')),
  chart: lazy(() => import('../app/cards/ChartCard.vue')),
  commands: lazy(() => import('../app/cards/CommandsCard.vue')),
  matrix: lazy(() => import('../app/cards/MatrixCard.vue')),
  probe: lazy(() => import('../app/cards/ProbeCard.vue')),
  sysmon: lazy(() => import('../app/cards/SysMonCard.vue')),
  http: lazy(() => import('../app/cards/HttpCard.vue')),
  launcher: lazy(() => import('../app/cards/LauncherCard.vue')),
  htmlcard: lazy(() => import('../app/cards/HtmlCard.vue')),
  stocks: lazy(() => import('../app/cards/StockCard.vue')),
  rss: lazy(() => import('../app/cards/RssCard.vue')),
  minutes: lazy(() => import('../app/cards/MinutesCard.vue')),
  winview: lazy(() => import('../app/cards/WinViewCard.vue')),
}
