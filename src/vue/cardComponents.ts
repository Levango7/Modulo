import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'
import { isExtModule } from '@levango7/engine/extcard'
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
 *
 * **`delay` 是 32ms，不是 200（2026-10-18 实测改）**。原先写 200 的理由是"本地 chunk
 * 毫秒级到位，200ms 内不闪占位"，它只在**快网**成立。慢网实测（300ms RTT / 400kbps
 * + 禁缓存，逐帧采新加那张卡的卡体）：`+58ms 空卡 → +225ms 「加载中…」→ +406ms 内容`
 * —— **先空一格再出字**，而空卡那一格最伤：刚点完加卡看到一个空壳，读起来就是
 * "点了没反应"。
 *
 * 但**归零也不对**：`delay: 0` 时哪怕 chunk 已预热，第一帧也必然是「加载中…」
 * （`fallback@+0ms → content@+6ms`）——等于每次加卡都闪一下字，而 200ms 在预热路径上
 * 是 `content@+0ms`（一次中间态都没有）。两个极端各错一半。
 *
 * 所以取 32ms（两帧），配合 `preloadCard` 的预取：
 * · **预热路径**（库里按下即预取，见 `preloadCard`）chunk 在 32ms 内 resolve，占位不上屏；
 * · **冷路径**最多空 32ms —— 两帧，肉眼当没发生，随后立刻给「加载中…」，
 *   慢网的空白从 200ms 压到 32ms。
 * 门禁见 `tests/e2e/layout.spec.ts`「加卡不许先空一格」（把 chunk 拖到 600ms，
 * 空白帧上限 4；实测改前 14 帧红、改后 3 帧绿）。
 */
function lazy(loader: () => Promise<{ default: Component }>): Component {
  const comp = defineAsyncComponent({
    loader,
    loadingComponent: cardLoading,
    errorComponent: cardError,
    // 见上：够短，预热路径不闪；够长，冷路径的空白只有两帧
    delay: 32,
  }) as Component & { __load?: () => Promise<{ default: Component }> }
  /**
   * 把 loader 挂在组件上，供 `preloadCard` 提前取 chunk。
   * **为什么不另建一张 id → loader 的表**：那等于把那 50 条字面量 `import()` 再抄一遍，
   * 而"字面量路径可被 bundler 静态分析"正是下面这张表存在的理由 —— 抄一份就是两份真相。
   */
  comp.__load = loader
  return comp
}

/** 已经发起过预取的 id（失败会移除，允许下次交互重试） */
const preloading = new Set<string>()

/**
 * 预取某张卡的 chunk —— 在用户**还没松手**的空档里先取回来。
 *
 * 依据是实测：从卡片 mount 到 chunk 到位要 9~69ms（本机静态服务），慢网 380~400ms。
 * 这段时间里卡体先是空白（`delay` 之前）、随后是「加载中…」。而加卡有两条天然的空档
 * 可以提前开跑：模块库的 `.lib-item`、目录菜单的每一项，都在 `pointerenter` 时就取 ——
 * 鼠标用户是"指过去"的那一段，触摸端 `pointerenter` 随 pointerdown 一起触发（规范如此），
 * 于是整个拖拽过程都在预取窗口里。用掉它们，常见路径就能**一次中间态都不出现** ——
 * 慢网 3G 实测：不预取 `empty→fallback→content@405ms`，先悬停 700ms 再点
 * `empty→content@6ms`。
 *
 * 失败静默：真 mount 时 `defineAsyncComponent` 会走 `errorComponent` 那条路如实报错，
 * 这里再提示一次就是重复。故只清标记、把重试留给下一次交互。
 */
export function preloadCard(id: string): void {
  if (preloading.has(id)) return
  const load = (cardComponentOf(id) as { __load?: () => Promise<unknown> } | undefined)?.__load
  if (!load) return
  preloading.add(id)
  void load().catch(() => preloading.delete(id))
}

/**
 * 模块 id → 渲染组件的**统一入口**。静态表覆盖内置卡；`ext:` 前缀的扩展卡全部落到
 * `ExtCard`（运行态由 `moduleId` prop 区分是哪张扩展）—— 注册表是动态的、组件表不能是，
 * 所以分叉必须收在这一个函数里，渲染点（工作台 / 浮窗 / 缩略图）一律走它，
 * 不许再各自直查 `CARD_COMPONENTS`。
 */
export function cardComponentOf(moduleId: string): Component | undefined {
  if (isExtModule(moduleId)) return ExtCardComp
  return CARD_COMPONENTS[moduleId]
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

/** 所有扩展卡的渲染组件都是它（管理态 = 模块 id `extcard`；运行态 = `ext:<id>`，由 moduleId prop 区分） */
const ExtCardComp = lazy(() => import('../app/cards/ExtCard.vue'))
