/**
 * `cardData` 全族的类型定义（Todo / Note / LedgerRow / CardData 接口……）。
 *
 * 从 cardData.ts 拆出（2026-10-20，#124）：类型是这份文件里被引用面最广的一部分
 * （十几张卡组件 import 它们），而它们零运行时、零 import —— 独立成文件让「找类型」
 * 与「改存储」两件事不再互相打扰。除引擎的类型别名外不 import 任何东西，
 * 也不要往这里引入运行时依赖 —— 它是被引用面最广的零运行时文件。
 */
import type {
  CommandEntry,
  ExtCard,
  FeedSource,
  HtmlCard,
  HttpEndpoint,
  LaunchItem,
  ProbeTarget,
  QuickLink,
  StockEntry,
  Watch,
} from '@levango7/engine'

/** 四个计时器在 `timers` 里的键名。动作共用一份实现（状态形状一样），所以键名也集中一处 */
export type TimerKey = 'stopwatch' | 'countdown' | 'interval' | 'breath'

export interface Todo {
  id: string
  text: string
  done: boolean
  /**
   * 标记完成那一刻的毫秒时间戳。**可选、向后兼容**：v1 数据与旧备份里没有它，
   * 月度统计据此只统计"知道自己何时完成"的那些条目，而不是猜一个月。
   * 取消勾选要清掉它 —— 否则"完成时间"会指向一个不再成立的过去。
   */
  doneAt?: number
}

/**
 * 四象限待办（艾森豪威尔矩阵）。与普通待办**分开存**而不是共用一份：
 * 矩阵的语义是"按象限归类"，混进 todos 会让那张卡多一套"有/没有象限"的分支。
 * q 四个值：重要且紧急（do）/ 重要不紧急（plan）/ 紧急不重要（delegate）/ 不重要不紧急（drop）。
 */
export type Quadrant = 'do' | 'plan' | 'delegate' | 'drop'

export interface MatrixTodo {
  id: string
  text: string
  q: Quadrant
  done: boolean
  doneAt?: number
}

export const QUADRANTS: readonly Quadrant[] = ['do', 'plan', 'delegate', 'drop']

export interface Note {
  id: string
  title: string
  body: string
  at: number
}

/**
 * 倒数日：**用户写的内容**（名字 + 日子），所以它放在这里、跟着完整备份一起走。
 * 判断标准就一句：用户敲进去的东西进 `cardData`（因此进备份）；"选哪个城市/皮肤"这类偏好
 * 留在各自的 key（换机器重选一次即可）—— 与 §7 的取舍同一条线。
 */
export interface CountdownSetting {
  label: string
  /** `YYYY-MM-DD`，空串 = 还没设 */
  date: string
}

/** 正计时：从哪天起算（"第 N 天"）。与倒数日共用日期口径（`isValidDate`） */
export interface ElapsedSetting {
  label: string
  date: string
}

/** 习惯打卡：名字 + 打过卡的日期集合 */
export interface HabitSetting {
  name: string
  days: string[]
}

/**
 * 生日提醒：**用户写的内容**（名字 + 月日 + 可选出生年），所以进 `cardData`、跟着完整备份走。
 * 与倒数日分开存而不是复用它：生日是"每年一次"、没有年，混进 `countdown` 会让那张卡多一套分支。
 */
export interface StoredBirthday {
  id: string
  name: string
  /** 1–12 */
  month: number
  /** 1–31 */
  day: number
  /** 可选；填了才显示年龄 */
  year?: number
}

/** 抽签名单：用户写的内容，进备份。权重 ≥ 0，0 = 永远抽不到 */
export interface PickItem {
  id: string
  label: string
  weight: number
}

/** 记账条目：**金额存「分」的整数**，不用小数 —— 一个月几十笔浮点加下来会让总额差几分钱 */
export interface LedgerRow {
  id: string
  /** `YYYY-MM-DD` */
  date: string
  /** 单位「分」。整数，永不为负 */
  cents: number
  category: string
  note: string
}

/**
 * 会议规划器：参会城市 + 会议在**本地**的墙上时间与时长。
 *
 * 只存"我说几点开"，不存每个城市几点 —— 后者是算出来的，存下来就会与夏令时变更对不上。
 * 偏好（城市选择、时间、时长）本不进备份，但这份列表是用户自己一组人，反复重选很烦，
 * 因此按"用户输入过的东西进备份"的同一条线存下来。
 */
export interface MeetingSetting {
  /** 参会城市 id（`worldclock.ts` 的候选表内），最多 4 个 */
  cityIds: string[]
  /** 本地墙上时间 `HH:mm` */
  at: string
  /** 时长（分钟） */
  minutes: number
  title: string
}

/**
 * 计时器的持久化形状。
 *
 * **只存「计时器的设定 + 上次停在哪」，不存"当前已跑多少秒"**。
 * 已跑量由 `startedAt` 这个时间戳 + 打开时的 `Date.now()` 算出来 ——
 * 这样跨重启、跨休眠、换机器导入备份之后，时间都是对的；
 * 存一个累加值则永远只对"写它的那一瞬间"成立。
 *
 * `startedAt` 是 epoch 毫秒。诚实说明：**这一版不做跨重启恢复运行态** ——
 * 读回来时把它当 0 处理（钟停在设定值、显示"开始"）。理由写进 CHANGELOG，
 * 因为"看起来该有其实没有"比"没有"更糟。
 */
export interface TimerStore {
  /** 秒表：上次停在哪（毫秒）与上次启动时刻 */
  stopwatch: { accumulatedMs: number; startedAt: number | null }
  /** 倒计时：设定时长（分钟）与进度 */
  countdown: { minutes: number; accumulatedMs: number; startedAt: number | null }
  /** 间歇计时：预设 id + 已完成段数 + 本段进度 */
  interval: { presetId: string; completedFocus: number; phaseIndex: number; accumulatedMs: number; startedAt: number | null }
  /** 呼吸计时：节奏 id + 进度 */
  breath: { patternId: string; accumulatedMs: number; startedAt: number | null }
}

/** 值班表：名单 + 轮转锚点（班次用引擎的默认三班，不给用户配 —— 可配置的排班规则是另一个产品） */
export interface DutySetting {
  /** 按顺序轮转的姓名 */
  roster: string[]
  /** 轮转起点 `YYYY-MM-DD` */
  anchor: string
}

/**
 * **按实例**的内容（F-01 阶段 2，2026-10-28）。键是**实例 id**（第二张起是 `模块:2`）。
 *
 * 为什么是"叠加层"而不是"每个实例一份完整 `CardData`"：`CardData` 有二十多个字段，
 * 一次全搬要连带 54 张卡的取数路径、备份与迁移一起改。按字段**逐个**搬过来，
 * 每搬一个都有它自己的用例与取舍；没搬的那些字段语义与今天完全一致（按模块共享）——
 * 这就是阶段 2 的形状，也是它为什么分几笔做。
 *
 * 已经搬过来的：`sticky`（便签，2026-10-28）、`todos`（待办，2026-10-29）。
 *
 * 字段一律**可选**：缺省表示"这个实例还没写过自己的内容"，读取口径见 `instanceData.ts`。
 */
export interface InstanceData {
  /** 便签正文（2026-10-28 起按实例分） */
  sticky?: string
  /**
   * 待办清单（2026-10-29 起按实例分）。第二个字段，形状与顶层 `todos` 逐字相同 ——
   * 不另造结构，读盘那道直接复用同一套条目清洗（`sanitizeCardData` 里的 `sanitizeTodos`）。
   */
  todos?: Todo[]
}

export interface CardData {
  sticky: string
  todos: Todo[]
  notes: Note[]
  countdown: CountdownSetting
  elapsed: ElapsedSetting
  habit: HabitSetting
  birthdays: StoredBirthday[]
  pickList: PickItem[]
  ledger: {
    /** 币种符号，用户填一次全表跟着走 */
    symbol: string
    entries: LedgerRow[]
  }
  meeting: MeetingSetting
  timers: TimerStore
  /** 快捷链接：点一下复制（不做"打开"—— 那要 opener 插件，见 links.ts 文件头） */
  links: QuickLink[]
  /** 命令速查：点一下复制命令（清洗在引擎 commands.ts，与 links 同一套分层） */
  commands: CommandEntry[]
  /** 四象限待办：用户写的字，进备份（与 todos 分开存，见 MatrixTodo 注释） */
  matrix: MatrixTodo[]
  /** 连通性探测的端点名单；**历史样本是机器采的，不进备份**（存独立 key） */
  probes: ProbeTarget[]
  /** 股票自选：名单是用户写的，进备份；行情是机器采的，只在内存里 */
  stocks: StockEntry[]
  /** RSS 订阅名单，进备份；抓到的条目存独立 key */
  feeds: FeedSource[]
  /** 网页监控的名单。边界（只 https、不许私网 IP）见 watch.ts 文件头 */
  watch: Watch[]
  /**
   * 网页取数端点（声明式扩展，2026-10-13 批 3）：用户填 URL + 取值路径，宿主抓取渲染。
   * 判据与 watch 同源（sanitizeEndpoints 内部复用 normalizeUrl）；**取到的数据不进备份**
   * —— 备份要外发，别人的接口数据不该跟着走。
   */
  endpoints: HttpEndpoint[]
  /** 速达收藏（用户写的，进备份）：点一下就打开的程序/网页/文件 */
  launch: LaunchItem[]
  /**
   * HTML 扩展（自定卡，用户写的，进备份）：一段 HTML 片段渲染成一张卡。
   * 渲染走 `sandbox="allow-scripts"` 的 iframe（隔离边界见引擎 htmlcard.ts 文件头）。
   */
  htmlCards: HtmlCard[]
  /**
   * 原生卡扩展（2026-10-27，路线第三层）：用户导入的卡包（manifest + 入口 HTML），
   * 宿主校验后注册成**一等公民卡片**（进模块库、有尺寸契约、可多开/可浮窗）。
   * 入口跑在与自定卡同一条隔离边界里（沙箱 iframe）；manifest 校验在引擎 `extcard.ts`。
   */
  extCards: ExtCard[]
  /**
   * 扩展卡的持久状态（桥 `setState` 写入），键 = 扩展 id。**按扩展共享**而非按实例 ——
   * 与「卡内容按模块共享」的既有口径一致（两张待办卡本来就是同一份 todos）。
   * 用户内容，进备份；读盘时逐键过 `sanitizeExtState`（朴素 JSON + 字节上限）。
   */
  extState: Record<string, unknown>
  /** 固定整数位计算的输入草稿；结果全在引擎算，这里只存两个输入 */
  fixed: { base: string; rate: string; symbol: string }
  duty: DutySetting
  /**
   * 按实例的内容（F-01 阶段 2）。**只有真正属于某一个实例的字段放这里**；
   * 顶层那些字段仍是"不分实例时"的内容，也是**第一实例与旧档**存的地方 —— 不重复存两份。
   *
   * 为什么"第一实例仍写顶层"：旧档、模板、单实例的形状因此**逐字不变**（键缺省即无此段），
   * 备份摘要与搜索这类按模块读的口径也不用改。代价写在 `instanceData.ts` 文件头。
   */
  byInstance?: Record<string, InstanceData>
}
