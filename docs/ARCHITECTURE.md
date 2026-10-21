# Modulo — 架构与选型

> 状态：设计定稿，待开工｜定稿日期：2026-09-30
> 定位：**自适应的自由编排工作台（layout-first workbench）**
> 上游调研：`F:\Agent\Qoder CN\workspace\x-hub-吃透报告.md`（含 x-hub 实机取证数据与必避坑清单）

## 0. 一句话与差异点

Modulo 是一个**逻辑网格恒定、物理列数随屏幕投影**的卡片式工作台：一份布局，从 1920 桌面到 390 手机都能编排、都能读、都能用键盘操作。

三条不可让渡的差异点（全部对着 x-hub 的实测短板）：

| 差异点 | x-hub 实测 | Modulo 目标 |
|---|---|---|
| 真响应式 | 390px 下仍 12 列，便签卡宽 **50px**、时钟截成 `23:43…`；编辑器画布 **88px** | 12 列逻辑 + N 列物理投影，窄屏自动降档形态，绝不出现碎片卡 |
| 键盘可达 | `.le-cell[tabindex]` = **0** | 全键盘完成增/移/缩/切形态/删/撤销 |
| 可回退 | 无 undo/redo（只有"整场放弃"） | 50 步历史栈，拖拽/缩放各自成一条历史 |

**MVP 只留核心闭环**（设计时口径）：布局引擎 + 编辑器 + 4 张卡 + 本地持久化；明确不做扩展系统、AI、剪贴板、账号、浮窗。

> **2026-10-04 复核**：上面这句是**立项时的范围声明**，落地时越了两条线 —— ① 桌面壳（Tauri 2、托盘、全局快捷键、应用内更新）已按 §11 落地并随 v0.4.0 发布；② 卡片从 4 张长到 38 张。**仍然成立**的是"不做扩展系统 / AI / 账号 / 浮窗"这四条：不造插件机制、不接模型、不做登录态、不做多窗口浮层。范围纪律没有被破坏，破坏的是"不做桌面打包"这一条 —— 它当时被判断为最贵的一个坑（WebView2 运行期建窗），后来用"桌面探针作为发布前本机门禁"把它变成可控成本，见 §10.3 / §11.4。

---

## 1. 分层

```
F:\Nexus\Modulo\
├─ packages\engine\src\    ★ `@levango7/engine` 包（2026-10-03 从 src\engine\ 搬入，git 历史保留；
│                          2026-10-09 前叫 `@modulo/engine` —— 改名与对外发布见 §12）
│                          ★ 禁止 import vue / @tauri / document / window，也不许 `../` 出包
│  ├─ types.ts          LayoutDoc / Placement / ModuleDef / VariantDef / FitLevel
│  │  ├─ geometry.ts       collides(a,b) · rectsOverlap · maxRow
│  │  ├─ fit.ts            fitState(p, variant) → below|mid|ideal|room
│  │  ├─ spot.ts           findFreeSpot（同列带向下找）/ findLeftFit（降档贴左首配）
│  │  ├─ ops.ts            add/move/resize/setVariant/remove/setTitle/toggleLock —— 纯函数，返回新 doc
│  │  ├─ history.ts        不可变 doc + 引用栈；mergeKey 合并窗口（连按方向键折成一步）已在生产路径上用
│  │  ├─ breakpoints.ts    容器宽 → 物理列数 N + 最小行高
│  │  ├─ projection.ts     ★ project(doc, N) → 物理矩形集 + 收起清单
│  │  ├─ downgrade.ts      投影后宽度不足时的形态自动降档 / 收起判定
│  │  ├─ tidy.ts spread.ts fitHeight.ts   按需整理 / 撑满 / 按内容降高
│  │  ├─ schemes.ts        方案册纯函数（上限 24、重名加序号、逐条清洗）
│  │  ├─ templates.ts      ★ 版面模板表（8 张）+ buildTemplate：坐标显式，铺满由单测数格子证明
│  │  ├─ weather.ts        ★ 天气数据层：open-meteo 响应收窄 + WMO 码→语义/中文（网络在 useWeather.ts）
│  │  ├─ calendar.ts progress.ts    ★ 月历格子（固定 6×7）与时间进度（今天/本月/今年）
│  │  ├─ worldclock.ts countdown.ts ★ 世界时钟（偏移交 Intl，本地时区由界面问）与倒数日（按日历日算差）
│  │  ├─ calc.ts baseconv.ts convert.ts color.ts    ★ 计算器（无 eval 的递归下降）、进制（BigInt）、单位表、颜色三表示 + WCAG
│  │  ├─ textstat.ts habit.ts dtools.ts             ★ 文本统计（字素簇）、习惯 streak、日期工具（复用倒数日口径）
│  │  ├─ birthday.ts focus.ts          ★ 下一次生日（含闰日落 28、没年份就不算年龄）+ 待办的两个读法（聚焦 / 月度）
│  │  ├─ ledger.ts meeting.ts          ★ 记账（金额一律整数分，parseAmount 走字符串切分）+ 会议规划（偏移/星期交 Intl）
│  │  ├─ timer.ts                     ★ 计时的一张引擎四种投影（秒表 / 倒计时 / 间歇 / 呼吸）。时间戳而非累加器
│  │  ├─ heatmap.ts links.ts          ★ 月度热力图（相对色阶）+ 快捷链接（协议白名单，不做"打开"）
│  │  ├─ fixed.ts shift.ts            ★ 整数位计算（金额到分、率到万分之一）+ 值班轮转（一条可手算的规则）
│  │  ├─ fx.ts air.ts ghrepo.ts hn.ts moon.ts       ★ 联网卡的收窄层（汇率 / 空气质量 / 仓库 / HN）+ 月相（本地）
│  │  ├─ validate.ts       盘上数据解析、钳制、重叠消解（不信任存储）
│  │  ├─ serialize.ts      JSON schema；schemaVersion 偏高只告警并按 v1 读；**迁移表 MIGRATIONS 有真调用方**（`parseLayout` 每次读盘都过）
│  │  └─ index.ts          对外统一出口
│  ├─ vue\                 唯一允许碰框架的适配层
│  │  ├─ store.ts          模块级 shallowRef 单例（无 Pinia）
│  │  ├─ cardData.ts cardRegistry.ts（尺寸契约，不 import .vue）cardComponents.ts
│  │  ├─ appearance.ts useAppearance.ts
│  │  ├─ fileStorage.ts fileIo.ts useShell.ts useSchemes.ts
│  │  ├─ useDensity.ts useFocusTrap.ts
│  │  ├─ useCanvasDrag.ts keyboard.ts chord.ts   ★ 拖拽状态机 / 键盘意图（纯函数）/ 组合键判定
│  │  ├─ useProjection.ts useElementSize.ts useCellFocus.ts   ★ 2026-10-04 从 App.vue / CanvasEditor 抽出（`useElementWidth` 于 2026-10-08 改名 `useElementSize`：行高开始看窗口高度，宽高一起量，见 §10.27）
│  │  ├─ rowUnit.ts        ★ 行高的"窗口高度抬升"（纯函数，可单测；§10.27）
│  │  ├─ backup.ts useBackup.ts useRemote.ts useWeather.ts useUpdateCheck.ts
│  │  └─ components\       TitleBar · BrandMark · GridLayout · CanvasEditor（+ ModuleLibrary · BatchActionBar 两块，2026-10-19 拆出） · StackEditor · SettingsPanel · TemplatePicker · BackupSection · SchemesSection · VersionSection
│  ├─ app\                 视图装配：工作台 / 编辑器 / 设置 / 卡片
│  │  └─ cards\   Clock / Sticky / Todo / Notes / Weather / Calendar / Progress / WorldClock / Countdown / DateTools / Elapsed / Habit / Calculator / Unit / Color / TextStat / Random / Base / Fx / Air / Repo / Hn / Moon（全部接容器查询）
│  ├─ tokens\              设计令牌（纯 CSS 变量，亮/暗两套）
├─ tests\
│  ├─ engine\              单测（每个纯函数一个文件）
│  ├─ property\            fast-check：投影不变量 I1–I4 + 分区完整
│  ├─ vue\                 适配层单测（store / fileStorage / cardData / appearance / shell / starter / backup）
│  ├─ engine-purity.test.ts  逐文件守住「引擎零框架 / DOM 依赖」
│  └─ e2e\                 puppeteer-core 驱动系统 Chrome：真浏览器断言
└─ docs\ARCHITECTURE.md
```

上面这棵树只描述**结构**；规模数字集中在这一行 —— `tests/` 下 **99 个文件**，其中 `tests/engine/` 61 个（每个纯函数一个）、`tests/vue/` 26 个（`meetings.test.ts` 15 条是 2026-10-17 加的：会议速记历史的纯判定 —— 日界分组 / 列表截断 / 字数统计；`tests/vue/useBackup.test.ts` 11 条是 2026-10-20 加的：备份"恢复的完整性"与自动备份的环形旋转，含一条把桌面 hydrate 链条跑真的用例；`tests/vue/useUpdateCheck.test.ts` 22 条是 2026-10-21 加的：更新检查这层的网络/缓存/状态机，见 §12.13；`tests/vue/reminders.test.ts` 18 条 + `tests/vue/useReminders.test.ts` 16 条是 2026-10-21 加的：提醒规则表（注入 now）与去重/静默/跨天/桌面 hydrate 链；`tests/vue/notify.test.ts` 7 条同日加：系统通知投递的降级路径（加载失败/权限被拒/插件抛错/无 IPC）；`tests/vue/migrate.test.ts` 14 条同日加：启动前迁移（先快照后写回 / 失败不毁原件 / 幂等 / 桌面 hydrate 链）；`tests/vue/cardData-write.test.ts` 6 条同日加：写入防抖（合并窗口 / flush / 卸载钩子）；`tests/engine/netPolicy.test.ts` 6 条是 2026-10-22 加的：网络策略单源 `net-policy.json` 与其生成产物的一致性 —— 逐字比对八个数字、URL 上限同源、两个响应体上限是有意差异（feed 256 KiB < 网页 1 MiB，恰好 4 倍）、股票行情域必须在允许外连的清单里（②号 bug 的回归钉），见 §12.14）、`tests/scripts/` 4 个（`tests/scripts/coord-gate-resources.test.ts` 20 条，在子进程里跑协调板门禁自己；`tests/scripts/release-artifact-facts.test.ts` 21 条，在子进程里跑「线上产物」那一维；`tests/scripts/docs-check-claims.test.ts` 10 条，在子进程里跑「认领数字」那条判据的整位数；`tests/scripts/coord-gate-range.test.ts` 4 条，在**临时 git 仓**里跑判据 2 的 range 口径 —— 守「本机与 CI 必须同口径」，2026-10-17 加）、`tests/release/` 4 个（`engine-package.test.ts` 5 条、`lockfile-registry.test.ts` 5 条、`csp.test.ts` 6 条、`cargo-lock-source.test.ts` 4 条 —— 最后这个是 Rust 侧依赖来源门禁）；fast-check 投影不变量属性测试 5 条断言（I1–I4 + 分区完整）；真浏览器 **E2E 49 条**（门禁脚本按 `it(` 家族正则扫 `tests/e2e/*.ts`；实际执行条数以 `npm run test:e2e` 的汇总为准，不再另记一套"实跑 / 门禁口径"的口径 —— 两套数并存正是此前漂移的来源）。<!-- facts -->

> **2026-10-12 说明（为什么数字从这里搬走了）**：上面那棵树原先在注释里带着三个规模数字
> （`engine` 47 个文件 / `property` 5 条断言 / `e2e` 22 条），而**代码块里的数字挂不了门禁** ——
> `docs-check` 认的是行尾的 `<!-- facts -->`，而这个标记放进代码块会**原样渲染成可见文本**。
> 代价已经付过两次：批次 5 把单测推到 1091 条、文件推到 75 个、E2E 推到 26 条时，
> 第 369 行的权威值被逐项更新了，而这棵树里的 `47 个文件` / `22 条` **没有人动** ——
> 同一份文档两处自相矛盾，而没有任何一条断言会因此变红。所以改成与 README 那棵树同样的写法：
> **树只描述结构，数字集中到上面那一行**（那里才挂得住标记）。规则是「**守不住的数字不写第二遍**」。

> **2026-10-02 复核**：上面这棵树此前记的是设计时的**计划**结构，和落地的代码差了十几个名字 —— 没有 `useDrag.ts` / `useKeyboard.ts` / `useFlip.ts` / `GridCell.vue`，也没有 `src/persist/`（拖拽与键盘编排直接长在 `CanvasEditor.vue` 与 `App.vue` 里，没单独抽 composable；让位动效是 `GridLayout.vue` 的 `TransitionGroup`），E2E 用的是 puppeteer-core 而不是 Playwright。已按实际文件重写。
>
> **2026-10-04 第二次复核**：上面「没单独抽 composable」那句已过时 —— 拖拽状态机已在 `useCanvasDrag.ts`、键盘意图判定已是纯函数 `keyboard.ts`；组合键判定在 `chord.ts`。本轮又补三个：`useProjection.ts`（投影派生从 App.vue 抽出）、`useElementWidth.ts`（ResizeObserver 样板）、`useCellFocus.ts`（编辑器焦点跟随）。`store.ts` 仍按一个工厂收历史 + 持久化，未做进一步拆分。
>
> **2026-10-08 第三次复核**：`useElementWidth.ts` 已改名 `useElementSize.ts` 并加量高（行高要看窗口高度了，§10.27），同一文件里顺带新增纯函数模块 `rowUnit.ts`。

**引擎纯度由两条防线守着**：`tests/engine-purity.test.ts` 扫 `packages/engine/src/**/*.ts` 的 import，出现 `vue`、`@tauri`、`document`、`window` 即失败（也不许用 `../` 往包外伸手）；`packages/engine` 自己的构建（`tsconfig.build.json` 的 `lib` 只有 ES2022、不含 DOM）是更硬的那一条 —— 真碰 DOM，编译就过不去。不引 eslint 插件。

**2026-10-03 起，引擎是独立包**（`packages/engine/`，从 `src/engine/` 整体 `git mv` 搬入）：仓库内按**源码**消费（`vite.config.ts` / `vitest.config.ts` / `tsconfig.json` 三处 `@levango7/engine` 别名），对外入口是 `dist/`（`npm run engine:build` 产出、`engine:pack` 出 tarball，`prepack` 自动先构建）。**这个包 2026-10-09 改名并开始对外发布**（`@modulo/engine` → `@levango7/engine`），见 **§12**。下文 §10 的历史叙述里写的 `src/engine/**` 是搬家前的路径，指同一个东西，按当时的写法保留。

---

## 2. 数据模型

```ts
const LOGICAL_COLS = 12 as const          // 逻辑列，永不变

interface VariantDef {                     // 形态 = 尺寸契约
  id: string; name: string
  minW: number; minH: number               // 内容完整可见的最小物理格
  idealW: number; idealH: number           // 正好铺满的推荐格
}
interface ModuleDef {
  id: string; title: string
  defaultVariant: string
  variants: VariantDef[]                   // 只有真需要多尺寸的模块才暴露多形态
}
interface Placement {
  id: string                               // = moduleId（单实例）
  variant: string
  x: number; y: number; w: number; h: number   // 逻辑坐标，x∈[0,11]
  title?: string
  hideTitle?: boolean
  locked?: boolean                         // ★ x-hub 无此字段；防误拖
}
interface LayoutDoc {
  schemaVersion: 1
  cols: 12
  items: Placement[]
}
```

设计要点（承接 x-hub 已被验证的好设计）：
- **尺寸约束挂在形态上，不挂在模块上** —— 这是"随便调大小但调不坏"的前提。
- **单实例**：一个模块在版面上只有一份，未放置的模块才出现在库里。
- 已知取舍：**MVP 单页，schema 不带 `pages`**。将来做多页时 `schemaVersion: 2` + 迁移函数。不提前为假想需求设计。

---

## 3. 投影算法（方案 A，本产品的技术支点）

### 3.1 断点表

按**主区容器宽度**（不是窗口宽度）取物理列数：

| 容器宽 | N 物理列 | 基准行高 | 编辑模式 |
|---|---|---|---|
| ≥1200 | 12（原生，零投影损失） | 64px | 画布 |
| 960–1199 | 8 | 60px | 画布 |
| 720–959 | 6 | 56px | 画布 |
| 480–719 | 4 | 52px | 画布（紧凑） |
| <480 | **1 = 堆叠模式** | 48px | 堆叠编辑器 |

上表的行高是**基准值**：只由容器宽定档，落在这张表里的数字是"默认窗口及更小窗口"下的实际行高。窗口比应用的默认窗口（1280×800）更高时，实际行高 = 基准 × 窗口高度倍率（线性、封顶 2 倍、参考可用高 684），使版面占比在各档窗口下都保持在 62–68% 而不是随窗口一路掉到 34% —— 见 §10.27（含八档视口的实测表）。**列数不含任何高度维度**，所以顶栏断点与栅格仍在同一刻降档。

行高是**固定 px 而非 `1fr`**：版面贴合内容高度，超出视口由页面滚动承接。曾用过撑满视口的 `minmax(rowMin,1fr)`，实测发现它会让"按内容收紧高度"完全看不出效果（行数变少＝每行变高，卡片又被拉回去），见 §10.10。**这条至今仍然成立**：高度倍率里刻意不含行数，所以"收紧 ⇒ 版面变矮"没有被这次改动破坏（§10.27 有专门的回归守卫）。**编辑态从 2026-10-09 起也用同一个 `rowPx`**（此前它自己把画布可用高摊给行轨，是两态不一致的根因），见 §10.29。

### 3.2 算法

```
s  = 12 / N                                  // 压缩因子（N=8 时非整数）
px(x)   = clamp(floor(x / s), 0, N - pw)
pw(x,w) = clamp(ceil(w / s), 1, N)           // 宽度向上取整、位置向下取整
```
取整方向是**刻意不对称**的：宽度用 `ceil` 保证覆盖不留空洞（用 `round` 时实测 4 列档会把 4 逻辑列的卡缩成 1/4 容器宽，版面中间开一个洞），偶尔因此产生的重叠交给让位消解。
然后对投影结果按 `(y, x)` 稳定排序，逐个在**物理空间**消解取整带来的重叠。**落位策略 2026-10-10 改过一次**：n = 12 是恒等映射、原样不动；**降档（n < 12）用 `findLeftFit` 贴左首配**（同一行从 x=0 往右找第一个放得下的位置，放不下才整行下移）。旧策略（`findFreeSpot` 留在原列带向下找）实测在 4/6 列档会留下"浮在中列、两边空"的岛 —— 横位本来就是投影的取整产物，不是用户的排布意图，左对齐更符合阅读习惯；`ops`/`validate` 那些要保用户横位意图的调用方仍然用 `findFreeSpot`。

**单位口径（实现时纠正了本节初稿的错误）**：`minW/minH` 是**逻辑列**单位，`pw` 是**物理列**，两者不可直接比 —— 一个 4 逻辑列宽的模块在任何 N 下都占容器的 1/3，投影只改变"它落在几个物理列上"，不改变它分到的比例。因此形态是否够用按**逻辑等效宽度** `round(pw * s)` 判断。若照初稿写成 `pw ≥ minW`，N=1 的堆叠模式会把所有卡都误判成"装不下"而全部收起。

### 3.3 四条不变量（全部有 property test 断言，见 `tests/property/`）

- **I1 只读**：投影永不回写逻辑坐标。用户在窄屏看到的一切都是视图，编辑的始终是 12 列逻辑空间。→ 从根上消灭"每档一套布局"的漂移问题。
- **I2 幂等**：同一 doc + 同一 N，投影结果确定（依赖稳定排序）。
- **I3 无重叠**：投影后任意两个物理矩形不相交，且 `x + w ≤ N`。
- **I4 尺寸充分**：`round(rect.w * s) ≥ 生效形态.minW` 且 `rect.h ≥ minH`；一个形态都装不下 → 该卡进「已收起」清单并给出计数入口，**绝不压成碎片**（x-hub 在 390px 下把便签压成 50px 宽、文字竖排，就是缺这条）。
- **分区完整**（property 追加的第五条）：每张卡要么可见、要么被收起，不重复不丢失。

### 3.4 一个待验证的岔口（诚实记录）

`round(w/s)` 会让模块宽度偏离其逻辑列数（误差 ≤ 半物理列）。两条候选路线：

- **A1 等分物理列 + 取整让位**（上面写的这套）：实现简单、视觉均匀，宽度不精确。
- **A2 加权列带**：物理列宽按 `B[j]=round(j*12/N)` 的边界差取 `fr` 权重，使每物理列恰好代表整数逻辑列。宽度更准，但**非列带对齐的模块仍要跨带取整**，精确性收益有限、复杂度明显上升。

MVP 先做 A1，A2 留一个 `projection.a2.test.ts` 做对照实验。不在没数据前选复杂方案。

### 3.5 对照实验结论（2026-10-01 已跑，A2 出局）

`tests/property/projection-a2.test.ts` 用 60 组随机版面 × 6 档列数，在同一"逻辑格"口径下量三个指标（A2 的实现只活在该测试里，产品层不留未用代码）：

| 列数 | 空洞率 A1 / A2 | 撑宽比 A1 / A2 | 位移卡数 A1 / A2 |
|---|---|---|---|
| 12 | 0.677 / 0.677 | 1.00 / 1.00 | 0 / 0 |
| 8 | 0.626 / 0.648 | 1.13 / 1.10 | 1.88 / 1.83 |
| 6 | 0.647 / 0.639 | 1.10 / 1.14 | 1.80 / 1.82 |
| 4 | 0.613 / 0.590 | 1.24 / 1.33 | 1.97 / 1.98 |
| 3 | 0.571 / 0.548 | 1.36 / 1.47 | 1.90 / 1.95 |
| 2 | 0.505 / 0.478 | 1.65 / 1.75 | 1.93 / 1.93 |
| **平均** | **0.607 / 0.597** | **1.25 / 1.30** | **1.58 / 1.59** |

结论三条：
1. **A2 不值**：空洞率只改善 0.01（相对 1.6%），代价是撑宽比更差（1.30 vs 1.25）且物理列宽不等分、观感更难对齐。A1 保留。
2. **问题被重新定义了**：N=12（投影恒等、零损失）时空洞率就已经是 0.677 —— 说明"版面开洞"根本不是取整策略造成的，而是**自由排版本身留的白**。继续在投影上花功夫是错的方向。
3. 因此真正的下一步是给用户一个**按需整理**的动作（把稀疏版面按行带聚拢，可选、可撤销、不自动贪心压实，避免 x-hub 那种"删一块整屏跳"）。这条进 §10 的待办，不进投影层。

---

## 4. 交互规范

### 4.1 拖拽（指针事件，不用 HTML5 DnD）
- **抓手区语义（2026-10-10 重做，Grafana 式"拖标题栏"）**：拖拽只能从卡片的**标题带**（`.tag`，24px，`touch-action: none`、`cursor: grab`）发起；卡面 pointerdown 只做选中（Shift/Ctrl 加选），卡面划动交还滚动（`pan-y`）。**意图靠区域区分，不靠时间门槛** —— 旧版"拖拽从卡面任意位置发起 + 触摸长按 250ms 才进拖拽"（含非 passive touchmove 武装链）整套删除，代价是"按住等一会儿才动"的反直觉手感；`dragGate` 退化为纯 6px 位移阈值。库面板同套语义：`.lib-title`/`.chip` 是抓手（`touch-action: none`），列表滚动落在 `.lib-item` 上。
- 6px 位移阈值区分点击与拖动（鼠标 / 触摸一致，`dragGate` 纯函数单测守）。
- 拖动中：跟随光标的 ghost + 落点预览矩形 + 尺寸/适配文字标签。
- **移动与缩放的冲突语义故意不同**（承袭 x-hub 的好设计）：
  - 移动 → 目标被占时同列带向下找最近空位，**绝不弹回**；
  - 缩放 → 目标非法（越界/重叠/低于形态 min）时**拒绝并回退**到拖前尺寸。
- 缩放过程中实时改 `w/h`，让内容当场重排（不是松手才变）。
- 无贪心压实：删掉中间一块不会整屏跳。

### 4.2 让位动效（x-hub 完全没有）
`.cell` 有让位过渡：投影/移动导致其他格子位置变化时播一段 `transform` 过渡，`prefers-reduced-motion` 下直接跳位。**实现方式与当初的选型不同**：没有自写 Web Animations API 的 FLIP，而是 `GridLayout.vue` 用 Vue 的 `<TransitionGroup>`、动效本体是 `tokens.css` 的 `.cell-move`（`@media (prefers-reduced-motion: reduce)` 关掉）。效果等价，少了几十行手写的 measure-play-replay 代码。

### 4.3 键盘（x-hub 为 0 分）
- 格子 roving tabindex，`Tab` 进出版面、`方向键` 在格子间跳焦点。
- 焦点在格子上时：`方向键`=移动 1 格｜`Shift+方向键`=改宽/高 1 格｜`Enter`=**循环切形态**（`CanvasEditor.vue:334` 直接 `store.cycleVariant`，没有弹形态菜单 —— 形态只有 2–3 档，循环比开菜单快）｜`Delete`=移除｜`L`=锁定切换｜`Ctrl+Z / Ctrl+Shift+Z`=撤销/重做。
- 焦点环用 `--shadow-focus` 令牌，禁止 `outline:none` 裸删。

### 4.4 多选与批量（x-hub 无）
`Shift+点击` 增选；空白处按下拖动 = 框选；选中集支持整体偏移、整体删除、整体锁定。

### 4.5 历史
50 步；合并策略：一次拖拽 = 一条历史；连按方向键 / 连续缩放在 300ms 窗口内按 `mergeKey` 折叠成一步（`CanvasEditor.vue:321` 传，`store.ts:56` 收）。**「标题输入按失焦合并」这条没实现**：`setTitle` 只在 `store.ts:93` 定义、全仓无 UI 调用方（卡片没有可编辑标题输入，标题走方案册那条输入框，不进历史）。

---

## 5. 设计令牌（纯 CSS 变量，不引 Tailwind）

```css
:root {                       /* 亮 */
  --bg-page; --bg-card; --bg-card-solid; --bg-card-soft; --input-bg;
  --text-1; --text-2; --text-3; --text-4;
  --border-soft; --border-strong; --scrim;
  --brand-500; --brand-600; --brand-50; --brand-glow;
  --c-*: 5 色（green/red/amber/blue/purple，无 -ink/-soft 变体）;
  --radius-sm/md/lg/xl/pill;  /* 8/8/12/16/999 —— pill 是刻意例外 */
  --space-1..6;               /* 4/8/12/16/20/24 */
  --shadow-card/hover/focus;
  --z-base/sticky/overlay/menu/modal/toast;   /* ★ 集中定义，x-hub 此处散落各组件 */
  --dur-micro:150ms; --dur-pop:200ms; --ease-out;
}
[data-theme="dark"] { /* 覆盖 */ }
```

- 主题三轴照做：模式（亮/暗/系统）× 预设（单色 + 渐变）× 强调色（`--accent` + `color-mix` 派生 brand 全族）。
- **卡片表面**：用静态烘焙渐变假装毛玻璃，**全仓零处 `backdrop-filter`**（`grep -rn backdrop-filter src/` = 0 命中）。原计划"真 blur 只给弹窗/菜单等瞬态层"没做 —— 这是 x-hub 用 GPU 从 ~26% 回落换来的结论，我们直接继承，不重新踩；不做也意味着这条没有实测成本可言。
- **卡片内容一律容器查询**：`.cell{container-type:size}` + `clamp(绝对下限, Ncq…, 绝对上限)`。x-hub 只有 2/13 张卡这么做了，我们 4 个卡组件全做 —— 这是"任意尺寸不裁字"的唯一可靠路径。（注册表里是 **5 个模块**：`cardRegistry.ts:10/20/29/38/47` 的 clock / sticky / todo / notes / **recent**；第 5 个「最近改动」是派生数据，渲染直接复用 `NotesCard`（`cardComponents.ts:12-18`），所以"4 个卡组件"和"5 个模块"都对，别混着写。起步版面里它也占一格（`store.ts:43`）。）
- 字号下限硬约束：**正文 ≥12px**，投影降档必须优先保住这条线（x-hub 在 720px 下编辑器预览正文掉到 6.7px）。E2E 卡的是更宽的口 —— `.cell` 里任意叶子文本节点 ≥11px（`tests/e2e/layout.spec.ts:84`），实测三档都是 11px，落在次要文字上（`.hint` / 待办的「已完成」小标题 / ink 皮肤的大写卡头），卡片正文是 13px 起（`tokens.css:180`）。

---

## 6. 选型

| 项 | 选择 | 理由 |
|---|---|---|
| 构建 | Vite 8 + TS 6 | 与 x-hub 同代，无未知风险 |
| 框架 | Vue 3.5 `<script setup>` | 已定 |
| 状态 | 模块级 `shallowRef` 单例，**无 Pinia** | 它的实践证明编辑器/主界面共享一份布局这个需求不需要 store 库 |
| 样式 | 纯 CSS 变量令牌 + scoped CSS | 已定；布局大量依赖 `calc()`/`cqw`/`cqh`，工具类反而绕 |
| 图标 | lucide-vue-next 按需引入 | 同代成熟，颜色继承 currentColor |
| 单测 | vitest | 引擎纯函数直接测 |
| 属性测试 | **fast-check** | 投影 I1–I4 天然适合随机布局 × 5 档 N |
| E2E | Playwright（初选）→ **puppeteer-core 驱动系统 Chrome**（落地） | 键盘全流程 + 拖拽 + 断点截图（也是"更好看"的取证工具） |
| 持久化 | IndexedDB（idb-keyval）+ localStorage 兜底（初选）→ **`localStorage` / `%APPDATA%` 下一 key 一文件**（落地，见 §7） | 原打算"字段级补丁写"绕开 x-hub"整份配置覆盖冲掉后端字段"那个坑；落地走整份 JSON，代价是并发写覆盖，靠导入前校验与备份兜住 |
| 动效 | Web Animations API 自写 FLIP（初选）→ **Vue `<TransitionGroup>`**（落地，见 §4.2） | 不引动画库 |
| 不引 | reka-ui、Tailwind、Milkdown、任何网格库（gridstack / react-grid-layout） | 网格库只解决"不重叠+压实"，**不解决"内容装不装得下"**（形态 min/ideal 语义），而后者才是体验核心；且引库会把坐标系与压实策略锁死，而投影正是要动坐标系的部分 |
| 桌面壳 | 第二轮再上 Tauri 2 | 引擎层零改动即可包；现在避开 WebView2 运行期建窗挂死那类最贵的坑 |

> **2026-10-02 复核：上表已就地改成"初选 → 落地"双写**，理由仍记在这里 —— ① 持久化没走 IndexedDB / idb-keyval，也没有"字段级补丁写"，实际是 `localStorage`（网页版）与 `%APPDATA%\app.modulo\data\` 下一 key 一文件的**整份 JSON**（桌面版，见 §7）；② E2E 用 puppeteer-core 驱动系统 Chrome，没引 Playwright；③ 让位动效是 Vue `TransitionGroup`，不是自写 WAAPI FLIP（见 §4.2）；④ 属性测试是 **7 档**列数 × 200 例、**5 条**断言（I1–I4 + 分区完整），不是"5 档 N × I1–I4"。保留原理由是因为取舍依据今天仍然成立 —— 但**实现口径以各行的"落地"一侧与 §10 为准**。

---

## 7. 持久化

一个 key 一个存储单元，全部走同一个同步的 `StorageAdapter` 接口（`store.ts` 里定义），实现按宿主切换：

| key | 内容 |
|---|---|
| `modulo.layout.v1` | 当前版面 `LayoutDoc`（`schemaVersion: 1`） |
| `modulo.schemes.v1` | 命名方案册 |
| `modulo.carddata.v1` | 便签文本 / 待办 / 速记 |
| `modulo.appearance.v1` | 皮肤 × 明暗 × 强调色 |
| `modulo.shell.v1` | 桌面壳开关（关闭是否收进托盘）+ 两条全局快捷键的自定义组合（`summon` / `ontop`） |
| `modulo.autobackup.index.v1` | 自动备份的环形索引（槽号 / 时间 / 触发原因 / 当时的应用版本 / 字节数） |
| `modulo.autobackup.slot.0..6.v1` | 自动备份的整包内容，环形 7 份（`useBackup.ts`，只在桌面写） |
| `modulo.reminders.v1` | 提醒设置（开关 / 静默起止 / 习惯提醒时刻）+「今天提醒过哪些」（`useReminders.ts`） |
| `modulo.migration.backup.v1` | 数据迁移前的原样快照，最近 3 次（`migrate.ts`；写不出就不迁移） |

**这张表就是 `DATA_KEYS`（`src/vue/fileStorage.ts`），漏登记是静默失效而不是报错**：桌面适配器
"启动 hydrate 成内存镜像、之后 `get` 只读镜像"，镜像内容只来自这张表。少一个键的症状是
"写得下去、重启读不到" —— 自动备份会每次启动都以为没有备份，重建基线并把 7 份洗掉。
`tests/vue/useBackup.test.ts` 里那条「重启后按同一张表读得回来」把整条链跑真（写 → 落盘记录 →
按 `DATA_KEYS` 重新 hydrate → 列表还得有那份备份）；变异验证：把两行键从表里删掉，该用例当场红。

- **网页版**：`localStorage`。
- **桌面壳**：`%APPDATA%\app.modulo\data\<key>.json`，一个 key 一个文件，整个目录拷走就是备份。由 `read_doc`/`write_doc` 两条命令实现（`src-tauri/src/storage.rs`）。
  - **原子写**：先写同目录临时文件再 `rename`。直接截断写会在崩溃/断电时留下半份 JSON，而这个文件就是用户的全部版面。
  - **同一个 key 的写强制排队**（`serialize()`）：两次并发写会共用同一个临时文件名，前一次还没 rename 就被后一次截断，落盘的可能是两份内容拼起来的半份。串行化做在 `createFileStorage` 内部，调用方忘不掉。
  - **文件名走白名单**：只允许小写字母/数字/`.`/`_`/`-`，且不许以点开头或含连续点，再统一加 `.json`。挡掉 `/` `\` `:` 就出不了数据目录。这条是 Rust 侧单测锁的。
  - **写失败会挂在界面上**（`storage.error` 顶出一条红框）。静默失败的存储迟早会变成"我明明存了"的数据丢失。
  - 存储适配器是**同步**接口而写文件是异步的，所以启动时一次性 hydrate 成内存镜像，之后 `get` 读镜像、`set` 立刻异步写穿。**存储层不做防抖**（拖拽只在 `pointerup` 提交一次）；**内容层**由 `cardData.ts` 自己合并 300ms 并暴露 `flush()`，`pagehide`/`beforeunload` 时冲刷 —— 合并窗口只降写盘频率，不能丢最后一笔（有 E2E「输入后立刻刷新」盯着）。
  - 首次启动会把桌面壳早期只存在 WebView2 localStorage 里的数据搬进文件；迁移单向，磁盘已有内容时以磁盘为准，避免旧 localStorage 覆盖新数据。
- 读取一律过 `validate.ts` / `parseBook`：校验 id/整数坐标、按形态 min 钳制、标题 trim+截断、失效 variant 归一，再从上往下扫描逐项消解重叠（x-hub 这套"不信任盘上数据"的做法照抄思路、码重写）。
  - 卡片数据（待办 / 速记 / 便签）走同一套规矩，入口是 `sanitizeCardData`（`src/vue/cardData.ts`）。**这里原来是漏的**：加载只做 `{...fallback, ...JSON.parse(raw)}`，只兜住了语法错误，`todos: null` 会一路传到渲染期的 `todos.filter(...)` 才炸 —— 注释里"数据损坏不阻塞启动"当时并不成立。现在顶层不是对象整份回退、条目形状不对只丢那一条、`done` 只认真 `true`、id 撞号改唯一（`toggleTodo` 按 id 找，撞号会连坐）、文本与条目数各有上限（几百 MB 的坏文件不该冻住首屏）。12 条单测锁住，含 `__proto__` 键不漏进状态。
- 导出/导入 = 单个 JSON（含 schemaVersion），导入走同一 validate。
- 迁移（2026-10-21，P0-⑤）：**有迁移器，且在启动最前面跑**。`serialize.ts` 的 `migrateWith(raw, table, to)`
  接受调用方的迁移表（版面仍用 `MIGRATIONS`，方案册 / 卡片内容各一张空表），版面的 `parseLayout`
  每次读盘都过；`src/vue/migrate.ts` 在 **store 读盘之前**统一跑一遍并**写回**（此前只迁不落盘，
  每次启动重迁，删旧步骤后老数据会读不出来）。写回前先把原文快照进 `modulo.migration.backup.v1`
  （最近 3 次），**快照写不出就不迁移**；迁移函数抛错 / 某个 key 写失败 / JSON 坏，一律保留原件。
  当前没有跨版本数据，所以生产计划对 v1 是空操作（有单测钉住"不重写、不留快照"）。

---

## 8. MVP 范围与验收

**做**：引擎（含投影）｜画布编辑器 + 堆叠编辑器｜撤销重做｜键盘｜多选｜FLIP｜4 张卡（Clock 三形态 / Sticky / Todo / Notes）｜三轴主题｜本地持久化 + 导入导出。

**不做**：扩展系统、AI、剪贴板历史、账号、市场、自动更新、开机自启、任何独立窗口。（托盘与全局快捷键原本也在这条里，已被 §11.3 推翻 —— 桌面壳是 MVP 之后单独开的一轮。）

**验收判据（可测，不靠感觉）—— 2026-10-02 逐条复核**
1. ✅ 三档视口：无横向滚动、无碎片卡、最小字号达标。**但实际断言跑在 1440 / 720 / 390**，不是这里原写的 360 —— 见 `tests/e2e/layout.spec.ts` 第一条。
2. ✅ 纯键盘可完成移动 / 缩放 / 切形态 / 选入 / 撤销 —— 由「编辑器键盘可达」「键盘补完」「方案册键盘排序」三条 E2E 覆盖。
3. ✅ **已补成测试**（2026-10-02）：`tests/e2e/layout.spec.ts` 里「拖动帧率实测」用 rAF 采样器在真拖期间记录帧距，断言**中位数 ≤ 18.2ms（≈55fps）**；本机 headless Chrome 实测 `median=16.7ms / p95=16.7ms / 103 帧`。注意这是 headless 的软合成节奏，只能当**下限**看，不代表低端实机。
4. ✅ 属性测试全绿：随机 200 例 × **7 档**列数（原写 5 档）× **5 条**断言（I1–I4 + 分区完整）。
5. ✅ **已补成门禁**：`npm run cover:engine`（v8 provider，`thresholds.branches = 90`），已并入 `verify` 的第二步，所以 CI 会拦。圈选范围 2026-10-03 从只圈 `src/engine/**` 扩到「engine 全量（现 `packages/engine/src/**`）+ `vitest.config.ts` 里 `GATED_VUE_MODULES` 那 6 个 vue 纯模块（2026-10-04 补进 `useWeather.ts` 后为 **7 个**）」，合数 93.85%。首跑实测 **87.29%** —— 也就是说这条判据从来没达成过；补了 13 条边界/失败分支用例后到 **90.95%**。剩下没覆盖到的多是防御性分支，例如 `spot.ts:25-26` 那个兜底 return 在数学上到不了（`bottom = maxRow(obstacles)`，循环到 `bottom` 时必然已空）—— 不为它编假测试。
6. ✅ 与 x-hub 同数据、同视口并排截图（见 §10.1）。

> §9 第一条教训是「文档会烂 → 验收标准写成测试，不写成文档条目」。第 3、5 条曾经就是那条教训的现场 —— 判据停在纸面上，谁也没测过。2026-10-02 两条都补成了可执行的测试/门禁，六条判据现在全部有断言或工具背书。

---

## 9. 从 x-hub 继承的教训（开工前自查清单）

1. **文档会烂**：它 DESIGN.md 与代码 13 处不一致，AGENTS.md 与 DESIGN.md 还互相矛盾。→ 验收标准写成测试，不写成文档条目。
2. **CI 必须真的跑测试**：它有 164 个 Rust 测试但 CI 只跑 `vue-tsc + cargo check`，一个测试都不执行。→ 第一天就把 vitest/Playwright 接进 CI。
3. **后端单独写的字段必须显式合并**：它两次被"前端整份配置覆盖写"冲掉数据。→ 字段级补丁写，禁止整份回写。
4. **`:global()` 陷阱**：lightningcss 会静默吃掉 `:global(x) y` 的后代部分，不报错。→ 我们不用 Tailwind，但仍要避免该写法；CI 加一条 grep 自查。
5. **计时类逻辑不放前端**（WebView 隐藏会节流）——MVP 无后台，但倒计时类卡片进第二轮时遵守。
6. **可能等 >5s 的操作，反馈不能只挂在短 toast 上**。
7. **许可证**：x-hub 无 LICENSE 文件 ⇒ 只借鉴概念与实现模式，**一行码都不复制**。

---

## 10. 实现状态

| 日期 | 内容 | 验证 |
|---|---|---|
| 2026-10-01 | 引擎层 11 个纯函数模块落地（types/geometry/spot/fit/ops/history/breakpoints/downgrade/projection/validate/serialize）+ 11 个测试文件 | `tsc --noEmit` 干净；`vitest run` **87/87 通过**（含 5 条 fast-check 属性测试，各 200 例随机布局 × 7 档列数）；`tests/engine-purity.test.ts` 逐文件守住"引擎零框架/DOM 依赖" |
| 2026-10-01 | Vue 适配层 + 工作台 + 画布编辑器 + 堆叠编辑器 + 4 张卡 + 设计令牌（`src/vue/`、`src/app/cards/`、`src/tokens/`）；`scripts/shoot.mjs` 无头取证 | 93/93 通过；`vite build` 干净（JS 37.6 kB gzip）；三档视口实测见下 |

### 10.1 三档视口实测（`evidence/`，与 x-hub 同口径对比）

| 视口 | 物理列 | 横向溢出 | 最窄可见卡 | 被裁文字 | 最小字号 | 编辑器可聚焦格 |
|---|---|---|---|---|---|---|
| 1440 | 12 | 无 | 221px | 0 | 11px | **5**（x-hub 0） |
| 720 | 4 | 无 | 160px | 0 | 11px | **5**（x-hub 0） |
| 390 | 1（堆叠） | 无 | 358px | 0 | 11px | 堆叠编辑器（x-hub 画布仅 88px） |

对照 x-hub 同视口：390px 下它仍是 12 列、便签卡被压成 **50px**、时钟截成 `23:43…`。差异点全部来自投影 + 形态降档 + 堆叠编辑模式这三件事。

遗留观感问题（已知、非阻塞）：窄列数下取整会让个别小卡（如 1 物理列的便签）右侧留出一段空档 —— 这是"宁可挤不可漏"的 ceil 策略换来的代价，属于 A1 方案的固有精度上限，A2 加权列带能否消掉待 §3.4 的对照实验。

### 10.2 多选与真实交互实测（2026-10-01；脚本与产物都没入库）

> 复核（2026-10-02）：标题里写的 `scripts/interact.mjs` 与 `evidence/interact.json` **都已不在仓库**（`evidence/` 在 `.gitignore` 里，脚本用完即删）。所以这一节的数字是一次性实测记录，**不可复算**；值得长期守住的部分已经转成 §10.3 的 E2E 断言。

引擎新增 `moveMany`（成组平移：整组夹到列范围内 → 向下试位直到与组外不撞 → 试不出则拒绝）与 `removeMany`，各带单测；编辑器加上 Shift/ Ctrl 点选、空白处框选、批量锁定/移回库、Ctrl+A、Esc。用无头 Chrome 真点真拖的结果：

| 步骤 | 结果 |
|---|---|
| 空白处框选 | 选中 3 个模块 ✓ |
| 按住选区成组拖拽 | 版面改变 ✓ |
| 拖完立刻 Ctrl+Z | 回到拖前 ✓ |
| 纯键盘：聚焦格子后 → / ↓ / Shift+→ | 移动与缩放生效 ✓ |
| 连续撤销 4 步 | 回到起点 ✓ |

这一轮由交互取证逼出两个真缺陷（都不是单测能发现的）：

1. **推荐布局首次启动不落盘** —— 用户不动版面就永远没有存档，导出/迁移会拿到空布局。修法：store 初始化时若走 starterDoc 立即写盘，并补一条单测锁住。
2. **Ctrl+Z 只在焦点位于编辑器内部时生效** —— 拖拽时 `pointerdown` 被 `preventDefault`，焦点可能仍留在 `body`，容器级 `@keydown` 根本收不到事件。修法：监听挂 `window`（卸载时摘掉），并对 `input/textarea/contenteditable` 直接放行，把 Ctrl+Z / Ctrl+A / Backspace 交还给原生文本编辑，避免抢键。

另外去掉了一处观感缺陷：编辑器标签条与卡片自身表头重复显示同一个名字（"便签 / 便签"），改为卡片在编辑态走 `chromeless`，每格只保留一层头部。

当前状态（2026-10-07 复核，由 agent-C 在本机实跑；这一笔同时把测试工具链从 vitest 3.2.4 升到 5.0.3，单测条数与覆盖率随该升级与「保留网段两侧判据对齐」重跑过；其后修 `watch.ts` 的 IPv6 方括号丢失与五处两侧判据分叉，并把判据表抽成两侧共读的 `tests/fixtures/watch-url-verdicts.json`（前端 +2、Rust +2）：**前端单测 1557 条（99 个文件）+ E2E 49 条 + Rust 单测 96 条**全绿（另有 2 条 `#[ignore]` 的主机侧门禁：`release_signature` 要安装包产物、`audio_probe` 要真麦克风，CI 上都不跑），`vue-tsc` 与 `tsc --noEmit` 都干净，受测层分支覆盖 **≥94%**（门禁 ≥90% + 逐文件棘轮，最近一次实测 95.01%），无 console 报错（由 E2E 里那条「拖拽与缩放全程无 console 报错」守着）。`vite build` 同日重跑：**JS 466.50 kB / gzip ~145.6 kB（主包 tokens 333.03 + 应用面 index 96.09 + 浮窗面 2.21 + core 1.93 + 更新插件面 1.03，余为共享 chunk；自 2026-10-16 起改成按产物名点名，原先那句「主包 366 + 命令面板与命令表 + …」随分块变化已经对不上账），CSS 141.36 kB / gzip ~20.9 kB**（比上一版记的 41.0 kB 大得多，因为多了桌面壳设置页、卡片内容、版面模板选择器、完整备份、更新插件与 41 种卡的 JS/CSS 面；CSS 相对上一版的 88.02 kB 多的部分，一是浏览态卡片 hover/active 反馈与添加菜单限高滚动那一笔，二是顶栏整合（排布下拉 + 统一高度 + 主 CTA）那一笔 —— 全是纯 CSS/模板增量，没进引擎。2026-10-08 两笔（默认皮肤改柔光、行高随窗口高度抬升，§10.27 / §10.28）复跑过一遍，主包随新增的 `src/vue/rowUnit.ts` 到 309.28 kB；2026-10-09 一笔（编辑态行高对齐浏览态，§10.29）复跑到上面这组数 —— 那一笔只多一个 prop 与几行注释，主包 309.28 → 309.33（+0.05），另加一条 E2E（22 → 23）；同日第二笔（引擎包改名 `@levango7/engine` 并开始发 npm，§12）只动名字与发布配置，主包体积不变，新增 `tests/release/engine-package.test.ts`（5 条）—— 单测 980 → 985、文件 66 → 67；2026-10-10 走查轮再 +11（降档对齐 4 + 投影贴左首配 3 + 拖拽门槛 4）、文件 67 → 68，E2E 23 → **25**（触摸长按 / 提示条 sticky）→ **996 / 68**，实跑值以本行数字为准；2026-10-10 第二笔（下拉菜单实底化，§10.30）只动 CSS：90.33 → 90.68；同笔把 JS 按实跑纠正为 311.30 —— 原记 310.36 漏认领了走查轮引擎侧（`spot.ts` 的 `findLeftFit` 等）进包的那部分，0.94 已贴到 ±1 kB 容差边缘；2026-10-11 第三笔（抓手区 + 悬停条，§10.31）：拖拽门槛契约重写（`canvasDragGate` 4 → 2 条）、E2E +1（悬停操作条）→ **994 / 68**、E2E **26**，JS 311.30 → 311.23、CSS 90.68 → 91.07（抓手图标 + 操作条胶囊底 + 标题带 24px）；2026-10-11 卡片批次 1（节假日 / 数据图表 / 命令速查，§10.32）：引擎新增 holiday / commands / chart 三个模块、卡组件 +3 —— 单测 +37、文件 68 → 71；JS 311.23 → 322.37、CSS 91.07 → 96.44；2026-10-11 批次 2（四象限待办 / 连通性探测 / 系统监控，§10.33）：引擎 probe / sysmon 两模块、卡组件 +3、Rust sysmon（sysinfo 依赖，cargo 测试 25 → 28）—— 单测 +33、文件 71 → 73、注册表 **47 种卡**；JS 322.37 → 336.74、CSS 96.44 → 102.79）；2026-10-11 第三笔（股票行情 / RSS 订阅，§10.34）：引擎 stock/rss 两模块、卡组件 +2 —— 单测 +27、文件 73 → 75、注册表 **52 种卡**；JS 336.74 → 349.15、CSS 102.79 → 108.08（两张卡组件与解析逻辑进包）；2026-10-12 阶段 B（行/分组容器，§10.35）：引擎新增 rows 模块（模型加法：Row/rows 字段与 Placement.row 归属，投影引擎零改动）、行头组件 —— 单测 +25、文件 75 → 76、E2E **26 → 28**（成组折叠展开解组 / 拖行头整组移动）；JS 349.15 → 356.78、CSS 108.08 → 109.61；2026-10-12 阶段 C（参数化一键自动重排，§10.36）：引擎 autoLayout 模块 + 行头参数控件 —— 单测 +25、文件 76 → 77、E2E **28 → 29**（行内重排 + 一步撤销）；JS 356.78 → 360.15、CSS 109.61 → 110.39（首测 110.13，随后补三枚行头图标钮的 22×22 命中区再 +0.26）；同日墨纸两笔（§10.37：卡边定值 + 卡面浮起）只动令牌值，体积微增；同日第四笔（编辑器事务化 + 「全部卡片」入口搬进模块库，§10.38）：store.restore + App 保存/取消/脏确认 + CardCatalogMenu 组件 —— 单测 +3、E2E **29 → 30**；JS 360.15 → 363.24、CSS 110.39 → 113.47；2026-10-13 潜在问题排查一轮（§10.39：网页版存储失败可见性 + 救命备份入口 / 待办删除热区）：单测 +3（1154）、E2E **30 → 31**；JS 363.24 → 362.84、CSS 113.47 → 114.01；2026-10-13 同日晚「脱离浮窗」第一批（§10.40）：Rust 单测 **32 → 35**（floatwin label/序列化/损坏兜底）、E2E **31 → 34**（Tauri 桩下的前端整链 +1、命令面板 +1、失焦/地址两条「本机绿 CI 红」修正后总数 34）；多出一个 float.html 入口与浮窗面（JS 369.70 / CSS 115.81，含浮窗面 2.37 kB JS + 1.21 kB CSS）；2026-10-13 深夜「命令总线与命令面板」（§10.41）：新增 `commands.ts`（22 条命令）+ `commandBus.ts` + `paletteIndex.ts` + 面板组件 + 表驱动测试 26 条 —— 单测 **1154 → 1199**（命令层表驱动 45 条）、文件 77 → 78；JS 369.70 → 383.51、CSS 115.81 → 118.43；2026-10-13 深夜「声明式扩展：网页取数」（§10.42）：引擎 `http.ts`（端点清洗/路径取值/格式化/取数计划）+ Rust `fetchjson.rs` + 新卡 —— 单测 **1199 → 1218**、文件 78 → 79、**卡 49 → 50**、Rust **35 → 38**、E2E **34 → 35**；JS 383.51 → 392.22、CSS 118.43 → 121.93；2026-10-13 夜「桌面工具箱：速达启动器」（§10.43）：引擎 `launcher.ts` + Rust `launcher.rs`（ShellExecuteW FFI）+ 新卡 —— 单测 **1218 → 1229**、文件 79 → 80、**卡 50 → 51**、Rust **38 → 41**、E2E **35 → 36**；JS 392.22 → 397.02、CSS 121.93 → 124.72；2026-10-13/14「HTML 扩展：自定卡」（§10.44）：引擎 `htmlcard.ts`（snippetLiteral 注入防线/信封校验/名单清洗）+ 沙箱卡 —— 单测 **1229 → 1249**、文件 80 → 81、**卡 51 → 52**、E2E **36 → 38**；JS 397.02 → 404.75、CSS 124.72 → 127.26；2026-10-16 Phase 3 前端批（§10.45 会议速记 + 窗口预览，两张卡都**仅桌面壳**、引擎零改动）：判定逻辑抽成 `src/vue/minutesLive.ts` / `src/vue/winPreview.ts` 两个纯模块并随卡进受测层、锁 100% 分支 —— 单测 **1249 → 1349**（+49 / +37 两条新用例文件）、文件 81 → 84、**注册表 54 种卡**（52 → 54）、E2E 38（不增：两张卡在网页版只渲染一句「仅桌面壳可用」，搭现有「全部卡上版」那条夹具的便车）；JS 404.75 → 426.90、CSS 127.26 → 136.12（含两张卡组件与窗口列表子组件）。**同日并入 origin/master**（PR #91~#96）后重测：`tests/scripts/` 2 个文件 41 条进来 —— 单测 **1349 → 1390**、文件 **84 → 86**；体积不变（并进来的只有 `scripts/` 测试，产品代码零变化）。同批顺手修掉三处既有欠账：① `winPreview.toFrameBytes` 视图分支改为**复制一份**并收紧返回类型 `Uint8Array<ArrayBuffer>`（TS 5.7 起 `BlobPart` 不收 `SharedArrayBuffer` 底，`vue-tsc` 实测报 TS2322 卡住整条 typecheck，子交付里「typecheck 通过」的说法在合入后不成立）；② `MinutesRecorder` 里一处 `clamp(10px, …, 11px)` 掉破最小字号铁律，锁死 11px；③ `docs-check` 的 Rust 条数改**递归**收集 —— 原写法 `readdirSync` 只数顶层 `.rs`，报 46 条而 `cargo test` 实跑 93 条，住在 `ai/` `capture/` `meeting/` 里的 47 条一条都没进判据；2026-10-16 第二笔（**门禁变异抽查**，零产品代码改动）—— 抽查结论是「现有门没有退化成假绿」，但当场抓到三处要修：① `docs:check` 那 6 条 `re` 型认领规则的正则**未锚定**，真值 54 时把「154 种卡」判**通过**（少一位/多一位的慢性漂移整个在射程外），现改走新的 `scripts/docs-check-claims.mjs`（判据 + CLI 两张口，与 `release-artifact-facts.mjs` 同一形状）并由 `tests/scripts/docs-check-claims.test.ts` 10 条钉住整位数（2026-10-16 当时 6 条，2026-10-19 行数抽取判据又 +4）；② `tests/release/engine-package.test.ts` 那条要走全量文件的扫描**撞默认 `testTimeout` 5000 ms**（本机全量 2 红 / 3 跑，红那次 5781 ms；隔离跑 3/3 绿；CI 分母 = 最近 29 个执行过 `verify` 的 run、4 个 verify 失败、**0 次同型红**），只给那一条 20s 预算、不动全局口径；③ `unitFacts` 此前让 `execSync` 直接抛，**任何一条单测红都会把整道门崩成 Node 堆栈**，日志里既没有测试名、也把「数字漂」与「测试红」压成同一个 exit 1 —— 现在接住并打印失败清单。单测 **1390 → 1396**、文件 **86 → 87**，覆盖率与体积与本笔无关；2026-10-17 并用 PR #53（**`calc.ts` 深层嵌套上限**，2026-10-11 那笔，§10.34）后重测 —— 单测 **1396 → 1398**、文件仍 **87**（`tests/engine/calc.test.ts` 现 **10 条**，较并用前 +2 —— `MAX_DEPTH=100` 话术与 `RangeError` 兜底各一条），覆盖率与体积与该笔无关；2026-10-17 并用 PR #55（**`baseconv.ts` 进制转换输入长度上限**，2026-10-11 那笔：超长输入会同步冻结界面）后重测 —— 单测 **1398 → 1401**、文件仍 **87**（`tests/engine/baseconv.test.ts` 现 **10 条**，较并用前 +3），覆盖率与体积与该笔无关；2026-10-17 并用 PR #52（**Cargo.lock 依赖来源门禁**，2026-10-11 那笔，纯门禁、产品面零改动）后重测 —— 单测 **1401 → 1405**、文件 **87 → 88**（新增 `tests/release/cargo-lock-source.test.ts` 4 条：每个 `source` 必须官方 crates.io、不许 git 依赖、外部包必须带 checksum、host 只认 `github.com` / `index.crates.io`，另含防空跑断言），覆盖率与体积与该笔无关。另：2026-10-17 修暗色皮肤 `button:hover` 对比度缺陷（`--brand-50` 在 `[data-theme='dark']` 下重定义，见 `docs/AGENT-COORD.md` 同日那行）：**CSS 136.12 → 136.18**（+0.06，只多一条 `color-mix` 声明）、**JS 不变**；同笔顺带核对这一维的当前实跑值 —— **JS 实为 427.24**（原记 426.90 是 2026-10-16 那笔的数；**撤掉本笔改动重建仍是 427.24**，故这 0.34 kB 与本笔无关，是期间累积的构建漂移，一直落在 `docs-check` 的 ±1 kB 容差内 —— 按实跑值更新）；2026-10-17 判据 2 的 range 口径统一 + 给它补上第一份测试（`tests/scripts/coord-gate-range.test.ts` 4 条，在临时 git 仓里跑，见 `docs/AGENT-COORD.md` 同日那行）—— 单测 **1405 → 1409**、文件 **88 → 89**，覆盖率与体积与该笔无关（`scripts/` 与 `tests/scripts/` 不进受测层）；2026-10-17 接上会议速记的**历史半边**（列表 / 详情 / 摘要 / 删除四处 UI 接通 `meeting_list / get / delete / summarize` 四个既有 Rust 命令 —— 它们在 `src/` 此前零调用，见 `docs/AGENT-COORD.md` 同日那行）：纯判定抽进 `src/vue/meetings.ts` 并进受测层逐文件棘轮**锁 100**，列表与详情各自自持 IPC、卡本体只做路由（`src/app/cards/MinutesCard.vue` 410 行，纪律内）—— 单测 **1409 → 1424**（`tests/vue/meetings.test.ts` 新文件 15 条）、文件 **89 → 90**，E2E **38 → 41**（`tests/e2e/minutes.spec.ts` 新文件 3 条：Tauri 桩预置 meeting 数据，在真组件上跑「分组渲染 / 详情取转写 / 摘要生成与徽标回读 / 两步删除」的前端整链，桩的删除与摘要**原地改桩数据**才能真测「回读落盘值」）；**JS 427.24 → 434.27**、**CSS 136.18 → 141.10**（两个新组件的 scoped 样式与 `meetings.ts` 全在这一增量里，按产物名 tokens 333.03 + index 96.09 分账见上行）；2026-10-20 第二笔（**同种卡多实例，阶段 1**）：引擎给版面条目加可选 `module` 字段与 `moduleIdOf()`，贯穿投影/校验/行折叠展开/缩放/切形态/自动重排；store 生成 `模块:2` 实例 id；模块库与「全部卡片」不再隐藏已放置卡；浮窗按实例找模块再渲染。**旧档/模板/单实例形状逐字不变**（第一实例不写 `module`）。单测 **1431 → 1435**、文件 90 不变（用例落在既有文件里），受测层分支覆盖 94.82 → 94.72%（新增分支多于用例），JS 464.21 → 464.79 kB；`src/vue/components/ModuleLibrary.vue` 204 → 201 行（去掉「全部已放置即禁用」的分支）。**阶段 2（按实例拆数据）未做**，判据见 `docs/design/FUNCTIONAL-SPEC.md` F-01。2026-10-20 第三笔（**内容级撤销**）：新增 `src/vue/contentHistory.ts`（`CardData` 整份快照 + 环形 50 步 + 500ms 合并窗口），App 的 `undoLatest()` 按时间戳路由（编辑态撤版面、工作台态撤内容）；顶栏按钮改为「撤销上一步」。单测 **1435 → 1444**、文件 **90 → 91**（新增 `tests/vue/contentHistory.test.ts` 9 条）；JS 464.32 → 466.50 kB（App 与新增模块进包），受测层覆盖不变。顺带把 `tests/engine/baseconv.test.ts` 的 4096 位耗时阈值 1000 → 3000 ms：本机负载下实测 1255 ms，原阈值会误报（本意是挡数量级回归）。另：`dist/index.html` 因首屏防闪脚本增至 3.00 kB，它不计入上面两个体积口径）。2026-10-17 **卡组件懒加载化**（#11/#12 同根，见 §12.9 首屏成本实测与 `docs/AGENT-COORD.md` 同日那行）：`cardComponents.ts` 此前 54 张卡**全静态 import**，而默认模板 `general` 只用 clock / todo / sticky / notes 四张（recent 复用 NotesCard），首屏白白解析 50 张卡；现除首屏四兄弟外 50 张全改 `defineAsyncComponent` + 字面量 `import()`（一张卡一个 chunk），`tokens.css` 加 `.card-fallback` 两条占位样式（加载中 / 加载失败如实说，不造骨架屏 —— 本地 chunk 毫秒级到位，骨架闪一帧反而碍眼）。**体积分两个口径记，别混着看**：**JS 总量 434.27 → 463.38 kB**（+29.1：50 个按需 chunk 各自带一小段 boilerplate，CSS 141.10 → **141.34**），但**首屏（load 事件前实际下载并求值的 17 个 chunk）434.27 → 272.80 kB / gzip ~99.5 kB（原 gzip ~145.6）—— 首屏降 37%**，tokens 主包 333.03 → **104.09**、index 96.09 → **96.64**、新增共享 helper 61.09，按需那 50 个卡 chunk 合计约 190 kB 在首屏之后才按需下载。桌面探针的项数是条件量，见 README「验证」一节里那两个原始行与出处；口径与 §11.3。2026-10-18 修「加卡先空一格」（§12.10：`delay` 200 → 32 + `preloadCard` 预取，并补 E2E 一条）后重测：**JS 463.69**（较上笔 +0.31，只多了 `preloadCard` 与两处模板属性）、CSS 141.34 不变；**E2E 41 → 42**。2026-10-19 拆 `CanvasEditor.vue`（§12.11）：**JS 463.69 → 464.32**（+0.63，两个新组件各一份样板与 scoped 属性）、CSS 141.34 → 141.36（噪声级），单测与 E2E 条数不变；`src/vue/components/CanvasEditor.vue` **834 → 677 行**，`src/vue/components/ModuleLibrary.vue` 201 行、`src/vue/components/BatchActionBar.vue` 45 行。2026-10-19 第二笔（**行数棘轮机器化**，判据细节与变异抽查详见 §12.11）：`docs-check` 新增**「文件行数」维度** —— 标记行里点名的 `.vue` / `.ts` 文件逐个读盘数换行，写错数字 / 改名 / 路径越界当场红；上岗首轮先咬到一口 —— **裸文件名认领解析不出路径被拒**（文件住 `src/vue/components/`），认领一律改全相对路径。判据与 CLI 走 `scripts/docs-check-claims.mjs` 新增的 `fileLineClaims`（箭头链取末数、路径到数字 8 字符窗口，kB / 条 / 行号引用不认领），抽取器钉进 `tests/scripts/docs-check-claims.test.ts`（+4）—— 单测 **1424 → 1428**、文件仍 **90**；变异抽查按规矩做：账本行 677 改 678，`docs-check` 红、报出「实测 677 行，这行写的是 678 行」后回滚 —— 门不是假绿。覆盖率与体积与本笔无关。2026-10-20 拆 `src/vue/cardData.ts`（#124，来龙去脉见 §12.12）：**909 → 367 行**，按关注面分成五份 —— 类型 `src/vue/cardDataTypes.ts` **210 行**、清洗 `src/vue/cardDataSanitize.ts` **346 行**、两层共用的数值上限 `src/vue/cardDataLimits.ts` **50 行**、示例内容 `src/vue/cardDataFallback.ts` **50 行**，store 层留在同名文件并做 barrel 再导出（导出面逐字一致，卡片组件与测试零改动）。**拆的过程里新用例咬出一个真 bug**：条目 id 是裸 `Date.now()`，同毫秒连加两条就撞号，而 `updateHtmlCard` / `removeXxx` 全是按 id 定点 —— 撞号会连坐误伤无辜那条（`sanitizeCardData` 里 `uniqueId` 的注释早写了这条不变量，写入路径一直没兑现它）；7 处统一改 `nextId`（时间戳 + 4 位随机后缀，与 `useSchemes.ts` 同招式）。清洗层与共享上限随拆分进受测层并登记逐文件棘轮（`src/vue/cardData.ts` 实测 97.84，原 97 地板复核通过不动；`src/vue/cardDataSanitize.ts` 99.58 取 **99**；`src/vue/cardDataLimits.ts` 100 锁满）—— 单测 **1428 → 1431**（+3：端点定点映射 / 自定卡定点映射 / 只改片段不动标题）、文件仍 **90**，E2E 42 不变；**JS 464.32 → 464.21**、CSS 141.36 不变。2026-10-20 第四笔（**完整备份与自动备份**，P0-③）：`confirmRestore` 此前只回填便签 / 待办 / 速记 / 倒数日四个字段，而备份包里一直是全的 —— 记账、四象限、习惯、生日、链接、订阅、自选、自定卡**静默丢失**（导出是全的、恢复是残的）。现改 `applyCardData()` 整份深拷贝回填；`BACKUP_VERSION` 1 → **2**，包内新增设置段（外观 + 上次选的模板；`shell.v1` 与 AI 密钥刻意不收）；自动备份环形 7 份（每日首启 / 恢复前 / 版本变化后首启），只在桌面写。实现时抓到一个**静默失效**：桌面适配器 `get` 只读启动时按 `DATA_KEYS` hydrate 的内存镜像，自动备份的 8 个键若不进那张表不会报错，症状是「写得下去、重启读不到」—— 每次启动重建基线并把 7 份洗掉；已登记进表，并加一条把整条链跑真的用例（写 → 落盘 → 按表 hydrate → 列表仍有那份备份），变异验证：删掉那两行键，该用例当场红。设置页顺带修掉「面板挂载不刷新自动备份列表」这条真 bug。`src/vue/backup.ts` 的逐文件棘轮 95 → **100**（补上四条从没执行过的分支：残缺包无版面段 / 导出时间读不懂 / settings 整段不是对象 / template 显式 null），并把共享夹具里 `watch`/`endpoints`/`launch` 三个一直为空的数组填上真数据 —— 那三行 `buildBackup` 的逐条拷贝从没被执行过。单测 **1444 → 1463 条**、文件 **91 → 92 个文件**（新增 `tests/vue/useBackup.test.ts` 11 条），受测层分支覆盖 94.72 → **94.87%**；**JS 466.50 → 470.84 kB**、**CSS 141.36 → 141.84 kB**（备份区与新胶水进包）。2026-10-21 第五笔（**提醒，P0-④ 阶段 1**）：新 `src/vue/reminders.ts`（纯判定，`now` 注入：倒数日就是今天 / 生日就是今天（闰日平年落 2/28，跟引擎走）/ 习惯过点未打卡）+ `src/vue/useReminders.ts`（每分钟对表、一天一次的去重、静默时段只压投递不压事实、坏存储与写失败不拦投递）；投递是注入回调，App 里接一条可收起的提醒横幅，设置面板加「提醒」一节。**默认不静默**（起止相同 = 关）—— 静默跨午夜会让"就是今天"的事件再也补不回来。`modulo.reminders.v1` 已登记进 `DATA_KEYS`（P0-③ 那条静默失效的教训），并有一条 `createFileStorage → hydrateData → 新实例` 的用例证明重启不重弹。两个新模块各锁分支 **100**。待办没有截止日期字段，所以**不做到期提醒**。阶段 2（系统通知 + 点击深链）需引 `tauri-plugin-notification`，未做。单测 **1463 → 1496 条**、文件 **92 → 94 个文件**（新增两个用例文件共 33 条）、E2E **42 → 43 条**；受测层分支覆盖 94.87 → **95.00%**；**JS 470.84 → 475.88 kB**、**CSS 141.84 → 143.21 kB**。2026-10-21 第六笔（**系统通知，P0-④ 阶段 2**）：桌面壳接 `tauri-plugin-notification`（**这一版唯一新增的依赖**：Cargo `tauri-plugin-notification = "2"` → 2.7.0，Windows 走 `tauri-winrt-notification`；npm `@tauri-apps/plugin-notification@^2.7.0`；capabilities 加 `notification:default`；`lib.rs` 注册插件）。投放层 `src/vue/notify.ts` **动态 import**（网页版不进包）：权限被拒 / 加载失败 / 发送抛错一律返回 false、绝不抛 —— 应用内横幅仍是兜底。App 的 `deliver` 在桌面且开关打开时同发系统通知；设置面板加「同时发系统通知」（默认开、只桌面可见）。**一条做不到的事已写死**：Windows 上插件拿不到"点了哪一条"（交互式 action 只有移动端有），所以**没有深链**，点通知只有系统默认的"把应用带到前台"；开发态 Toast 显示 `powershell.exe` 身份与图标，装成安装包后才是 Modulo（插件文档原话）。判定/去重/静默时段与阶段 1 完全共用。单测 **1496 → 1504 条**、文件 **94 → 95 个文件**（新增 `tests/vue/notify.test.ts` 7 条、`useReminders` +1）、E2E 43 条不变；受测层分支覆盖 95.00 → **95.02%**（`notify.ts` 锁分支 100）；**JS 475.88 → 479.70 kB**、**CSS 143.21 kB 不变**（只多一个开关文案）。本机 Rust 编译跑不通（GNU 缺 dlltool / MSVC 的 link 被 Git Bash 抢），Rust 腿以 CI 桌面 job 为准。2026-10-21 第七笔（**迁移框架，P0-⑤**）：`migrateWith(raw, table, to)` 把迁移表参数化（版面仍用引擎 `MIGRATIONS`；方案册 / 卡片内容各一张空表、独立版本线），`src/vue/migrate.ts` 在 **store 读盘之前**统一迁移并**写回**（此前只迁不落盘 ⇒ 每次启动重迁、删旧步骤后老数据读不出来）；写回前把原文快照进 `modulo.migration.backup.v1`（最近 3 次，**快照写不出就不迁移**），失败一律保留原件并把提示接到界面（迁移提示首次有 UI）。**顺手修掉一个真缺陷**：`migrate()` 注释写着"不抛"，但 `step(cur)` 没有 try/catch —— 一条迁移函数抛错会击穿 `parseLayout`，在启动路径上就是白屏，现在按注释兑现并有单测。生产计划对当前 v1 数据是空操作（单测钉住"不重写、不留快照"）；版面计划的 `to` 跟着 `CURRENT_SCHEMA_VERSION` 走，不写死 1。单测 **1504 → 1522 条**、文件 **95 → 96 个文件**（新增 `tests/vue/migrate.test.ts` 14 条、`tests/engine/serialize.test.ts` +4）、E2E 43 条不变；受测层分支覆盖 95.02 → **94.94%**（`migrate.ts` 地板按实测取 80）；**JS 479.70 → 481.59 kB**、CSS 143.21 kB 不变。当前状态（2026-10-07 复核，由 agent-C 在本机实跑；这一笔同时把测试工具链从 vitest 3.2.4 升到 5.0.3，单测条数与覆盖率随该升级与「保留网段两侧判据对齐」重跑过；其后修 `watch.ts` 的 IPv6 方括号丢失与五处两侧判据分叉，并把判据表抽成两侧共读的 `tests/fixtures/watch-url-verdicts.json`（前端 +2、Rust +2）：**前端单测 1526 条（96 个文件）+ E2E 43 条 + Rust 单测 93 条**全绿（另有 2 条 `#[ignore]` 的主机侧门禁：`release_signature` 要安装包产物、`audio_probe` 要真麦克风，CI 上都不跑），`vue-tsc` 与 `tsc --noEmit` 都干净，受测层分支覆盖 **≥94%**（门禁 ≥90% + 逐文件棘轮，最近一次实测 95.10%），无 console 报错（由 E2E 里那条「拖拽与缩放全程无 console 报错」守着）。`vite build` 同日重跑：**JS 466.50 kB / gzip ~145.6 kB（主包 tokens 333.03 + 应用面 index 96.09 + 浮窗面 2.21 + core 1.93 + 更新插件面 1.03，余为共享 chunk；自 2026-10-16 起改成按产物名点名，原先那句「主包 366 + 命令面板与命令表 + …」随分块变化已经对不上账），CSS 141.36 kB / gzip ~20.9 kB**（比上一版记的 41.0 kB 大得多，因为多了桌面壳设置页、卡片内容、版面模板选择器、完整备份、更新插件与 41 种卡的 JS/CSS 面；CSS 相对上一版的 88.02 kB 多的部分，一是浏览态卡片 hover/active 反馈与添加菜单限高滚动那一笔，二是顶栏整合（排布下拉 + 统一高度 + 主 CTA）那一笔 —— 全是纯 CSS/模板增量，没进引擎。2026-10-08 两笔（默认皮肤改柔光、行高随窗口高度抬升，§10.27 / §10.28）复跑过一遍，主包随新增的 `src/vue/rowUnit.ts` 到 309.28 kB；2026-10-09 一笔（编辑态行高对齐浏览态，§10.29）复跑到上面这组数 —— 那一笔只多一个 prop 与几行注释，主包 309.28 → 309.33（+0.05），另加一条 E2E（22 → 23）；同日第二笔（引擎包改名 `@levango7/engine` 并开始发 npm，§12）只动名字与发布配置，主包体积不变，新增 `tests/release/engine-package.test.ts`（5 条）—— 单测 980 → 985、文件 66 → 67；2026-10-10 走查轮再 +11（降档对齐 4 + 投影贴左首配 3 + 拖拽门槛 4）、文件 67 → 68，E2E 23 → **25**（触摸长按 / 提示条 sticky）→ **996 / 68**，实跑值以本行数字为准；2026-10-10 第二笔（下拉菜单实底化，§10.30）只动 CSS：90.33 → 90.68；同笔把 JS 按实跑纠正为 311.30 —— 原记 310.36 漏认领了走查轮引擎侧（`spot.ts` 的 `findLeftFit` 等）进包的那部分，0.94 已贴到 ±1 kB 容差边缘；2026-10-11 第三笔（抓手区 + 悬停条，§10.31）：拖拽门槛契约重写（`canvasDragGate` 4 → 2 条）、E2E +1（悬停操作条）→ **994 / 68**、E2E **26**，JS 311.30 → 311.23、CSS 90.68 → 91.07（抓手图标 + 操作条胶囊底 + 标题带 24px）；2026-10-11 卡片批次 1（节假日 / 数据图表 / 命令速查，§10.32）：引擎新增 holiday / commands / chart 三个模块、卡组件 +3 —— 单测 +37、文件 68 → 71；JS 311.23 → 322.37、CSS 91.07 → 96.44；2026-10-11 批次 2（四象限待办 / 连通性探测 / 系统监控，§10.33）：引擎 probe / sysmon 两模块、卡组件 +3、Rust sysmon（sysinfo 依赖，cargo 测试 25 → 28）—— 单测 +33、文件 71 → 73、注册表 **47 种卡**；JS 322.37 → 336.74、CSS 96.44 → 102.79）；2026-10-11 第三笔（股票行情 / RSS 订阅，§10.34）：引擎 stock/rss 两模块、卡组件 +2 —— 单测 +27、文件 73 → 75、注册表 **52 种卡**；JS 336.74 → 349.15、CSS 102.79 → 108.08（两张卡组件与解析逻辑进包）；2026-10-12 阶段 B（行/分组容器，§10.35）：引擎新增 rows 模块（模型加法：Row/rows 字段与 Placement.row 归属，投影引擎零改动）、行头组件 —— 单测 +25、文件 75 → 76、E2E **26 → 28**（成组折叠展开解组 / 拖行头整组移动）；JS 349.15 → 356.78、CSS 108.08 → 109.61；2026-10-12 阶段 C（参数化一键自动重排，§10.36）：引擎 autoLayout 模块 + 行头参数控件 —— 单测 +25、文件 76 → 77、E2E **28 → 29**（行内重排 + 一步撤销）；JS 356.78 → 360.15、CSS 109.61 → 110.39（首测 110.13，随后补三枚行头图标钮的 22×22 命中区再 +0.26）；同日墨纸两笔（§10.37：卡边定值 + 卡面浮起）只动令牌值，体积微增；同日第四笔（编辑器事务化 + 「全部卡片」入口搬进模块库，§10.38）：store.restore + App 保存/取消/脏确认 + CardCatalogMenu 组件 —— 单测 +3、E2E **29 → 30**；JS 360.15 → 363.24、CSS 110.39 → 113.47；2026-10-13 潜在问题排查一轮（§10.39：网页版存储失败可见性 + 救命备份入口 / 待办删除热区）：单测 +3（1154）、E2E **30 → 31**；JS 363.24 → 362.84、CSS 113.47 → 114.01；2026-10-13 同日晚「脱离浮窗」第一批（§10.40）：Rust 单测 **32 → 35**（floatwin label/序列化/损坏兜底）、E2E **31 → 34**（Tauri 桩下的前端整链 +1、命令面板 +1、失焦/地址两条「本机绿 CI 红」修正后总数 34）；多出一个 float.html 入口与浮窗面（JS 369.70 / CSS 115.81，含浮窗面 2.37 kB JS + 1.21 kB CSS）；2026-10-13 深夜「命令总线与命令面板」（§10.41）：新增 `commands.ts`（22 条命令）+ `commandBus.ts` + `paletteIndex.ts` + 面板组件 + 表驱动测试 26 条 —— 单测 **1154 → 1199**（命令层表驱动 45 条）、文件 77 → 78；JS 369.70 → 383.51、CSS 115.81 → 118.43；2026-10-13 深夜「声明式扩展：网页取数」（§10.42）：引擎 `http.ts`（端点清洗/路径取值/格式化/取数计划）+ Rust `fetchjson.rs` + 新卡 —— 单测 **1199 → 1218**、文件 78 → 79、**卡 49 → 50**、Rust **35 → 38**、E2E **34 → 35**；JS 383.51 → 392.22、CSS 118.43 → 121.93；2026-10-13 夜「桌面工具箱：速达启动器」（§10.43）：引擎 `launcher.ts` + Rust `launcher.rs`（ShellExecuteW FFI）+ 新卡 —— 单测 **1218 → 1229**、文件 79 → 80、**卡 50 → 51**、Rust **38 → 41**、E2E **35 → 36**；JS 392.22 → 397.02、CSS 121.93 → 124.72；2026-10-13/14「HTML 扩展：自定卡」（§10.44）：引擎 `htmlcard.ts`（snippetLiteral 注入防线/信封校验/名单清洗）+ 沙箱卡 —— 单测 **1229 → 1249**、文件 80 → 81、**卡 51 → 52**、E2E **36 → 38**；JS 397.02 → 404.75、CSS 124.72 → 127.26；2026-10-16 Phase 3 前端批（§10.45 会议速记 + 窗口预览，两张卡都**仅桌面壳**、引擎零改动）：判定逻辑抽成 `src/vue/minutesLive.ts` / `src/vue/winPreview.ts` 两个纯模块并随卡进受测层、锁 100% 分支 —— 单测 **1249 → 1349**（+49 / +37 两条新用例文件）、文件 81 → 84、**注册表 54 种卡**（52 → 54）、E2E 38（不增：两张卡在网页版只渲染一句「仅桌面壳可用」，搭现有「全部卡上版」那条夹具的便车）；JS 404.75 → 426.90、CSS 127.26 → 136.12（含两张卡组件与窗口列表子组件）。**同日并入 origin/master**（PR #91~#96）后重测：`tests/scripts/` 2 个文件 41 条进来 —— 单测 **1349 → 1390**、文件 **84 → 86**；体积不变（并进来的只有 `scripts/` 测试，产品代码零变化）。同批顺手修掉三处既有欠账：① `winPreview.toFrameBytes` 视图分支改为**复制一份**并收紧返回类型 `Uint8Array<ArrayBuffer>`（TS 5.7 起 `BlobPart` 不收 `SharedArrayBuffer` 底，`vue-tsc` 实测报 TS2322 卡住整条 typecheck，子交付里「typecheck 通过」的说法在合入后不成立）；② `MinutesRecorder` 里一处 `clamp(10px, …, 11px)` 掉破最小字号铁律，锁死 11px；③ `docs-check` 的 Rust 条数改**递归**收集 —— 原写法 `readdirSync` 只数顶层 `.rs`，报 46 条而 `cargo test` 实跑 93 条，住在 `ai/` `capture/` `meeting/` 里的 47 条一条都没进判据；2026-10-16 第二笔（**门禁变异抽查**，零产品代码改动）—— 抽查结论是「现有门没有退化成假绿」，但当场抓到三处要修：① `docs:check` 那 6 条 `re` 型认领规则的正则**未锚定**，真值 54 时把「154 种卡」判**通过**（少一位/多一位的慢性漂移整个在射程外），现改走新的 `scripts/docs-check-claims.mjs`（判据 + CLI 两张口，与 `release-artifact-facts.mjs` 同一形状）并由 `tests/scripts/docs-check-claims.test.ts` 10 条钉住整位数（2026-10-16 当时 6 条，2026-10-19 行数抽取判据又 +4）；② `tests/release/engine-package.test.ts` 那条要走全量文件的扫描**撞默认 `testTimeout` 5000 ms**（本机全量 2 红 / 3 跑，红那次 5781 ms；隔离跑 3/3 绿；CI 分母 = 最近 29 个执行过 `verify` 的 run、4 个 verify 失败、**0 次同型红**），只给那一条 20s 预算、不动全局口径；③ `unitFacts` 此前让 `execSync` 直接抛，**任何一条单测红都会把整道门崩成 Node 堆栈**，日志里既没有测试名、也把「数字漂」与「测试红」压成同一个 exit 1 —— 现在接住并打印失败清单。单测 **1390 → 1396**、文件 **86 → 87**，覆盖率与体积与本笔无关；2026-10-17 并用 PR #53（**`calc.ts` 深层嵌套上限**，2026-10-11 那笔，§10.34）后重测 —— 单测 **1396 → 1398**、文件仍 **87**（`tests/engine/calc.test.ts` 现 **10 条**，较并用前 +2 —— `MAX_DEPTH=100` 话术与 `RangeError` 兜底各一条），覆盖率与体积与该笔无关；2026-10-17 并用 PR #55（**`baseconv.ts` 进制转换输入长度上限**，2026-10-11 那笔：超长输入会同步冻结界面）后重测 —— 单测 **1398 → 1401**、文件仍 **87**（`tests/engine/baseconv.test.ts` 现 **10 条**，较并用前 +3），覆盖率与体积与该笔无关；2026-10-17 并用 PR #52（**Cargo.lock 依赖来源门禁**，2026-10-11 那笔，纯门禁、产品面零改动）后重测 —— 单测 **1401 → 1405**、文件 **87 → 88**（新增 `tests/release/cargo-lock-source.test.ts` 4 条：每个 `source` 必须官方 crates.io、不许 git 依赖、外部包必须带 checksum、host 只认 `github.com` / `index.crates.io`，另含防空跑断言），覆盖率与体积与该笔无关。另：2026-10-17 修暗色皮肤 `button:hover` 对比度缺陷（`--brand-50` 在 `[data-theme='dark']` 下重定义，见 `docs/AGENT-COORD.md` 同日那行）：**CSS 136.12 → 136.18**（+0.06，只多一条 `color-mix` 声明）、**JS 不变**；同笔顺带核对这一维的当前实跑值 —— **JS 实为 427.24**（原记 426.90 是 2026-10-16 那笔的数；**撤掉本笔改动重建仍是 427.24**，故这 0.34 kB 与本笔无关，是期间累积的构建漂移，一直落在 `docs-check` 的 ±1 kB 容差内 —— 按实跑值更新）；2026-10-17 判据 2 的 range 口径统一 + 给它补上第一份测试（`tests/scripts/coord-gate-range.test.ts` 4 条，在临时 git 仓里跑，见 `docs/AGENT-COORD.md` 同日那行）—— 单测 **1405 → 1409**、文件 **88 → 89**，覆盖率与体积与该笔无关（`scripts/` 与 `tests/scripts/` 不进受测层）；2026-10-17 接上会议速记的**历史半边**（列表 / 详情 / 摘要 / 删除四处 UI 接通 `meeting_list / get / delete / summarize` 四个既有 Rust 命令 —— 它们在 `src/` 此前零调用，见 `docs/AGENT-COORD.md` 同日那行）：纯判定抽进 `src/vue/meetings.ts` 并进受测层逐文件棘轮**锁 100**，列表与详情各自自持 IPC、卡本体只做路由（`src/app/cards/MinutesCard.vue` 410 行，纪律内）—— 单测 **1409 → 1424**（`tests/vue/meetings.test.ts` 新文件 15 条）、文件 **89 → 90**，E2E **38 → 41**（`tests/e2e/minutes.spec.ts` 新文件 3 条：Tauri 桩预置 meeting 数据，在真组件上跑「分组渲染 / 详情取转写 / 摘要生成与徽标回读 / 两步删除」的前端整链，桩的删除与摘要**原地改桩数据**才能真测「回读落盘值」）；**JS 427.24 → 434.27**、**CSS 136.18 → 141.10**（两个新组件的 scoped 样式与 `meetings.ts` 全在这一增量里，按产物名 tokens 333.03 + index 96.09 分账见上行）；2026-10-20 第二笔（**同种卡多实例，阶段 1**）：引擎给版面条目加可选 `module` 字段与 `moduleIdOf()`，贯穿投影/校验/行折叠展开/缩放/切形态/自动重排；store 生成 `模块:2` 实例 id；模块库与「全部卡片」不再隐藏已放置卡；浮窗按实例找模块再渲染。**旧档/模板/单实例形状逐字不变**（第一实例不写 `module`）。单测 **1431 → 1435**、文件 90 不变（用例落在既有文件里），受测层分支覆盖 94.82 → 94.72%（新增分支多于用例），JS 464.21 → 464.79 kB；`src/vue/components/ModuleLibrary.vue` 204 → 201 行（去掉「全部已放置即禁用」的分支）。**阶段 2（按实例拆数据）未做**，判据见 `docs/design/FUNCTIONAL-SPEC.md` F-01。2026-10-20 第三笔（**内容级撤销**）：新增 `src/vue/contentHistory.ts`（`CardData` 整份快照 + 环形 50 步 + 500ms 合并窗口），App 的 `undoLatest()` 按时间戳路由（编辑态撤版面、工作台态撤内容）；顶栏按钮改为「撤销上一步」。单测 **1435 → 1444**、文件 **90 → 91**（新增 `tests/vue/contentHistory.test.ts` 9 条）；JS 464.32 → 466.50 kB（App 与新增模块进包），受测层覆盖不变。顺带把 `tests/engine/baseconv.test.ts` 的 4096 位耗时阈值 1000 → 3000 ms：本机负载下实测 1255 ms，原阈值会误报（本意是挡数量级回归）。另：`dist/index.html` 因首屏防闪脚本增至 3.00 kB，它不计入上面两个体积口径）。2026-10-17 **卡组件懒加载化**（#11/#12 同根，见 §12.9 首屏成本实测与 `docs/AGENT-COORD.md` 同日那行）：`cardComponents.ts` 此前 54 张卡**全静态 import**，而默认模板 `general` 只用 clock / todo / sticky / notes 四张（recent 复用 NotesCard），首屏白白解析 50 张卡；现除首屏四兄弟外 50 张全改 `defineAsyncComponent` + 字面量 `import()`（一张卡一个 chunk），`tokens.css` 加 `.card-fallback` 两条占位样式（加载中 / 加载失败如实说，不造骨架屏 —— 本地 chunk 毫秒级到位，骨架闪一帧反而碍眼）。**体积分两个口径记，别混着看**：**JS 总量 434.27 → 463.38 kB**（+29.1：50 个按需 chunk 各自带一小段 boilerplate，CSS 141.10 → **141.34**），但**首屏（load 事件前实际下载并求值的 17 个 chunk）434.27 → 272.80 kB / gzip ~99.5 kB（原 gzip ~145.6）—— 首屏降 37%**，tokens 主包 333.03 → **104.09**、index 96.09 → **96.64**、新增共享 helper 61.09，按需那 50 个卡 chunk 合计约 190 kB 在首屏之后才按需下载。桌面探针的项数是条件量，见 README「验证」一节里那两个原始行与出处；口径与 §11.3。2026-10-18 修「加卡先空一格」（§12.10：`delay` 200 → 32 + `preloadCard` 预取，并补 E2E 一条）后重测：**JS 463.69**（较上笔 +0.31，只多了 `preloadCard` 与两处模板属性）、CSS 141.34 不变；**E2E 41 → 42**。2026-10-19 拆 `CanvasEditor.vue`（§12.11）：**JS 463.69 → 464.32**（+0.63，两个新组件各一份样板与 scoped 属性）、CSS 141.34 → 141.36（噪声级），单测与 E2E 条数不变；`src/vue/components/CanvasEditor.vue` **834 → 677 行**，`src/vue/components/ModuleLibrary.vue` 201 行、`src/vue/components/BatchActionBar.vue` 45 行。2026-10-19 第二笔（**行数棘轮机器化**，判据细节与变异抽查详见 §12.11）：`docs-check` 新增**「文件行数」维度** —— 标记行里点名的 `.vue` / `.ts` 文件逐个读盘数换行，写错数字 / 改名 / 路径越界当场红；上岗首轮先咬到一口 —— **裸文件名认领解析不出路径被拒**（文件住 `src/vue/components/`），认领一律改全相对路径。判据与 CLI 走 `scripts/docs-check-claims.mjs` 新增的 `fileLineClaims`（箭头链取末数、路径到数字 8 字符窗口，kB / 条 / 行号引用不认领），抽取器钉进 `tests/scripts/docs-check-claims.test.ts`（+4）—— 单测 **1424 → 1428**、文件仍 **90**；变异抽查按规矩做：账本行 677 改 678，`docs-check` 红、报出「实测 677 行，这行写的是 678 行」后回滚 —— 门不是假绿。覆盖率与体积与本笔无关。2026-10-20 拆 `src/vue/cardData.ts`（#124，来龙去脉见 §12.12）：**909 → 367 行**，按关注面分成五份 —— 类型 `src/vue/cardDataTypes.ts` **210 行**、清洗 `src/vue/cardDataSanitize.ts` **346 行**、两层共用的数值上限 `src/vue/cardDataLimits.ts` **50 行**、示例内容 `src/vue/cardDataFallback.ts` **50 行**，store 层留在同名文件并做 barrel 再导出（导出面逐字一致，卡片组件与测试零改动）。**拆的过程里新用例咬出一个真 bug**：条目 id 是裸 `Date.now()`，同毫秒连加两条就撞号，而 `updateHtmlCard` / `removeXxx` 全是按 id 定点 —— 撞号会连坐误伤无辜那条（`sanitizeCardData` 里 `uniqueId` 的注释早写了这条不变量，写入路径一直没兑现它）；7 处统一改 `nextId`（时间戳 + 4 位随机后缀，与 `useSchemes.ts` 同招式）。清洗层与共享上限随拆分进受测层并登记逐文件棘轮（`src/vue/cardData.ts` 实测 97.84，原 97 地板复核通过不动；`src/vue/cardDataSanitize.ts` 99.58 取 **99**；`src/vue/cardDataLimits.ts` 100 锁满）—— 单测 **1428 → 1431**（+3：端点定点映射 / 自定卡定点映射 / 只改片段不动标题）、文件仍 **90**，E2E 42 不变；**JS 464.32 → 464.21**、CSS 141.36 不变。2026-10-20 第四笔（**完整备份与自动备份**，P0-③）：`confirmRestore` 此前只回填便签 / 待办 / 速记 / 倒数日四个字段，而备份包里一直是全的 —— 记账、四象限、习惯、生日、链接、订阅、自选、自定卡**静默丢失**（导出是全的、恢复是残的）。现改 `applyCardData()` 整份深拷贝回填；`BACKUP_VERSION` 1 → **2**，包内新增设置段（外观 + 上次选的模板；`shell.v1` 与 AI 密钥刻意不收）；自动备份环形 7 份（每日首启 / 恢复前 / 版本变化后首启），只在桌面写。实现时抓到一个**静默失效**：桌面适配器 `get` 只读启动时按 `DATA_KEYS` hydrate 的内存镜像，自动备份的 8 个键若不进那张表不会报错，症状是「写得下去、重启读不到」—— 每次启动重建基线并把 7 份洗掉；已登记进表，并加一条把整条链跑真的用例（写 → 落盘 → 按表 hydrate → 列表仍有那份备份），变异验证：删掉那两行键，该用例当场红。设置页顺带修掉「面板挂载不刷新自动备份列表」这条真 bug。`src/vue/backup.ts` 的逐文件棘轮 95 → **100**（补上四条从没执行过的分支：残缺包无版面段 / 导出时间读不懂 / settings 整段不是对象 / template 显式 null），并把共享夹具里 `watch`/`endpoints`/`launch` 三个一直为空的数组填上真数据 —— 那三行 `buildBackup` 的逐条拷贝从没被执行过。单测 **1444 → 1463 条**、文件 **91 → 92 个文件**（新增 `tests/vue/useBackup.test.ts` 11 条），受测层分支覆盖 94.72 → **94.87%**；**JS 466.50 → 470.84 kB**、**CSS 141.36 → 141.84 kB**（备份区与新胶水进包）。2026-10-21 第五笔（**提醒，P0-④ 阶段 1**）：新 `src/vue/reminders.ts`（纯判定，`now` 注入：倒数日就是今天 / 生日就是今天（闰日平年落 2/28，跟引擎走）/ 习惯过点未打卡）+ `src/vue/useReminders.ts`（每分钟对表、一天一次的去重、静默时段只压投递不压事实、坏存储与写失败不拦投递）；投递是注入回调，App 里接一条可收起的提醒横幅，设置面板加「提醒」一节。**默认不静默**（起止相同 = 关）—— 静默跨午夜会让"就是今天"的事件再也补不回来。`modulo.reminders.v1` 已登记进 `DATA_KEYS`（P0-③ 那条静默失效的教训），并有一条 `createFileStorage → hydrateData → 新实例` 的用例证明重启不重弹。两个新模块各锁分支 **100**。待办没有截止日期字段，所以**不做到期提醒**。阶段 2（系统通知 + 点击深链）需引 `tauri-plugin-notification`，未做。单测 **1463 → 1496 条**、文件 **92 → 94 个文件**（新增两个用例文件共 33 条）、E2E **42 → 43 条**；受测层分支覆盖 94.87 → **95.00%**；**JS 470.84 → 475.88 kB**、**CSS 141.84 → 143.21 kB**。2026-10-21 第六笔（**系统通知，P0-④ 阶段 2**）：桌面壳接 `tauri-plugin-notification`（**这一版唯一新增的依赖**：Cargo `tauri-plugin-notification = "2"` → 2.7.0，Windows 走 `tauri-winrt-notification`；npm `@tauri-apps/plugin-notification@^2.7.0`；capabilities 加 `notification:default`；`lib.rs` 注册插件）。投放层 `src/vue/notify.ts` **动态 import**（网页版不进包）：权限被拒 / 加载失败 / 发送抛错一律返回 false、绝不抛 —— 应用内横幅仍是兜底。App 的 `deliver` 在桌面且开关打开时同发系统通知；设置面板加「同时发系统通知」（默认开、只桌面可见）。**一条做不到的事已写死**：Windows 上插件拿不到"点了哪一条"（交互式 action 只有移动端有），所以**没有深链**，点通知只有系统默认的"把应用带到前台"；开发态 Toast 显示 `powershell.exe` 身份与图标，装成安装包后才是 Modulo（插件文档原话）。判定/去重/静默时段与阶段 1 完全共用。单测 **1496 → 1504 条**、文件 **94 → 95 个文件**（新增 `tests/vue/notify.test.ts` 7 条、`useReminders` +1）、E2E 43 条不变；受测层分支覆盖 95.00 → **95.02%**（`notify.ts` 锁分支 100）；**JS 475.88 → 479.70 kB**、**CSS 143.21 kB 不变**（只多一个开关文案）。本机 Rust 编译跑不通（GNU 缺 dlltool / MSVC 的 link 被 Git Bash 抢），Rust 腿以 CI 桌面 job 为准。当前状态（2026-10-07 复核，由 agent-C 在本机实跑；这一笔同时把测试工具链从 vitest 3.2.4 升到 5.0.3，单测条数与覆盖率随该升级与「保留网段两侧判据对齐」重跑过；其后修 `watch.ts` 的 IPv6 方括号丢失与五处两侧判据分叉，并把判据表抽成两侧共读的 `tests/fixtures/watch-url-verdicts.json`（前端 +2、Rust +2）：**前端单测 1485 条（93 个文件）+ E2E 42 条 + Rust 单测 93 条**全绿（另有 2 条 `#[ignore]` 的主机侧门禁：`release_signature` 要安装包产物、`audio_probe` 要真麦克风，CI 上都不跑），`vue-tsc` 与 `tsc --noEmit` 都干净，受测层分支覆盖 **≥94%**（门禁 ≥90% + 逐文件棘轮，最近一次实测 94.95%），无 console 报错（由 E2E 里那条「拖拽与缩放全程无 console 报错」守着）。`vite build` 同日重跑：**JS 466.50 kB / gzip ~145.6 kB（主包 tokens 333.03 + 应用面 index 96.09 + 浮窗面 2.21 + core 1.93 + 更新插件面 1.03，余为共享 chunk；自 2026-10-16 起改成按产物名点名，原先那句「主包 366 + 命令面板与命令表 + …」随分块变化已经对不上账），CSS 141.36 kB / gzip ~20.9 kB**（比上一版记的 41.0 kB 大得多，因为多了桌面壳设置页、卡片内容、版面模板选择器、完整备份、更新插件与 41 种卡的 JS/CSS 面；CSS 相对上一版的 88.02 kB 多的部分，一是浏览态卡片 hover/active 反馈与添加菜单限高滚动那一笔，二是顶栏整合（排布下拉 + 统一高度 + 主 CTA）那一笔 —— 全是纯 CSS/模板增量，没进引擎。2026-10-08 两笔（默认皮肤改柔光、行高随窗口高度抬升，§10.27 / §10.28）复跑过一遍，主包随新增的 `src/vue/rowUnit.ts` 到 309.28 kB；2026-10-09 一笔（编辑态行高对齐浏览态，§10.29）复跑到上面这组数 —— 那一笔只多一个 prop 与几行注释，主包 309.28 → 309.33（+0.05），另加一条 E2E（22 → 23）；同日第二笔（引擎包改名 `@levango7/engine` 并开始发 npm，§12）只动名字与发布配置，主包体积不变，新增 `tests/release/engine-package.test.ts`（5 条）—— 单测 980 → 985、文件 66 → 67；2026-10-10 走查轮再 +11（降档对齐 4 + 投影贴左首配 3 + 拖拽门槛 4）、文件 67 → 68，E2E 23 → **25**（触摸长按 / 提示条 sticky）→ **996 / 68**，实跑值以本行数字为准；2026-10-10 第二笔（下拉菜单实底化，§10.30）只动 CSS：90.33 → 90.68；同笔把 JS 按实跑纠正为 311.30 —— 原记 310.36 漏认领了走查轮引擎侧（`spot.ts` 的 `findLeftFit` 等）进包的那部分，0.94 已贴到 ±1 kB 容差边缘；2026-10-11 第三笔（抓手区 + 悬停条，§10.31）：拖拽门槛契约重写（`canvasDragGate` 4 → 2 条）、E2E +1（悬停操作条）→ **994 / 68**、E2E **26**，JS 311.30 → 311.23、CSS 90.68 → 91.07（抓手图标 + 操作条胶囊底 + 标题带 24px）；2026-10-11 卡片批次 1（节假日 / 数据图表 / 命令速查，§10.32）：引擎新增 holiday / commands / chart 三个模块、卡组件 +3 —— 单测 +37、文件 68 → 71；JS 311.23 → 322.37、CSS 91.07 → 96.44；2026-10-11 批次 2（四象限待办 / 连通性探测 / 系统监控，§10.33）：引擎 probe / sysmon 两模块、卡组件 +3、Rust sysmon（sysinfo 依赖，cargo 测试 25 → 28）—— 单测 +33、文件 71 → 73、注册表 **47 种卡**；JS 322.37 → 336.74、CSS 96.44 → 102.79）；2026-10-11 第三笔（股票行情 / RSS 订阅，§10.34）：引擎 stock/rss 两模块、卡组件 +2 —— 单测 +27、文件 73 → 75、注册表 **52 种卡**；JS 336.74 → 349.15、CSS 102.79 → 108.08（两张卡组件与解析逻辑进包）；2026-10-12 阶段 B（行/分组容器，§10.35）：引擎新增 rows 模块（模型加法：Row/rows 字段与 Placement.row 归属，投影引擎零改动）、行头组件 —— 单测 +25、文件 75 → 76、E2E **26 → 28**（成组折叠展开解组 / 拖行头整组移动）；JS 349.15 → 356.78、CSS 108.08 → 109.61；2026-10-12 阶段 C（参数化一键自动重排，§10.36）：引擎 autoLayout 模块 + 行头参数控件 —— 单测 +25、文件 76 → 77、E2E **28 → 29**（行内重排 + 一步撤销）；JS 356.78 → 360.15、CSS 109.61 → 110.39（首测 110.13，随后补三枚行头图标钮的 22×22 命中区再 +0.26）；同日墨纸两笔（§10.37：卡边定值 + 卡面浮起）只动令牌值，体积微增；同日第四笔（编辑器事务化 + 「全部卡片」入口搬进模块库，§10.38）：store.restore + App 保存/取消/脏确认 + CardCatalogMenu 组件 —— 单测 +3、E2E **29 → 30**；JS 360.15 → 363.24、CSS 110.39 → 113.47；2026-10-13 潜在问题排查一轮（§10.39：网页版存储失败可见性 + 救命备份入口 / 待办删除热区）：单测 +3（1154）、E2E **30 → 31**；JS 363.24 → 362.84、CSS 113.47 → 114.01；2026-10-13 同日晚「脱离浮窗」第一批（§10.40）：Rust 单测 **32 → 35**（floatwin label/序列化/损坏兜底）、E2E **31 → 34**（Tauri 桩下的前端整链 +1、命令面板 +1、失焦/地址两条「本机绿 CI 红」修正后总数 34）；多出一个 float.html 入口与浮窗面（JS 369.70 / CSS 115.81，含浮窗面 2.37 kB JS + 1.21 kB CSS）；2026-10-13 深夜「命令总线与命令面板」（§10.41）：新增 `commands.ts`（22 条命令）+ `commandBus.ts` + `paletteIndex.ts` + 面板组件 + 表驱动测试 26 条 —— 单测 **1154 → 1199**（命令层表驱动 45 条）、文件 77 → 78；JS 369.70 → 383.51、CSS 115.81 → 118.43；2026-10-13 深夜「声明式扩展：网页取数」（§10.42）：引擎 `http.ts`（端点清洗/路径取值/格式化/取数计划）+ Rust `fetchjson.rs` + 新卡 —— 单测 **1199 → 1218**、文件 78 → 79、**卡 49 → 50**、Rust **35 → 38**、E2E **34 → 35**；JS 383.51 → 392.22、CSS 118.43 → 121.93；2026-10-13 夜「桌面工具箱：速达启动器」（§10.43）：引擎 `launcher.ts` + Rust `launcher.rs`（ShellExecuteW FFI）+ 新卡 —— 单测 **1218 → 1229**、文件 79 → 80、**卡 50 → 51**、Rust **38 → 41**、E2E **35 → 36**；JS 392.22 → 397.02、CSS 121.93 → 124.72；2026-10-13/14「HTML 扩展：自定卡」（§10.44）：引擎 `htmlcard.ts`（snippetLiteral 注入防线/信封校验/名单清洗）+ 沙箱卡 —— 单测 **1229 → 1249**、文件 80 → 81、**卡 51 → 52**、E2E **36 → 38**；JS 397.02 → 404.75、CSS 124.72 → 127.26；2026-10-16 Phase 3 前端批（§10.45 会议速记 + 窗口预览，两张卡都**仅桌面壳**、引擎零改动）：判定逻辑抽成 `src/vue/minutesLive.ts` / `src/vue/winPreview.ts` 两个纯模块并随卡进受测层、锁 100% 分支 —— 单测 **1249 → 1349**（+49 / +37 两条新用例文件）、文件 81 → 84、**注册表 54 种卡**（52 → 54）、E2E 38（不增：两张卡在网页版只渲染一句「仅桌面壳可用」，搭现有「全部卡上版」那条夹具的便车）；JS 404.75 → 426.90、CSS 127.26 → 136.12（含两张卡组件与窗口列表子组件）。**同日并入 origin/master**（PR #91~#96）后重测：`tests/scripts/` 2 个文件 41 条进来 —— 单测 **1349 → 1390**、文件 **84 → 86**；体积不变（并进来的只有 `scripts/` 测试，产品代码零变化）。同批顺手修掉三处既有欠账：① `winPreview.toFrameBytes` 视图分支改为**复制一份**并收紧返回类型 `Uint8Array<ArrayBuffer>`（TS 5.7 起 `BlobPart` 不收 `SharedArrayBuffer` 底，`vue-tsc` 实测报 TS2322 卡住整条 typecheck，子交付里「typecheck 通过」的说法在合入后不成立）；② `MinutesRecorder` 里一处 `clamp(10px, …, 11px)` 掉破最小字号铁律，锁死 11px；③ `docs-check` 的 Rust 条数改**递归**收集 —— 原写法 `readdirSync` 只数顶层 `.rs`，报 46 条而 `cargo test` 实跑 93 条，住在 `ai/` `capture/` `meeting/` 里的 47 条一条都没进判据；2026-10-16 第二笔（**门禁变异抽查**，零产品代码改动）—— 抽查结论是「现有门没有退化成假绿」，但当场抓到三处要修：① `docs:check` 那 6 条 `re` 型认领规则的正则**未锚定**，真值 54 时把「154 种卡」判**通过**（少一位/多一位的慢性漂移整个在射程外），现改走新的 `scripts/docs-check-claims.mjs`（判据 + CLI 两张口，与 `release-artifact-facts.mjs` 同一形状）并由 `tests/scripts/docs-check-claims.test.ts` 10 条钉住整位数（2026-10-16 当时 6 条，2026-10-19 行数抽取判据又 +4）；② `tests/release/engine-package.test.ts` 那条要走全量文件的扫描**撞默认 `testTimeout` 5000 ms**（本机全量 2 红 / 3 跑，红那次 5781 ms；隔离跑 3/3 绿；CI 分母 = 最近 29 个执行过 `verify` 的 run、4 个 verify 失败、**0 次同型红**），只给那一条 20s 预算、不动全局口径；③ `unitFacts` 此前让 `execSync` 直接抛，**任何一条单测红都会把整道门崩成 Node 堆栈**，日志里既没有测试名、也把「数字漂」与「测试红」压成同一个 exit 1 —— 现在接住并打印失败清单。单测 **1390 → 1396**、文件 **86 → 87**，覆盖率与体积与本笔无关；2026-10-17 并用 PR #53（**`calc.ts` 深层嵌套上限**，2026-10-11 那笔，§10.34）后重测 —— 单测 **1396 → 1398**、文件仍 **87**（`tests/engine/calc.test.ts` 现 **10 条**，较并用前 +2 —— `MAX_DEPTH=100` 话术与 `RangeError` 兜底各一条），覆盖率与体积与该笔无关；2026-10-17 并用 PR #55（**`baseconv.ts` 进制转换输入长度上限**，2026-10-11 那笔：超长输入会同步冻结界面）后重测 —— 单测 **1398 → 1401**、文件仍 **87**（`tests/engine/baseconv.test.ts` 现 **10 条**，较并用前 +3），覆盖率与体积与该笔无关；2026-10-17 并用 PR #52（**Cargo.lock 依赖来源门禁**，2026-10-11 那笔，纯门禁、产品面零改动）后重测 —— 单测 **1401 → 1405**、文件 **87 → 88**（新增 `tests/release/cargo-lock-source.test.ts` 4 条：每个 `source` 必须官方 crates.io、不许 git 依赖、外部包必须带 checksum、host 只认 `github.com` / `index.crates.io`，另含防空跑断言），覆盖率与体积与该笔无关。另：2026-10-17 修暗色皮肤 `button:hover` 对比度缺陷（`--brand-50` 在 `[data-theme='dark']` 下重定义，见 `docs/AGENT-COORD.md` 同日那行）：**CSS 136.12 → 136.18**（+0.06，只多一条 `color-mix` 声明）、**JS 不变**；同笔顺带核对这一维的当前实跑值 —— **JS 实为 427.24**（原记 426.90 是 2026-10-16 那笔的数；**撤掉本笔改动重建仍是 427.24**，故这 0.34 kB 与本笔无关，是期间累积的构建漂移，一直落在 `docs-check` 的 ±1 kB 容差内 —— 按实跑值更新）；2026-10-17 判据 2 的 range 口径统一 + 给它补上第一份测试（`tests/scripts/coord-gate-range.test.ts` 4 条，在临时 git 仓里跑，见 `docs/AGENT-COORD.md` 同日那行）—— 单测 **1405 → 1409**、文件 **88 → 89**，覆盖率与体积与该笔无关（`scripts/` 与 `tests/scripts/` 不进受测层）；2026-10-17 接上会议速记的**历史半边**（列表 / 详情 / 摘要 / 删除四处 UI 接通 `meeting_list / get / delete / summarize` 四个既有 Rust 命令 —— 它们在 `src/` 此前零调用，见 `docs/AGENT-COORD.md` 同日那行）：纯判定抽进 `src/vue/meetings.ts` 并进受测层逐文件棘轮**锁 100**，列表与详情各自自持 IPC、卡本体只做路由（`src/app/cards/MinutesCard.vue` 410 行，纪律内）—— 单测 **1409 → 1424**（`tests/vue/meetings.test.ts` 新文件 15 条）、文件 **89 → 90**，E2E **38 → 41**（`tests/e2e/minutes.spec.ts` 新文件 3 条：Tauri 桩预置 meeting 数据，在真组件上跑「分组渲染 / 详情取转写 / 摘要生成与徽标回读 / 两步删除」的前端整链，桩的删除与摘要**原地改桩数据**才能真测「回读落盘值」）；**JS 427.24 → 434.27**、**CSS 136.18 → 141.10**（两个新组件的 scoped 样式与 `meetings.ts` 全在这一增量里，按产物名 tokens 333.03 + index 96.09 分账见上行）；2026-10-20 第二笔（**同种卡多实例，阶段 1**）：引擎给版面条目加可选 `module` 字段与 `moduleIdOf()`，贯穿投影/校验/行折叠展开/缩放/切形态/自动重排；store 生成 `模块:2` 实例 id；模块库与「全部卡片」不再隐藏已放置卡；浮窗按实例找模块再渲染。**旧档/模板/单实例形状逐字不变**（第一实例不写 `module`）。单测 **1431 → 1435**、文件 90 不变（用例落在既有文件里），受测层分支覆盖 94.82 → 94.72%（新增分支多于用例），JS 464.21 → 464.79 kB；`src/vue/components/ModuleLibrary.vue` 204 → 201 行（去掉「全部已放置即禁用」的分支）。**阶段 2（按实例拆数据）未做**，判据见 `docs/design/FUNCTIONAL-SPEC.md` F-01。2026-10-20 第三笔（**内容级撤销**）：新增 `src/vue/contentHistory.ts`（`CardData` 整份快照 + 环形 50 步 + 500ms 合并窗口），App 的 `undoLatest()` 按时间戳路由（编辑态撤版面、工作台态撤内容）；顶栏按钮改为「撤销上一步」。单测 **1435 → 1444**、文件 **90 → 91**（新增 `tests/vue/contentHistory.test.ts` 9 条）；JS 464.32 → 466.50 kB（App 与新增模块进包），受测层覆盖不变。顺带把 `tests/engine/baseconv.test.ts` 的 4096 位耗时阈值 1000 → 3000 ms：本机负载下实测 1255 ms，原阈值会误报（本意是挡数量级回归）。另：`dist/index.html` 因首屏防闪脚本增至 3.00 kB，它不计入上面两个体积口径）。2026-10-17 **卡组件懒加载化**（#11/#12 同根，见 §12.9 首屏成本实测与 `docs/AGENT-COORD.md` 同日那行）：`cardComponents.ts` 此前 54 张卡**全静态 import**，而默认模板 `general` 只用 clock / todo / sticky / notes 四张（recent 复用 NotesCard），首屏白白解析 50 张卡；现除首屏四兄弟外 50 张全改 `defineAsyncComponent` + 字面量 `import()`（一张卡一个 chunk），`tokens.css` 加 `.card-fallback` 两条占位样式（加载中 / 加载失败如实说，不造骨架屏 —— 本地 chunk 毫秒级到位，骨架闪一帧反而碍眼）。**体积分两个口径记，别混着看**：**JS 总量 434.27 → 463.38 kB**（+29.1：50 个按需 chunk 各自带一小段 boilerplate，CSS 141.10 → **141.34**），但**首屏（load 事件前实际下载并求值的 17 个 chunk）434.27 → 272.80 kB / gzip ~99.5 kB（原 gzip ~145.6）—— 首屏降 37%**，tokens 主包 333.03 → **104.09**、index 96.09 → **96.64**、新增共享 helper 61.09，按需那 50 个卡 chunk 合计约 190 kB 在首屏之后才按需下载。桌面探针的项数是条件量，见 README「验证」一节里那两个原始行与出处；口径与 §11.3。2026-10-18 修「加卡先空一格」（§12.10：`delay` 200 → 32 + `preloadCard` 预取，并补 E2E 一条）后重测：**JS 463.69**（较上笔 +0.31，只多了 `preloadCard` 与两处模板属性）、CSS 141.34 不变；**E2E 41 → 42**。2026-10-19 拆 `CanvasEditor.vue`（§12.11）：**JS 463.69 → 464.32**（+0.63，两个新组件各一份样板与 scoped 属性）、CSS 141.34 → 141.36（噪声级），单测与 E2E 条数不变；`src/vue/components/CanvasEditor.vue` **834 → 677 行**，`src/vue/components/ModuleLibrary.vue` 201 行、`src/vue/components/BatchActionBar.vue` 45 行。2026-10-19 第二笔（**行数棘轮机器化**，判据细节与变异抽查详见 §12.11）：`docs-check` 新增**「文件行数」维度** —— 标记行里点名的 `.vue` / `.ts` 文件逐个读盘数换行，写错数字 / 改名 / 路径越界当场红；上岗首轮先咬到一口 —— **裸文件名认领解析不出路径被拒**（文件住 `src/vue/components/`），认领一律改全相对路径。判据与 CLI 走 `scripts/docs-check-claims.mjs` 新增的 `fileLineClaims`（箭头链取末数、路径到数字 8 字符窗口，kB / 条 / 行号引用不认领），抽取器钉进 `tests/scripts/docs-check-claims.test.ts`（+4）—— 单测 **1424 → 1428**、文件仍 **90**；变异抽查按规矩做：账本行 677 改 678，`docs-check` 红、报出「实测 677 行，这行写的是 678 行」后回滚 —— 门不是假绿。覆盖率与体积与本笔无关。2026-10-20 拆 `src/vue/cardData.ts`（#124，来龙去脉见 §12.12）：**909 → 367 行**，按关注面分成五份 —— 类型 `src/vue/cardDataTypes.ts` **210 行**、清洗 `src/vue/cardDataSanitize.ts` **346 行**、两层共用的数值上限 `src/vue/cardDataLimits.ts` **50 行**、示例内容 `src/vue/cardDataFallback.ts` **50 行**，store 层留在同名文件并做 barrel 再导出（导出面逐字一致，卡片组件与测试零改动）。**拆的过程里新用例咬出一个真 bug**：条目 id 是裸 `Date.now()`，同毫秒连加两条就撞号，而 `updateHtmlCard` / `removeXxx` 全是按 id 定点 —— 撞号会连坐误伤无辜那条（`sanitizeCardData` 里 `uniqueId` 的注释早写了这条不变量，写入路径一直没兑现它）；7 处统一改 `nextId`（时间戳 + 4 位随机后缀，与 `useSchemes.ts` 同招式）。清洗层与共享上限随拆分进受测层并登记逐文件棘轮（`src/vue/cardData.ts` 实测 97.84，原 97 地板复核通过不动；`src/vue/cardDataSanitize.ts` 99.58 取 **99**；`src/vue/cardDataLimits.ts` 100 锁满）—— 单测 **1428 → 1431**（+3：端点定点映射 / 自定卡定点映射 / 只改片段不动标题）、文件仍 **90**，E2E 42 不变；**JS 464.32 → 464.21**、CSS 141.36 不变。2026-10-20 第四笔（**完整备份与自动备份**，P0-③）：`confirmRestore` 此前只回填便签 / 待办 / 速记 / 倒数日四个字段，而备份包里一直是全的 —— 记账、四象限、习惯、生日、链接、订阅、自选、自定卡**静默丢失**（导出是全的、恢复是残的）。现改 `applyCardData()` 整份深拷贝回填；`BACKUP_VERSION` 1 → **2**，包内新增设置段（外观 + 上次选的模板；`shell.v1` 与 AI 密钥刻意不收）；自动备份环形 7 份（每日首启 / 恢复前 / 版本变化后首启），只在桌面写。实现时抓到一个**静默失效**：桌面适配器 `get` 只读启动时按 `DATA_KEYS` hydrate 的内存镜像，自动备份的 8 个键若不进那张表不会报错，症状是「写得下去、重启读不到」—— 每次启动重建基线并把 7 份洗掉；已登记进表，并加一条把整条链跑真的用例（写 → 落盘 → 按表 hydrate → 列表仍有那份备份），变异验证：删掉那两行键，该用例当场红。设置页顺带修掉「面板挂载不刷新自动备份列表」这条真 bug。`src/vue/backup.ts` 的逐文件棘轮 95 → **100**（补上四条从没执行过的分支：残缺包无版面段 / 导出时间读不懂 / settings 整段不是对象 / template 显式 null），并把共享夹具里 `watch`/`endpoints`/`launch` 三个一直为空的数组填上真数据 —— 那三行 `buildBackup` 的逐条拷贝从没被执行过。单测 **1444 → 1463 条**、文件 **91 → 92 个文件**（新增 `tests/vue/useBackup.test.ts` 11 条），受测层分支覆盖 94.72 → **94.87%**；**JS 466.50 → 470.84 kB**、**CSS 141.36 → 141.84 kB**（备份区与新胶水进包）。2026-10-21 给 `src/vue/useUpdateCheck.ts` 补测试并纳入受测层（§12.13）：该文件 **162 行**此前**零测试、也不在受测层**，而它管的正是更新检查与更新签名校验 —— 引擎那半（`packages/engine/src/update.ts`）背后有 `tests/engine/update.test.ts` **135 行**测试，「发请求 + 存缓存 + 摆状态 + 归还后端句柄」这半一条断言都没有（与 `useWeather` 当年同一个理由）。新增 `tests/vue/useUpdateCheck.test.ts` **22 条**（网页版与桌面壳两条路都覆盖），**实测 100% 语句/分支/函数/行**，地板同 chord / keyboard **锁满 100**。单测 **1522 → 1544 条**、文件 **96 → 97 个**，受测层分支覆盖 94.94 → **95.01%**；产品代码一行未改（`src/vue/useUpdateCheck.ts` **161 行**，纪律内），JS / CSS 体积不变。2026-10-21 给 F-04 自动备份面板链补 E2E（`tests/e2e/backup.spec.ts` **5 条**，Spec F-04 的「未做」销账）：「面板列出并可一键恢复」这半条此前只到胶水层单测 + 本机手动 —— 挂载刷新（P0-③ 修的那个 bug）由「开面板后不点刷新列表、基线就出现」钉住；恢复全链的断言**读盘不读界面**（桩的 localStorage），取消路径盘上数据字节级 + 索引深相等；索引在槽不在也有明确提示且不改任何东西。**零扩桩**：`read_doc`/`write_doc` 与 `__TAURI_INTERNALS__` 自 2026-10-17 会议历史那批起就在桩里，Spec 里「补它要先扩桩」那句已过期、随本笔勘误。E2E **43 → 48 条**；前端单测 1544 条 / 97 文件不变（E2E 不在单测套件）、覆盖与 JS / CSS 体积不变；产品代码一行未改（纯测试 + 文档）。 2026-10-22 第九笔（**F-07 网络策略单一来源**，P0 架构收口 + 一个真 bug）：仓根新增 `net-policy.json` 作唯一真源（超时五档 / 响应体上限两个 / URL 上限一个 / 允许外连的域名清单一份），三侧同读 —— 引擎与前端读 `packages/engine/src/netPolicy.generated.ts`（`scripts/gen-net-policy.mjs` 生成并**入库**，因为引擎包要能独立构建）、Rust 读 `src-tauri/src/net_policy.rs`（`include_str!` 同一份 JSON + `LazyLock` 解析，**解析失败直接 panic、不回落旧数字**）、CSP 的 `connect-src` 由同一份清单生成并写回 `src-tauri/tauri.conf.json` 的两条（挂在 tauri 的 `beforeDevCommand` / `beforeBuildCommand`，幂等）。**②号真 bug**：两条 `connect-src` 都缺 `https://push2.eastmoney.com`，而那正是 `packages/engine/src/stock.ts` 的 `QUOTES_URL` —— 桌面壳里股票卡取数被 CSP 实拦，网页版没有 CSP 所以一直没暴露，两条都补上了。**①号注释谎言**：`packages/engine/src/http.ts` 注释里的「5s」与 `src-tauri/src/net.rs` 实际的 10s 对不上，现在它不再抄数字。**⑥号分类结论**：feed 256 KiB 与网页 1 MiB 判为**有意差异**，两个名字都保留、理由写进单源的 `notes` 与 `net_policy.rs`，并有一条单测钉住「feed < 网页且恰好 4 倍」—— 没有为了统一而统一。新增 `scripts/net-policy-check.mjs`（45 项断言：单源 ↔ 生成产物 ↔ Rust 四个消费点 ↔ 两条 CSP 逐字比对，并反向断言旧的手抄数字已经不在：光删数字不算接上单源）并挂进 `.github/workflows/ci.yml` 的 `verify` job。判据一条未弱化：`packages/engine/src/watch.ts` 的 `normalizeUrl` 与 Rust 侧 `net.rs` 的 `split_target` 一行未动，`tests/fixtures/watch-url-verdicts.json` 一条未删。单测 **1550 → 1557 条**、文件 **98 → 99 个文件**（新增 `tests/engine/netPolicy.test.ts` 6 条）、Rust 单测 **96 条**（`src-tauri/src/net_policy.rs` 三条：单源解析探活 / 两个上限是有意差异 / 三档 Duration 与单源一致）、受测层分支覆盖仍 **≥95%**（实测 95.03%）、**JS 481.86 → 482.09 kB**、CSS 143.21 kB 不变；E2E 未重跑（本笔不改界面）。**Rust 腿本机编不了**（GNU 缺 `dlltool.exe`；MSVC 的 `link.exe` 被 Git Bash 的 coreutils `link` 抢到）⇒ `net_policy.rs` 与四个消费点只过了 `cargo fmt --check`，**编译以 CI 桌面壳 job 为准**；「股票卡在桌面壳里真的取到数」没有真机冒烟 —— 钉住它的是 CSP 字符串上的逐字断言。<!-- facts --> 2026-10-21 第八笔（**写入防抖**，P0-② 的遗留）：`cardData.ts` 的深监听改为 **300ms 合并窗口**（判据「≤300ms」，§4 性能表），`pagehide` / `beforeunload` 时 `flush()` 冲刷、并把 `flush()` 暴露给调用方 —— 合并只降写盘频率，**不能丢最后一笔**；新增 E2E「输入后立刻刷新不丢字」（输入后**不等待**直接 reload）。E2E 里对 `localStorage` 的即时读取改成**等条件**（`waitForFunction`），不再按固定 sleep 猜（`http` / `launcher` 两处原先 250ms 读盘恰好压在防抖窗口边上）。单测 **1544 → 1550 条**、文件 **97 → 98 个文件**（新增 `tests/vue/cardData-write.test.ts` 6 条）、E2E **43 → 44 条**；受测层分支覆盖 95.01 → **95.03%**；**JS 481.59 → 481.86 kB**、CSS 143.21 kB 不变。<!-- facts -->

覆盖率从上版的 95.08% 降到 94.49%，全部来自新加的 `watch.ts`：它有一批**防御性分支实际不可达** —— 例如 `if (url.protocol !== 'https:')`（构造出来的 URL 只可能是 `https:`）与 `if (!url.hostname)`（`new URL` 抛错时根本走不到这里）。这部分不打算用绕路的测试去凑数字：门禁是 90%，把不可达分支写成可达的假测试只会让覆盖率好看而让代码变脏。

### 10.3 验证固化进 CI（2026-10-01）

上面那些交互断言原来只是我手动跑的脚本，等于没有防线。现在：

- `tests/e2e/layout.spec.ts` —— 19 条真浏览器断言（vitest + puppeteer-core 驱动系统 Chrome，CI 上走 `CHROME_PATH=/usr/bin/google-chrome`）：三档视口的列数/溢出/裁字/最小字号、固定行高与卡片高度一致、编辑器可聚焦格 >0、方向键移动 + Ctrl+Z 回退、框选→成组拖拽→整体撤销、空格选入与删除后焦点落位、设置面板焦点陷阱、整理/撑满/收紧/紧凑各自的效果与分步撤销、方案册另存→应用→改名→删除、窄屏自动堆叠、版面模板选择器（点卡片换版面 / Esc 关闭不动 / 一步撤销 / 迷你示意齐全 / **1440×900 下不超过 2 行且不出现内部滚动**）、**出厂默认窗口 1280×800 里全部模板不用滚就能看完**、首启自动弹一次且挑过之后不再拦、拖拽帧率实测（rAF 采样，§8 第 3 条）、方案册键盘与拖拽排序跨重启保留、拖拽全程零 console 报错、出厂版面首行带铺满且整屏 0 空洞（§11.5）。**整理/撑满/方案册那三条不再吃出厂版面的红利** —— 它们现在自己喂一份乱版面当夹具（`SLOPPY_DOC`），因为出厂版面已经不烂了。
- `vitest.e2e.setup.ts` 用 vite 的 `build()` + `preview({port:0})` 起随机端口，避免与本机其它 dev server 抢端口。
- `npm run verify` = typecheck（`tsconfig.json` 管 `src/**` + `tests/**`（排除 e2e）、`tsconfig.e2e.json` 只管 `tests/e2e/**`，两份 `lib` 都带 DOM —— 分层是**按 include 范围**分的，不是按有没有 DOM；早先记的"产品代码拿不到 `document`"已经不成立）→ 单测与覆盖率 → 构建 → E2E。`.github/workflows/ci.yml` 的 `verify` job 按这四步跑，再加一步 `npm run docs:check`（共 5 步）。
- **桌面自检在 CI 挂过一步，2026-10-03 当天加了又摘了**：加它是要把 §11.4 那条"探针必须跑在要发的那颗二进制上"CI 化；摘它是因为下面那串排查证明**它在 runner 上量不到任何东西**。现在 `desktop` job 是 10 步（`cargo fmt` → `clippy` → `cargo test` → 打包 exe → 上传产物），没有 `continue-on-error`，也没有观测步骤。留这段排查不是因为好看 —— 它钉住了三条通用的测量纪律。
- **首次 runner 实跑（`c4a05a5`，run 37069233154）：探针是红的，而那一步显示 `success`。** 把 `probe-report` artifact 下载回来才看见真相：`passed: 0 / total: 2`，两条都是外层 catch 记的「自检过程未抛异常」，detail 为 `Failed to fetch browser webSocket URL from http://127.0.0.1:9223/json/version: fetch failed`。由此钉住两件：
  1. **`continue-on-error: true` 的步骤失败后 conclusion 仍报 `success`** —— 不是脚本漏了退出码（`desktop-probe.mjs:678` 一直是"有红就 exit 1"，本机 49/49 那轮就是这么来的），是 GitHub 把容忍掉的失败写成成功。所以**这类步骤的绿一律不作数，必须读 artifact**。
  2. 卡点在 **CDP 端口没监听**：`launch()` 先以 60×500ms 轮询 `http://127.0.0.1:PORT/json/list`，再 `puppeteer.connect`（`desktop-probe.mjs:55-63`）—— **Win32 钉窗口那段在 connect 之后**（`:78` 起）。日志时间差正好 30.7 秒（21:55:14.907 起步 → 21:55:45.615 报红），就是那 30 秒轮询耗尽后 connect 立刻抛。所以**这条红没有给出任何关于窗口的信息**：runner 上窗口到底出没出来，仍是未知。我第一版这里写的是"探针已过钉窗口那一关、窗口确实出来了"，那是**读错了代码顺序**，已就地收回；同理"runner 收不到 `SendKeys"这个假设也仍然没有被检验过。下一步是给失败路径加自述（子进程退出码、`modulo.exe` / `msedgewebview2.exe` 进程数、端口是否监听、真正传给子进程的远调参数），让下一次 runner 的红自己交代原因，而不是继续在本地猜。
  **加自述这件事本身翻了一次车**：顺手把 `stdio` 从 `ignore` 改成 `pipe` 想收 stderr，结果应用以 **101 panic** 死了（Rust 的 `print!` / `eprintln!` 在写端坏掉时是 panic，不是静默丢），本机 49/49 当场掉到 33/35。已回退成 `ignore`，观测字段全部改成"看一眼不改行为"的来源（退出码、进程计数、TCP 试探）。**测量手段不该改动被测对象** —— 这条比字段本身值钱，所以钉在 `launch()` 的注释里。
- **自述字段换回来了第一条真分类（`eb1afd7`，run 37072052990）**：runner 上的现场是
  `{"childExit":null,"moduloProcs":1,"webviewProcs":6,"portOpen":false,"browserArgsPassed":"--remote-debugging-port=9223"}`。
  也就是说**应用活着、WebView2 runtime 装着且派生了进程、远调参数确实传给了子进程，但端口没人监听** —— 排除了"runner 没装 WebView2"和"应用起不来"这两种，也仍然没走到 `SendKeys`。
  对照组（本机健康状态，同一套查询）：`msedgewebview2.exe` 命令行 24 条里 **2 条带 `--remote-debugging-port`**，且 `Test-NetConnection 127.0.0.1:9223` 返回 `True`。
  所以现在只剩两种分法，靠新加的 `webviewCmdLines / withDebugPort / sample` 三个字段切开：**参数没落到浏览器进程的命令行里**（⇒ 是 env 变量被 wry/Tauri 自己传的显式 args 顶掉这类"参数优先级"问题），还是**命令行带了参数但端口仍不监听**（⇒ 是 runner 的绑定/会话限制）。在切开之前不动 Rust 侧的 browser args —— 那是会影响所有用户的改动，不该建在未区分的假设上。
- **定位收口（`b4cf1b5`，run 37073016277）：`withDebugPort = 0`。** runner 上 6 条 `msedgewebview2.exe` 命令行，**没有一条带 `--remote-debugging-port`**，样本给出的 runtime 是 **153.0.4234.48**；本机同一颗 exe、同一套 `launch()`，runtime 是 **154.0.4258.53**，命令行里就有 2 条带该参数、端口可达。⇒ 结论是**`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 在 runner 那套 runtime 上根本没被 loader 写进浏览器进程**，端口不监听只是它的直接后果。
  顺带把开头那个假设正式请出去：**"runner 的交互会话收不到 `SendKeys`"从头到尾没被检验过** —— 探针三次都死在连 CDP 这一步，投递那段代码一行没执行。当时把它写进文档是因为它"听起来合理"，这是典型的拿假设当结论。
  **仍然未知的**：为什么 153 上不生效。两种可能之间没切开 —— (a) 旧 runtime/loader 对该环境变量的支持路径不同；(b) 环境变量与调用方显式传入的 args 冲突时优先级不同。区分它需要把参数改由 Rust 侧传（改产品代码，且会改变所有用户的 WebView2 启动参数），**为一个 CI 步骤的便利去动用户机器的行为，收益不匹配**，所以不做。
  **因此这条自检的定位定死**：桌面探针是**发布前的本机门禁**（必须跑在要发的那颗二进制上，见 §11.4），CI 里那一步只作观测。它升为真门禁的前提不是"等一次绿"，而是"runner 上拿得到 CDP" —— 目前没有可行路径；如果哪天要收，就该把这步从 CI 里摘掉，而不是留着一个每次都红的观测。
- **摘除已执行**：`.github/workflows/ci.yml` 删掉了探针步骤和 `probe-report` 的 artifact 上传，`desktop` job 回到 10 步、无 `continue-on-error`（改完用 `yaml.safe_load` 解析核对过步数与残留）。判据很简单：**一步红既不拦发布、又不携带可用信息，就只是噪音** —— 而噪音会让下一个真的红被当成同类忽略。
- 首批 CI 落地时的本地实测：103 单测 + 5 E2E 全绿，E2E 约 43s（含构建）；此后各轮持续增补，当前规模看 README。

对照 §1 那条事实——x-hub 写了 164 个 Rust 测试但 CI 只跑 `vue-tsc + cargo check`，一个测试都不执行——这条 CI 是它的反面教材，不是可选项。

### 10.4 按需整理 tidy（2026-10-01 已实现）

`src/engine/tidy.ts`：单趟"上+左"重力聚拢，锁定项不动、其余绕开它落位，兜底放到 `maxRow` 之下（那一行必然空闲）。两个实现细节是被测试逼出来的：

1. **两趟分开聚拢（先左后上）会造出重叠** —— 找不到空位时"原样返回"就撞上了前一趟已挪动过的卡片。随机版面性质测试抓到后改成单趟联合扫描。
2. **单次整理可能让版面更高**（旧出厂版面实测 11 行 → 12 行：左聚把窄卡挤到下一列，通栏只能再往下落；那份默认已按 §11.5 重排过，数字留作 tidy 行为的例证）。改为同时算"仅上聚"与"上+左聚"两个候选取更矮者，并**迭代到不动点**保证幂等。现在有两条硬保证：`usedRows` 只会变小不会变大（200 组随机版面断言）、tidy 两次等于一次。

工作台与编辑器共用顶部「整理」按钮；撤销/重做同时上移为**全局**键盘能力（E2E 抓到过：在工作台点整理后按 Ctrl+Z 无效，因为监听只挂在编辑器组件上）。

诚实边界：整理能压掉纵向空档，但**不会让版面"看起来满"** —— 横向中缝它管不了（那两张 `evidence/tidy-*.png` 是旧出厂版面的记录；出厂默认本身已在 §11.5 重排成 0 空洞）。要真正解决稀疏感，需要的是"按可用宽度重新分配卡片宽度"的模式，属于视觉/排版策略层，由 §10.5 的撑满模式接手。

### 10.5 视觉方向与撑满模式（2026-10-01）

**三套 skin 做成正式预设**（用户裁决：都保留，默认 `ink`；**默认皮肤于 2026-10-08 改为 `aurora`**，理由见 §10.28 —— `ink` 的卡片与页面底色太接近，"卡片是一张卡"的层次出不来，而 `aurora` 恰是 `:root` 的隐含实现，首屏因此连属性变化都不需要）：`aurora 柔光`（原状，最接近 x-hub）/ `ink 墨纸`（高对比、无渐变、小圆角、等宽数字）/ `candy 亮彩`（暖底饱和、20px 大圆角、厚实落影）。全部只覆盖令牌层，组件零改动；另加**模块身份色** `--mod`（按 `data-module` 给表头图标上色，跨 skin 复用）。选择当时存 `localStorage['modulo.skin']`，顶栏「外观」循环切换。**这条已被 §10.6 取代**：皮肤/明暗/强调色现在统一存 `modulo.appearance.v1`，「外观」按钮是打开设置面板，不再是循环切换（`modulo.skin` 这个键已从代码里删净）。同数据截图：`evidence/skin-{aurora,ink,candy}{,-editor}.png`。

**撑满模式**（`src/engine/spread.ts`）：按**顶边 y 相同**的行分组（组内须两两横向不相交），按原比例放大到铺满 12 列。四条约束：只变宽不变窄（所以形态 `minW` 天然继续成立）、含锁定项的行跳过、放大后与组外卡片相撞则整行放弃、`spreadLayout = fillRows(tidyLayout(doc))`。效果见 `evidence/ink-default.png` → `ink-spread.png`：中部空洞消失。

一个设计错误被 E2E 抓出来：第一版按"传递性行带"分组，但真实版面里卡片纵向错位，保守的相交检查直接跳过整组，**撑满完全没生效**（覆盖率断言停在 0.65）。改成按顶边分行后才对。

**撤销/重做上移为 App 级全局键盘能力**：原本只挂在编辑器组件上，在工作台点「整理」后按 Ctrl+Z 无效 —— E2E 抓到，属于"键盘可达"这条卖点上的真实漏洞。

### 10.6 外观设置页（2026-10-01）

顶栏的循环按钮换成正式设置面板（`SettingsPanel.vue`）：**视觉方向**（三张带说明的卡）× **明暗**（亮/暗/跟随系统）× **强调色**（"跟随皮肤" + 8 个预设，`appearance.ts:23-31`）。状态逻辑抽成纯函数放 `src/vue/appearance.ts`（`parseAppearance` 逐字段校验、非法回退默认、强调色只收 6 位 hex 以防注入 style；另有 `resolveTheme` / `accentColor`），DOM 应用与 `prefers-color-scheme` 监听在 `useAppearance.ts`，存档 `localStorage['modulo.appearance.v1']`。

实现中被抓到两例，都记在这里避免重犯：
- 模板里写 `a.value.skin` —— `a` 是 setup 返回的 ref，模板已自动解包，运行时直接 `Cannot read properties of undefined`（E2E 打不开面板才发现，单测覆盖不到）。
- 选中态皮肤卡是品牌色实底，说明文字与勾沿用 `--text-3` / `--brand-500` 就成了"蓝底蓝字"，必须随实底翻白。

### 10.7 键盘补完（2026-10-01）

- **空格**切换当前格的选入/移出（与 Shift+点选共用 `toggleSelect`），提示条与 `aria-label` 同步更新。
- **焦点跟随**：格子 ref 注册表 + `focusCell()`；删除后焦点落到**距离最近的**剩余卡片而不是掉回 `body`；方向键移动/缩放后焦点保持在同一张卡（keyed v-for 复用元素，E2E 实测确认）；聚焦时 `scrollIntoView({block:'nearest'})` 把卡片带进视口。
- 批量删除走 `removeSelectedAndRefocus()`，以被删集合中第一张为锚点找最近落点。
- 新增 E2E 断言链：空格选入→取消、移动后焦点不丢、Delete 后 `activeElement` 仍是某张卡。

### 10.8 面板焦点陷阱（2026-10-01）

`useFocusTrap(rootRef)`：打开时聚焦对话框本身（容器 `tabindex="-1"`，读屏会播报、第一次 Tab 自然落到首个控件），Tab / Shift+Tab 在容器内循环，卸载时把焦点还给打开它的元素。E2E 连按 14 次 Tab 与 4 次 Shift+Tab 断言焦点始终在面板内，并验证 Esc 关闭后焦点回到「外观」按钮。

一个测试自身的坑值得记：**程序化 `el.click()` 不会把焦点移给按钮**，所以陷阱记录的"上一个焦点"仍是 `body`，"关闭后归还焦点"这条断言必然假失败 —— 这类断言必须用真实指针点击（`page.click(selector)`）。

### 10.9 版面方案与导入导出（2026-10-01）

引擎层 `src/engine/schemes.ts` 是纯函数方案册：`createScheme / renameScheme / updateScheme / removeScheme / parseBook / mergeBooks / bookToJson`，上限 24 套、名称 trim+截断到 32、重名自动加序号。`parseBook` 对**每一条**方案跑 `sanitizeItems`（未知模块剔除、尺寸钳到形态最小值、重叠让位），空方案丢弃并留 warning，`activeId` 指向不存在的方案时归空；`mergeBooks` 保证导入不覆盖用户已有方案（id 与名称各自加后缀）。`tests/engine/schemes.test.ts` 18 条（这里原来写「10 条」，是空白方案与排序那批用例加进来之前的数）。 <!-- facts -->

胶水层：`useSchemes.ts`（状态 + `localStorage['modulo.schemes.v1']`）、`fileIo.ts`（Blob 下载 / `<input type=file>` 读取，桌面壳阶段只换这一个文件）。设置面板新增「版面方案」（另存为 / 覆盖当前 / 应用 / 改名 / 删除，活动项高亮且不给「应用」）与「导入导出」（当前布局、全部方案各双向），校验产生的 warning 就地列在面板里，不靠一闪而过的提示。

应用方案走 `store.importJson` → 因此**可撤销**：E2E 验证了"另存为 → 撑满改版 → 应用旧方案 → 坐标逐字回到原样"。

### 10.10 按内容收紧高度（2026-10-01）

引擎 `fitHeights(doc, reg, wantedRows)`：只变矮不变高、不低于形态 `minH`、非正数/NaN 视为"没有测量数据"直接忽略、无变化时返回同一引用。测量在 `useDensity.ts` 做**真测量**而非"每种卡片一个行数成本"模型（模型会随字号/皮肤/换行漂移）。

一个测量口径的坑：`scrollHeight` 恒 ≥ `clientHeight`，用它判断"内容比盒子矮"永远得不出肯定答案 —— 必须量内容子元素的实际排布范围（`max(bottom) - min(top) + padding`）。

**实测效果与它的局限（重要）**：收紧确实生效 —— 待办 6 行→3 行、速记 4 行→2 行、零裁字、可撤销。但**屏幕上的留白几乎没变少**，因为当时工作台用的是 `minmax(rowMin, 1fr)` 的**撑满视口**行模型：行数变少 → 每行变高 → 卡片又被拉回同样高度。也就是说"密度"问题的根不在卡片 span，而在**行高被拉伸**这个决策（x-hub 也是撑满视口，所以它有同样的观感）。

**已按结论改模型（同日）**：工作台改为**固定行高 + 页面滚动**（见 §3.1 行高列）。改完卡片真正贴着内容走，收紧才有视觉收益。同时确认两个动作是正交的：收紧只改 span、整理才把空行合掉，**只有连着点两者才会减少总行数** —— 这条组合效果已写成 E2E 断言锁住。

> **2026-10-08 补**：固定行高这条决策本身没被推翻，但"固定"当时被理解成了"**只按容器宽固定**"—— 于是同一张卡在 13″ 与 27″ 屏上像素尺寸一模一样，大屏上一半以上是空白（实测可用高 684 → 1356，版面占比 68% → **34%**）。现在行高在引擎的宽档基准上再乘一个**窗口高度倍率**，见 §10.27。**该节同时说明为什么这条改动不会把"收紧看不出效果"那个老毛病带回来** —— 倍率里刻意不含行数。

### 10.11 图标与默认配色（去"AI 味"）

图标提了四条意见：右下角有水印、不像模块、太像千问的紫蓝、整体有 AI 味。根因是**用生图模型出图**，所以解法不是再调提示词，而是换成手写 SVG：

- `build/icon.svg` 是唯一源，`scripts/render-icon.mjs` 用真 Chrome 光栅化成 1024 PNG 再交给 `tauri icon`。零新依赖、可 diff、可复现、没有水印。脚本带两个参数时只光栅化，用来肉眼对比候选稿。
- 图形是**一张 5 列 × 3 行的网格上放九块模块**：左右两列各三块当 M 的两条腿，中列两侧顶行两块 + 正中一块当中缝的 V。
- 排掉的方案（记在 SVG 注释里，避免以后又走回去）：把两条腿画成实心长条，中缝三块无论怎么排都读成 **H 加两个装饰点**；试过把三块角对角排成之字、试过中间一块探到基线（读成 Ш / III），都不如"腿也拆成网格上的模块"。只有全部元素同源于同一张网格，眼睛才把它当一个字母。
- 16px 下仍可辨（`node scripts/render-icon.mjs` 改 width 属性即可按真实像素出小图验证）。

配色一并处理，因为 header 上那个 `靛蓝→粉` 的渐变方块就是"AI 味"的实体来源：

- 应用内标识改成同一个 M 网格（`src/vue/components/BrandMark.vue`，腿走 `--text-1`、中缝走 `--accent`），删掉渐变和 glow。
- ink 皮肤默认强调色 `#1f6feb` → `#c93c16`（暗色 `#ff7a4d`）。**没有直接抄图标的 `#E4572E`**：它在白底只有 3.4:1，做按钮/正文文字过不了 4.5:1，深一档才 5.1:1。图标仍用亮的 `#E4572E`，因为它压在深色底上。
- 顺带补 `input[type=checkbox] { accent-color }`。之前原生复选框漏出系统蓝，是 ink 皮肤下唯一一处不属于任何令牌的颜色。
- 强调色板从 `nth-child(n)` 定位改成按值内联 —— 加一个颜色就把后面所有色板错位，这类脆弱性不值得留。

### 10.12 工具条分区与破坏性动作确认（2026-10-02）

**为什么改**：`src/App.vue` 的 `.tools` 原本是扁平一条，六件性质不同的东西同权重并排 —— 只读信息、历史导航、自动排布、**会整体替换版面的「推荐布局」**、全局设置入口。最该被区分开的破坏性动作，长得和一枚普通排布按钮没差别，还夹在中间。

**改成四区，用发丝线分开**：`[信息 pill] ｜ [撤销 重做] ｜ [整理 紧凑 收紧 撑满] ｜ [推荐布局 外观]`。分隔用 1px `.sep` 而不是加大间距（间距再大也分不出"这几枚是同一件事"）；每簇包在 `role="group"` + `aria-label` 里，窄屏换行时**整簇一起换**，不会把一簇拆散（390px 实测三行：信息+历史 / 排布 / 版面与设置）。「推荐布局」的边框用 `--c-red` 调出的淡红描边标出来。

**「推荐布局」当时的二次确认**：点按钮只弹确认框，文案写清"整体替换 + 立刻写存档 + 可 Ctrl+Z 退回"，默认焦点落在**取消**（安全的那侧）。**这条已被 §10.13 的模板选择器取代**：确认框解决的是"别不小心毁掉版面"，但它没解决"用户根本不知道该排成什么样"；换成"看图挑一张"之后，破坏性动作变成了有内容的选择，少一步点击也少一次"这是什么？"的困惑。安全网没有撤：换错可 Ctrl+Z、选择器里可连点比较、Esc/关闭等于"先不挑"。淡红 `.danger` 描边随之删除（现在没有一个按钮需要它了）。

**顺手消掉一个抖动**：「紧凑 / 收紧」原本是 `v-if="view === 'workbench'"`，切到「布局编辑」整排宽度突变、右边的按钮横向跳位。改成常驻 + `disabled` —— 这两个动作要读真实渲染出来的卡片高度，编辑器里没有那张 `.grid`，所以禁用是诚实的，title 在禁用态说明原因。

**一条约束记在这里**：E2E 是按 `textContent.trim() === '整理'` 这种**精确文本**点按钮的，所以工具条改文案等于改测试。这次标签一个字没动；要改名（比如语义重叠的「紧凑 / 收紧 / 整理」）得连测试一起排期。

### 10.13 版面模板：出厂默认 + 8 张推荐 + 自己存（2026-10-03）

**要解决的问题**：§11.5 把出厂版面修成 0 空洞之后，下一个问题自然冒出来 —— 那张"通用"排法凭什么是所有人的起点？待办为主的人和速记为主的人，需要的形状根本不是一张。而产品已经有"自定义"（编辑器 + 方案册另存为），缺的是中间那一层：**给几种看得懂的建议**。

**三层结构，各管一件事**：
- **出厂默认** = 模板表里的 `general`。`store.ts` 不再自己排第二套坐标 —— 两份真相迟早会漂，而"没存档时看到什么"必须和选择器里那张卡片画的逐格一致。
- **推荐模板** = `src/engine/templates.ts` 里 8 张：通用 / 大字时钟(2 张卡) / 极简专注(3 张卡) / 会议记录 / 开发排障 / 写作收集 / 备考清单 / 效率仪表盘。命名按**职业与场景**，因为用户认得出"我是写代码的"，认不出"信息密度均衡型"。后加的「大字时钟」与「会议记录」补的是两个最常见却原先没落点的用法：一个摆着几乎不操作（只看时间 + 一句话），一个边听边记还要收行动项。
- **自定义** = 已有的编辑器 + 方案册「另存为」。选择器底部一句话把这条说破：*"这些都是起点，不是限制"*，并指路去哪存自己的。

**为什么模板放引擎层**：模板的全部价值在于"排出来是满的"，而这句话必须能被纯函数数格子证明。`tests/engine/templates.test.ts` 52 条（8 张 × 5 条 + 全局 3 条 + 反向自测 4 条 + 降档对齐 5 条）：每张模板不重叠、不出列、**已用矩形内 0 空洞**、行数 ≤10、形态与 minW/minH 合法、铺出来逐格等于模板定义（含**形态名**）、且是 tidy/spread 的不动点。放在组件里就只能靠眼睛看 —— 而"靠眼睛看排版"这一轮已经翻过一次车。 <!-- facts -->

**一条自己抓出来的空转守卫**（值得记，因为它绿了整整一轮）：`validateTemplate` 里那条"形态不存在"的检查原本写成 `if (!resolveVariant(mod, c.variant))` —— 而 `resolveVariant` 在形态名失效时刻意回退到 `defaultVariant`（对用户友好是对的），于是这个 `!` 分支**永远进不去**。单测只断言它在真模板上返回 `[]`，所以守卫退化成"什么都不报"时一个灯都不会红。现在改成 `mod.variants.find(v => v.id === c.variant)` 精确查，并补 4 条反向自测（未注册模块 / 形态名不存在 / 小于 minW×minH / 合法模板仍然 0 条），把"会报错"和"没报错"分开钉住。顺带把逐格照搬那条断言补上 `p.variant` —— 只数 x/y/w/h 的话，形态被悄悄换掉是查不出来的。**规则**：校验函数只测"返回空"等于没测，必须至少一条反例证明它咬得动。

**选择器怎么做到"一看就会"**：每张卡片上半部是**按真实格子画的迷你示意**（12 列 CSS grid，色块用模块身份色 `--mod`），下半部三行字：名字 / 一句话说明它在看什么 / 适用人群 + 卡数。排法这种东西看图三秒，读描述三十秒。键盘可达（卡片是 `<button>`，`useFocusTrap` 锁在弹层内，Esc 分层关闭），窄屏 390 实测单列且无横向溢出。

**首启只拦一次**：没有存档**且**没挑过模板才自动弹（`store.firstRun`）。关掉（Esc / ✕ / 点遮罩）就记为"先不挑"，写 `modulo.template.v1`，下次不再问 —— 问第二次就成了骚扰。该 key 已加进 `fileStorage.ts` 的 `DATA_KEYS`，否则桌面壳下不会落盘，重启就失忆。

**确认框被吃掉这件事**：§10.12 那层"载入推荐布局？"的确认框删了 —— 它防的是误操作，但代价是把"我该选什么"这个更难的问题留给了用户。现在点卡片直接换，安全网换成三样：可 Ctrl+Z 退回、弹层里可连点不同卡片反复比较、以及换完的版面本身就是看得见的。

### 10.15 天气卡与「添加卡片」：第一张有外部数据源的卡，以及起点之后的路（2026-10-03）

**为什么这一步是两件事**：评估里说"现在 5 张卡的尺寸契约太听话，压不出投影边界"，所以加第 6 张
**内容来自网络**的卡；而真动手时发现一个更硬的事实：`store.add` 从立项起**没有任何调用方** ——
8 张模板管的是"起点"，而"起点之后想让版面上多一张卡"这件事，应用此前没有任何入口。
只加卡不给入口，等于做了一件用户够不着的东西。所以这一节是"卡 + 入口"一起做。

**数据源怎么选的**（不是拍脑袋，是逐条实测：可达性用本机 curl、CORS 看 `Access-Control-Allow-Origin`）：

| 候选 | 可达（无梯子） | CORS | 判定 |
|---|---|---|---|
| **open-meteo**（天气） | ✅ 实测 200 | `*` | **选它**：不用 key、一个请求给全（连日出日落都有） |
| api.github.com | ✅（更新检查在用） | `*` | 备选；白板上挂仓库动态的产品面太窄 |
| hacker-news firebaseio | ✅ 实测 200 | `*` | 可达，但英文资讯站对不上这个产品的使用场景 |
| frankfurter / open.er-api（汇率） | ✅ | `*` | 内容太少，压不出布局边界 |

选天气的另一个理由是**内容真的不规整**：温度有 `-12°` 与 `8°` 两种宽度、天气短句 2–7 个字、
三天预报是个列表、取不到时还要显示"上次没取到"（时间戳变旧）—— 这些正是 5 张本地卡给不了的输入。

**三条口径**（写在 `useWeather.ts` 文件头，也是这一节的核心）：

1. **首次渲染才查**：把卡加进版面 = 用户明确要它；版面上没有这张卡，一个请求都不发。
2. **30 分钟 TTL**，卡片底部永远显示"多久之前更新" —— 一份不显示新鲜度的天气数据比没有更糟。
3. **取不到保留上一份**并注明"上次没取到"，刷新是右上角那枚按钮；错误文案说清是哪一种（超时/HTTP/形状不认识）。

**CSP 是要付的账**：桌面壳的 `connect-src` 从 `'self' https://api.github.com` 加了
`https://api.open-meteo.com`（生产与 `devCsp` 两处）。每加一个外部源都是真实的表面积增加，
所以记一笔现状：**这个应用只连 5 个域名，全部 GET、全部不带凭据**（api.github.com / api.open-meteo.com / air-quality-api.open-meteo.com / open.er-api.com / hacker-news.firebaseio.com）。

**出厂版面刻意不含天气卡**（`tests/vue/starter.test.ts` 的 `NETWORK_MODULES` 守着这条）：
出厂版面是每个新用户首启看到的那一张，把网络卡摆进去 = 每次首启都飞一个请求出去。
那条不变式原来写的是"注册表里有几张就摆几张"，现在改成"注册表里的**非网络**模块各一张 +
**网络模块一张都不摆**"。

**「添加卡片」入口**（`App.vue`）：工具条「添加卡片」→ 菜单只列**还没在版面上**的模块
（数据模型就是单实例：`sanitizeItems` 会把重复模块去重）→ 点一下加到第一个空位，一步 Ctrl+Z 退得回。
菜单是 `role="menu"`、Esc 关闭、点外面关闭、全在版面上时按钮禁用并说明原因。
**它同时补上了"8 张模板之后怎么办"** —— 这是评估里"不要再往模板表里加卡"那半句建议的另一半：
模板给起点，添加入口给演进。

**实测**：引擎层 17 条单测（其中一条当场抓出真 bug：`weatherKind` 本来用 `code >= 95` 判雷暴，
把 1234 这种表外码也算成雷暴了 —— 改成显式列举三个码）+ E2E 19 → **20** 条
（新那条锁"只列缺的 / 点一下真加进来 / Esc 关 / 加满后禁用 / Ctrl+Z 一步退回"）。
天气卡在 E2E 里**可能与也可能不与网络连通**，断言因此写成"两种状态都得立住"——
取不到数据是合法状态，不许把页面弄崩。

### 10.16 四张新卡：月历 / 时间进度 / 世界时钟 / 倒数日（2026-10-04）

**起因**：一句反馈 ——「添加卡片里能加的东西太少了」。查下去发现根子不在入口：注册表只有 6 种卡，
出厂版面又占了 5 张，菜单里就剩天气一张。**入口的设计是对的，货架是空的。** 这一轮补四张，菜单 5 项。

**四张卡的共同点**（也是选它们的三条标准）：全部**本地计算、不联网、不需要账号**，而且都是"摆着就在说话"的卡 ——
时钟 / 进度 / 月历这类不需要用户每天输入，却每天都在变。§10.15 那条"外部数据要克制"的线因此没被碰：
`connect-src` 一行都没加。

| 卡 | 引擎模块 | 关键决定 |
|---|---|---|
| 月历 | `calendar.ts` | **固定 6 行 × 7 列**：行数随月份跳会让版面上下抖；补位格给 `null`，而"周末"是**列**的属性（补位格也带着它，界面据此给整列底色） |
| 时间进度 | `progress.ts` | 第几天用**本地日期之差**算（毫秒差跨夏令时会差一天）；`hoursLeftToday` 向上取整 —— 23:30 该说"还剩 1 小时"，不是 0 |
| 世界时钟 | `worldclock.ts` | **偏移表一行不写**，夏令时与半小时时区全交 `Intl`；引擎只返回绝对事实（`HH:mm` / 日期 / 偏移分钟），`relativeLabel(cityOffset, localOffset)` 是纯函数 —— 测试因此不依赖跑测机器的时区 |
| 倒数日 | `countdown.ts` | 按**日历日**算差（不是 24 小时制）；`2026-02-30` 这种"看着像日子"的必须被拒 |

**倒数日为什么进 `cardData`**：它的名字与日子是**用户写的字**。§7 的判准就此收敛成一句话并在各处一致 ——
**用户写的字进 `cardData`（因此进完整备份）；"选哪个城市 / 皮肤"这类偏好留在自己的 key。**
世界时钟的城市列表因此走 `modulo.worldclock.v1`（与天气的城市同一口径）；备份的确认框会如实说"设过倒数日"。

**「添加卡片」菜单加了 `blurb`**（注册表的新可选字段）：十张卡靠名字猜不出用途，一项一句说明
（"当月日历，今天高亮；可翻月"）。菜单项现在是两行。

**这一轮真正值钱的是那条新 E2E**：`十张卡全上版 × 三档视口（不溢出 / 不裁字 / 最小字号 ≥11px）`。
新卡既不进出厂版面、也不进 8 张模板 —— 没有这条，它们在**任何**视口下的表现都没人看过。它一上线就抓到两个真缺陷：

1. **字号下限低于 11px**：天气卡 3 处、新卡若干处（`clamp(9px…)`）。§8 的承诺是"任意叶子文本 ≥11px"，
   而天气卡既不在出厂版面也不在模板里 —— **这条承诺从没被任何断言看过**。全部下限抬到 11px（5 个文件 19 处）。
2. **类名撞车**：月历内部的日期格叫 `.cell`、月格叫 `.grid`，而"卡片"的选择器正是 `.grid .cell` ——
   测试里 10 张卡被数成 52 个。**这不只是测试问题**：编辑器里拖拽与框选都按 `.cell` 找目标，
   一个 42 格的月历会插进 42 个假目标。已改名 `.day-cell` / `.month-grid`。

**starter 不变式就地改正**：原来是"注册表里有多少张就摆多少张"，现在是"出厂版面 = **核心 5 张**，
其余一律由「添加卡片」按需加"，并加了防空转断言（至少要有一张可添加的卡，否则那句 for 什么都没测）。

**没做的**：四张卡都没进 8 张模板（模板给起点、新卡是起点之后的选项）；"同种卡多实例"仍未放开
（数据模型单实例，三层都堵着，见 §10.15）；卡片身份色**复用现有 5 色**，没为它们扩令牌集。

### 10.17 批次二：九张新卡、菜单分组，与通往 40 张的目录（2026-10-04）

用户对四张新卡的答复是"**我希望是 40 张卡**"。40 张不能一口气糊出来（每张都要过引擎单测、
三档视口、尺寸契约这道组合门），所以分两步：**先把 40 张的目录立成文档**（`docs/CARD-CATALOG.md`，
四批、每张标注引擎与数据源），**再按批次交付**。本轮交付批次 2 的九张（计算器 / 单位换算 / 日期工具 /
正计时 / 颜色工具 / 文本统计 / 随机数 / 进制转换 / 习惯打卡），注册表 10 → 19，
「添加卡片」菜单按**分组**渲染（19 张的平铺列表已经翻不动）。

- 分组数据用**普通数组**（`{name, cards}[]`）而不是 Map —— Map 的 v-for 解构顺序在模板里
  出过一次渲染歧义（组头显示成数字索引、条目全空，本地 preview 的 DOM 取证定位）。
- 计算器的**表达式求值不用 `eval`**（递归下降，`calc.ts`）：错误分"语法 / 除以零"两种文案、
  尾随垃圾拒绝、浮点显示修到 12 位有效数字。单测抓过三个实现缺陷：`%` 的两种语义冲突、
  除零错误被语法错误吞掉、`1+2)` 的尾括号被接受。
- 文本统计的字符按**字素簇**（`Intl.Segmenter`）：三人家庭 emoji 是 1 个字符（码点 5、UTF-16 8）。
- 随机数**RNG 注入**：引擎不摸 `crypto`（包构建的 lib 里没有它），测试用固定序列，
  卡片层才递 `getRandomValues` 包出来的 `() => number`。
- 习惯 streak 的口径：**今天没打卡不归零**（锚点取今天或昨天里更晚的）。
- 倒数日 / 正计时 / 习惯的内容都在 `cardData`，因此**都跟着完整备份走**；
  世界时钟的城市与天气的城市同口径（偏好，自己的 key）。
- 备份包带**来历**：`app`（导出时的应用版本）+ `createdAt`（ISO 8601，时钟由 `BackupInput.now`
  注入，所以"包里带导出时刻"这件事本身可测）。恢复确认框在覆盖之前把这两条摊出来 ——
  一份备份会跟着用户换机器、换版本到处搬，「哪一版、哪天导出的」答不上来时覆盖就是在赌。
  v1 旧包没有 `createdAt`：`meta.createdAt` 报 `null` 并留一句 warning，**不当成坏包**。
- 通往 40 张的下两批（联网卡 + 月相 × 5、需更多设计的 × 14）在目录里排好了批次与前置条件
  （联网卡 = 天气同款模式 + 每张一条 CSP 的账）。

### 10.18 批次三：联网卡四张 + 月相，与共用取数层 `useRemote`（2026-10-04）

注册表 19 → **24**，菜单 **19 项**。四张联网卡（汇率 / 空气质量 / GitHub 仓库 / HN 热榜）走
**同一个取数口径**（抽成 `useRemote`**：首次渲染才查、TTL 内不重复查、取不到保留
上一份并如实说 —— 收窄响应仍是各卡自己的纯函数（真夹具单测）。

- `useRemote` 带 **`freshKey`**：缓存属于**哪个目标**（城市 / 仓库名），目标一变立刻重查，
  而不是等 TTL 过期。这正是天气卡修过的那个坑，现在做成通用的一条。
- 它和 `useUpdateCheck` 同层级：**网络胶水不进单测门禁**（要真 fetch / 真计时），
  验收在 E2E 与"取不到是合法状态"这条纪律上。天气卡的 `useWeather` 是同一口径的另一份实现 ——
  将来该合并（它有城市选择等额外状态，本轮没动它，避免两处一起改出问题）。
- **空气质量卡的城市跟天气卡走**（读 `modulo.weather.v1` 的 `cityId`）：用户已经选过城市，再问一遍是骚扰。
- **GitHub 卡没加新域名**（api.github.com 早在 CSP 里，更新检查用它）；HN 的"1 个列表 + 5 条详情"
  在卡上如实写清楚；月相纯本地。
- CSP 现在连 **5 个域名**（api.github.com / api.open-meteo.com / air-quality-api.open-meteo.com /
  open.er-api.com / hacker-news.firebaseio.com），全部 GET、全部不带凭据。
- 这一轮抓到的坑：`air.ts` 又用了一次 `URLSearchParams`（引擎包构建的 lib 里没有它，老坑第二次踩）；
  `daysToFullMoon` 的**测试上限**写错（满月后到下一次满月是一整个朔望月 —— 实现对、判据错）。

### 10.14 下一步

1. ~~收紧与整理要不要合成一键「紧凑」~~ → **已加**：`compact() = fitContent() + store.tidy()`，原子按钮全部保留。刻意**不做成一步历史**，仍是两步 —— 撤销可以只退回其中一半，E2E 锁住了这一点（紧凑让总行数严格变少、两次 Ctrl+Z 逐格回到起点 —— 断言用相对量，不写死出厂版面的行数，否则改默认值会把测试改成假绿）。
2. ~~方案册 UI 的缺口：暂无"新建空白方案"与拖拽排序~~ → **已补**：`createBlankScheme` + `moveScheme` 两个纯函数，UI 上给「新建空白」按钮、拖把手排序、`Alt+↑/↓` 键盘排序。
   顺带修掉一个会咬人的规则：`parseBook` 原来对 `items` 为空的方案直接丢弃，于是**用户刚建的空白方案会在下次启动时被悄悄吃掉**。现在区分两种空 —— doc 本来就空（合法，保留）vs 有内容但清洗后一条不剩（外来数据里的未知模块，仍然丢弃并给 warning）。
3. ~~数据落地：localStorage → 数据根目录下的 JSON~~ → **已做**，见 §7 与 §11.3。

### 10.19 批次四之一：四张零新架构的卡，与一处被逼出来的数据模型改动（2026-10-04）

注册表 24 → **28**。这一批的排法本身就是一条决策，见 `docs/CARD-CATALOG.md` 的批次 4-② 表：
**番茄钟是唯一需要新状态机与新持久化口径的卡，因此不先做它** —— 先交付四张零架构成本的卡，
是为了让"先做什么"不被单张最贵的卡绑架（与 §3.5「不在没数据前选复杂方案」同一条纪律）。

- **`birthday.ts`（新）**：下一次生日。**没有复用 `countdown.ts`**，理由写进文件头 ——
  生日没有年，硬塞进 `countdown` 就要在引擎里造一个"随便挑个平年"的假年份，
  闰日与年龄两个坑会一起被带进来。三条口径由引擎钉死：没出生年 → `turns = null`；
  2 月 29 日在平年落 28 日；跨年只比月日不比"还剩几天"。
  `Birthday` 带 `id?` 是有意的：引擎不用它算任何东西，但**必须带出来** ——
  界面删一条要按 id 找，引擎把 id 吞掉就只能拿"月日 + 名字"猜，同月同日同名就删错了。
- **`focus.ts`（新）**：待办的三个读法（`nextUp` / `focusToday` / `monthStat`），无新结构。
  两条口径：**不重排**（顺序是用户排的）；**月度分母不是全部待办**，
  而是"本月完成的 + 本月还欠着的"—— 否则一条上月写、本月没碰的待办会稀释本月完成率。
- **`random.ts` 加 `pickWeighted`**：累计 + 线性扫描，**不用别名表**（几十条名单一次 O(n) 可忽略，
  别名表要多一份能写错的状态）。权重相等时退化成均匀。`rng()` 落在 [0,1) 之外时退到最后一个正权重项 ——
  那是"抽到了"，不是"抽不了"。
- **数据模型：`Todo` 加 `doneAt?: number`**。月度统计需要完成时刻，而原先只有 `done: boolean`。
  做成**可选**是关键：v1 数据与旧备份读得进来，读不出完成时刻的条目**不进任何月份**，
  卡上如实写"有 N 条旧记录没算"，而不是给一个看起来很确定的百分比。取消勾选要删掉它。
- **这一轮抓到的两个真 bug**：① `isValidBirthday({month:2, day:29})` 因"按平年判上限"被误拒 ——
  闰日该放行，平年由 `nextBirthday` 落 28；② 同日排序的测试断言按输入顺序写，
  而 `localeCompare('zh-Hans-CN')` 排的是拼音序（李 li < 张 zhang）—— 实现是对的、断言是错的，
  改成钉死拼音序并补一条"反序输入得同一结果"。

### 10.20 一道新门禁：`.vue` 也要被类型检查（2026-10-04）

`typecheck` 原先是 `tsc --noEmit`，而 `tsconfig` 的 `include` 只覆盖 `**/*.ts` ——
**26 个 `.vue` 文件从未进入过类型检查**。接上 `vue-tsc` 的第一件事就是抓到四处坏 import 路径：

| 文件 | 原来引的是 | 实际在 |
|---|---|---|
| `CountdownCard.vue` / `ElapsedCard.vue` / `HabitCard.vue` | `'../cardData'` | `src/vue/cardData.ts`（应 `'../../vue/cardData'`） |
| `WorldClockCard.vue` | `'../store'` | `src/vue/store.ts`（应 `'../../vue/store'`） |

四行全是 `import type` —— **构建时被擦除、运行时永远碰不到**，所以从落地到今天一次都没炸过。
这正是"没有门禁的错误比有门禁的错误更贵"的样本：它不响，只是让下一个读代码的人以为那里有个模块。

顺带清掉 10 处未使用的 import（`onMounted` × 8、`inject` × 1、`schemes` × 1）。

### 10.21 批次四之二：会议规划 + 记账，两条"宁可少算也不猜"的取舍（2026-10-04）

注册表 28 → **30**。两张卡，一句话共同点：**它们都拒绝了"先存一个看起来像答案的值"**。

- **`meeting.ts`（新）**：一次会议（本地墙上时间 + 时长）在各参会城市的当地读数与"该不该开"。
  复用 `worldclock` 的城市表与 `tzOffsetMinutes` —— **不维护第二份城市表**，两份迟早不一致，
  而不一致之后没人知道哪份对。星期几同样交给 `Intl`，不从 `MM-DD` 反推。
  - **只存"我说几点开"**，不存各城几点：后者是算出来的，存下来就会与夏令时变更对不上。
  - 排序按"离本地时差从小到大"：与本地同时的排最前，那是最不需要操心的那个。
  - `slotVerdict` 周末优先于时段：周六上午 10 点在"工作时间"区间内，但它显然不是工作时间。
  - `normalizeHhmm` 而不是 `padStart`：`'9:5'` 补长度会得到 `'009:5'` ——
    一个**比非法输入更糟的东西**（它看着像时间）。归一化必须按小时与分钟分别补。
- **`ledger.ts`（新）**：金额**一律整数「分」**。`0.1 + 0.2 !== 0.3`，一个月几十笔浮点加下来
  总额会差出几分钱，而"账对不上"是这类工具唯一不可原谅的失败。所以存储、传输、求和、比较
  全在整数域，只在显示时除以 100。
  - `parseAmount` 用**字符串切分**：`"12.30"` 用 parseFloat 会得到 `12.3`，
    `* 100 | 0` 得到 1229（少一分）；字符串切分给出 1230。
  - 千分位**先验格式再剥**：直接 `replace(/,/g,'')` 会把 `12,34`（分组写错）变成合法的 `1234`，
    于是用户敲错的东西被悄悄当成另一个金额记进去 —— 账目对不上时没人知道自己敲错过。
  - 第三位小数直接拒收而不是四舍五入：记账场景下"我不知道该不该进位"比"这条输了"更糟。
  - 分类固定 8 类：自由文本会让"按类汇总"退化成一堆只出现一次的类，
    而这张卡回答的是"钱去哪了"。要记到科目级，那是另一个工具的事。
- **清洗层丢条目而不是丢半个**：金额不是非负整数分（小数 / 负数 / NaN / 字符串）就丢**那一条** ——
  错账能看出来，半条账会让"总额"悄悄少一块，更难查。

### 10.22 一道门禁的第二个用途：让"清单与注册表同源"不必等人跑 E2E（2026-10-04）

批次 4-① 把 E2E 夹具里写死的 24 个 id 改成 `ALL_MODULE_IDS` + 一条"夹具与注册表同源"断言，
那条断言**不开浏览器**（直接在 spec 里 import `REGISTRY`）。批次 4-② 加两张卡时它的作用立刻显形：
不加 id 就在跑 E2E 之前先红，而不是等 100 秒跑完 22 条才发现漏了一张。

### 10.23 批次四之三：四个钟共用一套机制，以及"番茄钟"为什么不是一张卡（2026-10-04）

注册表 30 → **34**。这一批里最值得记的不是四张卡，而是**一次命名决策**。

- **「番茄钟」被降级成一个预设。** 番茄工作法是一套预设值（专注 25 / 短休 5 / 每 4 段长休 15），
  不是一种计时机制 —— 它的机制就是"倒计时 + 到点自动切段"，那正是「间歇计时」。
  给一套预设单独发一张卡，卡片的承诺就超过了它保证的范围：用户会以为它默认 25/5、
  能数番茄、四个一循环，而这些都不该由一张工作台卡片担保。
  于是它成了间歇计时里的一个预设；要 50/10、90/15 是改预设表的一行，不是再发一张卡。
  这个判断**反过来也修正了排序**：本目录早先把"番茄钟"标成"最贵、最后做"，而它其实**最便宜**
  —— 机制与倒计时共用，只差一个相位表。
- **一套机制，四种投影。** 四个钟共用 `RunState = { running, startedAt, accumulatedMs }`，
  剩下全是投影：正计时显示 `elapsed`；倒计时显示 `duration - elapsed`；间歇与呼吸是
  "倒计时 + 到点换一段"。分四套实现意味着四份计时偏差、四份恢复逻辑、四个"为什么这张卡跳了一秒"。
- **硬纪律：存时间戳，不存累加计数器。**
  `setInterval(1000)` 每秒 `acc += 1000` 在后台标签页会被节流到一分钟一次，
  于是它记的时间比真实时间少一大截 —— 用户回来发现"我明明过了十分钟"。
  `setInterval` 只负责重绘，不负责计时；累加值只在**暂停**时写回。
  持久化也只存 `startedAt` + `accumulatedMs`，不存"当前已跑多少秒" ——
  后者只对"写它的那一瞬间"成立。
- **一处诚实说明**：这一版**不做跨重启恢复运行态** —— 读回来时把 `startedAt` 当 0 处理，
  钟停在设定值、显示「开始」。理由是要正确恢复得处理"运行时改系统时钟""跨休眠"等情况，
  那是需要真机验证的一块；宁可先给一个明确的行为，也不要"看起来该有"的行为。
- 呼吸节奏的拍子由"已跑多久"映射而来，不自己推进，所以**后台被节流也不会走错拍**。
  动效只驱动 `transform`（走合成层），`prefers-reduced-motion` 由全局样式关掉。

### 10.24 批次四之四：四张卡，四条"不编造"的取舍（2026-10-04）

注册表 34 → **38**，**批次四收官**。这一批的共同点是每一张都在某个地方**主动放弃了"看起来更聪明"的做法**。

- **`heatmap.ts` —— 颜色是相对深浅，不是好坏。**
  max / total / activeDays **只统计画出来的那些格子**：早先的写法是对整份数据求 max，
  于是"9 月某个 99"会把 10 月压成一片浅色，而界面上没有任何地方能解释这件事。
  只有**最大值为 1** 时才退化成两档（所有非零值都是 1，渐变是编出来的）；
  `{1, 4}` 是真有两个量级，必须画出差。图例上明写"不是好坏" ——
  **颜色带评价色彩，而"这天打了三次卡"既不是好也不是坏**，那个评价不该由一张卡替用户下。
  刻意不做一整年 53 列：那在这个工作台里会挤成一条 1px 的线，投影也救不了。
- **`links.ts` —— 只做复制，不做打开。**
  桌面壳里打开外链需要 `tauri-plugin-opener`，那是**我们为这个功能刻意没有引入的依赖**
  （2026-10-21 提醒的系统通知引入了 `tauri-plugin-notification`，所以它不再是"唯一没引入的新依赖"；
  但 opener 仍然不引），而且它把"链接去哪"交给外部应用决定。代价是多一步 Ctrl+V，所以每个条目都写明
  "点了会复制什么"，而不是给一个看起来像链接、点下去没反应的文字。
  协议用**白名单**而不是"拒掉 javascript:"—— 黑名单永远漏得掉下一个危险协议。
- **`fixed.ts` —— 率的解读按数值大小，不看写法。**
  `>= 1` 已经是百分数（`6` = 6%），`< 1` 是小数（`0.06` = 6%）。
  早先的写法是"不带小数点就乘 100"，那会把 `6` 读成 **600%** —— 在税率场景里差 100 倍，
  而界面看不出错在哪。这条是本轮测试逼出来的**设计修正**，不只是测试修正。
  四舍五入用财务口径（负数**远离零**）而不是 `Math.round`：后者给 `-0`（往 +∞ 取整），
  那种差异会让一张退款单和一张发票对不上。去率净额用**除法**而不是 `base - result`。
- **`shift.ts` —— 一条可手算的规则，不做可配置排班。**
  可配置的排班规则（每人一条正则式）才是真正的排班系统，也是最容易出错的软件。
  这一版只支持 `(天数 × 每天班次数 + 班次序号) mod 名单长度` 一条，覆盖绝大多数小团队轮流值日，
  而且任何一天的值都能手算验证。名单为空时显示「待排」，**不回落到第一个人** ——
  那会让一张没填的表看起来像已经排好了。

### 10.25 两处 `monthGrid` 的月份口径（2026-10-04）

`monthGrid(year, month, now)` 的 month 是 **1–12**，而 `Date.getMonth()` 是 0–11。
`heatmap.ts` 与 `shift.ts` 一开始都少加了 1：不报错、格子数也对（固定 6×7），
只是**整个模块安静地画上个月的格子**。这类错误只有断言"补位格数量"和"label"才抓得到 ——
前者会算出 11 而不是 14，后者直接暴露月份错位。这两条断言现在都在。

### 10.26 0.5.0 发布前：探针抓出一个真 bug，和它自己的一处不可靠（2026-10-05）

版本从 0.4.0 提到 0.5.0（7 处同源，`npm run docs:check` 守着），发布前把从没在新增四批卡上跑过的
**真机探针 49 项**跑了一遍。第一轮 **40/49**，第二轮 **48/49**，第三轮 **49/49**。

### 10.26.1 CSP 漏了 Tauri 自己的 IPC 源 —— 窗口控制全部静默失效（发布阻断）

`tauri.conf.json` 的 `connect-src` 被手写成了一串联网卡的域名，**漏掉了 `ipc:` / `http://ipc.localhost`**。
Tauri v2 的行为是"**只要你显式写了 CSP，它就不再注入必需的那些源**"，于是：

1. `http://ipc.localhost/read_doc` 被自己的 CSP 拦掉；
2. 控制台只留下一句 `IPC custom protocol failed, Tauri will now use the postMessage interface instead`；
3. 之后**所有走 IPC 的窗口控制命令都没了动静** —— 不报错、不抛异常。

红掉的那 9 条正是这个集合：最小化 / 最大化 / 双击标题栏最大化 / 两条全局快捷键
（收起与唤出）/ 关闭藏进托盘 / 关闭真退出。纯几何断言（启动尺寸、居中、逐轴夹取）全过 ——
因为那些不碰 IPC。

**这类错误最难的地方在于症状离原因极远**：一行配置里少两个词，表现为"点按钮没反应"。
所以除了改配置，还加了一条 `tests/release/csp.test.ts` 把它钉死：以后任何人重写 CSP，
少一个 `ipc:` / `http://ipc.localhost`，或者顺手把联网卡的域名删了、或者把 dev server 泄进生产 CSP，
门禁都会当场红。注释里写了这段 bug 的完整因果，避免下一个人以为那是多余的严格。

### 10.26.2 探针自己有一处不可靠：断言默认值却读机器上的遗留状态

剩下那一条红是「ink 皮肤 + 朱砂强调色」—— 它断言的是**首次启动的默认值**，
却直接读 `%APPDATA%\app.modulo\data\modulo.appearance.v1.json`。这台机器上有人设过亮彩，
于是永远红着，而代码没问题。**一个取决于遗留状态的断言不是门禁，是抛硬币。**

改法：探针**只接管这一个文件** —— 跑前备份并写成文档化的默认值，跑完原样还原（原先没有就删掉自己写的）。
刻意**不清空整个数据目录**，因为同一次运行里「重启后勾选状态从磁盘读回来了」那几条要的就是真实数据。
默认值与 `src/vue/appearance.ts` 的 `DEFAULT_APPEARANCE` 必须一致 —— 上面那条断言就是校验它，
改了一处忘了另一处会红。

### 10.26.3 一个容易自己踩的坑：构建方式决定了探针能不能连上

中途排查时我用 `cargo build --release` 直接出了个 exe，探针立刻卡在"连 CDP"——
`/json/list` 里那个页面的 URL 是 `http://localhost:1430/` 而不是 `tauri.localhost`。
原因是**没开 `custom-protocol` feature**：那是一颗"开发二进制"，会去连 dev server。
必须走 `npm run tauri:build -- --no-bundle`（tauri-cli 会带上那个 feature）。

症状很像"这台机器上 WebView2 不支持远调"（`docs` 里记过 CI 上确实如此），
所以很容易误判成环境问题。判据是 `/json/list` 的 `url`：**空或 localhost 就说明二进制不对**，
不是端口没开。

### 10.27 行高：从"只认宽度"到"宽定档、高抬升"（2026-10-08）

**用户反馈**：「如果现有的不合理，那么就想办法让他更合理」。

**先量再改。** `E.rowHeight()` 只按**容器宽**给 64/60/56/52/48 五档，与窗口高度无关。
在出厂 5 张卡的固定夹具上跨八个视口扫一遍（脚本与产物不入库，与 §10.24 的临时探针同规矩）：

| 视口 | 可用高 | 行轨 | 版面高 | 卡片高 | 版面占比 | 死区 |
|---|---|---|---|---|---|---|
| 1280×700 | 616 | 64px | 464 | 224 | 75% | 152 |
| 1408×768 | 684 | 64px | 464 | 224 | 68% | 220 |
| 1408×900 | 816 | 64px | 464 | 224 | 57% | 352 |
| 1408×1080 | 996 | 64px | 464 | 224 | 47% | 532 |
| 1408×1200 | 1116 | 64px | 464 | 224 | 42% | 652 |
| 1408×1440 | 1356 | 64px | 464 | 224 | **34%** | **892** |
| 1920×1080 | 996 | 64px | 464 | 224 | 47% | 532 |
| 1920×1440 | 1356 | 64px | 464 | 224 | **34%** | **892** |

行轨、版面高、卡片高**八档全同**；唯一在变的是卡宽（562 → 776）。也就是说
**这个产品的宽度是响应式的，高度不是** —— 13″ 笔记本上刚好的格子，搬到 27″ 上就是
屏幕上方一小撮卡加一大片空白。网格类产品（iOS 小组件、GridStack）都会让基准单元随屏幕缩放。

**两条不能碰的线**（都写进了 `src/vue/rowUnit.ts` 的文件头）：

1. **倍率不能依赖"行数"。** 若行高按"把可用高度摊给现有几行"来算，收紧掉两行会让每行变高、
   总高不变 —— 那正是 §10.10 否掉 `1fr` 的原因，「收紧看不出效果」会原样回来。
   所以倍率**只是 (容器宽, 窗口高) 的函数**，不含行数；收紧行数就必然让版面变矮。
   这条不变量有专门的回归守卫：`tests/vue/rowUnit.test.ts` 里那组「行高与行数无关」。
2. **不能无上限。** 卡片内容靠 `cqh` 连续缩放（`container-type: size` 就是为此），
   行高随窗口一路线性跑下去，4K 竖屏会得到一张 300px 高的"一行"，正文涨成海报。故封顶 2 倍。

**参考高取 684 的来历**：应用自己的默认窗口是 1280×800 逻辑像素，那扇窗的 `.stage` 可用高实测 684
（视口高 − 84 的壳）。取它当锚意味着**出厂默认窗口及更小的窗口里倍率恒为 1，已经调好的观感
一个像素都不动**；只有更大的窗口才放大。

**改后（同一夹具、同一量表）**：

| 视口 | 可用高 | 行轨 | 版面高 | 卡片高 | 版面占比 | 死区 |
|---|---|---|---|---|---|---|
| 1280×700 | 616 | 64px | 464 | 224 | 75% | 152 |
| 1408×768 | 684 | 64px | 464 | 224 | 68% | 220 |
| 1408×900 | 816 | 76px | 536 | 260 | 66% | 280 |
| 1408×1080 | 996 | 93px | 638 | 311 | 64% | 358 |
| 1408×1200 | 1116 | 104px | 704 | 344 | 63% | 412 |
| 1408×1440 | 1356 | 127px | 842 | 413 | 62% | 514 |
| 1920×1080 | 996 | 93px | 638 | 311 | 64% | 358 |
| 1920×1440 | 1356 | 127px | 842 | 413 | 62% | 514 |

读法：**版面占比从"随窗口高度一路掉到 34%"变成"在 62–68% 之间基本恒定"** ——
这是这次改动真正想要的性质（版面在哪个窗口里都占差不多的比例），而死区少了 378px。
768 与 700 两档**逐像素未变**（倍率 1），即"不动已经调好的观感"那条承诺兑现。
行数仍 6、列数仍 12，结构没动，动的只有单位。

**宽仍只看容器宽**：`cols` / `mode` 一个高度维度都没加。这是顶栏断点（视口 992 / 752 ↔
容器 960 / 720）能与栅格同时降档的前提 —— 那正是同日早些时候刚修好的东西（§10.6 那条旁边
「顶栏整合」那笔），不能让新的高度维度把它打散。列数也不存在"13″ 与 27″ 上差一倍"的问题：
12 列在任何屏上都成立。

**顺带收窄的一处不一致（这一段的数字后来被推翻，见 §10.29）**：编辑态画布用 `minmax(0, 1fr)`
（把画布可用高摊给行轨），浏览态用固定行高 —— **这处不一致是真的，但本节原先记的量不对**：

| 本节原写 | 2026-10-09 实测（1408×1440，出厂 5 张卡） |
|---|---|
| 改之前「同一张卡在编辑态约 201px 一行、浏览态 64px，差 3.1 倍」 | 编辑态轨高 **93.94px**、浏览态 64px —— **201px 复现不出来**，而且**方向反了：改之前编辑态比浏览态大**（同 h=3 的卡：编辑 313.81 vs 浏览 224） |
| 改之后「浏览态抬到 127px，差距收窄到约 1.6 倍」 | 浏览态抬到 127px（这条对），编辑态仍是 93.94px → **浏览态反而比编辑态大了**，1.32 倍 |

**为什么能断定「201px」不是当时那一刻的真数据**：`CanvasEditor.vue` 自 `65cb1ff^` 到当前 HEAD
**逐字节未变**（`git diff 65cb1ff^ 65cb1ff -- src/vue/components/CanvasEditor.vue` 与
`git diff 65cb1ff HEAD -- …` **都是空**）；轨高只由「画布盒高 ÷ 轨数」决定，而盒高 = 可用高 −
页脚，两版之间都没动过；轨数下限 12 也在 `65cb1ff` 的 `useCanvasDrag.ts` 里
（`Math.max(acc, p.y + p.h), 12`）。所以那一档可达的最大轨高是 `(1329 − 11×16) / 12 = 96.06px`
—— **201px 在那个结构下不可能出现**。

原先留着不修的理由（拖拽几何从 DOM 反算行高，改它等于动"落点准不准"）方向是对的，但**结论判反了**：
反算之所以必要，正因为轨是 `1fr`；轨一旦固定，反算这一步不但可以删，**不改它本身还会算错**
（实测整体偏移 3 行、276px，见 §10.29）。2026-10-09 一并做掉了。

### 10.29 编辑态行高对齐浏览态：把 `1fr` 换成 `rowPx`（2026-10-09）

**用户裁决**：在多选项里勾了「消掉两态行高不一致」—— 这是 §10.27 那笔留下的、也是已知最后一处 UI 不一致。

**先量再改。** 出厂 5 张卡夹具、八个视口各量一遍两态的轨高（探针口径：读 `.grid` 与 `.canvas`
的计算 `gridTemplateRows` 首轨，不读产品常量）：

| 视口 | 可用高 | 浏览轨 | 浏览版面高 | 编辑轨（改前） | 编辑画布高 |
|---|---|---|---|---|---|
| 1280×700 | 616 | 64px | 464 | 32.28px | 589 |
| 1408×768 | 684 | 64px | 464 | 37.94px | 657 |
| 1408×900 | 816 | 76px | 536 | 48.94px | 789 |
| 1408×1080 | 996 | 93px | 638 | 63.94px | 969 |
| 1408×1200 | 1116 | 104px | 704 | 73.94px | 1089 |
| 1408×1440 | 1356 | 127px | 842 | 93.94px | 1329 |
| 1920×1080 | 996 | 93px | 638 | 63.94px | 969 |
| 1920×1440 | 1356 | 127px | 842 | 93.94px | 1329 |

同一张 h=3 的卡在两态的比值：1.74 / 1.54 / 1.45 / 1.39 / 1.36 / **1.32** / 1.39 / 1.32 ——
**八档全不一致，且窗口越矮差得越多**。还有一处更直观的代价：编辑态画布 1329px，而内容只用到 6 行
（6×93.94 + 5×16 = 643px），**下面 686px 是空的** —— 因为轨数下限是 12、且轨会把画布可用高摊满。

**根因一句话**：两态的"一格有多高"是**两个不同的量**。浏览态是 `rowPx`（引擎宽档 × 窗口高度倍率，
§10.27）；编辑态是 `画布可摊高度 ÷ 轨数`。单位不是同一个，任何窗口下都对不上。

**改法（三处，全在应用层）**：

1. `CanvasEditor.vue` 的 `gridTemplateRows`：`repeat(rowCount, minmax(0, 1fr))` → `repeat(rowCount, ${rowPx}px)`。
   `rowPx` 由 `App.vue` 传进来，来源是 `useProjection().rowPx` —— 与 `GridLayout` 用的**是同一个值**。
   两态从此共用一个来源，不是"两个地方碰巧算得一样"。
2. `useCanvasDrag.ts` 的 `cellAt`：`ch` 从反算（`(r.height − (rowCount−1)·GAP) / rowCount`）
   改成 `rowPx.value`。**反算这一步本来就是"因为轨是 `1fr` 才不得不反算"** —— 轨固定之后它
   既不必要、也不成立（见下面变异自检）。列向不动：列一直是 `repeat(12, minmax(0,1fr))`，
   画布宽就是它的宽度来源，`cw` 仍是反算。
3. `rowCount` 的 **12 行下限去掉**（改成 1）。那是"轨会摊满盒高"时代的造落点手段；轨固定之后
   12 个空轨会**真的占掉 12 个轨的高度**（1408×1440 下 12×127 + 11×16 = 1700px > 画布 1329px），
   等于每次进编辑态都多出一条**全是空轨的滚动条**。落点改由**画布盒子本身**提供。

**CSS 两处配套**：`.canvas` 从 `flex: 1`（= `1 1 0%`，基准 0 且可缩）改成 `flex: 1 0 auto`
（基准取内容高、有富余才长、没富余不缩）并加 `align-content: start`；内层 `section.stage` 加
`overflow-y: auto` —— 版面比画布高时由编辑区自己滚动承接，与浏览态由 `.stage` 承接**是同一条规矩**。

**改后（同一夹具、同一量表）**：八档**全部一致**，倍数 **1.00**。编辑态画布仍撑满（1329px，与改前同值），
内容高 842px 与浏览态**逐像素相同**，余下 487px 是留白 —— 而那片留白**仍是有效落点**
（`cellAt` 只按 `rowPx` 换算行号，不设上限）。

**落点没被牺牲，是量出来的**（本节最该看的部分）。稀疏夹具（只放一张卡，目标格全空），六个用例：

| 用例 | 期望 | 实测 |
|---|---|---|
| 模块库拖入 → 列6 行4 | 左上角 (844,449) | (844,449)，差 **0.0 × 0.0px** |
| 模块库拖入 → 列8 行0 | 左上角 (1037,81) | (1037,81)，差 0.0 × 0.0px |
| 模块库拖入 → 列1 行6（内容下方空白区） | 左上角 (362,633) | (362,633)，差 0.0 × 0.0px |
| 拖动已有卡下移 5 行 | 下移 460px（行 0 → 5） | 下移 460px（落 行5） |
| 缩放手柄拉高一格 | 高 352px | 352px（原 260px） |
| 落在画布盒子下半空区（指针 y=827） | 落到 行8 | 落到 行8 |

这个探针自己踩过两次坑，记下来免得下一个人重踩：**① 三例串在一个页面上跑**，前面的拖入改了文档，
后面的用例全在被污染的状态上量（有张卡被拖到第 10 行、已掉出画布盒子，`insideCanvas` 于是直接
丢弃那次缩放）；**② 判据本身是错的** —— 我假设"拖到哪儿就落在哪儿"，而引擎**有落位消解**
（`add` / `move` 撞上已占格子会往下找最近空位），于是三个用例全"落"在第 6 行，
那**不是 bug 是设计**（出厂版面占满 0..5 行，第 6 行正是第一个空位）。拿不成立的期望去量，
得到的红是假红。

**变异自检**：把 `cellAt` 的 `ch` 改回旧的反算式 → 同一组用例 **5/6 变红，且是系统性的 3 行
（276px）偏移**（只有"落到行 0"那例侥幸没露）。这就是"旧式子在新轨下本来就错"的直接证据，
也顺带证明这组用例真的测得到东西。

**一条新增的 E2E 守卫**（`两态行高一致：编辑态轨高 = 浏览态 rowPx，且卡片高 = span 轨 + 间距`）：
先读浏览态 `.grid` 的首轨，进编辑态后读 `.canvas` 的首轨，断言两者相等（`toBeCloseTo`），
并断言编辑态每张卡高度 = `span × 轨 + (span−1) × 16`（容差 1.5px，与浏览态那条同口径）。

**为什么必须有这条**：这次修的是"两态不一致"，而**不一致不会让任何已有断言变红** ——
把 `rowPx` 换回 `1fr` 之后，22 条 E2E **全绿**（拖拽、缩放、键盘、帧率都不受影响，因为落点几何
跟着一起变）。变异自检：改回 `minmax(0, 1fr)` → 该条红
（`expected 113.891 to be close to 76`，退出码 1，其余 22 条不受影响）；还原 → 绿。

**高版面的失败模式也量过**（26 行夹具）：轨数 26、轨高**只有一种取值**（76.00，没被压塌）、
版面高 2402 = `26×76 + 25×16` + 盒边距 26 **逐像素相符**、编辑区自己滚动（scrollH 2429 > clientH 816）、
外层 `.stage` 不滚（滚动只在一处）、卡片高与行距公式逐个相符、零 console 报错。
这条专门盯的是"换成定值轨之后会不会被压塌"——若用 `minmax(0, rowPx)` 写，在盒高不足时
固定轨不参与内容撑高，一行都长不出来（轨会塌成 0）。现在的写法不会：盒子按内容长高，滚动换地方。

**边界（如实记）**：编辑态的滚动落在**内层 `section.stage`**，所以版面高过画布时，底部那行操作提示
（`.foot`）会跟着一起滚出视野。出厂版面（6 行）与任何"放得下"的版面都看不到这一点。
要不要把提示条做成 sticky，留待真有使用反馈再定 —— 不为一个还没被抱怨的问题加粘性布局。
（2026-10-10 反馈来了并已落地：编辑态 `.foot` 改 sticky + E2E 守卫，见 CHANGELOG「走查轮收尾」。）

### 10.30 下拉菜单从"透底"改成磨砂实底（2026-10-10）

**用户实拍**：「排布」菜单压住待办卡时，下面的清单文字直接透出来 —— 要求降低透明度。根因：
`.add-menu` 用卡片档表面 `--bg-card`（亮彩皮肤 86%）且没有背景模糊 —— 卡片浮在环境底上时
这层半透明是"柔光"，而菜单浮在**任意内容**上时它就成了"透字"。

**先量化再选档。** 真 Chrome 像素采样（不靠肉眼），判据取菜单左缘的**无字空白列**（任何亮度
波动都是透底）+ 大块深色内容最坏情况，四档对比：

| 档位 | 空白列波动 | 压大块深色 |
|---|---|---|
| 86%（现状） | 5 级 | 31 级 |
| 92%（仅换令牌，无模糊） | 3 级 | 未测 |
| **92% + `blur(12px)`（采用）** | **0 级** | 17 级 |
| 100%（不透明） | 0 级 | 0 级 |

采用第三档：正文级内容零残影；17 级只会在"整块深色实心块"下出现，而卡片从不是那种东西；
100% 则会丢掉全站"柔光 / 玻璃"的语言，还与设置面板（同用 `--bg-card-solid`）不再同档。
吸顶分组头一并换同档（不然滚动时它比菜单自己还透），遮蔽力单独量过：滚过的项在头下最大
残影 4 级、72/4200 像素（滚动瞬态，不可见）。修复后真实现场复测（不注入样式）：亮彩亮
0 级 / 亮彩暗 2 级 / 柔光亮 1 级。

**过程里自纠两处测量错误**（都值得记）：① 一度怀疑 headless Chrome 不渲染 `backdrop-filter`，
先写了最小复现页做**数值**能力判定（层内四点全 197、极差 0 —— 正是条纹的均值，说明是真模糊
而非白罩层；层外采样仍是条纹暗值 17），结论是能力一直正常，"看不出模糊"其实是"92% 已把
残影压到肉眼不可分"；② 最坏情况测试第一版**几何布错**（深色块只盖住了四档里的第一档），
后三档量出假的 0，修正几何后才拿到真数。

### 10.31 抓手区替代长按门槛 + 悬停操作条（2026-10-11）

**用户裁决**：「拖拽、缩放这些机制我认为做的也让人操作起来很不舒服」，并点名对标 Grafana
最新版（13.2，官方文档已核实：拖标题栏移动面板 / 悬停浮出操作条 / 行·标签容器 /
Custom·Auto-grid 双布局）。本笔是四件事里的**阶段 A（手感层）**：

**① 长按门槛整条拆除。** 旧设计的因果链是：拖拽可从卡面**任何位置**发起 → 触摸端必须
防误触 → 于是加"长按 250ms 才进拖拽"（`dragGate` 的三元判定 + 一条非 passive 的
touchmove 武装链）。修的手感（按住等一会儿才动）恰恰是这个设计的代价。新设计把因果链
从根上换掉：**拖拽入口收窄到标题带**（`.tag` 24px，`touch-action: none`、`cursor: grab`、
左侧抓手图标），卡面 pointerdown 只做选中、划动交还滚动 —— **意图靠区域区分，不靠时间**；
`dragGate` 退化为纯 6px 阈值，武装链、`LONG_PRESS_MS`、`DragState.touch/bornAt` 一并删除。
间接收益：卡面上的原生交互（待办勾选、输入框）不再被 `begin()` 的 `preventDefault` 干扰。

**② 悬停操作条质感化。** 三枚动作钮（形态/锁定/删除）此前就在（悬停显形），但**是裸钮
直接压在卡片内容上**，看久了像叠字。改成胶囊底 + 描边 + 投影，浮在内容之上（`z-index: 2`），
位置让位给 24px 标题带。**有意不做「复制」**：Modulo 是"每模块单实例"模型（`item.id` 即
`moduleId`），复制要先拆 id/实例两层 —— 那是引擎模型变更，不混在手感层里做。

**测试**：`canvasDragGate.test.ts` 契约重写（4 → 2 条，`cancel` 分支随门槛一起消失）；
E2E 触摸用例重写为真实链路判据（**划卡面 = doc 不动、拖标题带 = doc 移动**，合成 touch 走
Chrome 指针管线）；新增「悬停操作条：悬停显形 → 锁定落盘 → 切解锁态 → Ctrl+Z 还原」。
后续阶段 B（单层行带：`doc.rows` + `item.row` 加法字段，投影引擎零改动）与阶段 C
（参数化一键 `autoLayout` 重排）另行记档。

### 10.32 卡片批次 5-①：节假日 / 数据图表 / 命令速查（2026-10-11）

**用户裁决**：「卡片会不会还是有点少？要不要再加点，而且可以分类？」→ 八张全要，分三批。
本批三张全部**零外网依赖**（分类机制本就存在：添加卡片菜单按 `group` 吸顶分组，五个组）。

**节假日（`holiday.ts`）** —— 数据卡的关键决定是**数据从哪来**：拉取官方通知原文
（gov.cn 内容页带浏览器 UA 可直抓；curl 默认 UA 与无头浏览器会被拦）后把全年安排录成
**引擎内的纯数据年表**，逐年注明文号（2026：国办发明电〔2025〕7 号）。查询全是纯函数
（阶段判定 / 倒计时 / 补班日扫描，复用 `countdown.ts` 的日期口径）。边界：年表没覆盖的
年份（如 2027 在 2026-11 前未公布）**如实显示「待公布」**，`nextHoliday` 返回 null 而不是
编一个假期；元旦的天数是事实、「放几天」必须标待公布。单测把年表与通知逐条对照
（春节 9 天 / 国庆 7 天、补班日列表）。

**数据图表（`chart.ts`）** —— 定位是**别的卡的数据的另一种看法**：自己一行数据都不存，
读记账（`dailyTotals` 日合计）与打卡（`lastNDays` 0/1 序列）的同源 cardData，删图表卡
不动任何数据。几何（归一化 `scaleSeries` / 折线点 `linePoints` / 柱槽位 `barSlots`）在
引擎可单测；渲染是**纯 SVG**（viewBox 0 0 100 100 + `preserveAspectRatio: none` 随卡面
连续缩放，线条 `vector-effect: non-scaling-stroke`）—— 这个体量不引图表库。

**命令速查（`commands.ts`）** —— 与 `links.ts` 同一套分层（引擎清洗、cardData 接线、
卡组件交互）。承诺与快捷链接一致：**只复制、不执行**。命令允许多行（管道贴进来是常态），
清洗口径：去首尾空白、截长 240、空命令拒收、同名同命令去重、空名取命令首行。

**接线清单**（每张新卡都要过的）：注册表条目（尺寸契约）→ 组件映射 → 模块身份色
（复用现有 5 色，不扩令牌集）→ E2E `ALL_MODULE_IDS` 夹具（有专门的同步断言守着）→
`cardData` / 备份（commands 是数据，进备份）。单测 +37 / 文件 68 → 71。

### 10.33 卡片批次 5-②：四象限待办 / 连通性探测 / 系统监控（2026-10-11）

**四象限待办（matrix）** —— 与普通待办是**兄弟卡不是变体**：数据分开存
（单实例模型下"变体"意味着矩阵与清单二选一，分开存才能两卡并存）。语义与 todos
同源（勾选 / doneAt 完成时刻），多一个 `q` 象限字段；**坏象限归位到「重要且紧急」
而不是丢条目** —— 字是用户写的。象限间挪动用条目旁的 ←/→ 循环按钮，
不做拖拽（12 列小格里拖拽没有精度）。

**连通性探测（probe）** —— 复用桌面壳的 `web_probe`（`elapsedMs` 即往返延迟），
端点名单与网页监控**同一条私网边界**（引擎 `sanitizeProbes` 走 `normalizeUrl`，
不另写一份 —— 两份边界清单迟早分叉）。**历史样本是机器采的、不进备份**
（仓里的口径：用户写的进备份、机器测的不进），存独立持久化键，进卡先过
`sanitizeSamples`。窗口 / 统计 / 分档（`pushSample` / `probeStats` / `probeLevel`）
是引擎纯函数；折线直接复用批次 5-① 的 `chart.ts`。**命名教训**：第一版参数叫
`window`（样本窗口），被引擎纯度守卫的 `\bwindow\b` 扫中 —— 守卫不看语义，
标识符别跟宿主环境全局重名，改叫 `samples`。

**系统监控（sysmon）** —— 本批唯一的 Rust 侧新增：`src-tauri/src/sysmon.rs`
+ `sysinfo` 依赖（ustc 镜像本地可拉）。两条设计：① **`System` 常驻**（CPU 占用率
是两次采样的差值，每次新建永远 0；首次采样 CPU=0，界面显示「采样中」不冒充）；
② **只回原始计数**（网卡回累计字节，速率由前端差分 —— 引擎 `netRate` 纯函数可测，
Rust 少一份"上次采样时刻"的状态）。cargo 测试 +3（字段自洽 / 计数器单调 /
磁盘条目自洽；本地 gnu 工具链要 `PATH=D:\msys64\mingw64\bin` 前缀）。网页版如实
显示「仅桌面壳可用」，与网页监控同一套诚实降级。**两个口径不合并**：sysmon 的
`formatSize`（1024 进制，内存/磁盘的 GiB 惯例）与 update.ts 的 `formatBytes`
（1000 进制，对齐 Releases 页写体积）撞名后分开命名 —— 它们本来就量纲不同。

**接线**：同批次 5-① 清单。单测 +33 / 文件 71 → 73；E2E「全部卡上版」抓到新卡
10px 字号违反「最小字号 ≥11px」铁律 —— 抬到 11px 后全绿（这条守卫又一次值回票价）。

### 10.34 卡片批次 5-③：股票行情 / RSS 订阅（2026-10-11，点单收官）

八张点单的最后两张。**先探源再选路** —— 两张卡走了不同的一侧，因为两个数据源的
现实不同（2026-10-11 实测）：

**股票行情（`stock.ts`，纯前端）** —— 东财 push2 的 ulist 接口：CORS 全开
（`Access-Control-Allow-Origin: *`）、UTF-8 JSON、**价格给的是「分」的整数**
（f2 = 价格 × 100）—— 正好对上这个仓"记账不碰浮点"的口径（只有显示才除 100）。
备选过新浪 hq.sinajs.cn：要 Referer 头且返回 GBK，网页版做不了 —— 取数口径越干净
越好，选了东财。secid 的坑：`000001` 在沪是上证指数、在深是平安银行，**同码不同所**
—— 显式 sh/sz 前缀永远保留，裸 6 位按前缀段猜（6/5/9 沪、0/2/3 深），猜不出返回
null 让用户带前缀重输，不猜。停牌字段是字符串 `-`：解析如实给 null、界面显示「—」。
A 股口径涨红跌绿（国际惯例在这张卡上是错的）。

**RSS 订阅（`rss.ts` + Rust `feeds.rs`，桌面壳兜底）** —— 实测三个真实源
（阮一峰 Atom / Solidot / 36kr）**全无 CORS 头**，浏览器侧拦死 → 需要 Rust 侧带响应体
的取数。好消息：`net.rs` 的 `get` 早就带回响应体（监控命令层按设计丢弃），新增的
`fetch_text` 复用它 + 256KB 上限 + **charset 解码**：本机 WinHTTP 查响应头的路是坏的
（已知），charset 只能从内容嗅探 —— `sniff_charset` 在前 1KB 里只在 `encoding=` 后
认标签（GB2312 归一到 GBK），`encoding_rs` 解码（第二个 Rust 依赖）。取数两路：
**先试原生 fetch**（少数源开了 CORS，网页版也能读）→ 失败且桌面壳则走 `fetch_text`；
网页版读不了的源**如实标注**，不摆假内容。解析是容忍式正则（CDATA 剥壳、实体解码、
RSS 2.0/Atom 双族、`rel=alternate` 优先于 `rel=self`、日期两族归一），夹具取自
Solidot 与阮一峰的**实测原文**；局限写在文件头。抓到的条目存独立持久化键
（机器采的、不进备份）；订阅名单进 cardData / 备份。

**接线**：同 5-① 清单 + Rust 侧 `fetch_text` 注册。单测 +27 / 文件 73 → 75、
Rust +4（32 条）；E2E 夹具 **49 张卡**三档视口全绿。

### 10.35 阶段 B：行/分组容器（单层行带，2026-10-12）

用户最早对标 Grafana 的一项（「行/分组容器」），定稿方案在 §10.31 的收尾处。
落地时对方案有**一处有意偏离**，外加一条 **E2E 抓出来的真缺陷**：

**插入式行头（偏离"成员坐标不动"，如实记）** —— 行头要占真实的落位空间。
`groupIntoRow` 把成员与其下方内容整体下移 1 行、行头落在腾出的那一行；`ungroupRow`
收回。所以成员坐标在成组/解组时整体 ±1 行，换到的是**渲染零覆盖**（行头不与卡片抢
空间，不需要任何浮层或绝对定位叠放）与**可逆的整段位移**。"坐标不动"因此读作
"成员的**相对**布局不动"——单测把"成组→解组逐字段回到原样"钉死。

**模型（加法，投影引擎零改动）**：`Row = { id, title, y, collapsed?, stash? }`；
`LayoutDoc.rows?`、`Placement.row?`。折叠时成员从 `items` 整体移出、按**相对偏移**
（`dy` 相对成员区顶部）存进 `stash` —— 相对量锚定行头 `y`，任何整段位移同步平移
行头，于是**嵌套折叠自洽**（折叠上面的行会带着下面的折叠行一起上移，展开时各自的
现场按当前锚点还原；单测覆盖两层折叠/逆序展开）。投影引擎看不见行（成员不在
items 里就是不渲染），浏览态因此零改动。空行自动剪除（`removeItem`/`removeMany`
调 `pruneRows`——"最后一张卡移走 = 行没了"）。

**E2E 抓出的真缺陷：带内非成员（guest）** —— 第一版只处理成员，折叠把"坐在成员区
里但不是成员"的卡原地留下，展开又整体下推 —— 出厂版面里组上半带（时钟+待办，
而待办 6 行高）时，便签/速记正住在它的跨度里，往返一次**塌 +6 行**（E2E 逐项比对
坐标抓出，单测当时全绿——因为单测夹具没造这个形状）。修法：折叠时带内非成员
（与成员区纵向相交的非成员卡）**一起进现场并带 `guest` 标记**：折叠后移到行头下方
（同列带首配），展开时按同样的相对锚点还原、但**不设**归属；`rowsBands` 的成员
列表与行头计数**只认真成员**（拖动/计数不该把 guest 算进去）。修复后单测补上了
与出厂版面同构的 guest 往返用例（先还原成失败再修——此前的夹具形状没覆盖到）。

**UI**：行头（`RowBand.vue`）= 抓手图标（拖动 = 整组移动：**先把成员全选再交给
既有拖拽状态机的 group 模式**，实时预览/让位规则/锁定检查全部复用，不新造一套）+
折叠箭头 + 双击改名（内联输入）+ 解组；行围合框（虚线，`pointer-events: none`，
cells 在 DOM 之后天然盖在上面）；多选批量条加「成组为行」。已知边界如实记：
成员区里放**已属别的行**的卡属病态输入（v1 不特殊处理）；`groupIntoRow` 拒收
已归行的卡（要先解组——避免一次操作多段位移的语义歧义）。

**接线**：单测 +25 / 文件 75 → 76（`tests/engine/rows.test.ts` 24 条 + cardData 无涉）、
E2E **26 → 28**（成组折叠展开解组全链 / 拖行头整组移动且非成员不动）。

### 10.36 阶段 C：参数化一键自动重排（2026-10-12）

Grafana 对标清单的最后一项。**范围与克制**：只做"一键、参数化、可撤销"的显式动作，
**不做连续自动**（Grafana 的 auto grid 会跟着加卡/改窗连续重排，而这版面上的卡很多是
手工微调过尺寸的 —— 偷偷重排会与手工意图打架；用户早前的口径就是"不偷覆盖手工坐标"）。

**算法（`autoLayout.ts`，数字全部可手验）**：每行 `per` 张 → 宽 `floor(12/per)`、
余数 `r` 分给前 r 张；**任何卡宽不小于自己形态的 minW**（小于就取 minW，超 12 列顺延
到下一格行，不硬塞）；高 = `max(rowH, 该格行内最大 minH)` 的**统一行高**（宁可格子高一点，
不让任何卡低于 min）；顺序按 `(y, x)` 保阅读序；落位后对全表做一次确定性消叠
（非目标卡被压到就走同列带向下首配 —— "不重叠"是全仓不变量，不因一次重排破掉）。
目标两种：`{ row }`（行内成员；折叠中的行拒绝——没有可见成员区可排）与 `{ top: true }`
（全部无行卡）。**幂等**：同输入同输出，重复点"重排"版面不动（单测钉死）。

**UI**：行头加 `每行 N 张 / 高 N 行` 两个原生 select + 重排键（参数**随结果一起提交**——
改下拉不产生历史，点重排才是一步可撤销的动作）；排布菜单加「行重排」（逐行用各自存的
`row.auto`）。**明确不做**：整页无行卡片的重排（「整理/撑满」已管那群）。**三枚行头图标钮
（折叠/解组/重排）的视觉都只有 13×13px**，低于最小可点区 —— 沿 `.cbtn` 的老办法用伪元素
把命中区撑到 22×22（实测扩张后 ≥23×21，与行头 22px 等高），视觉零变化。

**覆盖率插曲（第二阶段的老问题再来一次）**：autoLayout 分支密集（参数夹回、余数分配、
minW 抬底、折叠守卫、消叠让位、全行入口），一上来把受测层分支覆盖从 94.3 顶到 93.4；
补 14 条针对性单测（含"参数假值走默认""per=5 的余数+minW 抬底的精确宽度序列
`[3,3,3,3,2]`""重排压到无行卡→让位后仍不重叠"）后回到 **94.12%**。同时清掉两处
**恒真守卫**（`if (line.length)` 与命令标签的空回退 —— 由构造保证非空，留着只是
覆盖率账本上的假洞）。

**接线**：单测 +25 / 文件 76 → 77（`tests/engine/autoLayout.test.ts` 16 条为主）、
E2E **28 → 29**（行内重排：成员均匀成格 + Ctrl+Z 一步退回，基准取"成组后重排前"——
成组本身也是一步历史，这一步差点写成假红）。

### 10.37 墨纸皮肤的卡片边框：用逐像素测量把"看不见"变成"看得见"（2026-10-12）

**用户实拍**：「墨纸主题下，卡片边框线不明显」。**先量后改** —— 三套皮肤各截边框像素、
按 WCAG 算对比度，根因一句话：ink 的 `--border-soft` `#e6e6e2` 对页底 `#f7f7f5`
只有 **1.13:1**，边框不等于存在。

**为什么只有墨纸显示不出来**（不是"值填错了"，是三套皮肤的分层语言不同）：

| 皮肤 | 卡边 | 页底对比 | 另两条分层线索 |
|---|---|---|---|
| aurora | 白边 `rgba(255,255,255,.55)` | 1.10:1 | 玻璃面渐变 + 厚落影 —— 浅边是**高光边**，分层不靠它 |
| candy | 白边 `rgba(255,255,255,.9)` 2px | 1.09:1 | 大圆角 + 厚实落影 |
| **ink** | 灰边 1px | **1.13:1**（≈没有） | `--frost-edge: none`、落影 0.06 透明度、无 top 高光 —— **分层只剩边线一条，而边线几乎不可见** |

墨纸的产品语义是"平底色 + 1px 硬边 + 无渐变"（§10.28 那一轮的定位），它没有别的
分层手段可用，所以**它的边线必须比 aurora/candy 配得深** —— 这不是偏离美术语言，是补齐它。

**取值不是拍脑袋，是逐档排出来的**：同一张卡上逐档替换边框色、截图回读像素，
对页底对比度 1.17 → 1.24 → 1.31 → 1.38 → 1.46:1 五档。对照组：aurora 白边
（1.10:1，但靠落影成立，**不能拿它当目标**）与 ink 自己的 `--border-strong` `#cfcfc9`
（1.46:1，已经是 ink 词汇表里"更硬"的那一档）。选择：**把 soft 抬到旧 strong 的档位**
（`#e6e6e2 → #cfcfc9`：对卡底 1.56:1 / 对页底 1.46:1），strong 顺带上抬到 `#c0c0b8`（1.71:1）
保住"两档"的序关系 —— 抬 soft 不抬 strong 会把两档并成一档。**暗色同一个病**：
soft `#26272b` 对卡底 `#17181b` 仅 1.19:1 → 取 `#3a3b41`（1.59:1，与亮色同档），
strong `#3a3b41 → #4a4b52`（2.05:1）。

**影响面**：`--border-soft` 是全仓 59 处边框/分隔线的底料（卡边、卡内输入框、设置面板
分隔、行带框……）—— 一次改值全部跟着清晰一档，这正是想要的效果（墨纸下"一切边界"
本来就该同一个深浅口径）；亮暗两主题整板截图验收过，没有哪处显得变重。

**同一反馈里的第二项「加一张卡时界面会抖、再加一张就不抖」：实测不可复现，如实记账**
（不为不可复现的东西乱改）。量法：四组视口（1440×900 / 1280×800 / 1024×768 / 640×700 栈式）
× 工作台 / 编辑器两视图 × 单加 / 连加两张，10ms 采样 + MutationObserver 逐帧记录卡片矩形、
行轨高、列宽、容器高与滚动位置 —— **几何全程帧稳定**（无跳变、无滚动锚定位移、无滚动条
闪烁、无 FLIP 动画帧）。过程中唯一一次「368px 跳变」经复跑证实是探针进程被 kill 留下的
脏读数（读数文件里时间戳自证），已排除。**待用户给复现细节（哪个视图、哪张卡、多宽的窗）再收**；
探针基建（`tmp-shake*.mjs`，含零依赖 PNG 解码）留在工作区不入库。

**同日晚二笔（同一用户的第二句实拍）：把"卡浮在底布上"这件事补上** ——
「卡片的背景色能不能不要和底布一致……仿佛浮在底布上」。第一笔只把**边线**补明白了，
但 ink 依然是"白纸平铺在白纸桌上"：卡面 `#ffffff` 对页底 `#f7f7f5` 的亮度差只有 2 级、
零落影、`--frost-edge: none` —— 层次出不来。**修法跟着柔光的语言走、换成纸的版本**：

| 手段 | aurora（玻璃） | ink（纸，本次） |
|---|---|---|
| 表面 | 四层 radial 渐变 + 玻璃线性 | 纯色（无渐变是墨纸的定位，不动） |
| 顶边高光 | `inset 0 1px 0 rgba(255,255,255,.85)` | `inset 0 1px 0 rgba(255,255,255,.95)`（\(--frost-edge\)，纸边受光） |
| 落影 | `0 1px 2px .05 + 0 8px 24px .06` | `0 1px 3px .08 + 0 14px 34px .13`（近距接触影 + 中距扩散影，比柔光更重——纸要更用力才"离桌"） |
| 底布 | `#f4f1e9` 亚麻白 | `#f7f7f5 → #f2f2ed` 压暖压深（**层次改动做在底布一侧**，卡面保持纯白） |

一条踩到的小坑：顶边高光**只能写一处**。`--shadow-card` 与 `--frost-edge` 都会被
`.card` 的 `box-shadow` 拼进去，两边同时写会在元素上叠出**两层同款 inset**（实测
computed style 里出现两份 `rgba(255,255,255,.95) 0 1px 0 inset`）——高光归 `--frost-edge`。
暗色同修（底布 `#0e0f11 → #0c0d0f`、卡面 `#17181b → #191a1e`、落影加重、高光收弱到 `.09`——
`#fff` 在暗面上像一条白线）。**数值不是排出来的而是从对比度链上落下来的**：
卡面对底布 1.07 → 1.12（亮）/ 1.06 → 1.12（暗），卡边对新页底 1.39:1、对白卡 1.56:1
（仍在前一笔定的目标档内，§上文逐像素表）。

### 10.45 桌面能力卡：会议速记 + 窗口预览（2026-10-16）

**来源**：Phase 3 施工顺序 10（用户「先 1 再 2」里的第 2 步）。两批 Rust 侧能力
（`meeting/` 的采集 + sherpa-onnx 转写、`capture/preview.rs` 的 WGC 帧管线）在前一批已经落地，
这一批**只做前端**：把它们变成两张能用的卡。

**两张卡共有的形状**：都是「桌面壳专属」—— 网页版拿不到本机音频、也读不到本机窗口画面，
所以两张卡都**如实说不可用**（`isDesktop` 为假时只渲染一句话），不摆一排点了没反应的假控件。
**引擎零改动**：判定逻辑各自抽成纯模块 `src/vue/minutesLive.ts` / `src/vue/winPreview.ts`，
与卡同批进受测层、逐文件棘轮锁 100% 分支。

**会议速记（`minutes`，归「记录」）**：

- 状态机是**两个维度相乘**：模型三态（missing / downloading / ready / failed）× 会话三态
  （idle / recording / paused）。可用性由 `deriveControls` **一处**算出来，不在模板里散着写 if。
- 进度取 **Channel 的 received/total**，不取 `asr_model_status` 的 `progress` ——
  后者是文件级粗进度（Rust 里写的是 `(i+1)/模型数`），Channel 那份精确到当前文件且自描述。
- **暂停口径**：暂停 = 收回采集句柄 + join 转写线程 + 重新开采集，**不是把流暂停**；
  所以暂停后再续，设备要重新挑一次（输入 / 输出是两批设备，切音源同理）。
- 已录时长由前端按 `Date.now()` 自己累：后端只在 stop 时给一次总时长，中间**没有心跳**。

**窗口预览（`winview`，归「工具」）**：

- 帧链路：Rust WGC 捕获 → `Channel<InvokeResponseBody>` 发 `Raw` 字节 → 前端 `Blob` →
  `URL.createObjectURL` → `<img>`。**每帧先撤上一帧的 objectURL**：10fps 跑一分钟就是 600 个，
  被 URL 引用着的 blob 不会被 GC，不撤就是一条一直涨的内存曲线。
- 三态降级都在界面里说清：已最小化（不能预览）/ 受保护内容（只能拿黑帧，Windows 的限制）/
  会话已停止（`win_preview_stopped`，人话映射在 `winPreview.ts`）。

**三处按实现写、不按 IPC 契约的偏差**（契约已回写 yaml，逐条也记在卡文件头）：
① 实时事件名是 `minutes_segment` / `minutes_error`，**不是** `meeting_segment`；
② 载荷是 `Utterance{text, startMs, endMs}`，**没有 sessionId / speaker / partial**；
③ `speaker` 恒 null、`meeting_diarized` 永不 emit（diarization 本批没有权威校验源）。
②的后果如实写在卡里：**停止后立刻开新会话时，上一场的尾巴句仍可能落进新会话的字幕**——
这是事件契约的限制，前端根除不了，别把它当 bug 去"修"。

**未决项：diarization（D-14，2026-10-17 从代码注释落成正式条目）**

- **卡在哪**：说话人分割要用的 pyannote `speaker-segmentation-models`（分割模型 6.6 MB），
  上游 release 里**没有官方 `checksum.txt`** —— 而 `asr-models` / `punctuation-models` 两个
  release 有（所以转写与标点模型有权威校验源，能走 sha256 落盘校验）。本仓模型下载链路的
  规矩是「官方 checksum → sha256 → 不匹配拒装」，**没有校验源的模型一个字节都不下** ——
  宁可整批剥离，也不无校验下载一个能改转写行为的东西。
- **为什么记成"未决"而不是"砍掉"**：模型本体可用、管线位置也全留好了 —— 契约里
  `Segment.speaker`、`Transcript.speakerNames`、`meeting_diarized` 事件都在 yaml 里，
  实现侧恒空（`session.rs` / `session_store.rs` 的 D-14 注释）；UI 侧按"没有说话人"处理，
  不摆「说话人回填中」这类没有可等回填的假状态。
- **解堵条件（满足其一即可开工）**：① 上游给 `speaker-segmentation-models` release 补上
  `checksum.txt`；② 或自托管模型包并自算 checksum 入库（等于自己当权威源，需在下载链路
  登记新源并过 R-01 的规矩）。到那天：`speaker` 的 `None` 换成真实回填、`meeting_diarized`
  接上事件发射，UI 只需剥掉"没有说话人"那一层 —— 契约与表结构都不用动。

**收口时当场撞到的三处既有问题**（都不属于这批的设计）：

| # | 问题 | 为什么值得记 |
|---|---|---|
| 1 | `toFrameBytes` 视图分支返回 `Uint8Array<ArrayBufferLike>`，而 `BlobPart` **只收 `ArrayBuffer` 底** | TS 5.7 起 `Uint8Array` 按底层缓冲泛型化，`vue-tsc` 当场 TS2322，**把整条 typecheck 卡住**。修法是归一化函数自己把返回类型收紧成 `Uint8Array<ArrayBuffer>`（视图分支复制一份 —— 一帧几十 KB，成本在 JPEG 解码面前可忽略） |
| 2 | `MinutesRecorder` 一处 `clamp(10px, 1.9cqw, 11px)` 掉破 11px 最小字号铁律 | E2E 那条「全部卡上版」**查不到它** —— 网页版根本不渲染录制控件。铁律不能只靠那一条夹具守 |
| 3 | `docs-check` 的 Rust 条数判据与它声明的语义**不一致** | 声明「Rust 单测条数」，实现却是 `readdirSync` 只数**顶层** `.rs`：报 **46** 而 `cargo test` 实跑 **93**，住在 `ai/` `capture/` `meeting/` 里的 47 条一条都没进门禁。改递归收集（跳过 `target/`）后与 `cargo test` 逐条对上。**这个形状在本项目已经出现过不止一次**（coord-gate 曾经根本没被 CI 调用；覆盖率用聚合值代替逐文件棘轮）—— 共同点都是"门禁在跑，但判据不是它声称的那个" |

**门禁**：1390 单测 / 86 文件 · 受测层分支覆盖 94.68% · E2E **37 条实跑**（门禁口径 38 ——
两张卡在网页版只是一句话，搭「全部卡上版」那条夹具的便车，**不新增用例**）· docs-check 全对。
**卡 52 → 54**。
（2026-10-17 补记：历史半边接上后，速记卡有了专属 E2E 3 条 —— 实跑 **40** / 门禁口径 **41**，
单测 **1424 / 90**，见 :379 facts 行与本节上方的「未决项」补段；「不新增用例」从那笔起对
速记卡不再成立，**窗口预览至今仍无专属用例**。）

### 10.44 HTML 扩展：自定卡（一段 HTML 就是一张卡）（2026-10-14）

**来源**：路线里「声明式扩展 → **HTML 扩展** → 原生卡扩展」的第二层（用户「那么久继续做吧」）。
把扩展门槛压到最低：**一段 HTML 片段就是一张卡** —— 没有 manifest、没有目录约定、没有打包。
片段跑在 `sandbox="allow-scripts"` 的 iframe 里，可以做任何前端能做的事，但**碰不到应用数据**。

**隔离边界是实测的，不是声明的**（真 Chrome，动手前先量）：父级 DOM /
浏览器存储 / cookie **全部 SecurityError 拒绝**（opaque origin），只有 `postMessage`
一条通道；入站消息要过三查（来源是你这个 iframe / 信封带 `__modulo:'ext'` /
payload 是朴素 JSON，深度 ≤6、节点 ≤512）。

**这一轮最深的坑（同一个 `</script>` 陷阱咬了三层，值得完整记档）**：

| 层 | 症状 | 修法 |
|---|---|---|
| 引擎 `frameDoc` | JSON.stringify **不管 `</`** —— 片段里普通的 `</script>` 把外壳脚本提前闭合，注入 IIFE 整段变文本、卡片空白 | 字面量再 `.replace(/<\//g,'<\\/')`；**这一行就是全部注入防线** |
| 组件 SFC | 同样的字面量出现在 `<script setup>` 的模板字符串里 → **SFC 解析层**把它当块结束标签（TS1005） | 模板字符串里写 `<\/script>` |
| 校验层 | 最初在输入时拦 `</script>`，结果**把所有带脚本的正常片段全拒了**（`<script>…</script>` 本来就该出现那个字面量） | **撤掉这条校验**：安全靠注入方式（结构性），不靠输入过滤 |

顺带把"外壳文档"从引擎搬回宿主（`HtmlCard.vue` 的 `shell()`）：**引擎纯度守卫会拦
`window`/`document` 这类词**，而外壳 HTML 是渲染实现 —— 引擎只留 `snippetLiteral`
（注入防线）、`isExtMessage`/`plainJson`（信封校验）、名单清洗，全部环境无关。

**边界与口径**：片段最大 16 KiB、最多 8 张（进备份）；片段**能联网、能占 CPU** ——
卡片上的说明与文档写的是同一句话：*信任级别 = "你愿意在浏览器里打开一个文件"*。
沙箱保证的是"动不了应用数据"，不是"没有副作用"。

### 10.43 桌面工具箱：速达启动器（2026-10-13）

**来源**：批 4 的一半（路线里用户全选的四项之一）。先量后做：托盘（唤出/置顶/退出）与
两个全局快捷键（summon/ontop，含改键）**早就在**，所以批 4 真正缺的是"点一下就打开"。

**做的是「速达」**（对标 x-hub 的资源启动器里最核心的一半）：常用程序 / 网页 / 文件
收成收藏，点一下用系统默认方式打开。**明确定下没做的一半**：不扫全机已安装应用
（要解析开始菜单与注册表，是另一套体量）、不解析 `.lnk`（要 COM）、不提取图标（要
GDI）—— 这些都如实写在卡片与文档里，不假装有。

**边界（这张卡敢做"点开就执行"的前提）**：

| 层 | 判据 |
|---|---|
| 引擎 `kindOf` | 只认 `http(s)://` 与**绝对路径**（盘符 / UNC / POSIX）；**裸命令名一律拒** |
| Rust `shape_ok` | 同一套判据**再判一次**（前端能被 XSS 改、Rust 不能 —— 与 net.rs 同分工） |
| 打开方式 | `ShellExecuteW`（等价双击）；**UAC 由系统弹，我们不代劳静默提权** |

裸命令名被拒这条是刻意的：`explorer.exe` 这类交给 ShellExecute 会走 PATH 解析，
于是"打开"就变成了"执行任意命令"。x-hub 用 `runas` 动词静默提权，我们**不做** ——
静默提权意味着一个被改过的收藏项能拿到管理员会话。

**Rust 侧不加依赖**：`ShellExecuteW` 走裸 FFI 声明（与 `net.rs` 的 winhttp 同一手法）——
一个函数不值得引入 crate（还要过镜像与供应链审查）。失败码翻人话（`describe_code`：
找不到文件 / 权限被拒 / 没有关联程序 / 裸命令名…），别让卡片只说"打开失败"。

**网页版如实降级**：能列、能编辑，点击时明说"网页版不能打开本机程序"，不静默、不假装成功。

**没做剪贴板历史，理由记账**：它需要新 crate（clipboard-manager 或裸 Win32 clipboard
轮询）+ 一个新浮窗 + `summon` 之外的新全局快捷键，体量与回归面都比速达大一档；
按"宁缺毋滥、不半成品上线"的用户口径，本批不做，留在路线里。

### 10.42 声明式扩展第一层：网页取数（2026-10-13）

**来源**：路线里「声明式扩展 → HTML 扩展 → 原生卡扩展」的第一层（用户「那就做吧」）。
对标 x-hub 的扩展里最实用的一档：**填一个 URL + 选刷新频率 + 说清要哪个字段，宿主负责
抓取、解析与渲染** —— 零代码就把任意 JSON 接口变成工作台的一张卡（热搜条 / 汇率 /
股价 / 服务状态）。**只认 JSON、不做 HTML 抓取**：解析网页文本极易因对方改版而碎，
而且那是另一类问题（正文抽取），不该顺手塞进"取一个数"里。

**边界不重新发明**（这是本批最省事也最重要的决定）：

| 环节 | 复用谁 | 说明 |
|---|---|---|
| URL 判据 | `watch.normalizeUrl` | 只 https、拒私网/保留主机名/userinfo，与 Rust 侧同源；本批只在长度上限上对齐（300） |
| 取数 | `net::get`（Rust） | 同一套安全边界原样适用；本模块只做"这确实是 JSON 吗" |
| 名单清洗 | `sanitizeWatch` 的骨架 | 丢坏条、去重、砍上限、**被挡条数回显**（导入别人的备份时有意义） |
| 卡组件 | 仓里"机器采的不进备份"口径 | 端点表（用户写的）进 cardData/备份；**取到的数据只在内存** |

**引擎 `http.ts` 的四个纯函数**（全可测、无 DOM）：`cleanPath`（只认 `a.b[0].c` 白名单
形状，**不解释任何表达式** —— 输入即代码的接口攻击面大于便利）、`pickPath`（落空一律
undefined、不抛）、`formatValue`（数字按 `scale100` 折元、其余原样，**不猜千分位与货币
符号**）、`listOf`（对象数组/标量数组两种列表形状）；外加 `fetchPlan`：网页版标
"desktop-only"、桌面壳 native —— **不预判哪些接口开 CORS**（那份名单会过期），运行时
真取一次最诚实。

**Rust `fetchjson.rs`**：与 `feeds.rs` 同构（同一个 `net::get`，256 KiB 上限、按字符
截断），差别只在**校验响应是 JSON**：`"响应不是 JSON"` 与 `"取不到"` 分开报 —— 前者说明
URL 指错了东西，后者是网络/边界问题，卡面文案不该含糊。

**卡（`HttpCard.vue`）**：数据源下拉切换、大数字/列表两种呈现、页脚 HTTP 状态与
"多久前取的"、刷新键；配置态内联成表格（显示名 / 取值路径 / 刷新档位 / 分→元 / 删除），
**提交成功即关配置并立刻取一次数**（"改完即看"；真机验收时发现留在配置态是错的）。
刷新节奏取所有端点里最短的档（各自定时器不值当）。

**真机验收**（1430 + 公开汇率接口）：加卡 → 填 `https://open.er-api.com/v6/latest/CNY`
→ 网页版原生 fetch 成功 → 配路径 `rates.USD` → 卡面显示 **0.15 / HTTP 200 / 刚刚**。
私网地址在输入端被拒并写明边界。

### 10.41 命令总线与命令面板：把"能被发起的动作"收成一份清单（2026-10-13）

**用户口径**：「命令要有一套严谨的设计逻辑啊！不是乱搞的那种随便几个提示词，
这个没有意义 —— 你看看到底要不要做」。这一句把方案从"加个 Ctrl+K"改成了
**先建命令层再建界面**；如果只做面板，它必然长成 x-hub 那种"一堆名字平铺"的样子。

**设计（先写清，后动手）**：引擎的 `ops.ts` 早已是每次编辑的纯函数实现，但它们被
**三条互不相识的路**调用（顶栏直调 store、键盘经 `keyboard.ts` 各自调 store、
编辑器 UI 直调 store）。命令层把"能被用户发起的动作"收成一份清单，入口只发
`dispatch(id, args)`，执行只有一条路。

| 字段 | 语义 | 为什么必须有 |
|---|---|---|
| `id` | `域.动作`，只增不改 | 键盘绑定、将来的宏/扩展都引用它 |
| `label` + `hint` | 动词+对象 + 一句人话 | 面板的可用性建立在"每条都说清做什么"上（测试拦缺项） |
| `scope` | 全局/行/卡片/视图/编辑/app | 决定分组与"此刻有没有这条命令" |
| `when` | **纯函数**可用性谓词 | 键盘与面板走**同一道闸**；不可用时给原因而不是消失 |
| `undoable` | 是否进历史 | 声明了就必须过"执行→Ctrl+Z→复原"的表驱动测试 |
| `binding` | 键盘绑定 | 绑定与面板**同源**（键盘按得到的，面板搜得到） |
| `run` / `effect` / `wait` | 改文档 / 开界面 / 等宿主数据 | `wait: 'workbench-measure'` = 实现要读真实渲染高度，由 App 拦截 |

**命令总线（`commandBus.ts`）**：`dispatch` 校验 id → 跑 `when` → 优先交给宿主拦截项
→ 再跑 `run`/`effect`；既无实现又无拦截 = **不静默吞**，返回错误。宿主拦截项解决
"命令表不该知道界面长什么样"（保存要刷新编辑基线、切工作台在编辑态等于取消）。

**面板（`CommandPalette.vue`）**：一入口三件事，**三个域各自排序、分区呈现**，
不混成一列 —— 跨域比"匹配分"没有意义：
命令（走同一张表的 commandStates）／卡片（注册表按名字搜，回车定位并闪亮）／
内容（`paletteIndex.contentIndex` 把用户写的字铺平：便签、待办、四象限、速记、
链接、命令速查、订阅、自选、生日；机器采的数据不在 `CardData` 里，天然不会被搜到
—— 数据分层的直接收益）。

**测试（这轮的严格性都在这）**：`tests/vue/commands.test.ts` **26 条全是对全表跑的不变量**
——结构与文案齐全、id 唯一、binding 不重复、有实现（run/effect/wait 三选一）、
**undoable 的全表逐条真跑"执行 → 文档变 → Ctrl+Z 逐字节复原"**、
`when` 随上下文翻转、闸门拒绝含原因、effect 类不动文档。
E2E（`palette.spec.ts`）锁真实链路：Ctrl+K → 过滤 → 执行 → 一步撤销 → Esc。

**过程中被这条链自己抓出来的一个真缺陷**：把 `card.remove` 并入总线后，
**Delete 键静默失效** —— 命令的"目标"当时只认"选中"，而键盘用户从来不先框选；
修复是把**焦点格**补成目标来源（`focusedCard`），优先级 = 显式参数 > 焦点格 > 唯一选中。
这条正是"单一分派点"的价值：三段合流的路上，两套目标语义立刻现形（分散时永远
撞不上）。同时定下一句规矩：**焦点在输入框里时 Ctrl+Z 属于输入框**（面板开着按它
撤销的是文字，不是版面）。

### 10.40 脱离浮窗：卡片可以离开工作台，变成桌面小窗（2026-10-13）

**来源**：用户转来 x-hub 的操作教程（微信公众号）与仓库，问"里面的机制能不能参考、
能不能做得更好"。摸清它的扩展/市场/脱离/触达四层之后，按 **脱离浮窗 → 命令面板 →
声明式扩展 → HTML 扩展 → 原生卡扩展** 的路线分批落地（用户拍板，四项全要）。
本批是第一件，也刻意选它打头：**观感提升最大、技术风险最小**。

**语义**（对齐 x-hub 的"便签/倒计时脱离主窗"，但卡片本体是宿主的）：

- 工作台卡片右上角悬停出「脱离」键 → 卡片从工作台消失、桌面出现一个无边框置顶小窗；
- **位置与尺寸记忆**（`detached.json`，`Moved`/`Resized` 事件写回）——移动/缩放随用户，
  关掉只是消失，下次脱离回原处；
- **关窗 = 还原**：窗口 `Destroyed` → Rust 摘登记 → 广播 `modulo:floats-changed` →
  主窗把卡片放回工作台（坐标/形态原样，因为**文档从头到尾没动过**）；
- 启动时 `restore_all` 把登记过的浮窗全部恢复（与 x-hub 同款语义）；
- 浮窗里渲染的是**同一个原生卡组件**（`CARD_COMPONENTS[cardId]`）——不是 iframe 里的
  网页。这是相对 x-hub 的根本差别：观感、令牌、容器查询全部与主窗逐像素一致。
  拿不到卡组件（未知 id）时如实显示"这张卡暂不支持浮窗"，不白屏。

**实现的关键判断**：

- **投影层过滤，不是文档层**。`useProjection` 新增 `hidden: Ref<Set<string>>`，
  投影前 `items.filter(...)`；被脱离的卡**仍在 `doc` 里**，所以不需要动引擎一行，
  也不存在"删了再插回去坐标丢了"的问题。代价是脱离后版面上会留一个洞——这是产品上
  正确的一侧（回工作台时原位复原），后续可用「排布-整理」聚拢。
- **登记放 Rust 侧**（`src-tauri/src/floatwin.rs` + `data_root/detached.json`）：
  浮窗几何是窗口属性，由窗口事件驱动写盘；前端只维护"哪些卡在浮动"，经
  `list_floats` 拉取 + 事件增量同步 —— 开关可能由任意窗口触发（浮窗里点还原、
  系统关窗），只信本地动作会漂。
- **主窗写盘 → 浮窗重读**：两个 WebviewWindow 共享同一份落盘文件，靠
  `modulo:doc-written` 事件通知（在 `fileStorage.set` 成功后广播），不轮询。
- **多页构建**：`float.html` 是独立入口（`vite.config.ts` 的 `rollupOptions.input`）——
  不登记它，`vite build` 不产出产物，桌面端脱离就是白屏。
- **网页版如实降级**：`floatingSupported()` 为假 → 脱离键不渲染；浮窗页在网页版
  不崩（拉不到清单不自关，命令缺省返回空）。

**测试策略**（重要，因为窗口系统测不到）：把这条链拆成两半各自可测 ——
Rust 侧测纯函数（label 往返、JSON 序列化往返、损坏兜底，+3）；
前端侧在 E2E 里**桩掉 Tauri 核心**（`tests/e2e/tauri-stub.js`：invoke 表 + 按
`@tauri-apps/api` v2 真实形状实现的 `plugin:event|listen` 协议 + floats 广播），
把"点脱离 → float_card → floats-changed → 卡片离开工作台 → 关浮窗回来"整链跑真。
踩过的三个桩坑记档：① 源码字符串不能直接当 `evaluateOnNewDocument` 的函数
（含 IIFE 分号解析失败）；② `__TAURI_INTERNALS__.invoke` 必须是**同一个**带广播的
invoke，否则"记了调用却没人收到事件"；③ `transformCallback` 必须返回 id 并登记到表里，
事件插件才找得到回调 —— 这三条都是"看起来绿其实没跑"的形状。

### 10.39 潜在问题排查一轮：两个真缺陷（2026-10-13）

**用户口径**：「先不管抖动，解决一下其他潜在的问题」。排查面与结论先记全（都是实跑量出来的，
不是读代码猜的）：

- **全流程运行时报错走查**（真跑：加载 / 排布四项 / 模板与设置与外观切换 / 编辑器事务 /
  行容器全链 / 撤销重做 ×20 / 视口四档 / 进出编辑器 ×6）：**0 pageerror、0 console 警告、
  0 非预期网络失败，DOM 节点数全程恒定 226**（无泄漏感）。
- **性能与资源**（CDP `Performance.getMetrics`）：静置 10s 主线程仅 **58ms（CPU≈0.6%）**、
  布局 10 次（里面就一个秒针 tick）；进编辑器+加卡+保存布局 6 次、排布-整理 4 次、
  换皮肤样式重算 7 次。25 张带 `setInterval` 的卡**全部**带 `clearInterval`；拖拽三条
  window 监听在 pointerup/cancel 与 unmount 都摘。
- **数据完整性**：方案册存的是文档引用，但 store 是不可变 `apply` → 无别名污染；
  备份恢复有事实摘要 + 显式确认（破坏性动作要摆出来再问）。
- **无障碍**（自写扫描器）：0 无名按钮、0 无 alt 图片；发现**待办删除 × 是全仓最小热区**。

**修掉的两个真问题**：

**㈠ 网页版存储写失败完全不可见**（真缺陷，实测复现）。桌面壳写失败会填 `error`、
界面顶红条；而网页版的 `webStorage` 只是 `{ ...fallback, error: ref(null) }` ——
**error 槽永远为 null**，QuotaExceeded（配额满 / 隐私模式）从 `set` 里直接抛出去：
pageerror 一条、`.storage-error` 不出现、改动只在内存，用户以为存上了、刷新即失。
这正好违反仓库自己写在 `PersistentStorage` 注释里的规矩（"静默失败的存储迟早会变成
『我明明存了』的数据丢失"）——**规矩只落在了桌面壳一侧**。修法：webStorage 包 try/catch
填 error（读失败按"没有存档"处理并留提示），红条上加一枚**「立刻下载备份」**救命入口
（判据=文案含「只在内存里」，两版同源），"同一 key 再写成功撤红条"与桌面壳对称。
回归：单测 3 条（写失败不抛/恢复消警/读失败降级）+ E2E 1 条（接管
`Storage.prototype.setItem` 确定性制造失败 → 红条出现且带救命按钮 → 还原后消失）。

**㈡ 待办删除 × 的触区 18×13px**（全仓最小，手指几乎点不中，行距 23px）→ 沿
`.cbtn` 的老办法用伪元素扩到 **31×25**（不越相邻行），并补
`aria-label="删除待办：<条目>"`；待办输入框与便签 textarea 补显式 `aria-label`
（placeholder 不算可访问名）。

**这一轮还收紧了一条守卫的方法**：「不裁字」原判据只看 `scrollWidth > clientWidth`，
热区伪元素的外扩也被算成"溢出的内容"，31px 的命中让 18px 的 × 变成假报（实测踩到）。
改成**排除带 `::after` 覆盖层的元素**（全仓热区扩法都是这个签名），并做了变异自检：
往卡里塞一个"定宽 + overflow hidden + 超长文本"的 span → 被裁数 0 → 1（**守卫会咬**），
恢复原状 → 0。妥协点记档：真出现"按钮内文本被裁"会被这个规则放过 —— 当前全仓没有
这种形状，若将来有，判据要再收紧。

### 10.38 模式分工落地：工作台=用+微调，布局编辑=增删改（事务化）（2026-10-12）

**用户裁决**：「布局编辑里面没有保存和取消的选项，添加卡片应该是布局编辑里面才有的
选项；工作台应该是主要用来使用，做点微调；布局编辑应该是用来增删改」。两处口径经
AskUserQuestion 定死：**删除只在布局编辑里**（工作台悬停条不设删除键）、
**取消时有改动先问一句**（不是点错就白改，也不是每次弹）。

**编辑器事务**。此前两态共享同一份实时文档：编辑器里拖一下 = 立刻落盘，没有"这次编辑"
这个概念。现在进编辑器拍一张快照（`editSnapshot`），顶栏在编辑态多出 `取消 / 保存 ②`：

- **保存** = 确认改动并退出；**取消** = 有改动先弹「放弃这次编辑？（版面有 N 处改动）」
  确认框，确认才还原；没改动直接退出。
- **`N 处改动` 按版面差异数，不是按历史步数** —— 拖一步再拖回来在历史上是两步、
  在版面差异上是 0 处，而用户看的是版面。实现是逐卡片/逐行比对（增、删、改各计一）。
- **指针路径三条都走同一条取消路径**：Esc、点「工作台」tab、点「取消」。只做按钮
  不做 tab/Esc，事务就会被一次 tab 切换绕开。
- **还原本身可撤销**：`store.restore(snapshot)` 刻意复用 `apply()`（提交进历史 + 落盘），
  所以"取消"是历史里的一步 —— Ctrl+Z 能把放弃的改动再踩回来，而不是把历史撕开一个洞。
  这条写进了单测（restore 一步可撤销 / 重做成对）与 E2E（放弃后 Ctrl+Z 找回）。
- **编辑中换模板 = 重建基线**（新快照）：换模板那一刻的版面就是"这次编辑的起点"。
- **Esc 的层级编排**：确认框 → 编辑器自退（清选中/关目录下拉，`escapePressed()` 经
  模板 ref 上抛）→ 取消这次编辑 → 顶栏各弹层。编辑器先吃，因为它手里有比"取消整场编辑"
  更局部的"退一步"——否则选着卡按 Esc 会直接弹放弃确认。

**「添加卡片」搬进编辑器**。顶栏那枚主按钮删除，菜单逻辑平移到模块库头部的
「＋ 全部卡片」（新组件 `CardCatalogMenu.vue`，菜单本体从 App.vue 抽出来共用一套外观；
顶栏「排布」下拉保留原样式）。理由不只是位置：模块库只列**还没放置**的卡，而卡片到
49 张后，按分组翻一遍目录比在库里逐个找更快 —— 目录与库是同一件事的两种视图
（`placedIds` 同一判据，落位都走 `findItem`/`findFreeSpot` 同一条引擎路径）。
定位用 `fixed` + 按钮矩形现算（库是滚动容器，`absolute` 会被裁）。

**一处被 E2E 抓出来的旧问题**：`freshPageWithDoc` 夹具从不预置 `modulo.template.v1`，
于是"预置了版面"的用例里首启模板选择器**一直盖在工作台上** —— 它自己的「自己去编辑器排」
里也有"布局编辑"三个字。此前没出事只是因为没人从这套夹具里点顶栏；这次一进编辑器就
翻出来了。已按 `freshPage` 的口径补上预置（这支夹具的语义本来就是"已经挑过模板、
只是版面不同"）。

**接线**：单测 +3（`restore` 三步语义）、E2E **29 → 30**（目录搬家后的完整链 +
事务三态：取消确认/继续编辑/放弃还原/tab 同路径/保存生效）。文案统一：删除键的
title 仍是「移回模块库」——那不是"删除数据"，卡片回库随时能再拖回来。

### 10.28 出厂皮肤改柔光，以及一条"永远不会红"的守卫（2026-10-08）

**用户裁决**：默认皮肤 `ink` → `aurora`。理由是"第一印象"：`ink` 的卡片底（近白）与页面底
（`#f7f7f5`）几乎同色，"卡片是一张卡"的层次出不来 —— 而这个产品卖的就是"一张张卡"。
`aurora` 带柔光渐变与玻璃表面，层次一眼可见；它同时就是 `:root` 的隐含实现，
于是「没存过偏好」这条最常见的路径上**首屏连一次属性变化都不需要**（与同日 07:20 那轮
防闪脚本是同一套逻辑的收尾）。另两套皮肤一个没删，在「外观」里随时可换。

**改这一处默认值，牵出四处手抄了同一个数的地方**：`index.html` 的内联回退值、
`tests/vue/appearance.test.ts` 两条期望、`tests/e2e/layout.spec.ts` 一条断言、
`scripts/desktop-probe.mjs` 的 `DEFAULT_APPEARANCE_ON_DISK` 与那条断言。
前三处是普通的同步；**第四处暴露了一个真问题**，值得单独记：

> 探针（`npm run desktop:probe`，发布前的本机门禁）那条「首次启动是墨纸皮肤 + 朱砂强调色」，
> 原先的修法是"跑前把文档化的默认值**写进** `modulo.appearance.v1.json`，再断言读到它"。
> 它当时绿着，注释还写着"改了一处忘了另一处，这里会红"—— **但那句话是假的**：
> 探针自己写 `ink`、再断言读到 `ink`，覆盖的只是"存档能读回来"这条持久化路径；
> `DEFAULT_APPEARANCE` 从 `ink` 改成 `aurora`，它照样绿（这次就是这样发现的：
> 手里握的是过期期望值，而灯是绿的）。
>
> 所以改成**把文件清掉**：这才是真实的首次启动，应用只能落到代码里的 `DEFAULT_APPEARANCE`，
> 而期望值是它的手抄。跑完仍按原样还原、原来没有就不留。这跟同一轮 E2E 里
> `clickTool` 那句 `?.click()` 是同一类病：**会静默跳过自己的守卫比没有守卫更糟**。

---

## 11. 桌面壳（第二轮，2026-10-01）

Tauri 2 最小壳：`src-tauri/` 只声明一个主窗口（1280×800，最小 380×560，居中、可缩放；启动时按显示器工作区夹一次，见 §11.4），能力只申请 `core:default`（§11.3 起补了四条窗口动作），**不申请文件、shell、通知权限**。前端一行没改就能跑，因为壳只是把已有的 web 构建装进 WebView2。

**构建与运行已实测**：`npx tauri build --no-bundle` 在注入 MSYS2 PATH 后 5m09s 完成，产物 `src-tauri/target/release/modulo.exe` **5.42 MB**；启动后窗口标题为 `Modulo`、进程稳定存活（验证完即关闭）。安装包当时没打（NSIS 要联网下载打包工具），后来打了，见 §11.4。

窗口最小尺寸刻意给到 380×560：x-hub 的 `minWidth: 1000` 让它的响应式断点变成死代码，我们把下限压到手机宽度，正是为了让 §3 的投影在桌面端真的被用到。

### 11.1 本机环境配方（重要，否则会以为是代码坏了）

- `rustc` host 为 `x86_64-pc-windows-gnu`（不是 msvc），且**没有装 VS Build Tools**。
- GNU 工具链在 MSYS2 里但不在 PATH：`D:\msys64\mingw64\bin`（`gcc 16.1.0`、`windres 2.47`）。
- `tauri-build` 在 GNU 目标上要 `windres` 打资源。因此构建前必须注入 PATH（**只对该次命令生效，不改系统配置**）：
  ```bash
  export PATH="/d/msys64/mingw64/bin:$PATH"
  npm run tauri:build
  ```
- 另一个 PATH 陷阱：MSYS/git 自带一个 `link.exe`（创建硬链接的 coreutils 工具），它在 PATH 里会**遮蔽 MSVC 链接器**。本机因为走 GNU 工具链所以不受影响，但如果哪天切到 msvc target，必须先确认 `where link.exe` 的第一条不是 MSYS 那个。
- **`modulo.exe` 不能单独拷走**（2026-10-03 为它花了半小时）：windows-gnu 构建的 exe 会从**自己所在目录**加载 `WebView2Loader.dll`（`target/release/` 里就有它，160 880 字节）。只把 exe 复制到别处，症状是**进程活着但没有 webview**（工作集 4.5 MB、零 `msedgewebview2` 子进程、CDP 永远不来），或者直接以 `0xC0000135`（STATUS_DLL_NOT_FOUND）静默退出 —— 两种都不打任何错。要拷就连 DLL 一起拷。（对用户不是问题 —— 但**理由不是这句原来写的「安装包装出来的目录里带着它」**：2026-10-15 实测 0.8.1 装完的目录里只有 `modulo.exe` 与 `uninstall.exe`，**没有** `WebView2Loader.dll`，应用照常起（进程模块表里 webview 相关只有系统那份 `EmbeddedBrowserWebView.dll`）。当前 CI 走 msvc target，loader 已经静态进 exe；所以这条坑的成立范围**收窄到本机 windows-gnu 自建那一种**。详见 §11.4 的装/卸门禁 —— 那句话本身也已经按实测改过。）

### 11.2 已知取舍

- ~~数据仍在 WebView2 的 localStorage~~ → 桌面壳已改成 `%APPDATA%\app.modulo\data\` 下一个 key 一个 JSON（见 §7），设置页里会显示这个目录。网页版仍用 localStorage。
- ~~CSP 里放开了 `ws://localhost:1430`~~ → 已收紧（2026-10-01）：开发期的 WebSocket 白名单挪进独立的 `devCsp` 字段，生产 `csp` 只剩 `default-src 'self'` + 内联样式 + `data:`/`blob:` 图片。探针仍能连 —— CDP 走的是 WebView2 的调试端口，不受页面 CSP 约束。
- ~~无边框自制标题栏、托盘、全局快捷键都还没做~~ → 已做，见 §11.3。刻意单独一轮，不和其他改动混在一起 —— 那是 x-hub 踩坑最密的地方（运行期建窗挂死、`skip_taskbar` 失效）。

### 11.3 托盘、全局快捷键与无边框标题栏（2026-10-01）

**无边框**：`decorations: false` + `src/vue/components/TitleBar.vue`（34px，拖拽区用 `data-tauri-drag-region="deep"`，右侧最小化/最大化/还原/关闭三个按钮）。

拖拽区这里有两个反直觉点，都是读 Tauri 注入的 `drag.js`（`tauri/src/window/scripts/drag.js`）+ 探针实测确认的：

1. **裸 `data-tauri-drag-region` 只认「事件 target 恰好是带属性的那个元素」**（`el === composedPath[0]`）。标题栏里有点击价值的区域恰恰是子元素 —— Logo（SVG）和 "Modulo" 文字，用裸属性等于只有两侧空白能拖。改成 `="deep"` 后子树里除可点击元素（button/a/input…）外都算拖拽区。
2. **双击最大化不要自己接**。`drag.js` 已经在第二次 `mousedown`（`detail === 2`）里 invoke 了 `internal_toggle_maximize`（该命令在 `core:window:default` 里，不用额外申请）。原先我又在 Vue 上挂了 `@dblclick="win.toggleMaximize()"` —— 真双击会切两次（原生一次、自己一次），净效果是**不最大化**。这是探针改用真 mousedown 事件后才暴露的：合成 `dblclick` 事件根本走不到原生那条路，测了等于没测。

标题栏只在 `isDesktop` 为真时渲染 —— 网页版和 E2E 完全不受影响，`npm run verify` 的 E2E（那一轮 14 条，现在 16 条）仍然是原样通过的。

一个容易踩的布局坑：标题栏不能塞进 `.shell`，因为 `.shell` 有 16px 内边距，标题栏会浮在窗口中间。改成外面套一层 `.app`（flex column），`.shell` 从 `height: 100%` 换成 `flex: 1; min-height: 0`。

**托盘**：`TrayIconBuilder`（要开 tauri 的 `tray-icon` feature）。左键双击唤出/隐藏，右键出菜单（显示/隐藏、窗口置顶、退出）。刻意 `show_menu_on_left_click(false)` —— 否则单击就弹菜单，双击永远触发不了。图标用 `default_window_icon()`，不额外引 `image` feature。

**全局快捷键**：`tauri-plugin-global-shortcut`，默认 `Ctrl+Alt+Shift+M` 唤出/隐藏、`Ctrl+Alt+Shift+T` 置顶。默认档换了两次，两次都是实测逼的（`Alt+Shift+M` 撞输入法、`Ctrl+Alt+M`/`Ctrl+Alt+T` 在本机 `RegisterHotKey` 直接返回 1409 = 已被别的程序占用），完整过程见下面「已知红」那条。**逐个注册而不是批量**：插件的 `Builder::with_shortcuts` 在 setup 里 `?` 上抛，一个组合键被别的程序占用就会让整个应用启动失败（`run()` 直接 panic 成"Modulo 启动失败"）。改成在 `setup` 里自己 `register()` 并吞掉错误。

注册失败本身是静默的，只在 stderr 打一行等于没有 —— 所以把结果存进状态、开一个 `global_shortcuts` 命令给设置页显示「已注册 / 被占用」。快捷键文案也因此只有一份（Rust 侧），前端不再抄一遍常量。

**用户可改键**（2026-10-02）：`set_shortcut(kind, chord)` 先解旧再注册新，**新键注册失败就把旧键滚回去**，绝不留下「两条都没绑上」的状态。回调不再按 `shortcut.key` 猜是哪一条 —— 改键后两条完全可以共用字母、只换修饰键，所以多了一张 `kind → 当前 Shortcut` 的表来反查。持久化和「收进托盘」同一个套路：Rust 侧不落地，前端存在 `modulo.shell.v1` 里（一个 key 存两样东西，因此每次写回必须带全字段，否则拨一下开关就把改过的键抹了），启动时读到与默认档不一致的键再推回去。
设置页每行一个「改键」按钮，按下后在 **document 捕获阶段**听 keydown 并 `stopPropagation` —— 挂在 bubble 上会先让应用自己的 Ctrl+Z / Esc 跑掉（Esc 还会顺手关掉设置面板）。裸键（`M`）被 `parse_chord` 拒绝：全局裸键会吞掉系统里所有该键的输入。

这条原先记的是「**没有 Rust 单测**：一引用 `parse_chord`，windows-gnu 的测试二进制就 `STATUS_ENTRYPOINT_NOT_FOUND`（去掉立刻恢复）」。**那个因果是错的**，2026-10-06 更正：测试壳**从来就没能启动过**，与引用什么无关 —— `tauri → muda → windows crate` 的静态导入 `comctl32.dll::TaskDialogIndirect` 只由 comctl32 v6 导出，而测试壳没嵌声明 Common-Controls 6 的应用清单，loader 绑到 System32 的 v5 存根就缺入口（详见 §11 的「0xC0000139」与 `src-tauri/build.rs` 的注释）。修掉之后补了 **4 条** Rust 单测：裸键被拒、带修饰键解析得过、错误信息带得下原文，以及一条把「Win 键的写法是 `Super` 不是 `Win`」钉死的契约测试 —— 前端 `toChord` 发的是 `Super`（muda 只认 `COMMAND`/`CMD`/`SUPER`），这条防的是有人把 `toChord` 改成发 `Win` 后录制出来的键一律注册失败。

**取消键的判定只认裸 Esc**（2026-10-03 修，0.1.0 起就带在身上）：录制态原先按 `key === 'Escape'` 一刀切取消，于是 `Ctrl+Alt+Esc` 这类组合**永远绑不上** —— 而"全局快捷键必须带修饰键"正是产品自己的规则，等于把这条规则允许的键挡在门外。现在 `toChord` / `isCancelEscape` 抽到 `src/vue/chord.ts`（**10 条单测**，含"带修饰的 Esc 拼成 `Ctrl+Alt+Shift+Escape`"与"裸 Esc 才算取消"两组正反用例），Rust 侧确认收得到：`global-hotkey 0.8.0` 的键名表里就有 `"ESCAPE" | "ESC"`（`hotkey.rs:319`）。真机那两条落在探针的录制块里（录进去 + 录完换回基线）。

**「点关闭」默认是退出，不是收进托盘**：Windows 会把新出现的托盘图标塞进溢出浮层，默认藏进去等于把用户关在门外。设置页里有开关可以改成收进托盘，持久化在前端 localStorage，启动时推给 Rust（Rust 侧不落地）。

**权限收紧**：能力清单从只写 `core:default` 改成显式补四条（`allow-minimize / allow-toggle-maximize / allow-close / allow-start-dragging`）—— `core:window:default` 其实只有只读 getter，自制标题栏的按钮一个都不在里面。同时**刻意不给** `allow-create` / `allow-destroy`：x-hub 代价最高的那批 WebView2 bug 都在运行期建窗/销毁窗上，这里用权限层把它堵死，而不是靠口头约定。

**真机自检（`npm run desktop:probe`，那一轮 30/30；项数随轮次增长，最近一轮 49/49，见 §11.3 与 §11.4）**：不模拟鼠标 —— `SetCursorPos` 会抢走用户真实的指针和焦点，点错地方赔不起。改成给 WebView2 开远调端口（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port`），用 CDP 在页面里点**真实的 DOM 按钮**，再从 Win32 侧读窗口状态，走的是同一条代码路径。已验证：无边框标题栏渲染且带拖拽区、三个按钮都能点、最小化真的进图标态（`rect` 变成 -32000 那个经典值）、最大化铺满工作区、再点回原尺寸、`WS_THICKFRAME` 样式位仍在（所以边缘可拉伸）、托盘图标直接可见没被收进溢出浮层、收进托盘开关两个方向都生效。

原先说「三件事自动化够不着」，现在只剩一件。**双击拖拽区最大化**改成派发真的 `mousedown(detail=2)`（走 drag.js 而不是自己的 dblclick），顺带把「标题文字、Logo 都算拖拽区」一并断言了。**召唤键在系统层面真的触发**则借 `WScript.Shell.SendKeys`：SendInput 进的是系统输入队列，`RegisterHotKey` 能收到 —— 全程不碰物理键盘。投递的组合键**从 Rust 实际注册的那条现算**（`toSendKeys('Ctrl+Alt+F13') → ^%{F13}`），默认档换了或用户改过键都不用动探针。验证是双向的：正例按两次、看窗口收起再回来；**反例投旧的 `Alt+Shift+M`、断言窗口纹丝不动** —— 只有正例的话，窗口被别的东西碰一下也可能算过。改键本身另有三条：裸键必须被拒、换成 `Ctrl+Alt+F13` 后新键可用且旧键失效、最后换回默认档。剩下**拖标题栏移动窗口**仍需人手确认：`start_dragging` 会进 Windows 的原生模态拖动循环，合成鼠标事件撑不起这个循环。

写这个探针时踩到一个坑值得记下来：`.NET` 的 `Process.MainWindowHandle` 在窗口最小化期间会漂到一个 6×6 的辅助窗口上，于是 `IsIconic` 永远读到 false —— 每次重新查句柄的写法会把「真的最小化了」误报成「没有」。必须第一次拿到 hwnd 后钉死回传。

开发中由测试与取证逼出的三处修正已并入正文：§3.2 的单位口径（逻辑列 vs 物理列）、`findFreeSpot` 在空版面/整列占满时丢失请求 y 的缺陷（回退位改为 `max(maxRow, start)`）、投影取整由 `round` 改 `ceil`（4 列档实测会开出空洞）。

### 11.4 窗口尺寸、打包与许可（2026-10-01）

**默认 1280×800 是这么协调出来的**：横向要求来自产品本身 —— §3 的 12 列投影在约 1200px 以下就降档，工作台的价值全在满列时；纵向按主流 IM 客户端的量级对齐（微信/QQ/钉钉/飞书的默认窗口都在 1000–1200 × 700–800 这个区间里，1280×800 取的是它的上沿）。1080P 上 1280×800 左右各留 320、上下各留 120；1600×900 高度也放得下（832 < 852）。

**小屏靠启动时夹一次，不靠第二套数字**：`fit_window()` 读主显示器的 `work_area()`（`Monitor::work_area`，tauri 2.12 才有），逐轴判断 —— 放得下（留 32px 边距）就一点不动，放不下才取该轴的 94%，下限是配置里的最小尺寸。1366×768 因此只压高度、不连宽度一起缩。判定抽成纯函数 `fit_size()`，三条单测锁住（放得下不动 / 只缩放不下的那轴 / 不低于最小尺寸）。尺寸一律按逻辑像素算，DPI 缩放负责翻译成物理尺寸，所以 4K@150% 不用另设一套数字。

**实机核对（2026-10-02）**：探针新增一项启动尺寸断言，把「逻辑档 × DPI」真的落到窗口上这件事钉住 —— 本机 150% 缩放下读到可见外框 1920×1200（= 1280×800 × 1.5）。读数比期望大出 w+22 / h+13 是 Win10+ 的不可见调边框（`GetWindowRect` 含它，tao 保证的是可见外框），容差按邻居检查的 40px 收。夹取分支要小屏才触发、本机平时走不到，一度只剩 `fit_size` 的三条单测守着；**这条边界当天就收掉了**：`fit_window` 加了测试接缝 `MODULO_WANT_SIZE`（不设时产品路径零变化；`parse_size` 严格解析，非法值回落默认档并打日志，单测锁住），探针拿 `2600x1500` 把期望尺寸顶过 2560×1528 的工作区，实测窗口落在 **2428×1449** = 逐轴 94% 算出的 2406×1436 再加那圈边框，且 `center()` 之后左右留白差 **0 像素** —— 夹取与居中从此都是真机断言，探针 31 → 33 项。同轮还把探针里六处固定 sleep 采样改成轮询等待：单次 Win32 采样实测 1.1–1.3 秒（PowerShell 起进程 + `Add-Type` 编译），而最小化/双击的状态迁移本身也要 1 秒上下，旧写法 0.9–1.2 秒的 sleep 正好压在分界线上，会把「慢」报成「坏」（本轮就这样先红了 4 条，改轮询后 31/31）。同轮还换掉了窗口定位：`shot-window.ps1` 原来取「第一个同名 modulo 进程」的窗口，用户自己也开着应用时会钉到他的实例上（`-Restore`、点关闭就打在别人的窗口里）。现在探针把 `spawn()` 的 PID 传进去，ps1 只认那个进程、找不到就返回空**而不回退按名字查**；判别检查是「有一个实例真在跑时传假 PID」，结果 `byName:true / bogus:false / real:true`。

**真机帧距（同日补）**：E2E 那条只能测 headless，探针现在在 WebView2 里先采 500ms 空闲基线，再用整版重排（撑满 → 整理）压测，门槛取 `min(18.2ms, 1.5 × 基线)`。这一步很关键：本机面板是 **240Hz**、空闲基线中位 5.6ms，绝对阈值 18.2ms 在这种屏幕上形同虚设（掉到 60fps 都算"过"）。实测重排期间中位仍 5.6ms（与基线持平、p95 6.6ms）。至于 `max` 里那几百毫秒的"孤峰"——**已排除是我们的代价**：同一台机器上完全不动的空闲窗口，6 秒里同样出现 5–7 次 >100ms 的空窗（max 423–579ms），比压测时的孤峰更大更密；而点下「撑满」的同步耗时实测 0.1–0.8ms（连做 6 次）。所以断言只卡中位数与 p95，`max` 仅记录、不参与判定 —— 它量到的是渲染进程的节流行为，不是我们的代码。
**曾经那条已知红已结案（2026-10-02 实测）**：`Alt+Shift+M 经系统投递后窗口收起` 从 09:07 起连续两轮不过，而注册检查仍绿（`registered:true`，热键确实归这个实例）。当时归因于输入法（`HKCU\Keyboard Layout\Toggle\HotKey = 1`、`Language Hotkey = 1`，即「左 Alt+Shift 切换输入法」正是这个前缀）—— **这是假设，始终没有直接证到**；能证的是换档之后同一条投递检查稳定通过。换档过程踩了第二坑：先试 `Ctrl+Alt+M` / `Ctrl+Alt+T`，结果**开机就注册不上**，stderr 两条 `RegisterHotKey` 失败。用一段独立 PowerShell 直接调 `RegisterHotKey` 实测本机（`SetLastError=true` 取真实错误码）：

| 组合键 | 结果 | Win32 |
|---|---|---|
| `Ctrl+Alt+M` / `Ctrl+Alt+T` | TAKEN | 1409 = `ERROR_HOTKEY_ALREADY_REGISTERED` |
| `Win+Alt+M` / `Win+Alt+T` | TAKEN | 1409 |
| `Alt+Shift+M` / `Ctrl+Shift+M` / `Ctrl+Alt+Space` / `Ctrl+Alt+F9` / `Ctrl+Alt+\` / `Ctrl+Alt+B` / `Ctrl+Alt+J` | FREE | —— |
| **`Ctrl+Alt+Shift+M` / `Ctrl+Alt+Shift+T`** | FREE | —— |

所以默认档最终取**三修饰**那一行（`lib.rs:97-98`）。1409 说明本机有别的程序占着 `Ctrl+Alt+M/T`，但**没查出是哪个程序**，也没必要 —— 产品侧的处理是：注册失败逐条吞掉、设置页显式显示「注册失败，多半被别的程序占用了」、并提供录制改键。探针那一轮 **47/47**，其中召唤键那块六条：正例投递收起 / 再投递唤出 / 反例（旧 `Alt+Shift+M` 投进去窗口纹丝不动）/ 裸键被拒 / 换成 `Ctrl+Alt+F13` 后新键可用且旧键失效 / 换回默认档。设置页的录制另有五条（按钮存在、只按修饰键不提交、Esc 取消、录制后 Rust 与界面同步、改过的键落进 `modulo.shell.v1.json`）。**2026-10-03 这块加到七条**：再补「录 `Ctrl+Alt+Shift+Escape` 要提交给 Rust 而不是当成取消」+「录完换回基线」，实测 detail 里键值原样回读（`keys:"Ctrl+Alt+Shift+Escape"` → 换回 `Ctrl+Alt+Shift+M`），整轮 49/49。

**打包**：**当前线上发布产物是 `Modulo_0.8.3_x64-setup.exe`**（NSIS，4 042 044 字节，`sha256 7eb1145c8e48a5733ebd3f473ba790932b8227cda775bd6fdc8c720775ad3646`，2026-10-17 由 CI 从 tag `v0.8.3` = `d41b71e` 构建，连同 `.sig` + `latest.json` 挂上 Release，`isDraft:false`、`immutable:true` 已发布。这条哈希有**两个独立出处**互相对上：`release-manifest.json` 的台账条目，与 GitHub 资产自带的 `digest`；2026-10-15 本机下载后 `sha256sum` 量到的第三个值与前两者逐字一致 —— 三个出处不一致时以现测为准）（**这一句现在是机器核的，不是人抄的**：`npm run docs:check` 会拿 `release-manifest.json` 台账认定的当前安装包名与 sha256 来比这一行，而台账本身由 `scripts/release-manifest.mjs` 与 GitHub 真实资产对账 —— 文档 ⇐ 台账 ⇐ 线上，中间不需要谁再抄一遍哈希。**没覆盖到的是字节数**：台账只存 `assets{name: digest}`，没有 size 字段，所以 `3 035 916 字节` 这一项仍由人负责；要给台账加一列得动的是另一条门禁的 schema，不在这笔里顺手改。）。**上一轮在这里挂着的两处缺口，2026-10-15 在 0.8.1 上都闭合了**（下面 ①② 两项都是在 **0.8.1 装完的产物**上量的；0.8.2 / 0.8.3 均未重做，要认领「本机探针对当前产物成立」这句话得在当时的版本上再跑一轮）：① 包内 `modulo.exe` 现在量得到 —— 装完之后目录里那颗是 11 470 336 字节 / `sha256 0A366F5FFD1C8146C954DE0F52B8A8110F4525277459D9073D92EF9F218CC111`；② 「该二进制本机探针 N/N」这句话**对 0.8.1 装完的产物**成立了 —— 官方探针指着安装目录里那颗二进制跑（`MODULO_EXE=<安装目录>\modulo.exe PROBE_NET=1 PROBE_PORT=9333 npm run desktop:probe`）**52/52**，原始行 `at: 2026-10-14T18:41:47.063Z passed: 52 total: 52 failed: []`（`evidence/` 在 `.gitignore` 里，所以照本节的规矩抄原文；**项数是条件量**，`PROBE_NET=1` 才含那三条网络边界断言；同一轮另有 **2 条 SKIP**：本机有常驻程序吃掉合成投递，「按一下召唤键窗就回来」这条没量到，只量到「注册成功 + 程序自身路径能恢复」，那是环境不可达而不是缺陷）。中间这几版（`v0.7.1` / `v0.7.2` / `v0.8.0` / `v0.8.1`）都是并行会话切的版，逐笔的 sha256 都在 `release-manifest.json`，本节不重抄以免两处各说各话。**上一版 `Modulo_0.7.0_x64-setup.exe`** 的数字原样留档当历史：NSIS，3 031 110 字节，`sha256 1e27d996f1e232b33f979192d295b0bf7e774d06676e378ed67de531844b5b5c`，2026-10-06 由 CI 的 `release` job（run 60）从 tag `v0.7.0` = `6d537a5` 构建、签名，并连同 `.sig` + `latest.json` 挂上 Release，`isDraft:false` 已发布；当时那两处缺口（包内 exe 未取哈希、探针跑的是本地 `target/release` 那颗）如上所述已在 0.8.1 上补齐。上一笔满足「尺寸 + sha256 + 源 commit + 本机探针 + 签名门禁」全套的是 **`Modulo_0.4.0_x64-setup.exe`**（NSIS，2 806 839 字节，`sha256 53c431d5f7971bc8b17265042c1f6e33d35eaac10cff3542df3eaa1bf627ac18`，包内 `modulo.exe` 8 099 840 字节 / `sha256 24a5ccc1ab42f8db96adfa34b51164bb04f79358073064b21344a5d1ff5fc833`，构建自 `b27142e`、打包时工作树干净；**该二进制本机探针 49/49** —— 原始行 `2026-10-03T08:58:40.667Z 49/49`；**更新签名门禁通过** —— `cargo test --test release_signature -- --ignored` 验过"这颗包的签名对得上应用内嵌公钥 + `version:0.4.0` 绑定"；tag `v0.4.0` 落在发布记录那笔，代码与构建源 `b27142e` 相同）。上一版 **`Modulo_0.3.0_x64-setup.exe`**（NSIS，1 865 657 字节，`sha256 0b879d72631a7a72d182e67fb31a460104b7365b696448e2a6e1b21ae18d6779`，包内 `modulo.exe` 5 711 872 字节 / `sha256 3b475a5b7c2873cb7d6d56a92a3816719716221ae45bd8d2d057194e37778264`，构建自 `4c5b54c`、打包时工作树干净；**该二进制本机探针 49/49** —— 原始行 `2026-10-03T05:02:28.732Z 49/49`；tag `v0.3.0` 落在最后发版前的构建提交 `4c5b54c`，与 `v0.1.x`「落在版本号定型那笔」差一次核对修复 —— 版本定型那笔 `5d2c642` 带着会被环境抖动打红的 docs-check，不该当发布点，理由见 CHANGELOG 0.3.0 发布节）。上一版 **`Modulo_0.2.0_x64-setup.exe`**（NSIS，1 860 690 字节，`sha256 f4ff0413510809c44cfbc75e9faad5436f68fcc715488cb42a71a8f528852559`，包内 `modulo.exe` 5 706 752 字节 / `sha256 e99ddec087bb34f8e6277901c7faa6848e1fd2ea35d434f4b2a5b6d6f66e57d9`，构建自 `2e73795`、打包时工作树干净，**该二进制本机探针 49/49** —— 原始行 `2026-10-02T22:02:51.248Z 49/49`；tag `v0.2.0` 按惯例落在版本号定型那笔 `ef07a92`）。上一版 **`Modulo_0.1.1_x64-setup.exe`**（NSIS，1 859 053 字节 = 1.77 MiB，`sha256 47aad05abc9c5ef2958cbf6252b780a23253acd616f69d18e6f4b7a4e73121c6`，构建自 `53b0ed9`，打包时工作树干净；该二进制本机探针 47/47 —— 原始那行是 `2026-10-02T18:50:25.522Z 47/47`，来自本机 `evidence/probe-history.log`）。**注意 `evidence/` 在 `.gitignore` 里**（`.gitignore:3`），这两份日志是**本机**证据、不随仓库分发，所以凡是拿它当出处的地方都得把关键那一行原文抄进文档，否则公开仓库里的读者点不开。上一版 `Modulo_0.1.0_x64-setup.exe`（1 858 935 字节，`sha256 4658ada982c7e439…`，构建自 `0c42fc9`）**发布当天就被 §11.5 的起步版面重排作废** —— 这正好说明「尺寸 + sha256 + 源 commit」三件套有什么用：包与代码的差距是可查的事实，不是一句「感觉应该没问题」。v0.1.0 的 Release 页面已加取代声明（不动已公开的 tag：下过 0.1.0 的人手里的校验和必须继续对得上）。v0.1.0 发布前重切过一次：上一版是 `1 852 946 字节 / sha256 4a1c90a7… / 构建自 782a520`，缺本轮的改键能力与新默认组合键。先前担心的「NSIS 工具链在本机下载不动」没有发生 —— 它走 github.com 的 release 直链（取不动的是 raw.githubusercontent 那一类），下载后还会校验哈希。上一版包栽过一次：它的 `modulo.exe` 链于 21:23:11，而 `lib.rs` 最后写入是 21:24:47 —— **包比代码早，不能证明里面含最终的 `fit_window`**。教训是记产物必须同时记尺寸、哈希**和源 commit**：只看时间戳还会漏掉"包里有未提交代码"这种情况。（v0.8.4 已备料、尚未发布；发布点台账回写时本行随新版安装包的实测数据更新，在那之前线上最新产物仍是上面这个 0.8.3。） <!-- facts -->

**装/卸一次的门禁（2026-10-03 补；2026-10-15 在 0.8.1 上把两头都重跑了一遍）**：
`Modulo_0.8.1_x64-setup.exe /S`（**不给 `/D`**，让它走默认目录）静默安装 exit 0 → 目录里**只有两颗文件**：
`modulo.exe`（11 470 336 字节 / `sha256 0A366F5F…CC111`，NSIS 打过补丁的那颗）与 `uninstall.exe`
（79 211 字节）—— **没有 `WebView2Loader.dll`**。2026-10-03 那一轮记的是「目录里有
`WebView2Loader.dll`（160 880 字节），这条回答 §11.1 那个坑对用户不成立」：**结论仍然成立，但理由变了**，
当时的包确实带那颗 DLL，现在的 CI 产物走 msvc target 把 loader 静态链接进了 exe，所以不再需要它 ——
判据是装完那颗进程的模块表里 webview 相关只有系统的
`…\EdgeWebView\Application\155.0.4283.45\EBWebView\x64\EmbeddedBrowserWebView.dll`。
**老gate的文本要按这个改，否则下一班会照着它去查一颗不存在的文件。**
→ 启动装出来的 exe：窗口 **0.6 秒**出现，之后连续存活 ≥6.5 分钟，webview 子进程 18→24，
`app.modulo` 写出 90 个文件（本机时间 2026-10-15 02:34–02:45 那一轮）；官方探针指着**这颗装出来的二进制**
跑 = **52/52**（条件见上面 §11.4 打包那段的原始行与 `PROBE_NET` / SKIP 两条口径）。
→ `uninstall.exe /S`：exit 0，目录清空、HKCU 卸载项消失、开始菜单快捷方式消失，
**用户数据一处没动** —— `Roaming\app.modulo\data` 那 9 个文件回退前后逐字节 SHA256 相同（9/9 MATCH，
比对脚本带反例自证：故意错配的一对必须报 CHANGED，否则"零不一致"可能只是根本没比成）。
它回答的是"发出去的安装包装出来到底能不能用" —— 在这之前没人验过这一步（探针跑的一直是
`target/release` 里那颗）。以后每次发版值得花这两分钟。

**顺带记一条注册表行为，它会咬掉后一次安装（2026-10-15 实测根因）**：NSIS 把安装目录写进
`HKCU\Software\Modulo\Modulo` 的**默认值**，而**卸载器不清这条**。于是任何一次
`/S /D=<临时目录>` 的试验装会**传染给后一次「默认安装」** —— 后者会安静地装进那个临时目录，
连开始菜单快捷方式一起指进 `%TEMP%`，而 `%TEMP%` 随时会被系统或清理工具回收，症状是
"谁都没改文件，应用却没了"。这一轮就是这么撞上的：10-07 有人用 `/D` 在 `%TEMP%` 里做过试验装，
10-14 另一次默认安装被带进同一个目录。三件事要记住：
① 用 `/D` 做试验装之后，**要么清掉那条默认值**（`reg delete HKCU\Software\Modulo\Modulo /ve /f`；
PowerShell 的 `Remove-ItemProperty -Name '(default)'` 与 `.SetValue('','')` 都删不掉默认值，
报的是 `Cannot write to the registry key` —— 那是 API 不支持，不是权限问题），
② 要么每次显式给 `/D=<正式目录>`，
③ 清之前先 `reg export` 留一份回退件。这条已经写进 `docs/AGENT-COORD.md` 的「机器资源认领」表
（`registry:HKCU\Software\Modulo` 标成**钉死 + 独占**），由 `coord-gate.mjs` 判据 5 盯着。

**上一轮（2026-10-03，`Modulo_0.4.0_x64-setup.exe /S /D=<临时目录>`）的记录照原样留档**：
静默装到临时目录（exit 0）→ 目录里有 `modulo.exe`（8 099 840 字节）、`uninstall.exe`、
`WebView2Loader.dll`（160 880 字节 —— 当时那颗包确实带着它）→ 启动装出来的 exe：页面起得来
（WebView2 与 CDP 都在）→ `uninstall.exe /S`：目录清空、无残留。

**发布前探针的两轮红（2026-10-02 深夜）：两条不同的红，各有其因，各修一次**

**① 「夹取尺寸 + 居中」成对假红 —— 探针钉错了窗口。** 四轮里两轮 45/47，红的总是这一对。第一反应是"采样太早、`fit_window` 还没落地"，**这个猜法被失败详情自己否掉了**：那两条读到的矩形是 `{x:-32000, y:-32000, w:237, h:39}` —— 图标态窗口的 `GetWindowRect` 就是这个形状。而 `FindLargestWindow` 原来的筛子写成「`!IsWindowVisible && !IsIconic` 才跳过」，也就是**图标态窗口也参评**：主窗口还没出现的那一瞬间，那座小窗口在"面积最大"上就赢了。句柄一旦钉错，这一轮后面每条 Win32 读数都是垃圾值，**`waitUntil` 也救不了**（它读的是同一个错句柄）。修法三条一起上：筛子收紧成只接受「可见且非图标态」（已钉句柄之后的最小化/隐藏检查走 `-Hwnd` 直读，不经过这里，那几条不受影响）；`launch()` 等到「非图标态且宽 >400」才钉，每轮重试前把 `hwnd` 清 0 强制重解析；**等不到就直接抛** —— 宁可红一条名字叫「探针没拿到可见主窗口」的，也不要成对的红去误导产品判断。修后这一对连续多轮绿（实测 2428×1449、`offCenter:0`）。同一条块里还有个旧病：夹取检查自己也是"固定 `sleep(1500)` + 单次采样"，那是我已经改过六遍的「把慢报成坏」，在新写的块里又犯了一遍，一并改成轮询（超时 8s；真不夹取则谓词永不成立，判据仍可证伪）。

**② 「投递后窗口收起」连红两轮 —— 弱的是判据，不是产品。** 注册绿、尺寸/图标态/最大化全绿，只有召唤键投递那两条红。查的时候我又错了一次：先怀疑"钉错窗口"（被 ① 已修 + 尺寸类全绿排除），再怀疑"后台执行上下文吞掉了合成注入"（**也被否掉**：同一份脚本前台跑一轮、后台跑一轮，两轮都 47/47）。站得住的结论是**判据本身太弱**：旧写法在 JS 侧轮询，每采一次要新起一个 PowerShell（实测 1.1–1.3 秒），而 hide/show 在投递后几十毫秒内就发生完 —— 一整趟往返可以完整落在两次采样之间；更糟的是"唤出"那条只断言 `visible===true`，**起点本来就可见时它会白过**。现在把观测挪进投递所在的那个进程：`-SendKeys` 顺手在**投递前几毫秒**读一次 `preSendVisible`，再以 50ms 一步跟踪到 2.6 秒，判据要「起点 + 终点 + 中间真的动过」三者齐全（`wentHidden` / `cameBack` / `untouched`），并把 `sendErr`（ps1 退出码/错误）单独记进 detail —— "注入命令没跑成"和"跑了但热键没响应"从此是两种形状。**至于那两轮为什么整个没响应，仍然没有查到确定原因**；能说的是：现在的写法既不会白过，也能在下一次复发时直接分清是注入丢了还是热键没接住。

**取证手法上也失守一次**：第一轮 45/47 的两条红**当场问不出名字**，因为我把长报告接了 `tail -3`，逐项结果只活在 scrollback 里。这不是产品结论，是证据链断了。从现在起探针自己落两份：`evidence/probe-report.json`（逐项 pass/detail + exe 路径 + 时间戳）与 `evidence/probe-history.log`（每轮一行，红的话把名字带上），写在 `evidence/` 而不是 `evidence/desktop/`（后者每轮开头被 `rmSync` 清空）。这两份在 `.gitignore` 里，属**本机**证据 —— 所以文档里引用它们时必须抄出原文那一行（如 §11.4 的 `2026-10-02T18:50:25.522Z 47/47`），CI 上则靠 `probe-report` artifact 交付，读者不必能点开我的硬盘。上面两个"猜法是错的"都靠这两份文件翻的案 —— 抖动必须能归因，不能靠重跑赌绿。

**许可**：Apache-2.0（`LICENSE`），`Cargo.toml` 的 `license`、`package.json` 的 `license`、`tauri.conf.json` 的 `bundle.copyright` / `bundle.licenseFile` 四处一起对齐。选 Apache-2.0 而不是 MIT：带显式专利授权与商标条款，且与同目录的 OpsMesh 一致。

**顺带修掉一个「本机 `cargo test` 从来没通过过」的问题**：模板给的 `crate-type = ["staticlib", "cdylib", "rlib"]` 是给移动端的，本项目只有桌面端；而 windows-gnu 目标下 debug 版 cdylib 会把整棵依赖树的符号塞进导出表（dlltool 生成九万余条，超 PE 的 65535 序号上限），链接直接报 `export ordinal too large`。能跑通的只有 `cargo test --lib`。裁成 `["rlib"]` 之后 `cargo test` 第一次真正跑通 —— 也就是说 CI 里那条 `cargo test` 门禁，在本地从来没有被等价地执行过。

### 11.5 起步版面重排：0 空洞，以及三条"靠默认缺陷才过"的测试（2026-10-03）

**现象**：用户实拍首启界面 —— 时钟与待办之间空着 4 列 × 3 行，屏幕右半一大块白。

**量出来的根因**：`starterDoc` 把坐标写死（`clock(0,0)` / `todo(8,0)` / `sticky(0,3)` / `notes(2,3)` / `recent(0,9)`），每张卡用形态的 ideal 尺寸，于是：
- `clock` 4 宽 + `todo` 4 宽 = 8，**cols 4-8 整段没人占**；
- `recent` 的 y=9 是硬编码的，而它上面的卡最高只落到 y=6/7，**y7、y8 两整行全空**；
- 用引擎实算：11 行的矩形里 **50/132 格是空的 = 37.9% 空洞**（`① 出厂 starterDoc` 那次跑数）。

README 主图一直用的是"点过撑满之后"的截图 —— 等于默认了这个起点不好看。

**修法分两层，缺一不可**：
1. **显式重排**（模板定义在 `packages/engine/src/templates.ts` 的 `general`）：两带各自铺满 12 列 —— 第一带 时钟 6×3 + 待办 6×6（待办在右侧既当主卡也撑住两带高度），第二带 便签 3×3 + 速记 3×3，底带 最近改动 通栏 12×2。**2026-10-10 走查轮按"降档三档都要对齐"重调过一次坐标**：旧坐标在 4 列档会被取整规则顶出一张浮在中列的卡（"楼梯"），新坐标在 N=12/8/4 三档零空洞、零内部洞（守卫：`tests/engine/templates.test.ts`「通用模板的降档对齐」）；N=6 一档受"待办 ≥4 否则裁字、便签 ≤3、最近改动 ≥4"三条硬约束夹住，保留一次通道式折行，如实记档。
2. **`spreadLayout` 兜底**：手排只保证"当下这两带是满的"，以后改 registry 的 ideal 尺寸或加第 6 个模块，还得靠 tidy+fillRows 收。

**中间踩到的两个反直觉点**：
- **只靠 `fillRows` 会把事情弄糟**：它按"顶边相同的卡"为一组铺宽，**某一带只剩一张卡时会被拉成通栏** —— 实测速记变成 12 列横幅装 1 条内容，空洞率 0 了但更难看。所以宽度必须自己排，`fillRows` 只当兜底；守卫里也加了"任何卡不许超过理想宽 1.5 倍"（`tests/vue/starter.test.ts`）。
- **`addItem` 不吃尺寸**：它只按形态 ideal 找空位，给 x,y 也只是搜索起点。所以起步版面必须 `addItem → resizeItem → moveItem` 三步走（`store.ts:47-51`），少了 move 那步，12 宽的通栏会被塞到下一带，速记就成了上面那种"单卡带"。
- 待办必须留 4 逻辑列：N=4 档是 `ceil(w/3)`，3 列会被压成 1 物理列（实测 159px），条目文字直接裁掉（`clipped=2`）。

**顺带暴露的测试设计问题（这条最值钱）**：改完 0 空洞之后，**三条 E2E 立刻挂了** —— 「整理：行数变少」「撑满：首行带从缺角铺满」「版面方案：按撑满改版面」，它们全都建立在"出厂版面本来就有洞"上，也就是**一直在测"排版排得烂"，而不是测"这三个工具有用"**。默认一修好，它们就空转了。现在这三条改成自己喂夹具（`SLOPPY_DOC`，就是旧版那份真实出厂坐标），另加一条正向守卫「出厂版面：首行带铺满且整屏不留空洞」。
**教训**：凡是"点一下 X 会变化"的断言，都要问一句"这个变化是 X 造成的，还是默认状态本来就烂"。夹具要自带，不能蹭默认。

**新增守卫**：`tests/vue/starter.test.ts` 8 条（0 空洞、无整行空、不重叠、minW/minH 下限、1.5× 理想宽上限、tidy/spread 不动点、出厂版面恰为核心 5 张、注册表其余一张不预设；这里原来写「7 条」，是 `a50b68e` 补进「注册表其余不预设」那一条之前的数），并且它 import 的是**真注册表** —— 为此把 `.vue` 组件映射从 `cardRegistry.ts` 拆到 `cardComponents.ts`（尺寸契约文件必须能被 node 环境的单测直接 import，抄一份 fixture 进测试等于装了个会撒谎的守卫）。 <!-- facts -->

**实测**：三档视口（1440 / 720 / 390）`hScroll=false`、`clipped=0`、最小字号 11px、零 console 报错；`npm run verify` 两轮连绿：**201 单测（24 文件）+ 17 E2E**，引擎分支覆盖 90.95% → **91.33%**（新守卫顺带跑到了 `spread`/`tidy` 的更多分支）。README 三张实拍图已按新出厂版面重拍（1× 尺寸，旧的 `workbench-spread-1440.png` 删除）。

### 11.6 应用内更新：自己人的签名，与仍然没有的代码签名（2026-10-03）

**这一节解决的是哪个问题**：0.3.0 的版本检查只做到"有新版，去看下载页" —— 装过旧版的人仍要自己下载、自己重装。
这一轮把"下载 → 验签 → 安装 → 自重启"接上（`tauri-plugin-updater`）。但必须把**两种"签名"**分清楚，
它们经常被混成一句"要签名就得花钱"：

| | 谁签 | 花钱 | 防的是什么 | 现在有吗 |
|---|---|---|---|---|
| **更新包签名**（minisign） | 我们自己（密钥对） | 不花 | 更新包被调包、清单被篡改（配合 `requireSignedVersion` 顺带防降级） | ✅ 已接上 |
| **代码签名**（Authenticode） | CA（OV/EV 证书） | 花钱 + 实名 | Windows SmartScreen 的「未知发布者」 | ❌ **仍然没有** |

**密钥放哪**：私钥 `%USERPROFILE%\.modulo\modulo-updater.key`（**不在仓库里**，`.gitignore` 加了 `*.key` 兜底）；
公钥内嵌在 `tauri.conf.json` 的 `plugins.updater.pubkey`。丢了私钥 = 已发布的版本永远收不到更新，
所以它只在本机（将来若上 CI 签名，放 CI secret）。构建时用 `TAURI_SIGNING_PRIVATE_KEY`（路径或内容）
+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（密钥没设密码就免了）。

**发布流程**（比之前多两步）：

1. `set TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.modulo\modulo-updater.key` → `npm run tauri:build`。
   `bundle.createUpdaterArtifacts: true` 会额外产出 `Modulo_<版本>_x64-setup.exe.sig`；
2. `node scripts/make-latest-json.mjs --notes-file <Release notes 文件>` 生成清单。
   它会**自检**签名里有没有 `version:` 绑定 —— 应用开着 `requireSignedVersion`，没绑定的包客户端直接拒收，
   与其发一个"谁都装不上"的更新，不如脚本里就红；
3. **跑签名门禁**：`cd src-tauri && cargo test --test release_signature -- --ignored`。
   它用**插件同一套实现**（`minisign-verify`）验"我要发出去的这颗包的签名，对不对得上应用里内嵌的公钥"，
   并念出 `version:` 绑定。默认 `#[ignore]`（CI 上没有产物），性质与 `desktop:probe` 相同 —— 发布前的本机门禁。
   自检过：把签名改一个字符，这条立刻红；
4. Release 里**必须同时上传安装包 + `.sig` + `latest.json`**。端点就是
   `https://github.com/Levango7/Modulo/releases/latest/download/latest.json`。
5. **Authenticode 状态核对（硬步骤，2026-10-18 立）**：对**发布资产**——从 GitHub Release 下载的那颗
   `Modulo_<版本>_x64-setup.exe`，**不是**本机 `target/` 里那颗（NSIS 打包会给 exe 打
   "bundle type information" 补丁，包内外字节不同，见下面「两个只有实测才知道的细节」）——跑
   `Get-AuthenticodeSignature`，与 `CODE_SIGNING_POLICY.md` 的 Current status 段**比对**后才算发布完成：
   实况与声明一致 → 放行；**若意外变成 Valid 而政策页仍写未签名 → 先改政策页再发布**。这条棘轮防的是
   "签了却没人知道"——声明与实貌双向漂移，都比没有声明更糟（政策页受众是签名服务方审核者，过期状态页
   同时是合规风险）。**方法（顺序不能反）**：① 从 Release 完整下载，**下载后先对账**——字节数 + sha256
   与 `release-manifest.json` 台账、GitHub 资产 digest 一致，再验签（2026-10-18 实测踩过：一次残包
   2,732,222 B 哈希不符，作废重下；不复盘就验签，阴性结论没有意义）；② `Get-AuthenticodeSignature`；
   ③ 与政策页 Current status 比对。**当前基线（2026-10-18）：v0.8.3 实测 NotSigned，政策页同步写未签名 ——
   一致，放行。** 同机对照 `cmd.exe` = Valid，证明阴性结论归于产物而非命令失效。

**两个只有实测才知道的细节**：

- **不带私钥时，安装包能打出来，但整个 build 会在最后一步失败**：
  `Error A public key has been found, but no private key. Make sure to set TAURI_SIGNING_PRIVATE_KEY` ——
  `createUpdaterArtifacts: true` 要的是"签"，不是"警告后跳过"。所以**任何要产出安装包的地方都必须有那把私钥**
  （本机走 `%USERPROFILE%\.modulo\`；CI 走 GitHub secret —— 这个取舍已经定了，见 §11.7）。
- **安装包里的 `modulo.exe` 与 `target/release/modulo.exe` 不是同一份字节**：NSIS 打包前会给 exe 打
  "bundle type information" 补丁（构建日志里那句 `Patching …`），**尺寸不变、哈希不同**。
  0.4.0 实测：打包前 `24a5ccc1…c833`（探针跑的就是这一颗），装出来以后 `541486e3…d4315`，
  两颗都是 8 099 840 字节。**记录里写"包内主二进制"时必须指明是哪一颗**，别笼统写一个哈希了事。

**三条克制**（与上一轮"不自动查"一脉相承）：检查、下载、安装**三件事都只由用户在设置页点出来**；
启动时不联网；下载完成停在"重启并安装"，不偷偷装。**验签发生在 `download()` 里**（插件 `updater.rs`），
所以界面上"下载完成，签名校验通过"这句是有后端依据的，不是文案。

**这一轮怎么验的**（不满足于"配好了"）：用 `-c` 把一颗**测试二进制**的端点覆盖到 `http://127.0.0.1:8787`
（本地假端点），跑的仍是真插件、真验签：

- 正向：假端点发 `9.9.9`（用 `tauri signer sign --app-version 9.9.9` 签过），应用里点「检查更新 → 下载更新」，
  界面停在 **「下载完成，签名校验通过。」**；
- 反向：把签名数据中段改一个字符（**外层 base64 仍合法、签名结构仍合法**），同样操作报
  **「The signature verification failed」** —— 打到的是 minisign 的密码学验签，不是格式检查。
  （第一次反向用例我改的是最后一个字节，结果只打到 base64 解析层就先红了 —— 判据要打到哪一层，得自己确认。）

**踩到的三个坑**（都不是产品问题，但每次都值半小时）：

- `cargo add tauri-plugin-updater` 会因为 `Cargo.toml` 里 `rust-version = "1.77"` **悄悄回退到 2.0.0-rc**；
  插件稳定版要求 rustc 1.90 → MSRV 抬到 **1.90**（本机 1.97.1、CI 的 stable 都满足）。
- `tauri.conf.json` 里一出现 `plugins` 段，`generate_context!` 生成的代码就会在 crate 根上引用 `serde_json` ——
  这个依赖曾在 0.1.0 被当"未使用"删掉过，删了直接 `E0433` 编译不过。**它现在有真实用途，别再删。**
- 手工 `tauri signer sign` 默认**不带**版本绑定（CLI 只打一句警告），`tauri build` 才会自动带上 ——
  所以清单脚本把"签名里有 version:"做成硬检查。

**端点在"无代理直连"的网络下会抖**（2026-10-03 实测，同一台机器同一颗客户端）：

- `latest.json` 的检查成功过两次（正确检出 0.4.0，Release 说明也显示出来了），也失败过一次：
  `没成（error sending request for url (…/latest.json)）` —— 是 reqwest 的传输层错误，不是 401/404；
- 2.8 MB 的安装包直连 GitHub 只跑到 ~66 KB/s（42 秒还没下完），另一次直接失败；
- **机制没问题，是链路问题**：用本地**限速**端点做确定性验证（3 MB、每 700 ms 给 64 KB ≈ 32 秒），
  检出 → 下载 → 验签全通、「下载完成，签名校验通过」稳定出现、面板全程不关；
- 结论：大陆无代理用户的实际体验是"能更新，但可能慢/失败，多点一次" —— 这条记在这儿，别当成 bug 修。

**一条没复现的观察**（留个记号，别当已知问题传）：某次真·线上慢下载（42 秒那个）跑到一半，设置面板
自己关掉了、下载状态丢失（`panel:false`，同一时刻无重载、无按键、无点击）。之后两轮真·线上 + 一轮
确定性限速**都没再出现**，所以**没有归因**。以后再遇到，先查"面板为什么会关" ——
`settingsOpen` 只可能被 Esc 或面板的 `@close` 改掉（`App.vue`），别从更新链路查起。

### 11.7 代码签名：不花钱的渠道，与"要准备什么"（2026-10-03）

§11.6 那张对照表里"Authenticode 要花钱"这句**有一条例外**，这一节把它查清楚（渠道信息来自各家自己的页面；
价格类的一律标"未核实"，只当线索）。

> **2026-10-09 修正：本节那张路线 A/B 表的取舍早就做完了，走的是 A。**
> 原文把它写成一条**尚未采用**、且有风险的路线 —— 与现状不符（证据见下面「构建早已在 CI 里」）。
> 表留着，因为它讲的是取舍本身；**但别把它读成"还没决定"**。

**唯一现成的免费渠道：SignPath Foundation（开源项目）**

- 免费对开源项目开放；**不要求个人实名** —— 他们验的是"这颗二进制确实由你的仓库自动构建出来"（来源证明），不是你是谁；
- 私钥在他们的 HSM 里，签名在 CI 里做；
- **证书主体是 `SignPath Foundation`**，不是项目名也不是你 —— 也就是说 SmartScreen 上显示的 Publisher 会是
  SignPath Foundation。比"未知发布者"强得多，但**不会写"Modulo"**；这是这条路最需要先想清楚的一点；
- 规则两条要注意：只签"自己源码构建的二进制"；上游库可以不签但**可以被打进已签名的包/安装器**
  （我们的 NSIS 安装包正是这种情况 ✓）；
- **要准备什么**（2026-10-09 从 `signpath.org/terms` 逐条读的）—— 这一半是**合规**，不是代码：

  | 条件 | 我们 |
  |---|---|
  | 公开仓库；功能在下载页或商店条目里有描述；**已发布过要签的那种形态** | ✓ 公开 + README 描述了功能 + 已发 14 个版本（`v0.1.0` → `v0.8.3`，tag 与 Release 各 14 条） |
  | 不含专有代码（含维护者或关联方发布的闭源件） | ✓ Apache-2.0，无闭源件 |
  | **项目主页要有一页「代码签名政策」** | ✓ **已新增 `CODE_SIGNING_POLICY.md`（2026-10-09）** |
  | 团队要有 **Authors / Reviewers / Approvers** 三角色，且**每个签名请求由一个 Approver 批准** | ✓ 已写入政策页：单人项目三角色由同一人担任，但每次签名请求仍作为独立步骤显式批准（不靠"我就是全部"默认过去） |
  | **所有成员强制 MFA**（SignPath 与源码仓库两边都要） | ⚠️ GitHub 侧需自己确认已开 |
  | 可卸载；不偷偷改系统配置；不把数据发到用户未指定的地方 | ✓ NSIS 标准卸载器；启动不联网（§11.6 的三条克制） |
  | 只签自己的二进制；上游库可以被打进已签名的包 | ✓ |
  | 未来可能被追加要求出 SBOM | ⚠️ 现在没有 |
  | 违反行为准则可被**暂停订阅、立即或追溯吊销证书** | 风险项：签名身份挂在第三方组织上，不在自己手里 |

**构建早已在 CI 里（2026-10-09 实测）**

SignPath 的来源证明要求"这颗二进制确实由你的仓库自动构建出来"。这个前提**早就满足了**，
只是当时的记录没跟上：

| 事实 | 怎么核的 |
|---|---|
| 更新签名私钥在 CI secret 里 | `gh secret list` → `TAURI_SIGNING_PRIVATE_KEY`，建立于 **2026-10-05** |
| CI 跑**完整出包并签名** | `ci.yml` 的 `release` job：`npm run tauri:build`（env 带 `TAURI_SIGNING_PRIVATE_KEY`）→ `make-latest-json` → `gh release create`；引入于 `8fe1f8b`（2026-10-05） |
| 线上 Release 确实是 CI 产出的 | `gh release view v0.8.0` → 作者 `github-actions[bot]`，资产 = 安装包 + `.sig` + `latest.json` |

也就是说下面这张表里的取舍**早就做完了，走的是 A**，并把"本地跑门禁"保留为**发布前**的本机动作
（`release:ledger` / `desktop:probe`）。表留着，因为它把另一面讲清楚了：

| 路线 | 做法 | 硬约束 / 风险 |
|---|---|---|
| **A：CI 带私钥打包** ← **实际走的这条** | 把 `TAURI_SIGNING_PRIVATE_KEY` 放 GitHub secret，CI 里跑完整 `tauri build`，本地跑发布前门禁 | **更新签名私钥进 CI**：它能签"所有用户都会接受"的更新包，泄露=可以被推恶意更新。收益（少一次本地构建）与这个风险不成比例 —— 除非同时上 SignPath 的 HSM |
| **B：CI 只打安装包，更新签名本地补** | CI 里 `-c '{"bundle":{"createUpdaterArtifacts":false}}'` 打安装包（实测：**不带私钥也能打出安装包**，只有最后那步签名会失败），本地对这颗产物跑 `tauri signer sign --app-version <版本>` 补 `.sig` | 私钥不出本机 ✓；代价是"构建产物来自 CI、签名来自本地"两段式，发布流程要写清顺序 |

**其他路子（不推荐或未核实）**：

- **自签名证书**：免费、无人审批，但**对 SmartScreen 毫无帮助** —— 用户机器不信任它，弹窗从"未知发布者"
  变成"证书不受信任"，观感更差。别做；
- **MSIX + 微软商店**：微软替你签，但分发改成商店/MSIX（安装与更新模型全变，Tauri 更新器用不上），
  与"GitHub 直发 + 应用内更新"这条线直接冲突；
- **Azure Trusted Signing / 各家 OV、EV 证书**：都要钱，**价格未核实**。EV 的好处是 SmartScreen 立刻信任
  （OV 也要先攒声望）；真到花钱那天，先把这几家摆在一起比。
  **2026-10-09 看到两条线索**（第三方页面，**未核实，只当线索**）：Azure Trusted Signing 报价约
  $9.99/月、签发的是 ~3 天有效期的短证书（靠时间戳长期有效）；同一条线索说它**身份验证只开放美加** ——
  如果属实，这一条对我们直接不可用。真要花钱那天先自己核。

**结论（2026-10-09 重写）**：不花钱的可得路径就是 SignPath。**它的前提已经满足（见上），所以剩下的工作
不在代码侧** —— 按"投入落在谁身上"分两堆：

- **主要工作量（合规，占九成）**：写一页代码签名政策；把 Authors / Reviewers / Approvers 三角色显式写出来
  （单人项目也要写成明文，不能靠"我就是全部"默认过去）；确认全员 MFA；然后提交申请、等审核
  （别人的经验是几天到几周）。

> **2026-10-09 更新**：上面第一条已落地 —— 代码签名政策页（含三角色明文）见
> `CODE_SIGNING_POLICY.md`；**剩余前置只剩「确认 MFA」**，然后提交申请。
- **代码侧只有两处**：① 加一处 `signCommand` 覆盖配置（Tauri 的外挂签名入口，SignPath 的 GitHub Action
  或 CLI 都从这里进去）；② 把签名步骤**用 `SIGNPATH_API_TOKEN` 是否存在来开关** —— 没有 token 时继续走
  现在这条未签名的路。否则一旦 tag 推上去，CI 会因为拿不到签名服务而变红：**没接签名之前，发布流程
  必须保持能跑**。

**顺序的硬约束（多方印证，别只信一处）**：**Authenticode 先签 → 再算更新签名 `.sig`**。更新签名覆盖的是
**最终字节**，顺序反了 `.sig` 就对不上用户实际下载的那颗包，**所有已装用户的自更新会静默全坏**。
SignPath 的 GitHub 集成本身就是这个形状：上传未签名产物 → 服务端签 → **重算 `.sig`**。
好消息是有一道现成的网：`cargo test --test release_signature` 验的正是"要发出去的这颗包的签名对不对得上
内嵌公钥" —— 只要它**在签名之后、对最终产物**跑，顺序错了它会红。

---

## 12. 引擎包对外分发（2026-10-09）

**这一节解决的是哪个问题**：`@modulo/engine` 从 2026-10-03 抽出来之后一直是**名义上的**可分发资产 ——
`engine:build` / `engine:pack` 在、`prepack` 会先构建、tarball 也打得出来，**但这个包从来没出现在 npm 上**。
2026-10-09 用户拍了「发」，并选定名字 `@levango7/engine`。

### 12.1 名字只能改（这一笔最大的波及面）

| 名字 | 状态 | 怎么核的 |
|---|---|---|
| `@modulo/engine` | ❌ **发不出去** | `npmjs.com/org/modulo` 落到一个叫 `modulo` 的**账号页**（0 个包、0 个组织）—— 作用域不在我们手上 |
| `modulo`（无作用域） | ❌ 已被占 | 别人的 Express 组件库，`modulo@0.0.3`，MIT |
| `@levango7/engine` | ✓ 空闲 | `npm view` → 404 |
| `modulo-engine` / `modulo-layout` | ✓ 空闲 | 同上（备选，没用上） |

作用域属于**账号名或组织名**。所以这条路有一件**只有账号主人能确认**的事：
**npm 上的用户名必须是 `levango7`**（或另有一个同名组织）。对不上就发不出去 ——
一旦对不上，改法是全仓换一个名字，`tests/release/engine-package.test.ts` 会盯着每一处。

### 12.2 改名时踩到的真实事故：别名不是纯文本

全仓做了 `@modulo/engine` → `@levango7/engine` 的文本替换（**109 个文件 / 158 处**），
**但两处别名是漏的** —— 它们写的不是纯文本，是**转义过的正则**：

```ts
{ find: /^@modulo\/engine$/, replacement: join(engineSrc, 'index.ts') },
{ find: /^@modulo\/engine\//, replacement: `${engineSrc}/` },
```

`@modulo\/engine` 中间那个反斜杠让文本替换一条都没命中。**而且当时没有任何东西会因此变红**：
980 条单测、23 条 E2E、`vue-tsc`、`docs:check` 全绿 —— 因为别名解析发生在**构建期**，
而那一轮恰好没重跑构建。**「全绿」和「能用」在这里是两件事。**

这条事故直接决定了下面那个门禁的形状（12.5）：判据不能是"扫一遍看有没有旧名"
（把别名整行删掉也是绿的），得**逐处点名"这一处必须指向那个名字"**。

### 12.3 发出去的包里有什么（`npm pack` 实测）

| 项 | 实测值（`npm pack`，2026-10-09） |
|---|---|
| tarball | **104.1 kB**（修 LICENSE 之前是 99.4 kB —— 多出来的 4.7 kB 就是那份许可证） |
| 解包后 | **263.8 kB**（修前 251.2 kB） |
| 文件数 | **97** = 47 个模块 × (`.js` + `.d.ts`) + `package.json` + `README.md` + **`LICENSE`** |
| 名字 / 版本 / 可见性 | `@levango7/engine@0.8.0`，**public** |
| 源码发不发出去 | **不发** —— `files` 只有 `["dist", "README.md"]` |
| 测试发不发出去 | **不发** —— 测试留在仓库的 `tests/`（属性测试、边界用例、纯度守卫） |

`npm publish --dry-run` 实跑过一遍（只打包不上传）：`prepack` 依次跑 `license:sync` → `tsc`，
最后一行是 `Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)` ——
**`publishConfig.access` 确实被认下来了**。这一条不发出去是看不见的，所以把证据留在文档里。

`prepack` 是唯一的构建入口，`npm pack` 与 `npm publish` 都会先跑它 —— 没有它就是发一个没有 `dist/` 的空包。

### 12.4 许可证据说没有 —— 顺手修掉

`package.json` 里写着 `"license": "Apache-2.0"`，但**打出来的 tarball 里一个 LICENSE 文件都没有**。

原因是 npm 的一条规则：`LICENSE` 无论 `files` 怎么写都必进 tarball，**前提是它在该包的目录下**。
而我们的许可证只有一处 —— 仓库根。包在 `packages/engine/`，够不着。

这不是洁癖：Apache-2.0 第 4 条要求分发时**随附许可证副本**。而且这件事**发出去之前根本看不见**
（仓库内走别名直吃源码，不经 tarball，谁也不会去看那个目录）。

修法保持**单一来源**：新增 `scripts/engine-license.mjs`，由 `prepack` 在构建前把根目录的
`LICENSE` 同步一份到 `packages/engine/`；产物在 `.gitignore` 里（不是提交一个副本，
否则就有两份许可证文本、改一处忘一处）。

### 12.5 门禁：`tests/release/engine-package.test.ts`（5 条）

这个包此前**从没发出去过**，所以所有配置错误都是不可见的；真发出去以后，
配置错了的代价是「用户装到一个缺东西的包」或者「发到一半失败」，而 **`npm publish` 不可撤回**。

| 判据 | 咬住的是 |
|---|---|
| 包名是发布名 + `publishConfig.access === 'public'` + 没有 `private` | scoped 包**默认 restricted**，免费账号漏了这行会在服务端被拒（402） |
| **四处引用都写同一个名字**（`tsconfig` 的 `paths` / `vite` 与 `vitest` 的别名定义 / 根 `package.json` 的依赖与三条脚本） | 12.2 那次事故；**逐处点名**，且每处必须先"确实存在"再要求"名字对"——否则整段删掉也算通过 |
| `src/` 与 `tests/` 的**导入**里没有别的 `@x/engine` 写法 | 上一条只点数了四个文件，源码里的漏网之鱼归这条兜 |
| `files` / `main` / `types` / `exports` / `type` / `sideEffects` | 入口指错、源码或测试被发出去、消费方摇不掉 |
| `prepack` 里既有构建又有许可证同步 | 12.4 |

**变异自检 5/5 全红**（这一项是必须做的，理由见 12.2）：① 别名改回旧名；② **别名两行整行删掉**；
③ 删 `publishConfig`；④ `prepack` 去掉许可证同步；⑤ 源码里漏一个导入没改名。
其中 ② 是第一版**漏掉**的形状 —— 第一版扫整份文件文本，一句提到包名的注释就能让"出现过"成立，
**一条能被注释满足的判据管不住别名**，所以第二版改成只从别名定义处提取。

### 12.6 CI：tag 一发就发，但没配 token 就跳过

`release` job 里加两步（在**挂完 GitHub Release 之后** —— `npm publish` 不可撤回，
它得是整条链的最后一件事）：

- `查有没有 NPM_TOKEN` → 把"有没有"算成 step output。**不能直接写 `if: secrets.NPM_TOKEN != ''`**：
  GitHub 在 `steps[*].if` 里不提供 `secrets` 上下文，写上去不报错但求值不是我们要的；
- `发 @levango7/engine 到 npm` → `npm run engine:publish -- --provenance`。
  **没有 token 时跳过**，否则没配 token 的仓库一推 tag 就红，而红的不是产品问题。

配套两处：`permissions` 加 `id-token: write`（provenance 要 OIDC 换令牌）；
`setup-node` 加 `registry-url`（它在 runner 的用户级 `.npmrc` 写一行 auth，
于是 `npm publish` 认得 `NODE_AUTH_TOKEN`。**不把这一行写进仓库那份 `.npmrc`** ——
那是每台机器都会读的文件，而 token 只在 CI 里有）。

版本对齐那道检查从"查 `package.json`"扩成"查两处 `package.json`"（根 + `packages/engine`）：
**npm 同名同版本只能发一次**，发错版本比发不出去更难收拾。

### 12.7 版本同源，以及这个选择的代价

引擎版本**与应用同源**（`scripts/docs-check.mjs` 的 `VERSION_PLACES` 机器核对，7 处）。
所以每发一个应用版本就同时发一次这个包。

**代价要认下来**：引擎那一版没什么改动时，npm 上也会多一个版本号几乎一样的条目。
换来的是"版本号永远对得上"这件事**不需要人去记**。
等真有独立消费者、开始在意自己的 API 稳定性时，再谈解耦 —— 那时候要改的是 `VERSION_PLACES`
那一条，以及"引擎 API 的兼容性口径"这件现在还不存在的东西。

### 12.8 还差什么（用户侧，不在代码里）

1. **npm 账号名必须是 `levango7`**（见 12.1）—— 这是唯一的硬前提；
2. **凭据二选一**（两条都能让那一步真的跑起来，差别在"仓里存不存长期密钥"）：
   - **A 路（发一把钥匙）**：npmjs.com → Account → Access Tokens → **Create a Granular Token**，
     范围只给 `@levango7/engine`、权限 **Read and change**、勾 **Bypass 2FA**（不勾 CI 里会要 OTP）、
     有效期挑短的；明文只显示一次，拿到就存进仓库 secret **`NPM_TOKEN`**。
     代价自己认：这是长期凭据，泄露=别人能发你的包，而**发出去撤不回**（协调板「机器资源认领」表里
     `irreversible:release-npm-tag` 那一行就是为这件事立的）。要收紧就把它放进 **environment**；
   - **B 路（免钥匙，trusted publishing / OIDC）**：在 npm 侧给这个包配 **Trusted Publisher**
     （owner `Levango7` + repository `Modulo` + workflow 文件名 `ci.yml` + 允许的 ref 按 tag `refs/tags/v*`），
     仓库里就**不需要任何 secret**。前提是包必须已存在才能配（已满足）。
     **还有一个版本门槛**：这条路要 **npm CLI ≥ 11.5.1**，而 release job 是 `node-version: 22`
     （自带 npm 10.x），所以走这条要在 step 里显式装 npm 11（B 路已按此落地，见下面 2026-10-20 段）。
     版本号**已核实**（2026-10-20 联网复核：npm 11.5.1+ 是多源一致的数；Node 22 自带 npm 10.x 不够，
     要么显式升 npm、要么换 Node 24）—— 原先那条「只有一篇 2026-01 笔记作出处、落地前自己确认」的
     警告到此结案。
3. 之后每个 `v*` tag 会自动带上引擎包。**两条路都没配之前，发布流程照常能跑**（跳过那一步并给一条 warning）。
4. **provenance 只能随下一个版本带上**：`0.8.1` 已经发出去了，而 npm **同一版本号不可重发、发布不可撤回** ——
   配好凭据之后受益的是 `0.8.2+`，不是把 0.8.1 补上证明。

**2026-10-15 实测更正（这一段替代原先那句"这个包在 npm 上没有历史" —— 那句已经过期）**：包**已在线**。
registry 实测 `dist-tags.latest = 0.8.1`、`versions = ['0.0.0-stage', '0.8.1']`、
`created 10-13 03:03:00Z`（那条 `0.0.0-stage`）与 `0.8.1` 的 `03:08:11Z`（**相隔 5 分钟的两条 = 手工本机发布的形状**），
`maintainers` 只有 `levango7` 一个。由此两条口径要分开写：

- 「**引擎包开始对外分发**」成立；「**供应链可验证**」不成立 ——
  `GET https://registry.npmjs.org/-/npm/v1/attestations/@levango7%2Fengine@0.8.1` 实测
  **HTTP 404 `{"error":"Not found"}`**（404 是结论，不是网络故障）。
- 工作流里那句 `npm run engine:publish -- --provenance` 是 `4ccc698`（2026-10-09）加的，**但在 2026-10-15 之前它从未被执行过**：
  当时本仓 Actions secrets 实测只有 `TAURI_SIGNING_PRIVATE_KEY` 一个名字、没有 `NPM_TOKEN`，
  于是上面那条例外分支（`查有没有 NPM_TOKEN` 的 output）恒假。
  ⇒ **别把「CI 里写了 provenance」读成「发出去的包有 provenance」** —— 这就是「函数正确≠被调用」在交付面上的形状。
  原句「第一个发出去的版本号会是当时应用的版本号（那句写下时应用是 `0.8.1`），而不是从 `0.1.0` 补齐」这件事本身仍然成立
  （npm 不要求版本连续，不需要补发），但读者要按「已经发生」去读，不是「将来会发生」。

**2026-10-15 09:49Z 状态变更（同一件事的另一半，别只读上面那段就下结论）**

- `NPM_TOKEN` 这个 secret **已经建好**：`gh secret list --repo Levango7/Modulo` 现在返回
  `NPM_TOKEN 2026-10-15T09:49:27Z` 与 `TAURI_SIGNING_PRIVATE_KEY 2026-10-05T11:04:14Z`。
  这条命令只给**名字与时间戳**，值既读不到也不该读；仓库里也**不写任何 token 片段**（写了就是永久泄露）。
- 这把凭据**能认证**是用正反对照验的，不是「它存在所以它有效」：同一个只读端点
  `GET https://registry.npmjs.org/-/npm/v1/tokens` 上，真凭据回 **200**、故意打坏的回 **401**、匿名回 **401**。
- 但**范围与有效期机器读不到**：那个端点对 granular token 不 enumerate（实测 `tokens` 数组长度为 0）。
  所以「它只限 `@levango7/engine`、勾没勾 Bypass 2FA、多久过期」这三件事**只能由维护者在 npm 页面核对**，
  本文不声称已验证。
- **仍未验证的那句**：「引擎包带上了 provenance」。`NPM_TOKEN` 存在 ≠ 发布成功 —— 这句话要等**下一个 `v*` tag
  真的跑过 `发 @levango7/engine 到 npm` 那一步**才算有证据；在那之前上面那条「供应链可验证不成立」继续适用。
- 一条**由这次变更引入的操作风险**（写下来免得下一个发版的人踩）：publish 那一步现在会真的执行，
  而它在 `gh release create` **之后**。对**已经发布过的 tag** 重跑（`workflow_dispatch` 填 `release_tag=v0.8.1`）
  会撞上 npm「同一版本号只能发一次」而失败，把一个**已经建好的 Release 留在红 job 上**。
  ⇒ 别对已存在的 tag 重派；要重做就切新版本（版本号一致性由前面那道「`校验 tag 与两处 package.json 版本一致`」挡）。
- 凭据卫生：这把 token 曾出现在维护者的会话记录里，属于**半暴露**；建议方便时到 npm 页面 rotate 一次，
  轮换后 `gh secret set NPM_TOKEN` 更新一遍即可（一条命令，代码不用改）。
  还要知道的爆炸半径：secret 是**仓库级**的，任何能把 workflow 推到这个仓的人（含并行协作的 agent）
  结构上都有机会读到它 —— 要收紧就得把它挪进 **environment** 并给 release job 加审批人，那是另一笔改动。

**2026-10-17 状态变更（上面那句「仍未验证的话」已验证，本节收口）**

`v0.8.2` 的 tag 触发跑通了「发 `@levango7/engine` 到 npm」那一步 —— **本仓第一次真的执行它**：

- `npm view @levango7/engine@0.8.2 dist.attestations` 返回 provenance：
  `predicateType = https://slsa.dev/provenance/v1`、attestations URL
  `https://registry.npmjs.org/-/npm/v1/attestations/@levango7%2fengine@0.8.2`；
  registry `dist-tags.latest = 0.8.2`（`versions` 现为 `0.0.0-stage` / `0.8.1` / `0.8.2`）。
- 由此「**引擎包带上了 provenance**」成立，上面那条「供应链可验证不成立」从 **0.8.2 起改为成立**
  （0.8.1 及更早的 attestations 404 记录原样留档 —— npm 同版本不可重发，旧版本补不上证明，
  这句的理由本身没变）。
- 同一条链上另外两个出口也齐了：GitHub Release `v0.8.2` 已发布（draft → published、
  `immutable: true`，资产三件：安装包 4 040 175 B / `.sig` / `latest.json`），
  出处台账 `release-manifest.json` 已回写该发布点。

**2026-10-20：切成 trusted publishing（B 路落地，v0.8.4 备料笔）**

上面「二选一」有了答案：走 B。v0.8.2 / v0.8.3 的 npm 发布走的是 A 路那把 `NPM_TOKEN`
（granular token，2026-10-15 建）；本笔起 release job 不再用它：

- **仓库侧**（`ci.yml`）：删掉「查有没有 NPM_TOKEN」探测步与 `NODE_AUTH_TOKEN`；新增
  「升级 npm ≥11.5.1」一步 —— 只升 npm、不动 `node-version: 22`，是为了不改整条 release job
  的运行时（出包 / 签名都在这个 job 里）；`id-token: write` 本 job 早有（provenance 用的就是它），
  认证复用它，不新增权限；`--provenance` 保留（trusted publishing 下冗余，但显式）。
- **仓库外待办（维护者，不做完就打 tag 会红）**：npmjs.com → `@levango7/engine` → Settings →
  Trusted Publisher 里配 GitHub Actions（owner `Levango7` + repository `Modulo` + workflow
  文件名 `ci.yml`，字段大小写敏感）。配好之前第一个 `v*` tag 会在发布步失败 —— 设计如此：
  认证不了就不假装发布成功。第一次 tokenless 发布成功后，`NPM_TOKEN` secret 即可删除
  （2027-01 起 bypass-2FA 的 granular token 不能再发包，留着也只是个过期炸弹）。
- provenance 口径不变：0.8.2 起「引擎包带上 provenance」成立，旧版本的 attestations 记录不动；
  此后的发布由 OIDC 自动生成证明，npm 包页的 provenance 徽标继续有。

### 12.9 首屏成本实测（2026-10-17，#11/#12）

起因是「首屏有长任务」这条旧账。这一节把**实测方法与结论**留下来，因为过程中**推翻了自己两次归因** ——
这两个错误的形状比结论更值得记住。

**口径与工具**：生产构建 `dist/` + `vite preview`（本地 HTTP）+ headless Chrome（`--disable-gpu`）；
长任务用 `PerformanceObserver({entryTypes:['longtask']})`，渲染事件用 CDP `Tracing`（`devtools.timeline`），
体积用 `dist/assets` 真实字节（与 `docs-check` 同一口径）。**所有对照都跑 incognito context** ——
复用同一 browser 会命中 HTTP 缓存，那是第一次归因翻车的直接原因。

| 场景（incognito，无缓存） | 首屏 longtask | FCP |
|---|---|---|
| 有存档（不弹模板选择器） | 1 条 · 55ms @35ms | 124 ms |
| 无存档（首启弹选择器，全屏 `blur(12px)`） | 1 条 · 54ms @57ms | 132 ms |

**两次归因翻车（按发生顺序）**：

1. **「老用户 longtask 归零 = 弹层的锅」是错的**。第一版消融复用同一 browser，老用户那一路**命中了 HTTP
   缓存**（V8 compile cache + 资源缓存全中），longtask 归零是缓存的功，不是"没有弹层"的功。加 incognito
   重做，两路都是 ~55ms —— 弹层的 `blur` 只值 ~1ms。**教训：消融实验必须先排除缓存，否则两路差异全是伪影。**
2. **「首屏长任务 = JS 解析编译」是错的**。懒加载把首屏 JS 从 434 kB 砍到 273 kB（-37%），
   longtask 却**纹丝不动**（141 → 168ms，噪声内）。CDP Tracing 给出真因：
   `Layout 80.8ms`（其中单项一次 **77.3ms** 全量重排）+ `RasterTask 98.8ms`，而
   `v8.parseOnBackground` 只有 ~50ms 且**在后台线程**、JS 自身执行 ~40ms。**瓶颈在渲染（软件光栅），不在 JS。**
   （与 `scripts/drag-budget.mjs` 里那条旧教训同源：只有 20% 样本落在 JS 上。）

**留下来的改动只有一笔**：`cardComponents.ts` 的 50 张卡改 `defineAsyncComponent`（首屏只需 4 个组件）。
它是真收益 —— 首屏 JS -37%、按需 chunk 共约 190 kB 挪出关键路径，而**收益不在"长任务"这一维**
（基线 ~55ms 由渲染决定，与 JS 量无关）。

**试过并撤回的一笔**：把模板选择器改成 FCP 之后再开（`PerformanceObserver` 监听 `paint`）。理由是
「弹层 blur 挡在首屏前」，但干净消融显示 54ms vs 55ms，**差值在噪声内** —— 没有实测收益的改动就是凭空
加复杂度，已撤回（`git checkout src/App.vue`）。**待实测的假设**（没做，不写进代码）：
真机 4K 视口下 `blur` 的光栅成本随像素数增长，headless 默认 1440×900 可能低估了它；要验证得换视口重跑。

### 12.10 加卡的三段入场：删掉「先空一格」（2026-10-18，#10 操作稳定性）

用户 2026-10-08 那条反馈的第二半是「操作稳定性要好好解决」。当年被追成「加卡界面抖动」，
四组视口逐帧量过几何（10ms 采样 + MutationObserver）**不可复现**，挂账待复现细节。
这一轮换了问法：**不再找"抖动"，而是逐帧量"新增那张卡的卡体里什么时候才有东西"**。

#### 量到了什么

同一套探针（生产构建 + incognito + rAF 逐帧采样，采样点从"点击前已存在的卡数"起算，
不读 `.at(-1)` —— 那是异步更新，第一帧读到的还是上一张加载完的卡）：

| 场景 | 卡体序列 |
|---|---|
| 快网 · 改前（`delay: 200`） | `content@+0ms` |
| 慢 3G（300ms RTT / 400kbps）+ 禁缓存 · 改前 | `+58ms 空卡 → +225ms 「加载中…」→ +406ms 内容` |
| 慢 3G · `delay: 0`（试过，不对） | `「加载中…」@+0ms → content@+6ms`（**哪怕 chunk 已预热也闪一下字**） |
| 慢 3G · 改后（`delay: 32` + 预取） | `empty@+0ms → content@+6ms`（整段占位消失） |
| 慢 3G · 改后**不**预取 | `empty@+0ms → fallback@+34ms → content@+405ms` |

结论有两层：

1. **几何始终稳定** —— 「抖动」这一维三轮（10-12、本轮两次）都测不出东西。A 组逐帧采
   `stage.clientWidth / scrollHeight / 画布高 / 行轨 / 每张卡矩形`，一次加卡的几何变化是 **0 段**。
   如实记账：**这一维没有可复现的缺陷**，不要再按"抖动"去找。
2. **真正的三段入场在卡的"内容"维度上**，而且是我 2026-10-17 那笔懒加载**引入**的：改前 50 张卡全静态
   import，内容与外壳同一帧上屏，根本没有中间态。`delay: 200` 把"空卡"那一格暴露了 200ms ——
   用户刚点完加卡看到一个空壳，读起来就是"点了没反应"。

#### 为什么 `delay` 取 32 而不是 0 或 200

两个极端各错一半，都是量出来的：

- **200**：慢网空 200ms 才给占位（三段入场）。
- **0**：**任何**一次加卡都先渲染一帧「加载中…」，连 chunk 已预热也一样
  （`fallback@+0ms → content@+6ms`）—— 等于每次加卡闪一下字。原因是 Vue 的 `delayed` 标记
  **自己不会触发重渲染**，`delay: 0` 等于让占位无条件上屏一帧。
- **32（两帧）**：预热路径在 32ms 内 resolve，占位不上屏；冷路径最多空两帧（≈32ms），
  肉眼当没发生，之后立刻给「加载中…」。

#### 为什么加预取

`delay` 只能压短空白，压不到零。加卡有两条**天然的空档**可以提前把 chunk 取回来：
模块库的 `.lib-item` 与目录菜单的每一项都在 `pointerenter` 就取 —— 鼠标用户是指过去的那一段，
触摸端 `pointerenter` 随 pointerdown 一起触发（规范如此），整个拖拽过程都在窗口里。
`preloadCard(id)` 就挂在这两处（loader 直接挂在组件上，避免把那 50 条字面量 `import()` 再抄一遍）。
慢 3G 实测：不预取 `empty→fallback→content@405ms`，先悬停 700ms 再点 `empty→content@6ms`。

#### 门禁

`tests/e2e/layout.spec.ts`「加卡不许先空一格：chunk 慢到 600ms 时卡体空白 ≤ 4 帧」：
拦截卡片 chunk 并延迟 600ms，加一张卡，逐帧采卡体，**空白帧（pending + empty）上限 4**。
**变异抽查过**：`delay` 改回 200 → `pending→empty→fallback→content`、14 帧、红；`delay: 32` → 3 帧、绿。

这条门禁自己翻过两次车，两次都记在这里当教训：

1. **数状态切换 ≠ 数帧**。第一版 `seq.filter(s => s === 'empty').length` 恒为 1（`empty` 只算一次切换），
   变异下照样绿 —— 改成逐帧 `blank++` 才咬得住。
2. **`cells.at(-1)` 在点击后第一帧读到的是上一张卡**（Vue 的 DOM 更新是 nextTick），
   于是第一帧就 `content` 并 break，门禁假绿。改成按"点击前卡数"索引取，并把"新卡还没进 DOM"
   单独记成 `pending` 帧一起计入空白。

### 12.11 CanvasEditor 的两块外移：为什么只拆这两个（2026-10-19，`#17` 收口）

**起因**：`CanvasEditor.vue` **834 行**（script 278 / template 173 / style 383），拆分时点居全仓前端第三（前两名：`src/vue/cardData.ts` 909 行、`src/App.vue` 811 行 —— 原句写作"是全仓前端第二大文件（384 行）的两倍多"，与时点快照不符，2026-10-20 盘点勘误）。在"单人 + 并行 agent"的模型下它是**冲突磁铁**：改一次模块库要认领整份文件的读写面。

**拆出去的两个**（834 → **677**，-19%）：

- **`ModuleLibrary.vue`（204 行）**：接口只有三个（`store` 注入、`startNew` 回调、自己的开合状态），却是全文件 **churn 最集中**的块 —— 加卡预取（`preloadCard`，§12.10 那笔刚加）、目录搬移都落在这里。churn 集中的块单独成文件，是这次抽取的第一判据。
- **`BatchActionBar.vue`（45 行）**：接口最干（`count` / `canGroup` + 4 个 emit），取材（`groupableIds`）与执行（`store.*` + 清选中）都留在母组件 —— 它们属于选中集语义，而选中集是键盘枢纽在管的。

**刻意不拆的三块**（不是"不够大"，是抽走会造出两份真相）：

- **`runIntent` + `onGlobalKey` + `onCellKeydown`（键盘编排枢纽）**：判定已经抽到 `keyboard.ts`（19 条单测），剩下的是**刻意做薄的执行胶层**，同时摸 sel / items / store / commandBus / focusNearest / clearSel；抽出去要么搬 7 个注入依赖（耦合原样搬运）、要么把 sel 状态级联搬走 —— 两种都不划算，而它正是本项目对 x-hub 声称的差异点之一。
- **`.cell` 一族样式**：浏览态 `GridLayout.vue` 另有自己一套且差异刻意（`GridLayout.vue:66`）；共享只能到令牌层（已在 `tokens.css`），抽"共享 cell 样式"就是两份真相。
- **拖拽浮层（preview / marquee / ghost）**：preview / marquee 必须是 `.canvas` 的 Grid 子元素才能定位，搬不动。

**样式必须整块迁移**：style 383 行占 46% —— 只拆 script 不拆 style 是自欺（script 砍到 200，文件仍 580+）。这次 `.lib` 一族（含 `.add-cat` / `.lib-item` / `.lib-title` / `.chip` / `.small`）与 `.batch` 一族整块搬走。末尾那条 `@media (max-width: 992px)` 同时管 `.editor`（留母文件）和 `.lib`（随模块库走），已劈成两半：一条媒体查询横跨两个文件，这就是"共享样式制造两份真相"的现实形状，E2E「窄屏堆叠」守着它。

**对外接口一字未动**：`App.vue:255` 只认 `editorRef.escapePressed()` 这一个入口。目录下拉的开合状态随模块库走了，母组件改成转问 `libEl.closeMenu()` —— **没有把 `addOpen` 复制一份回母组件**（复制 = 两份真相）。E2E 那条「Esc 关掉目录」（断言 `.add-menu` 消失）守着这条路径。

**E2E 零改**：`.add-cat` 被 4 个 spec 引用（`htmlcard` / `http` / `launcher` / `layout`），`.batch button`（成组为行）被 `layout.spec.ts` 三处引用，类名与按钮文案原样保留；`.lib-item` / `.lib-title` 没有任何测试选择器覆盖。diff 里**预期只有两处形状变化**（其余应是纯移动）：批量条从内联 handler 改成 4 个 emit、Esc 从读 `addOpen` 改成转问 `closeMenu()`。

**实测（拆后重跑，D-03）**：typecheck 干净 · 单测 **1424 / 90 文件** · build **JS 463.69 → 464.32**（+0.63，两个新组件各一份样板与 scoped 属性）、CSS 141.34 → 141.36（噪声级）· E2E 8 文件 **41 条**（声明 42 条，差的是一条 todo/skip —— `docs-check` 数的是 `it(` 声明数，与实跑数不同口径）· docs-check 一致 · coord-gate 0 警告。

**行数棘轮（同日机器化，不再是人读认领）**：拆后 `CanvasEditor.vue` **677 行**、`ModuleLibrary.vue` 204、`BatchActionBar.vue` 45，已认领进上面那行 facts 账本。本笔当时只做到「人读的认领」，同日第二笔把牙齿装上了：`docs-check` 新增**「文件行数」维度** —— 标记行里点名的 `.vue` / `.ts` 文件逐个读盘数换行（`readFileSync` 数 `\n`，与 `wc -l` 同义），写错数字、改名、路径写错当场红。**上岗首轮先咬到一口**：账本里 `` `CanvasEditor.vue` 677 行 `` 这种裸文件名认领解析不出路径（文件住 `src/vue/components/`），认领一律改全相对路径 —— 门禁还没正式上岗先抓了一处真漂移。判据与 CLI 走 `scripts/docs-check-claims.mjs` 的 `fileLineClaims`（箭头链 `834 → 677` 取**末数**；路径到数字 **8 字符窗口**；`309.28 kB` / `（10 条）` / `:334` 行号引用都不认领），抽取器由 `tests/scripts/docs-check-claims.test.ts` 新增 4 条钉住（单测 1424 → **1428**）。**变异抽查按规矩做了**：账本行 677 改 678，`docs-check` exit 1、报出「实测 677 行，这行写的是 678 行」，回滚 —— 门不是假绿。

### 12.12 cardData.ts 五分：纯搬运，顺手咬出 id 撞号（2026-10-20）

**起因**：`src/vue/cardData.ts` **909 行**是全仓前端最大的文件（§12.11 那条「前两名」里排第一，2026-10-20 盘点把它点名为下一笔候选），而它其实是**四种不相干的东西挤在一起**：类型定义、清洗层、示例内容、store 写入层。更关键的是它**没有行数棘轮管着** —— #122 那笔的受测层是显式清单，它没进；拆分前它只在聚合门禁里被高分文件兜着。

**按关注面分五份**（909 → 367 + 210 + 346 + 50 + 50 = 1023；多出的 114 行是五份各自的文件头注释与 import，不是逻辑增量）：

- **`src/vue/cardDataTypes.ts`（210 行）**：类型定义与 `CardData` 接口，纯类型。
- **`src/vue/cardDataSanitize.ts`（346 行）**：清洗层（`sanitizeCardData` 一族 + `MAX_TEXT` / `textOf` / `uniqueId`）。
- **`src/vue/cardDataLimits.ts`（50 行）**：**两层共用的数值上限**（`MAX_ITEMS` / `MAX_BIRTHDAYS` / … + `clampWeight` / `knownCategory`）。这第三份真相是拆开才看见的：清洗层与 store 层各写了一份同样的上限，同一个数字两处落笔 —— 合在一个文件时看不出来，拆开就必须选一份当真相，于是单开一个小文件让两边共读。
- **`src/vue/cardDataFallback.ts`（50 行）**：示例内容。**写成函数而不是常量** —— 里面有 `Date.now()`（`notes[0].at`），常量化会让每次 `createCardData()` 拿到同一个时间戳，语义就变了。
- **`src/vue/cardData.ts`（367 行）**：store 层 + barrel 再导出（`export *` 出类型 + 显式再导出 `sanitizeCardData`）。卡片组件与测试仍从这里 import，**导出面逐字一致**。

**对外接口一字未动**：`verbatimModuleSyntax` 开着，barrel 的类型再导出走 `export *`，类型专属的具名再导出要写 `export type`。改完 typecheck 干净、cardData 相关单测 134 条全绿、零组件改动。

**顺手咬出来的真 bug（不是拆出来的，是补用例照出来的）**：条目 id 是裸 `Date.now()`，共 7 处（todos / notes / birthdays / pickList / ledger / matrix / htmlCards）。同毫秒连加两条就撞号 —— 补「改一张不碰另一张」这条定点映射用例时，`updateHtmlCard` 当场把两张卡一起改了。而 `sanitizeCardData` 里 `uniqueId` 的注释早就写着「撞号会连坐改错条目」：**不变量一直写在清洗层，写入路径没兑现它**。修法是 7 处统一走 `nextId`（时间戳 base36 + 4 位随机后缀，与 `useSchemes.ts` 的 `newId` 同招式）。这一条值得单独记：拆分本身是纯代码搬运、逻辑一处没动 —— bug 是**补测试补出来的**，不是搬出来的。

**受测层同步**：清洗层与共享上限随拆分进 `GATED_VUE_MODULES` 并登记逐文件地板（新进受测层的文件不会自动获得地板，见 `vitest.config.ts` 第 2 条纪律）—— `src/vue/cardData.ts` 实测 **97.84**，原 97 地板复核通过、不动；`src/vue/cardDataSanitize.ts` **99.58 取 99**（整数下取整，house 惯例）；`src/vue/cardDataLimits.ts` **100 锁满**（纯数值函数，同 chord / keyboard 的写法）。

**cardData.ts 剩下三个未覆盖分支，判定为「按契约不可达」，不凑测试**：

- **`231` 早退（`addCommand`）**：上面 `if (!cmd.trim()) return` 已把空输入拦掉，而非空命令经 `normalizeCommand` 必然存活或命中去重 —— 两种情况下那个 `&&` 都不会放行早退。
- **`310` / `319` 的 `?? '这条没能通过校验'`**：`SnippetCheck.reason` 在类型上是**可选**的，所以这兜底是按类型契约的正当防御。要覆盖得先改引擎契约，不值得为不到一个百分点演戏。

**实测（拆后重跑）**：typecheck 干净 · 单测 **1431 / 90 文件**（+3）· 受测层分支覆盖 94.68 → **94.82** · E2E 42 条不变 · build **JS 464.32 → 464.21**（-0.11）、CSS 141.36 不变 · docs-check 一致 · coord-gate 0 警告。

### 12.13 更新检查这层的测试：为什么补、怎么补（2026-10-21）

**由来**：2026-10-20 盘点记着「`useUpdateCheck.ts` 161 行无测试」。它不是没写完的功能，而是**发布链上最要紧的那一环** —— 桌面端走 `tauri-plugin-updater` 读 `latest.json`、按内嵌 minisign 公钥**验签**、拉起 NSIS 静默升级；网页版问 GitHub Releases 只显示「有新版」。引擎那半（`packages/engine/src/update.ts`：比版本 / 解析 Release / 进度累加）背后有 `tests/engine/update.test.ts` **135 行**测试，**而"发请求 + 存缓存 + 摆状态 + 归还后端句柄"这半一条断言都没有**。这与当初给 `useWeather` 补测试是同一个理由（那一层的文件头写着：「引擎那半有测试，不代表"发请求 + 存缓存"这半有」）。

**22 条覆盖什么**（每条都能证伪，不复述实现）：

- **三条克制**（文件头声称的）逐一钉住：建出来不发请求、一小时内命中缓存不再联网、只有 `force` 才真去问。
- **失败是常态不是 bug**：HTTP 非 2xx / 网络抛错 / 8 秒超时自断，三种都落到 `failed` 且**不抛**；抛的不是 `Error`（有的库抛字符串）也要如实显示，不许显示成 `undefined`。
- **缓存的三种坏法**：JSON 坏了当没有、形状不全（缺 `url`）当没有、缺时间戳不算新鲜 —— 最后这条最要紧：时间戳缺省回落到 0，于是"写一次就永远命中、再也查不到新版"这条路径被堵死。
- **状态机**：`checking` / `downloading` / `installing` 三态下重复点被忽略（连点不该把 GitHub 打三遍）。
- **桌面端那条路**：`check()` 返回 null → `current`；返回句柄 → `found`（说明文字取纯文本并截 200、网页下载页为空因为动作是「下载更新」）；插件抛错 → `failed`（端点/公钥配错要能看见）；下载进度按块累加、验签失败落在 `download()` 的 `failed` 上；**无句柄时 `download()` / `install()` 是 no-op**；设置页卸载（`effectScope.stop()`）把后端句柄还回去。

**踩到的两个坑**（都写进测试文件头了）：

1. **每个用例 `vi.resetModules()` + 动态 `import()` 重新装模块** —— 单机跑 18/18 绿，**全量套件里 `beforeAll` 撞 10 秒 hook 预算，整文件被判 skipped**（本机还有别的 agent 在抢 CPU）。改成静态 import + `vi.hoisted` 可变开关翻 `isDesktop` / 插件 `check()`，测试本体从 7.7 秒降到 90 毫秒。
2. **假定时器下做第一次动态 import 会卡死**（`queueMicrotask` 也被假掉）。

**实测**：typecheck 干净 · 22 条全绿 · `src/vue/useUpdateCheck.ts` **100% 语句/分支/函数/行**（合并后整树重跑：48/48 分支）· 进 `GATED_VUE_MODULES` 并**锁 100**（同 chord / keyboard 的写法：这个文件里没有一条"按契约不可达"的分支，留余量没理由）· 单测 1522 → **1544**、文件 96 → **97** · 受测层分支覆盖 94.94 → **95.01%**（3014/3172）· coord-gate 0 警告 · docs-check 绿（合并后整门实跑：套件 **1544 / 1544 全绿**、认领核对一致）· 产品代码一行未改，JS / CSS 体积不变。

### 12.14 网络策略单一来源：为什么是单源、三侧怎么读（2026-10-22，F-07）

**由来**：网络与超时的策略数字此前散在六处 —— `packages/engine/src/http.ts`、`watch.ts`、
三个 `src/vue/use*.ts`、Rust 的 `src-tauri/src/net.rs` / `feeds.rs` / `ai/openai_compat.rs`、
以及 `src-tauri/tauri.conf.json` 里两条 CSP 的 `connect-src`。它们互相靠**注释**维系同源
（「与 watch 同一 URL 上限（300）」「响应上限与超时沿用 net.rs（1 MiB / 5s）」），
而注释维系同源没有任何机器保证 —— 已经出过两次事：

1. `http.ts` 那句注释里的 **5s 是错的**：`net.rs` 实际是 **10s**。两份数字并存，坏的那份还在生效。
2. 两条 CSP 的 `connect-src` **漏了 `https://push2.eastmoney.com`**，而那正是
   `packages/engine/src/stock.ts` 的 `QUOTES_URL` —— **桌面壳里股票卡取数被 CSP 实拦**。
   网页版没有 CSP，所以它一直没暴露，也没人报过。

**形状**：仓根 `net-policy.json` 是唯一真源（超时五档 / 响应体上限两个 / URL 上限一个 /
允许外连的域名清单一份），三侧同读它：

| 侧 | 读法 | 产物 |
|---|---|---|
| 引擎 + 前端 | `scripts/gen-net-policy.mjs` 生成 `packages/engine/src/netPolicy.generated.ts`，**文件入库** | 引擎包要能独立构建，不能依赖消费侧跑过生成 |
| 桌面壳 Rust | `src-tauri/src/net_policy.rs`：`include_str!("../../net-policy.json")` 编译期内嵌 + `LazyLock` 解析；**解析失败直接 panic，不回落旧数字** | 改了 JSON 就得重编，不存在"运行时读到旧文件" |
| CSP | 同一份域名清单生成 `connect-src`，写回 `src-tauri/tauri.conf.json` 的 `csp` / `devCsp`（只换 `connect-src` 段，幂等） | 挂在 tauri 的 `beforeDevCommand` / `beforeBuildCommand` 上 |

**一个刻意的"不统一"**：`limits.feedBodyBytes`（256 KiB）**低于** `limits.httpBodyBytes`（1 MiB）。
feed 是用户订阅的第三方全文，走独立解析路径且一次解析多份（名单可能几十条），单个源体量小、
数量多；网页取数是单条、一次一目的地。统一成同一个数会让「一次刷新 40 个订阅」的峰值内存
涨四倍。理由写进 `net-policy.json` 的 `notes` 与 `net_policy.rs` 的 `Limits::feed_body_bytes`，
并有一条单测钉住「feed < 网页且恰好 4 倍」，防止后人当成笔误改掉。

**没有弱化的边界**：`packages/engine/src/watch.ts` 的 `normalizeUrl`（只收 https、拒私网与
保留网段、拒保留主机名、拒 userinfo）与 Rust 侧 `net.rs` 的 `split_target` 同源，本笔一行未动；
`tests/fixtures/watch-url-verdicts.json` 判据表一条未删。本笔搬走的只是**数字**，不是判据。

**门禁**：新增 `scripts/net-policy-check.mjs`，**45 项断言**逐字比对「单源 ↔ 生成产物 ↔ Rust
四个消费点 ↔ 两条 CSP」，并反向断言旧的手抄数字已经不在（`1024 * 1024` / `256 * 1024` /
`10_000` / `from_secs(120)` / `from_secs(3)` / `from_secs(5)` / `8000`）—— 光删数字不算接上单源，
还得**确实引用**它。已挂进 `.github/workflows/ci.yml` 的 `verify` job（排在构建之前，漂移能在
几分钟的构建之前就红）。

**实测**：typecheck（`vue-tsc` + `tsc --noEmit`）干净 · 单测 **1550 → 1557 条 / 98 → 99 文件**
（新增 `tests/engine/netPolicy.test.ts` 6 条）· 受测层分支覆盖 **95.03%**（`netPolicy.generated.ts`
无分支，100%）· `node scripts/net-policy-check.mjs` **45/45** · `cargo fmt --check` 干净 ·
coord-gate 0 警告 · 构建重跑过：**JS 481.86 → 482.09 kB**（+0.23）、CSS 143.21 kB 不变 ·
E2E 未重跑（本笔不改界面）。

**没做的**：Rust 腿**本机编不了**（GNU 缺 `dlltool.exe`；MSVC 的 `link.exe` 被 Git Bash 的
coreutils `link` 抢到），`net_policy.rs` 与四个消费点的**编译**以 CI 的桌面壳 job 为准；
「股票卡在桌面壳里真的取到数」没有真机冒烟 —— 钉住它的是 CSP 字符串上的逐字断言。
