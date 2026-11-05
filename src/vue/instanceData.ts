/**
 * 按实例取数的**判定层**（F-01 阶段 2，2026-10-28）。
 *
 * ## 为什么单独一个文件
 *
 * 本仓没有组件测试设施（无 `@vue/test-utils`、无 jsdom），判定嵌在组件里就只剩 E2E 一层兜底。
 * 抽成纯函数进受测层锁 100 —— 与 `floatList.ts` / `moduleFilter.ts` 同一条理由。
 *
 * ## 口径（三条，逐条都有理由）
 *
 * 1. **第一实例仍用顶层那一份。** 实例 id 等于模块 id（或两者有一个拿不到）时读写都走顶层。
 *    理由：旧档、模板、单实例的形状必须**逐字不变** —— 顶层那些字段本来就是"不分实例时的
 *    内容"，第一实例继续用它，就不需要迁移、也不需要把同一份内容存两遍。
 * 2. **第二实例读自己那一份；没有就是空白。**
 *    不回落顶层 —— 回落的话，新拖出来的第二张便签会显示第一张的字，那正是阶段 1 那个
 *    "两个实例共享同一份内容"的缺陷，阶段 2 是来消掉它而不是保留它。
 *    代价（如实记）：升级前就已经摆着两张便签的用户，第二张会从"跟着第一张显示"变成空白。
 *    内容没丢 —— 它一直在第一张上。这条写进 CHANGELOG。
 * 3. **写才建立。** 第二实例第一次输入时才生成 `byInstance[实例 id]`，
 *    不在渲染时播种（渲染有副作用会让撤销历史与写盘都变得说不清）。
 *
 * ## 不做的事
 *
 * - **不解析 `:2` 后缀**：是不是"第二实例"由"实例 id ≠ 模块 id"判定，不靠字符串形状
 *   （与 `moduleIdOf` 只认 `p.module ?? p.id` 同一条纪律）。
 * - 按实例分的字段：`sticky` / `todos` / `countdown` / `elapsed` / `matrix`（四象限，
 *   **合并序第七个字段**）/ `ledger`（记账的**条目**，第五个字段）/ `habit`（习惯，
 *   2026-11-01，第六个字段）/ `notes`（速记，2026-11-05，第八个、也是阶段 2 最后
 *   一个字段 —— 如实记：它今天没有 UI 写入入口，本笔只铺数据层）。序数按**合并序**排 ——
 *   master 那两笔先合入，故本笔排其后，口径见 ARCHITECTURE §12.51。
 *   其余字段（生日 / 抽签 / 快捷链接 / 启动器 / 自定卡 / 原生卡……）仍是按模块共享 ——
 *   它们不属于 F-01 阶段 2 点名的"记录类卡"七（今八）个字段，没有各自的下一笔。
 *   记账的币种符号也留顶层：它是偏好不是内容（`LedgerCard.vue` 文件头自己这么写），
 *   两条账本共用一种货币。
 *
 * ## 单卡取数 vs 聚合取数（2026-11-01 补）
 *
 * 上面那些 `*Of` 回答的是「**这张卡**有什么」；文件末尾的 `all*` / `any*` 回答的是
 * 「**这块板**一共有什么」。前者第二张没有就返回空、**不回落**顶层；后者把顶层与每个
 * 切片加在一起、**一张都不漏**。两种问法方向相反，各自都对 —— 混用才是错的。
 */
import type { CardData, CountdownSetting, ElapsedSetting, HabitSetting, LedgerRow, MatrixTodo, Note, Todo } from './cardDataTypes'

/**
 * 取数只需要这些字段，测试不必造一整份 `CardData`。
 *
 * `ledger` 不直接 `Pick<CardData, 'ledger'>`：`entries` 在别的取数来源（如 AI 摘录的
 * `ExcerptSource`）是**只读数组**，判定层只读不写，放宽到 `readonly` 才能共用同一个入口。
 * 字段可选 —— 形状不对 / 没有这个字段的来源一律按空账处理（读路径 `?? []`）。
 * `habit` 没有第二个取数来源共用这个入口，按 `HabitSetting` 原样即可（同样可选）。
 */
export type InstanceSource = Pick<CardData, 'sticky' | 'todos' | 'countdown' | 'elapsed' | 'byInstance'> & {
  ledger?: { symbol?: string; entries?: readonly LedgerRow[] }
  habit?: HabitSetting
  /** 四象限：顶层那份在 `CardData` 里是**必填**，但取数来源未必带它（测试夹具、旧档）⇒ 放宽成可选 */
  matrix?: MatrixTodo[]
  /** 速记：同四象限的理由（AI 摘录的 `ExcerptSource` 没有它、只读来源）⇒ 放宽成可选 + 只读 */
  notes?: readonly Note[]
}

/** 空"名字 + 日子"：与顶层那个空形状（`emptyCardData`）逐字相同，渲染侧不必为实例分叉判空 */
const BLANK_DAY = { label: '', date: '' }

/** 空习惯：与顶层那个空形状（`emptyCardData`）逐字相同 —— 第二张还没写过时读出来的就是这个 */
const BLANK_HABIT: HabitSetting = { name: '', days: [] }

/**
 * 便签正文：按实例读。
 *
 * @param moduleId   该实例所属模块（工作台传 `r.module ?? r.id`，浮窗传解析出的模块 id）
 * @param instanceId 实例 id；拿不到（undefined / 空）时按"不分实例"处理
 */
export function stickyOf(data: InstanceSource, moduleId?: string, instanceId?: string): string {
  if (!isSecondInstance(moduleId, instanceId)) return data.sticky ?? ''
  return data.byInstance?.[instanceId as string]?.sticky ?? ''
}

/**
 * 便签正文：按实例写。**方法本身不改语义，只决定写在哪** ——
 * 上限与清洗在读盘那道（`cardDataSanitize.ts`），这里不重复实现一遍。
 */
export function writeSticky(
  data: InstanceSource,
  moduleId: string | undefined,
  instanceId: string | undefined,
  value: string,
): void {
  if (!isSecondInstance(moduleId, instanceId)) {
    data.sticky = value
    return
  }
  const bag = data.byInstance ?? {}
  // 整条替换而不是原地改字段：Vue 的深层 watch 依赖"值变了"才触发写盘，
  // 换一个新对象比"改了里面一个字符串"的信号更明确（也更好断言）。
  bag[instanceId as string] = { ...bag[instanceId as string], sticky: value }
  data.byInstance = bag
}

/**
 * 待办清单：按实例读。
 *
 * 口径与便签**完全相同**（第一条：第一实例仍用顶层那一份；第二条：第二实例没有就是空清单，
 * 不回落顶层 —— 回落会让新拖出来的第二张待办卡显示第一张的清单）。
 * 差别只有一处：没有内容时的"空"是空数组而不是空串（渲染侧直接 `filter`，不必再判空）。
 */
export function todosOf(data: InstanceSource, moduleId?: string, instanceId?: string): Todo[] {
  if (!isSecondInstance(moduleId, instanceId)) return data.todos ?? []
  return data.byInstance?.[instanceId as string]?.todos ?? []
}

/**
 * 待办清单：按实例写。**只决定写在哪，不改语义** —— 加/勾/删由调用方先在数组上做，
 * 这里整条替换回去（与 `writeSticky` 同一条理由：深层 watch 靠"值变了"才触发写盘）。
 */
export function writeTodos(
  data: InstanceSource,
  moduleId: string | undefined,
  instanceId: string | undefined,
  next: Todo[],
): void {
  if (!isSecondInstance(moduleId, instanceId)) {
    data.todos = next
    return
  }
  const bag = data.byInstance ?? {}
  bag[instanceId as string] = { ...bag[instanceId as string], todos: next }
  data.byInstance = bag
}

/**
 * 倒数日：按实例读。第三个字段（2026-10-30），口径与前两个**完全相同** ——
 * 差别只有"空"的形状：便签是空串、待办是空数组、这两个是空"名字 + 日子"
 * （与顶层同一个空形状，渲染侧不必为实例分叉判空）。
 */
export function countdownOf(data: InstanceSource, moduleId?: string, instanceId?: string): CountdownSetting {
  if (!isSecondInstance(moduleId, instanceId)) return data.countdown ?? BLANK_DAY
  return data.byInstance?.[instanceId as string]?.countdown ?? BLANK_DAY
}

/** 倒数日：按实例写（整条替换，理由同 `writeSticky`：深层 watch 靠"值变了"才触发写盘） */
export function writeCountdown(
  data: InstanceSource,
  moduleId: string | undefined,
  instanceId: string | undefined,
  next: CountdownSetting,
): void {
  if (!isSecondInstance(moduleId, instanceId)) {
    data.countdown = next
    return
  }
  const bag = data.byInstance ?? {}
  bag[instanceId as string] = { ...bag[instanceId as string], countdown: next }
  data.byInstance = bag
}

/**
 * 正计时：按实例读。第四个字段（2026-10-30），与 `countdownOf` 同形状、同口径 ——
 * 与倒数日一起搬：清洗 / 备份 / 卡片三路写的是同一段代码，分两笔等于读两遍。
 */
export function elapsedOf(data: InstanceSource, moduleId?: string, instanceId?: string): ElapsedSetting {
  if (!isSecondInstance(moduleId, instanceId)) return data.elapsed ?? BLANK_DAY
  return data.byInstance?.[instanceId as string]?.elapsed ?? BLANK_DAY
}

/** 正计时：按实例写（整条替换，理由同 `writeCountdown`） */
export function writeElapsed(
  data: InstanceSource,
  moduleId: string | undefined,
  instanceId: string | undefined,
  next: ElapsedSetting,
): void {
  if (!isSecondInstance(moduleId, instanceId)) {
    data.elapsed = next
    return
  }
  const bag = data.byInstance ?? {}
  bag[instanceId as string] = { ...bag[instanceId as string], elapsed: next }
  data.byInstance = bag
}

/**
 * 四象限清单：按实例读。**合并序第七个字段**（2026-10-30 撰写；master 的
 * 记账 / 习惯两笔先合入，故本笔排其后，口径见 ARCHITECTURE §12.51），
 * 口径与前六个**完全相同** ——
 * 差别只有"空"的形状：便签是空串、待办与四象限是空数组、倒数日 / 正计时是空"名字 + 日子"。
 * 不回落顶层 —— 回落会让新拖出来的第二张四象限卡显示第一张的条目。
 */
export function matrixOf(data: InstanceSource, moduleId?: string, instanceId?: string): MatrixTodo[] {
  if (!isSecondInstance(moduleId, instanceId)) return data.matrix ?? []
  return data.byInstance?.[instanceId as string]?.matrix ?? []
}

/**
 * 四象限清单：按实例写。**只决定写在哪，不改语义** —— 加/勾/挪/删由调用方先在数组上做，
 * 这里整条替换回去（与 `writeSticky` / `writeTodos` 同一条理由：深层 watch 靠"值变了"才触发写盘）。
 */
export function writeMatrix(
  data: InstanceSource,
  moduleId: string | undefined,
  instanceId: string | undefined,
  next: MatrixTodo[],
): void {
  if (!isSecondInstance(moduleId, instanceId)) {
    data.matrix = next
    return
  }
  const bag = data.byInstance ?? {}
  bag[instanceId as string] = { ...bag[instanceId as string], matrix: next }
  data.byInstance = bag
}

/**
 * 记账条目：按实例读。第五个字段（2026-10-31），口径与前四个**完全相同** ——
 * 差别只有一处：**币种符号不算内容、不分实例**。卡片文件头写的就是"币种符号是一个偏好"，
 * 偏好跟着模块走（顶层那份），两条账本共用一种货币；分实例的是用户一笔一笔敲进去的条目。
 * 所以这里返回的只是条目数组，符号由调用方自己读顶层（`LedgerCard.vue`）。
 */
export function ledgerEntriesOf(data: InstanceSource, moduleId?: string, instanceId?: string): readonly LedgerRow[] {
  if (!isSecondInstance(moduleId, instanceId)) return data.ledger?.entries ?? []
  return data.byInstance?.[instanceId as string]?.ledger ?? []
}

/**
 * 记账条目：按实例写（整条替换，理由同 `writeTodos`：深层 watch 靠"值变了"才触发写盘）。
 *
 * 顶层那一侧替换的是**条目数组**，但外壳得展开一层（`{ ...data.ledger }`）——
 * 直接整体赋值会把币种符号弄丢，符号是顶层共享的偏好，不该跟着条目一起被换掉。
 */
export function writeLedgerEntries(
  data: InstanceSource,
  moduleId: string | undefined,
  instanceId: string | undefined,
  rows: LedgerRow[],
): void {
  if (!isSecondInstance(moduleId, instanceId)) {
    data.ledger = { ...data.ledger, entries: rows }
    return
  }
  const bag = data.byInstance ?? {}
  bag[instanceId as string] = { ...bag[instanceId as string], ledger: rows }
  data.byInstance = bag
}

/**
 * 习惯打卡（名字 + 打卡记录）：按实例读。第六个字段（2026-11-01），
 * 口径与前五个**完全相同** —— 差别只有"空"的形状：空名字 + 空日子数组
 * （与顶层同一个空形状，渲染侧不必为实例分叉判空）。与记账不同：习惯**整份都是内容**
 * （名字是用户起的、日子是用户点的），没有"哪一半留顶层"的切法。
 */
export function habitOf(data: InstanceSource, moduleId?: string, instanceId?: string): HabitSetting {
  if (!isSecondInstance(moduleId, instanceId)) return data.habit ?? BLANK_HABIT
  return data.byInstance?.[instanceId as string]?.habit ?? BLANK_HABIT
}

/** 习惯打卡：按实例写（整条替换，理由同 `writeTodos`：深层 watch 靠"值变了"才触发写盘） */
export function writeHabit(
  data: InstanceSource,
  moduleId: string | undefined,
  instanceId: string | undefined,
  next: HabitSetting,
): void {
  if (!isSecondInstance(moduleId, instanceId)) {
    data.habit = next
    return
  }
  const bag = data.byInstance ?? {}
  bag[instanceId as string] = { ...bag[instanceId as string], habit: next }
  data.byInstance = bag
}

/**
 * 速记条目：按实例读（2026-11-05，第八个、也是阶段 2 最后一个字段）。
 *
 * 三条口径与便签 / 待办逐条相同（第一实例读顶层；第二实例读自己那份、空不回落；
 * 两 id 缺一回落顶层）。返回**新数组**（`?? []` 与拷贝二选一都不够——
 * `readonly Note[]` 的来源可能就是顶层那个数组本身，调用方 slice/ filter 之前
 * 得先有一份自己的，不然改起来会原地污染顶层）。
 */
export function notesOf(data: InstanceSource, moduleId?: string, instanceId?: string): Note[] {
  if (!isSecondInstance(moduleId, instanceId)) return [...(data.notes ?? [])]
  return [...(data.byInstance?.[instanceId as string]?.notes ?? [])]
}

/**
 * 速记条目：按实例写。**整条替换**（理由同 `writeTodos` / `writeHabit`：
 * 深层 watch 靠"值变了"才触发写盘，原地 unshift 既不动界面也不落盘）。
 * 上限与清洗在读盘那道（`cardDataSanitize.ts`），这里不重复实现。
 */
export function writeNotes(
  data: InstanceSource,
  moduleId: string | undefined,
  instanceId: string | undefined,
  next: readonly Note[],
): void {
  if (!isSecondInstance(moduleId, instanceId)) {
    data.notes = [...next]
    return
  }
  const bag = data.byInstance ?? {}
  bag[instanceId as string] = { ...bag[instanceId as string], notes: [...next] }
  data.byInstance = bag
}

/**
 * **所有**速记（顶层那一份 + 各实例自己的那一份），给聚合口径那几路用 ——
 * 备份摘要「N 条速记」/ 导出文案 / 命令面板内容域 / `@卡片` 全量上下文 / `recent`
 * （最近改动）卡。与 §12.50 同一条理由：只看顶层的话，第二张速记卡的内容"看得见、
 * 算不进"——比报错更难被发现。`recent` 卡与备份文案要的是"这块板一共有什么"，
 * 这正是聚合口径的反向问法（单卡问"这张卡有什么"走 `notesOf`）。
 *
 * 与 `allTodos` 的唯一差别：**按 `at` 倒序排**（recent 卡的语义就是"最近动过的"）。
 * 同刻两条不保证次序 —— 稳定性不重要（界面上同一分钟内的两条速记谁前谁后无意义），
 * 不引入额外比较键。
 */
export function allNotes(data: InstanceSource): Note[] {
  const out: Note[] = [...(data.notes ?? [])]
  for (const slice of Object.values(data.byInstance ?? {})) {
    if (slice?.notes) out.push(...slice.notes)
  }
  return out.sort((a, b) => b.at - a.at)
}

/**
 * **所有**倒数日（顶层那一份 + 各实例自己的那一份），给提醒那一路用。
 *
 * 为什么提醒要换这个口径：倒数日按实例分之前，提醒只看顶层没问题；分了之后还只看
 * 顶层，第二张倒数日卡到期就是"界面上红红火火、提醒静默吞掉"—— 这类"看着对、
 * 实际漏"的缝最危险，所以提醒这一路必须拿到**全部**。
 *
 * 不需要实例 id 到模块的映射：切片里出现 `countdown` 字段 ⇒ 一定是某张倒数日卡写的
 * （`writeCountdown` 是唯一写入点，读盘那道只收白名单字段）—— 不解析 `:2` 后缀，
 * 与文件顶部「不做的事」同一条纪律。空的（没设日子的）也原样返回，判要不要提醒
 * 由 `reminders.ts` 自己做（它本来就要判空 label / 空日期）。
 */
export function allCountdowns(data: InstanceSource): CountdownSetting[] {
  const mine = Object.values(data.byInstance ?? {})
    .map((slice) => slice?.countdown)
    .filter((c): c is CountdownSetting => !!c)
  return [data.countdown ?? BLANK_DAY, ...mine]
}

/**
 * **所有**习惯（顶层那一份 + 各实例自己的那一份），给提醒那一路用 —— 与 `allCountdowns`
 * 同一条理由：习惯按实例分之后还只看顶层，第二张的"今天还没打卡"就会静默吞掉。
 *
 * 与倒数日的差别：`allCountdowns` 不带 id，因为同一天到站的几张**合一条提醒**（标题把
 * 名字都列上）；习惯不合 —— 两张习惯名字不同、各欠各的，每张各自一条，所以 key 必须
 * 带实例身份（`reminders.ts` 用 `id` 拼它），否则两张互相吃掉对方的"今天还没打卡"。
 * 空的（没起名的）也原样返回，判要不要提醒由 `reminders.ts` 自己做（它本来就要判空名字）。
 */
export interface HabitEntry {
  /** null = 顶层那一份（第一实例）；否则是实例 id（`byInstance` 的键） */
  id: string | null
  habit: HabitSetting
}

export function allHabits(data: InstanceSource): HabitEntry[] {
  const mine: HabitEntry[] = []
  for (const [id, slice] of Object.entries(data.byInstance ?? {})) {
    const habit = slice?.habit
    if (habit) mine.push({ id, habit })
  }
  return [{ id: null, habit: data.habit ?? BLANK_HABIT }, ...mine]
}

/**
 * **聚合口径**（2026-11-01，阶段 2 收尾）：把这块板当整体看的那些视图（图表卡 / 热力图 /
 * 今日聚焦 / 月度统计 / 备份文案）要的是"所有实例加起来"，不是"第一张写了什么"。
 *
 * 与 `allCountdowns` 同一条纪律：不解析 `:2` 后缀 —— 切片里出现哪个字段，就说明是哪张卡写的
 * （`writeTodos` / `writeLedgerEntries` / `writeHabit` / `writeSticky` 是唯一写入点，
 * 读盘那道只收白名单字段）。第一实例本来就在顶层，所以两边不会重复计数。
 *
 * 为什么不是"回落第一张"：那是阶段 1 的缺陷本身 —— 摆两张卡，聚合视图只报第一张，
 * 第二张的内容在界面上"看得见、算不进"，比报错更难被发现。
 */
export function allTodos(data: InstanceSource): Todo[] {
  const out: Todo[] = [...(data.todos ?? [])]
  for (const slice of Object.values(data.byInstance ?? {})) {
    if (slice?.todos) out.push(...slice.todos)
  }
  return out
}

/** 记账条目：顶层 + 各实例。**币种符号不在里面** —— 它是偏好只有顶层那一份（见 `ledgerEntriesOf`） */
export function allLedgerEntries(data: InstanceSource): LedgerRow[] {
  const out: LedgerRow[] = [...(data.ledger?.entries ?? [])]
  for (const slice of Object.values(data.byInstance ?? {})) {
    if (slice?.ledger) out.push(...slice.ledger)
  }
  return out
}

/**
 * 打卡日期的**并集**。为什么不是拼接：打卡位是"这天打过没有"（0/1），两张习惯卡在同一天
 * 都打过，图上仍然是那一天一个点；拼起来同一天会出现两条，"几天打过卡"与连续天数都会变得说不清。
 * 并集是这个形状下唯一诚实的"求和"。
 */
export function allHabitDays(data: InstanceSource): string[] {
  const set = new Set<string>(data.habit?.days ?? [])
  for (const slice of Object.values(data.byInstance ?? {})) {
    for (const day of slice?.habit?.days ?? []) set.add(day)
  }
  return [...set]
}

/**
 * 习惯名字的合并标签（图表卡抬头用）：一张卡报它的名字，几张卡报张数。
 * 不拼接名字 —— 两张卡叫「喝水」「跑步」，拼成「喝水、跑步」在标题栏那种宽度里会被截掉。
 */
export function habitLabel(data: InstanceSource): string {
  const names = new Set<string>()
  const top = (data.habit?.name ?? '').trim()
  if (top) names.add(top)
  for (const slice of Object.values(data.byInstance ?? {})) {
    const name = (slice?.habit?.name ?? '').trim()
    if (name) names.add(name)
  }
  if (names.size === 0) return ''
  if (names.size === 1) return [...names][0]
  return `${names.size} 张习惯卡`
}

/** 有没有**任何一张**卡设过倒数日（备份确认框「设过倒数日」那句） */
export function anyCountdownSet(data: InstanceSource): boolean {
  return allCountdowns(data).some((c) => !!c.date)
}

/** 有没有**任何一张**便签写过正文（备份确认框「有便签正文」那句） */
export function anySticky(data: InstanceSource): boolean {
  if ((data.sticky ?? '').trim() !== '') return true
  for (const slice of Object.values(data.byInstance ?? {})) {
    if ((slice?.sticky ?? '').trim() !== '') return true
  }
  return false
}

/**
 * 是不是"第二（及以后）个实例"。
 *
 * 两个 id 都要有才敢判 —— 只拿到实例 id 时按"不分实例"处理，
 * 这样任何还没传模块 id 的渲染点都回落到**今天的行为**，不会静默变空。
 */
function isSecondInstance(moduleId?: string, instanceId?: string): boolean {
  if (!moduleId || !instanceId) return false
  return moduleId !== instanceId
}
