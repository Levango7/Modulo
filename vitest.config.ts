import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 两条覆盖门禁，圈的是两层不同的东西。
 *
 * ① `packages/engine/src/**` 分支 ≥90（§8 验收第 5 条）。以前这条只写在文档里，谁也没测过。
 *    引擎是「纯函数、必须可测」的那一层，所以门禁卡死。2026-10-03 抽成 `@levango7/engine` 包之后
 *    路径从 `src/engine/**` 挪到这里 —— 门禁跟着资产走，不是跟着目录名走。
 *
 * ② `src/vue/**` 里**可单测的那几个纯模块** 分支 ≥90。这一条是 2026-10-03 补的：
 *    原来只有引擎有门禁，于是 `keyboard.ts`（键盘意图判定）、`backup.ts`（备份包解析）
 *    这种"判定逻辑"跟 DOM 胶水混在同一个目录里，也一样没有防线。
 *    **只圈下面列出的文件**，不圈整个 `src/vue` —— `useCanvasDrag` / `useFocusTrap` /
 *    `useBackup` 这些要真 DOM 与真事件，属于 E2E 的地盘（§10.3 的 19 条），
 *    把它们塞进单测门禁只会逼人写假测试。
 *
 * ── "余量故意不大"这句话，2026-10-13 修正 ────────────────────────────────
 * 这里原先写着「以后往这几个文件加带分支而没测到的代码，CI 就该红」。
 * **那句话当时不成立。** `thresholds.branches: 90` 卡的是下面这些文件的**聚合值**
 * （实测 94.12%），不是逐个文件 —— 于是有 7 个文件实际低于 90 而 CI 全绿：
 *
 *     src/vue/store.ts            82.22%（函数覆盖 66.66%）
 *     engine/breakpoints.ts       75.00%
 *     engine/shift.ts             75.00%
 *     engine/schemes.ts           79.24%
 *     engine/convert.ts           82.14%
 *     engine/downgrade.ts         83.33%
 *     engine/fitHeight.ts         83.33%
 *
 * 56 个高分文件（chord / keyboard / worldclock 那些 100%）在替它们兜底。
 * 这是"门禁脚本存在 ≠ 门禁在跑"的**同族问题**：上次是脚本根本没被 CI 调用，
 * 这次是调用被一句话解释了、但**判据与声明的语义不一致**。同一个坑换了件马甲。
 *
 * 修法：把承诺落到逐文件（见下面 `thresholds` 里的棘轮表），
 * 值取 2026-10-12 的实测值（整数下取整）。语义是**只往下锁、不往上抬** ——
 * 涨了不必改这张表，跌了必须补用例，**不许调低它**。
 *
 * 这张表**盖不住两件事**，写在这儿免得下一个人以为它全包了：
 *   1. 高于 90 的**引擎**文件没有逐文件锁 —— 从 95 掉到 91，聚合值与这张表都不会红。
 *      要不要逐个锁（引擎 56 个 + 这里 7 个 = 63 行）是个取舍，本轮没做。
 *   2. **新加进受测层的文件不会自动获得地板**，得同步在这张表里登记。
 *      这条与 `GATED_VUE_MODULES` 本身是同一种纪律：受测层是**显式清单**，不是扫出来的。
 *      引擎层另有一条兜底（下面那条 `packages/engine/src/**`）管新文件。
 *
 * 纳入门禁的判据不是"它在 src/vue 下"，而是"**它能在不开浏览器的情况下被断言**"。
 * `useWeather` 在 2026-10-04 补进来：它是**网络层**，而网络是会失败的那一半 ——
 * 引擎那半（`packages/engine/src/weather.ts`）有测试，不代表"发请求 + 存缓存"这半有。
 */
const GATED_VUE_MODULES = [
  'src/vue/appearance.ts',
  'src/vue/backup.ts',
  'src/vue/cardData.ts',
  'src/vue/cardDataLimits.ts',
  'src/vue/cardDataSanitize.ts',
  'src/vue/chord.ts',
  'src/vue/commandBus.ts',
  'src/vue/commands.ts',
  'src/vue/keyboard.ts',
  'src/vue/meetings.ts',
  // 会议转写导出（2026-10-28）：导出文案 / 安全文件名的判定层 —— 同 meetings.ts 的
  // 分工理由，胶水（取数 + Blob 下载）留在组件，留给 E2E。
  'src/vue/meetingExport.ts',
  'src/vue/minutesLive.ts',
  // 模块库搜索（F-09，2026-10-26）：判定层单独成文件就是为了能被断言 —— 本仓**没有组件测试
  // 设施**（无 @vue/test-utils / jsdom），判定留在组件里就只剩 E2E 一层兜底。
  'src/vue/moduleFilter.ts',
  // 浮窗清单（F-08，2026-10-26）：判定层同样是为了「不开浏览器也能断言」才单独成文件 ——
  // 组件里那半（顶栏那枚按钮）留给 E2E。锁 100 的语义同 openUI/moduleFilter。
  'src/vue/floatList.ts',
  // 按实例取数（F-01 阶段 2，2026-10-28）：「这是不是第二张便签 / 正文该读哪一份」是纯判定，
  // 一样为了不开浏览器也能断言才单独成文件；组件那半（v-model 接读写对）留给 E2E。
  'src/vue/instanceData.ts',
  // App.vue 拆分 Cut A（2026-10-24）：外点关闭判定 / 「打开界面」查表。两处判定原来长在
  // App.vue 里、只有 E2E 兜底；都满足「不开浏览器也能断言」的纳入判据（见各文件头注释）。
  'src/vue/openUI.ts',
  'src/vue/outsideClick.ts',
  'src/vue/paletteIndex.ts',
  // 提醒（P0-④ 阶段 1，2026-10-21）：判定层是纯函数（注入 now），胶水层可用 memoryStorage 驱动，
  // 都满足"不开浏览器也能断言"这条纳入判据。
  'src/vue/reminders.ts',
  'src/vue/notify.ts',
  'src/vue/migrate.ts',
  'src/vue/useReminders.ts',
  'src/vue/store.ts',
  'src/vue/useUpdateCheck.ts',
  'src/vue/useWeather.ts',
  'src/vue/winPreview.ts',
  // App.vue 拆分（2026-10-23，970 → ~270）抽出的三个纯模块：撤销路由 / 编辑事务差异 /
  // 舞台几何。抽它们的理由与 chord/keyboard 相同 —— 原来长在 App.vue 里，零断言。
  'src/vue/undoRouting.ts',
  'src/vue/editTransaction.ts',
  'src/vue/stageGeometry.ts',
  // App.vue 拆分②（2026-10-23）：三个 composable。纳入判据同 chord/keyboard ——
  // 判定逻辑能用 ref + spy + 假 ctx 驱动，不开浏览器也能断言。
  'src/vue/useEditTransaction.ts',
  'src/vue/useAppCommands.ts',
  'src/vue/useGlobalKeys.ts',
  // App.vue 拆分 Cut B（2026-10-24）：撤销/重做 composable。判定层在 undoRouting.ts，
  // 这里是执行层（两份历史的调用顺序 + lastUndoKind 记账）—— 用假 store / 假 contentHistory
  // / view ref 就能驱动，不开浏览器也能断言。
  'src/vue/useUndoRedo.ts',
  // App.vue 拆分③（2026-10-23）：顶栏搬进 AppToolbar.vue 后，「排布」这一项变成
  // 「顶栏发名字 → App 按名字取执行体」的跨文件映射，写成纯查表才能断言
  // （收紧与行重排在 E2E 里没人点，这五条是它们唯一的钉子）。
  'src/vue/arrangeActions.ts',
  // 多端同步（2026-10-25）：设置+各段戳的存储层，与「取远端→裁决→确认→落地/上传」的胶水层。
  // 两条都不开浏览器也能断言（假传输 + 内存存储驱动），符合纳入判据。
  'src/vue/syncStore.ts',
  'src/vue/useSync.ts',
  // 原生卡目录扫描（2026-10-28）：落袋循环是纯判定，同 moduleFilter/instanceData 的理由
  // 单独成文件 —— 组件那半（按钮 + invoke）在桌面态，E2E 注 Tauri 桩与本仓安全钩的
  // 动态执行禁令冲突，跑不了；Rust 侧 scan_cards_dir 由 cargo 单测兜底。
  'src/vue/extcardScan.ts',
]

/** 仓库内按源码解析引擎包（与 vite.config.ts 同一条约定） */
const engineSrc = join(dirname(fileURLToPath(import.meta.url)), 'packages/engine/src')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@levango7\/engine$/, replacement: join(engineSrc, 'index.ts') },
      { find: /^@levango7\/engine\//, replacement: `${engineSrc}/` },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**/*.ts', ...GATED_VUE_MODULES],
      reporter: ['text', 'json-summary'],
      thresholds: {
        // 聚合线（原样保留）：受测层整体分支覆盖 ≥90。
        // 注意它**不能**代替下面的棘轮表 —— 聚合值会被高分文件抬起来。
        branches: 90,

        // 引擎层兜底：任何一个引擎文件都不得低于"当前引擎层最差文件"那条线。
        // 存在理由是**显式棘轮表管不到以后新加的文件**：新引擎文件若带 0% 覆盖率进来，
        // 聚合值上完全看不出来。75 不是拍的，是 2026-10-13 实测的最低值。
        'packages/engine/src/**/*.ts': { perFile: { branches: 75 } },

        // ── 逐文件棘轮：27 个受单测门禁的 src/vue 模块（其中 18 个锁 100）──────────
        // chord / keyboard 锁 100 才是那句话的本意：加一条没测到的分支，当场红。
        'src/vue/appearance.ts': { branches: 95 },
        // backup.ts 原地板 95。P0-③（2026-10-20）把恢复改成整份回填、格式升 v2 并加了设置段清洗，
        // 补齐四条从未被执行过的分支（残缺包无版面段 / 导出时间读不懂 / settings 整段不是对象 /
        // template 显式为 null）—— 两个用例文件隔离跑实测**分支 100%**，棘轮只升不降，锁满。
        'src/vue/backup.ts': { branches: 100 },
        'src/vue/cardData.ts': { branches: 97 },
        // cardData 拆分（2026-10-20，#124）：清洗层与共享上限各自成模块，随拆分进受测层。
        // 地板按拆分后**全量套件**实测回填（棘轮只升不降）：
        //   cardData.ts      97.84 —— 原 97 地板复核通过，不动。剩的三个未覆盖分支全是
        //                     「按契约不可达」的防御（231 早退 / 310、319 的 `?? 兜底`），
        //                     不值得为覆盖率演戏；要覆盖得先改引擎契约。
        //   cardDataSanitize 99.58 —— 取整数下取整 99。缺口是同形状的 rejected>0 告警旁路
        //                     （launch 那条已被导入测试覆盖，其余是复制形状）。
        //   cardDataLimits   100   —— 纯数值函数，表驱动全覆盖，同 chord/keyboard 锁满。
        'src/vue/cardDataSanitize.ts': { branches: 99 },
        'src/vue/cardDataLimits.ts': { branches: 100 },
        // 提醒（P0-④ 阶段 1，2026-10-21）：规则表 + 胶水层两个文件都由注入时钟与内存存储驱动，
        // 隔离跑实测**分支 100%**（去重/静默/跨天/坏数据/写失败全有用例）。棘轮只升不降，锁满。
        'src/vue/reminders.ts': { branches: 100 },
        // 系统通知投递（P0-④ 阶段 2）：加载器失败（注入）、权限被拒、插件抛错、默认加载器在
        // 无 Tauri IPC 的 node 里返回 false 都有用例；隔离跑实测分支 100%（import 自身 reject
        // 那条 catch 没被执行，属真实环境才走得到的防御，不为覆盖率演戏）。
        'src/vue/notify.ts': { branches: 100 },
        // 数据迁移（P0-⑤）：隔离跑实测分支 80.76%（未覆盖的是三个默认参数兜底：默认计划 /
        // 默认时钟 / 缺步骤时的早退）；快照与写回的失败路径全部有用例。地板按实测回填，取 80。
        'src/vue/migrate.ts': { branches: 80 },
        'src/vue/useReminders.ts': { branches: 100 },
        'src/vue/chord.ts': { branches: 100 },
        'src/vue/keyboard.ts': { branches: 100 },
        // App.vue 拆分（2026-10-23，970 → ~270）抽出的三个纯模块：撤销路由 / 编辑事务差异 /
        // 舞台几何。抽它们的理由与 chord/keyboard 相同 —— 原来长在 App.vue 里，零断言。
        // 三条都按**全量套件实测**回填并锁满（棘轮只升不降）：
        //   undoRouting    12/12 分支 —— 顺序决策全部由固定输入穷举（编辑态恒版面 / 谁近谁先 /
        //                   平手算内容近 / redo 跟 lastUndoKind 不跟时间戳）。
        //   editTransaction 18/18 —— 注意 `a.rows ?? []` 的兜底是**真实分支**不是防御：
        //                   LayoutDoc.rows 是可选加法字段（types.ts：旧档缺键按空表处理），
        //                   已补"旧档缺 rows 键"三条断言钉住。
        //   stageGeometry   10/10 —— 三处下限（列宽 40 / 宽 240 / 高 160）表驱动全覆盖；
        //                   Cut A（2026-10-24）追加 resolveDetachVariant 兜底链 6 条后 8/8；
        //                   2026-10-25 修 clock:2 时该函数多一条 `p ? … : undefined`（版面外
        //                   id 找不到条目 ⇒ 无从得知模块），两侧都钉住后 10/10，锁 100 不变。
        'src/vue/undoRouting.ts': { branches: 100 },
        'src/vue/editTransaction.ts': { branches: 100 },
        'src/vue/stageGeometry.ts': { branches: 100 },
        // 多端同步（2026-10-25）：
        //   syncStore 100 —— 坏档容错 / 戳的取舍 / 代理透传全部有用例，锁满。
        //   useSync    84.7 —— 未覆盖的两处都是**按契约不可达**的防御：① 坏时间戳的兜底
        //              （parseBundle 已经把坏戳的段挡掉，planMerge 那道 invalid 是直接调用
        //              方的纵深防御）；② 设置里 deviceId 被手改成空（正常路径开箱就有）。
        //              地板按实测回填取 80，不为覆盖率演戏。
        'src/vue/syncStore.ts': { branches: 100 },
        'src/vue/useSync.ts': { branches: 80 },
        // App.vue 拆分 Cut A（2026-10-24）：四处「不开浏览器就能断言」的判定抽出受测层 ——
        // 两处新建文件（openUI / outsideClick）+ 两处追加进**已在**受测层的文件
        // （stageGeometry / notify，故棘轮表只为两个新文件加行）。
        //   openUI      0/0 —— 纯查表没有分支（同 useAppCommands / arrangeActions），锁 100 的
        //               语义是「保持无未测分支」：以后这里长出 if/兜底而没测，当场红。
        //               五个名字逐一命中 + 未知名静默无操作，7 条断言。
        //   outsideClick 2/2 —— instanceof 守卫的两侧（元素 target / 非元素与 null）全有用例，
        //               全量套件实测 100%。
        // 逐文件分支数可从留存产物 `coverage/coverage-summary.json` 的逐文件条目复核
        // （coverage-final.json 会被跑后清理删掉，summary 不会）。
        'src/vue/openUI.ts': { branches: 100 },
        'src/vue/outsideClick.ts': { branches: 100 },
        // 模块库搜索（F-09，2026-10-26）：6/6 分支全满 —— 两个 `??`（缺 blurb / 缺 group 的模块，
        // 用例里刻意留了一个两样都没有的「便签」）+ 空查询早退的两侧。锁 100 的语义同 openUI：
        // 以后这里长出 if / 兜底而没测，当场红。
        'src/vue/moduleFilter.ts': { branches: 100 },
        // 浮窗清单（F-08，2026-10-26）：分支数在写完用例后由 `coverage-summary.json` 实测回填，
        // 锁 100 —— 以后这里长出 if / 兜底而没测，当场红。
        'src/vue/floatList.ts': { branches: 100 },
        // 按实例取数（F-01 阶段 2，2026-10-28）：分支数在写完用例后由 `coverage-summary.json`
        // 实测回填，锁 100 —— 以后这里长出 if / 兜底而没测，当场红。
        'src/vue/instanceData.ts': { branches: 100 },
        // 原生卡目录扫描（2026-10-28）：落袋循环 5 条断言钉满（装 / 跳 / 空目录 / 摘要两支），
        // 分支数写完用例后由 `coverage-summary.json` 实测回填，锁 100。
        'src/vue/extcardScan.ts': { branches: 100 },
        // App.vue 拆分②（2026-10-23）：三个 composable，26 条断言，全量套件实测回填：
        //   useEditTransaction 8/8 —— 快照/保存/取消/还原状态机全钉住，含"快照已清"
        //                   时确认取消的防御路径（界面到不了、composable 层可达，不演戏）；
        //   useAppCommands    0/0 —— 纯直线（建总线 + 注册 5 条拦截），没有分支可测。
        //                   锁 100 的语义是"保持无未测分支"：以后加 if 而没测当场红；
        //   useGlobalKeys     18/18 —— Esc 七层透传 / 快捷键四种形状 / 输入控件放行。
        'src/vue/useEditTransaction.ts': { branches: 100 },
        'src/vue/useAppCommands.ts': { branches: 100 },
        'src/vue/useGlobalKeys.ts': { branches: 100 },
        // App.vue 拆分 Cut B（2026-10-24）：useUndoRedo，15 条断言，隔离跑实测回填：
        //   16/16 分支全满 —— undo 侧：编辑态恒撤版面（不查 canUndo，含空栈赋值照旧）/
        //                   工作台态谁近谁先 / 平手算内容近 / 内容 undo 返回 false 退到版面 /
        //                   工作台态查 canUndo 跳过 / 两边都没得撤（内容调一次落空、版面不调）；
        //                   redo 侧：内容分支查 canRedo（false 退版面）/ 编辑态无条件重做版面
        //                   （含空转）/ 两边都没得重做（两个 redo 都不调）。
        //                   注意 undo 内容分支看**返回值**、redo 内容分支看 **canRedo**，
        //                   这个不对称是拆分前就有的形状，逐字保留（测试文件头 ③）。
        'src/vue/useUndoRedo.ts': { branches: 100 },
        // App.vue 拆分③（2026-10-23）：排布动作名 → 执行体的查表。纯属性访问，
        // 0/0 分支（同 useAppCommands），锁 100 的语义是"保持无未测分支" ——
        // 以后这里长出 if/兜底而没测，当场红。五个名字各有一条例证（7 条断言）。
        'src/vue/arrangeActions.ts': { branches: 100 },
        // store.ts 是这张表存在的头号理由：82.22% 而 CI 绿了很久。
        'src/vue/store.ts': { branches: 82 },
        // 更新检查（2026-10-21）：161 行此前**零测试且不在受测层** —— 与 useWeather 同一种理由
        // （引擎那半 `tests/engine/update.test.ts` 有测试，"发请求 + 存缓存 + 摆状态 + 归还后端句柄"
        //  这半没有，而它恰好是会出错的那一半）。随补测进受测层：**实测 100%（22 条），同 chord /
        //  keyboard 锁满** —— 这个文件里没有一条分支是"按契约不可达"的，留余量没理由。
        'src/vue/useUpdateCheck.ts': { branches: 100 },
        'src/vue/useWeather.ts': { branches: 92 },
        // 命令层（2026-10-13 批 2）：新加进受测层的文件必须同步登记地板（见上面第 2 条纪律）。
        // 三条都被表驱动测试全覆盖，90 是"留一点呼吸"而不是现状回填。
        'src/vue/commands.ts': { branches: 90 },
        'src/vue/commandBus.ts': { branches: 90 },
        'src/vue/paletteIndex.ts': { branches: 90 },
        // Phase 3 前端批（2026-10-16）：两张新卡的判定逻辑各自抽成纯模块，随卡一起进受测层。
        // 两条都实跑 100%，锁 100 才是「加一条没测到的分支当场红」的写法 ——
        // 它们恰好都是"所有分支都靠卡片状态穷举出来的"那种模块，没有理由留余量。
        'src/vue/minutesLive.ts': { branches: 100 },
  // 会议历史（2026-10-17）：minutes 卡的「历史」半边抽成纯模块（列表截断 / 日界
  // 分组 / 字数），随本批进受测层。判定全部可由固定时钟穷举，同 minutesLive 锁 100。
  'src/vue/meetings.ts': { branches: 100 },
  // 会议转写导出（2026-10-28）：同 minutes 家族的分工 —— 导出文案与文件名的判定
  // 抽成纯函数才好钉死（白名单 / 空白句 / 时间戳同源），组件只留「取数 → 下载」胶水。
  'src/vue/meetingExport.ts': { branches: 100 },
        'src/vue/winPreview.ts': { branches: 100 },

        // ── 逐文件棘轮：6 个低于 90 的引擎文件 ─────────────────────────────
        'packages/engine/src/breakpoints.ts': { branches: 75 },
        'packages/engine/src/shift.ts': { branches: 75 },
        'packages/engine/src/schemes.ts': { branches: 79 },
        // convert.ts 归 #55（进制转换输入长度上限）在改，这条地板排在它之后取值；
        // 若那边补了用例把覆盖率抬上去，改高这张表是欢迎的。
        'packages/engine/src/convert.ts': { branches: 82 },
        'packages/engine/src/downgrade.ts': { branches: 83 },
        'packages/engine/src/fitHeight.ts': { branches: 83 },
      },
    },
  },
})

