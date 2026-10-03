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

**MVP 只留核心闭环**：布局引擎 + 编辑器 + 4 张卡 + 本地持久化。不做扩展系统、AI、剪贴板、账号、浮窗、托盘、桌面打包。

---

## 1. 分层

```
F:\Nexus\Modulo\
├─ packages\engine\src\    ★ `@modulo/engine` 包（2026-10-03 从 src\engine\ 搬入，git 历史保留）
│                          ★ 禁止 import vue / @tauri / document / window，也不许 `../` 出包
│  ├─ types.ts          LayoutDoc / Placement / ModuleDef / VariantDef / FitLevel
│  │  ├─ geometry.ts       collides(a,b) · rectsOverlap · maxRow
│  │  ├─ fit.ts            fitState(p, variant) → below|mid|ideal|room
│  │  ├─ spot.ts           findFreeSpot(items,w,h,x,y) 同列带向下找最近空位
│  │  ├─ ops.ts            add/move/resize/setVariant/remove/setTitle/toggleLock —— 纯函数，返回新 doc
│  │  ├─ history.ts        不可变 doc + 引用栈；mergeKey 合并窗口（连按方向键折成一步）已在生产路径上用
│  │  ├─ breakpoints.ts    容器宽 → 物理列数 N + 最小行高
│  │  ├─ projection.ts     ★ project(doc, N) → 物理矩形集 + 收起清单
│  │  ├─ downgrade.ts      投影后宽度不足时的形态自动降档 / 收起判定
│  │  ├─ tidy.ts spread.ts fitHeight.ts   按需整理 / 撑满 / 按内容降高
│  │  ├─ schemes.ts        方案册纯函数（上限 24、重名加序号、逐条清洗）
│  │  ├─ templates.ts      ★ 版面模板表（8 张）+ buildTemplate：坐标显式，铺满由单测数格子证明
│  │  ├─ weather.ts        ★ 天气数据层：open-meteo 响应收窄 + WMO 码→语义/中文（网络在 useWeather.ts）
│  │  ├─ validate.ts       盘上数据解析、钳制、重叠消解（不信任存储）
│  │  ├─ serialize.ts      JSON schema；schemaVersion 偏高只告警并按 v1 读；**迁移表 MIGRATIONS 有真调用方**（`parseLayout` 每次读盘都过）
│  │  └─ index.ts          对外统一出口
│  ├─ vue\                 唯一允许碰框架的适配层
│  │  ├─ store.ts          模块级 shallowRef 单例（无 Pinia）
│  │  ├─ cardData.ts cardRegistry.ts（尺寸契约，不 import .vue）cardComponents.ts
│  │  ├─ appearance.ts useAppearance.ts
│  │  ├─ fileStorage.ts fileIo.ts useShell.ts useSchemes.ts
│  │  ├─ useDensity.ts useFocusTrap.ts
│  │  └─ components\       TitleBar · BrandMark · GridLayout · CanvasEditor · StackEditor · SettingsPanel · TemplatePicker
│  ├─ app\                 视图装配：工作台 / 编辑器 / 设置 / 卡片
│  │  └─ cards\            Clock / Sticky / Todo / Notes / Weather（全部接容器查询）
│  ├─ tokens\              设计令牌（纯 CSS 变量，亮/暗两套）
├─ tests\
│  ├─ engine\              单测（15 个文件，每个纯函数）
│  ├─ property\            fast-check：投影不变量 I1–I4 + 分区完整（共 5 条断言）
│  ├─ vue\                 适配层单测（store / fileStorage / cardData / appearance / shell / starter）
│  ├─ engine-purity.test.ts  逐文件守住「引擎零框架 / DOM 依赖」
│  └─ e2e\                 puppeteer-core 驱动系统 Chrome：16 条真浏览器断言
└─ docs\ARCHITECTURE.md
```

> **2026-10-02 复核**：上面这棵树此前记的是设计时的**计划**结构，和落地的代码差了十几个名字 —— 没有 `useDrag.ts` / `useKeyboard.ts` / `useFlip.ts` / `GridCell.vue`，也没有 `src/persist/`（拖拽与键盘编排直接长在 `CanvasEditor.vue` 与 `App.vue` 里，没单独抽 composable；让位动效是 `GridLayout.vue` 的 `TransitionGroup`），E2E 用的是 puppeteer-core 而不是 Playwright。已按实际文件重写。

**引擎纯度由两条防线守着**：`tests/engine-purity.test.ts` 扫 `packages/engine/src/**/*.ts` 的 import，出现 `vue`、`@tauri`、`document`、`window` 即失败（也不许用 `../` 往包外伸手）；`packages/engine` 自己的构建（`tsconfig.build.json` 的 `lib` 只有 ES2022、不含 DOM）是更硬的那一条 —— 真碰 DOM，编译就过不去。不引 eslint 插件。

**2026-10-03 起，引擎是 `@modulo/engine` 包**（`packages/engine/`，从 `src/engine/` 整体 `git mv` 搬入）：仓库内按**源码**消费（`vite.config.ts` / `vitest.config.ts` / `tsconfig.json` 三处 `@modulo/engine` 别名），对外入口是 `dist/`（`npm run engine:build` 产出、`engine:pack` 出 tarball，`prepack` 自动先构建）。下文 §10 的历史叙述里写的 `src/engine/**` 是搬家前的路径，指同一个东西，按当时的写法保留。

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

| 容器宽 | N 物理列 | 固定行高 | 编辑模式 |
|---|---|---|---|
| ≥1200 | 12（原生，零投影损失） | 64px | 画布 |
| 960–1199 | 8 | 60px | 画布 |
| 720–959 | 6 | 56px | 画布 |
| 480–719 | 4 | 52px | 画布（紧凑） |
| <480 | **1 = 堆叠模式** | 48px | 堆叠编辑器 |

行高是**固定 px 而非 `1fr`**：版面贴合内容高度，超出视口由页面滚动承接。曾用过撑满视口的 `minmax(rowMin,1fr)`，实测发现它会让"按内容收紧高度"完全看不出效果（行数变少＝每行变高，卡片又被拉回去），见 §10.10。

### 3.2 算法

```
s  = 12 / N                                  // 压缩因子（N=8 时非整数）
px(x)   = clamp(floor(x / s), 0, N - pw)
pw(x,w) = clamp(ceil(w / s), 1, N)           // 宽度向上取整、位置向下取整
```
取整方向是**刻意不对称**的：宽度用 `ceil` 保证覆盖不留空洞（用 `round` 时实测 4 列档会把 4 逻辑列的卡缩成 1/4 容器宽，版面中间开一个洞），偶尔因此产生的重叠交给让位消解。
然后对投影结果按 `(y, x)` 稳定排序，逐个用 `findFreeSpot` 在**物理空间**消解取整带来的重叠。

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
- 6px 位移阈值区分点击与拖动。**`pointerType` 分流（触摸长按 250ms 才进拖拽）没做**：全仓零处读 `pointerType`，触摸与鼠标共用一套逻辑，只在拖拽区/格子上用 `touch-action: none` 挡住浏览器接管手势（`CanvasEditor.vue:483/505/528/541`）。x-hub 同样是全局零引用，这里不假装做过了。
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
| E2E | Playwright | 键盘全流程 + 拖拽 + 断点截图（也是"更好看"的取证工具） |
| 持久化 | IndexedDB（idb-keyval）+ localStorage 兜底 | **字段级补丁写**，绕开 x-hub"整份配置覆盖冲掉后端字段"那个坑 |
| 动效 | Web Animations API 自写 FLIP | 不引动画库 |
| 不引 | reka-ui、Tailwind、Milkdown、任何网格库（gridstack / react-grid-layout） | 网格库只解决"不重叠+压实"，**不解决"内容装不装得下"**（形态 min/ideal 语义），而后者才是体验核心；且引库会把坐标系与压实策略锁死，而投影正是要动坐标系的部分 |
| 桌面壳 | 第二轮再上 Tauri 2 | 引擎层零改动即可包；现在避开 WebView2 运行期建窗挂死那类最贵的坑 |

> **2026-10-02 复核：这张表里有四行是"当时的选择"，不是"现在的实现"** —— ① 持久化没走 IndexedDB / idb-keyval，也没有"字段级补丁写"，实际是 `localStorage`（网页版）与 `%APPDATA%\app.modulo\data\` 下一 key 一文件的**整份 JSON**（桌面版，见 §7）；② E2E 用 puppeteer-core 驱动系统 Chrome，没引 Playwright；③ 让位动效是 Vue `TransitionGroup`，不是自写 WAAPI FLIP（见 §4.2）；④ 属性测试是 **7 档**列数 × 200 例、**5 条**断言（I1–I4 + 分区完整），不是"5 档 N × I1–I4"。保留原表是因为它记的是取舍理由，理由今天仍然成立 —— 但落地结果以 §10 为准。

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

- **网页版**：`localStorage`。
- **桌面壳**：`%APPDATA%\app.modulo\data\<key>.json`，一个 key 一个文件，整个目录拷走就是备份。由 `read_doc`/`write_doc` 两条命令实现（`src-tauri/src/storage.rs`）。
  - **原子写**：先写同目录临时文件再 `rename`。直接截断写会在崩溃/断电时留下半份 JSON，而这个文件就是用户的全部版面。
  - **同一个 key 的写强制排队**（`serialize()`）：两次并发写会共用同一个临时文件名，前一次还没 rename 就被后一次截断，落盘的可能是两份内容拼起来的半份。串行化做在 `createFileStorage` 内部，调用方忘不掉。
  - **文件名走白名单**：只允许小写字母/数字/`.`/`_`/`-`，且不许以点开头或含连续点，再统一加 `.json`。挡掉 `/` `\` `:` 就出不了数据目录。这条是 Rust 侧单测锁的。
  - **写失败会挂在界面上**（`storage.error` 顶出一条红框）。静默失败的存储迟早会变成"我明明存了"的数据丢失。
  - 存储适配器是**同步**接口而写文件是异步的，所以启动时一次性 hydrate 成内存镜像，之后 `get` 读镜像、`set` 立刻异步写穿。**不做防抖**：拖拽只在 `pointerup` 提交一次，写频率就是用户动作频率。
  - 首次启动会把桌面壳早期只存在 WebView2 localStorage 里的数据搬进文件；迁移单向，磁盘已有内容时以磁盘为准，避免旧 localStorage 覆盖新数据。
- 读取一律过 `validate.ts` / `parseBook`：校验 id/整数坐标、按形态 min 钳制、标题 trim+截断、失效 variant 归一，再从上往下扫描逐项消解重叠（x-hub 这套"不信任盘上数据"的做法照抄思路、码重写）。
  - 卡片数据（待办 / 速记 / 便签）走同一套规矩，入口是 `sanitizeCardData`（`src/vue/cardData.ts`）。**这里原来是漏的**：加载只做 `{...fallback, ...JSON.parse(raw)}`，只兜住了语法错误，`todos: null` 会一路传到渲染期的 `todos.filter(...)` 才炸 —— 注释里"数据损坏不阻塞启动"当时并不成立。现在顶层不是对象整份回退、条目形状不对只丢那一条、`done` 只认真 `true`、id 撞号改唯一（`toggleTodo` 按 id 找，撞号会连坐）、文本与条目数各有上限（几百 MB 的坏文件不该冻住首屏）。12 条单测锁住，含 `__proto__` 键不漏进状态。
- 导出/导入 = 单个 JSON（含 schemaVersion），导入走同一 validate。
- 迁移：**没有迁移器**。这里原来写的 `migrations: Record<fromVersion, (doc)=>doc>` 占位接口在代码里根本不存在。`serialize.ts` 实际只做一件事：`schemaVersion` 高于当前支持版本时告警并按 v1 读取。真要跨版本时再引入显式迁移表 —— 提前摆一个没人调用的接口，就是下一份"文档说有、代码没有"。

---

## 8. MVP 范围与验收

**做**：引擎（含投影）｜画布编辑器 + 堆叠编辑器｜撤销重做｜键盘｜多选｜FLIP｜4 张卡（Clock 三形态 / Sticky / Todo / Notes）｜三轴主题｜本地持久化 + 导入导出。

**不做**：扩展系统、AI、剪贴板历史、账号、市场、自动更新、开机自启、任何独立窗口。（托盘与全局快捷键原本也在这条里，已被 §11.3 推翻 —— 桌面壳是 MVP 之后单独开的一轮。）

**验收判据（可测，不靠感觉）—— 2026-10-02 逐条复核**
1. ✅ 三档视口：无横向滚动、无碎片卡、最小字号达标。**但实际断言跑在 1440 / 720 / 390**，不是这里原写的 360 —— 见 `tests/e2e/layout.spec.ts` 第一条。
2. ✅ 纯键盘可完成移动 / 缩放 / 切形态 / 选入 / 撤销 —— 由「编辑器键盘可达」「键盘补完」「方案册键盘排序」三条 E2E 覆盖。
3. ✅ **已补成测试**（2026-10-02）：`tests/e2e/layout.spec.ts` 里「拖动帧率实测」用 rAF 采样器在真拖期间记录帧距，断言**中位数 ≤ 18.2ms（≈55fps）**；本机 headless Chrome 实测 `median=16.7ms / p95=16.7ms / 103 帧`。注意这是 headless 的软合成节奏，只能当**下限**看，不代表低端实机。
4. ✅ 属性测试全绿：随机 200 例 × **7 档**列数（原写 5 档）× **5 条**断言（I1–I4 + 分区完整）。
5. ✅ **已补成门禁**：`npm run cover:engine`（v8 provider，`thresholds.branches = 90`），已并入 `verify` 的第二步，所以 CI 会拦。圈选范围 2026-10-03 从只圈 `src/engine/**` 扩到「engine 全量（现 `packages/engine/src/**`）+ `vitest.config.ts` 里 `GATED_VUE_MODULES` 那 6 个 vue 纯模块」，合数 93.85%。首跑实测 **87.29%** —— 也就是说这条判据从来没达成过；补了 13 条边界/失败分支用例后到 **90.95%**。剩下没覆盖到的多是防御性分支，例如 `spot.ts:25-26` 那个兜底 return 在数学上到不了（`bottom = maxRow(obstacles)`，循环到 `bottom` 时必然已空）—— 不为它编假测试。
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

当前状态（2026-10-03 复核）：**前端单测 355 条（32 个文件）+ E2E 20 条 + Rust 单测 6 条**全绿，`tsc --noEmit` 干净，受测层分支覆盖 **≥93.7%**（engine 93.13% + vue 纯模块 97.28%，门禁 90），无 console 报错。`vite build` 同日重跑：**JS 180.10 kB / gzip 66.45 kB（主包 179.07 + 更新插件面 1.03），CSS 30.40 kB / gzip 6.53 kB**（比上一版记的 41.0 kB 大得多，因为多了桌面壳设置页、卡片内容、版面模板选择器、完整备份、更新插件与天气卡的 JS 面；桌面探针 49 项见 §11.3）。<!-- facts -->

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

**三套 skin 做成正式预设**（用户裁决：都保留，默认 `ink`）：`aurora 柔光`（原状，最接近 x-hub）/ `ink 墨纸`（高对比、无渐变、小圆角、等宽数字）/ `candy 亮彩`（暖底饱和、20px 大圆角、厚实落影）。全部只覆盖令牌层，组件零改动；另加**模块身份色** `--mod`（按 `data-module` 给表头图标上色，跨 skin 复用）。选择当时存 `localStorage['modulo.skin']`，顶栏「外观」循环切换。**这条已被 §10.6 取代**：皮肤/明暗/强调色现在统一存 `modulo.appearance.v1`，「外观」按钮是打开设置面板，不再是循环切换（`modulo.skin` 这个键已从代码里删净）。同数据截图：`evidence/skin-{aurora,ink,candy}{,-editor}.png`。

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

引擎层 `src/engine/schemes.ts` 是纯函数方案册：`createScheme / renameScheme / updateScheme / removeScheme / parseBook / mergeBooks / bookToJson`，上限 24 套、名称 trim+截断到 32、重名自动加序号。`parseBook` 对**每一条**方案跑 `sanitizeItems`（未知模块剔除、尺寸钳到形态最小值、重叠让位），空方案丢弃并留 warning，`activeId` 指向不存在的方案时归空；`mergeBooks` 保证导入不覆盖用户已有方案（id 与名称各自加后缀）。18 条单测覆盖（`tests/engine/schemes.test.ts`；这里原来写「10 条」，是空白方案与排序那批用例加进来之前的数）。

胶水层：`useSchemes.ts`（状态 + `localStorage['modulo.schemes.v1']`）、`fileIo.ts`（Blob 下载 / `<input type=file>` 读取，桌面壳阶段只换这一个文件）。设置面板新增「版面方案」（另存为 / 覆盖当前 / 应用 / 改名 / 删除，活动项高亮且不给「应用」）与「导入导出」（当前布局、全部方案各双向），校验产生的 warning 就地列在面板里，不靠一闪而过的提示。

应用方案走 `store.importJson` → 因此**可撤销**：E2E 验证了"另存为 → 撑满改版 → 应用旧方案 → 坐标逐字回到原样"。

### 10.10 按内容收紧高度（2026-10-01）

引擎 `fitHeights(doc, reg, wantedRows)`：只变矮不变高、不低于形态 `minH`、非正数/NaN 视为"没有测量数据"直接忽略、无变化时返回同一引用。测量在 `useDensity.ts` 做**真测量**而非"每种卡片一个行数成本"模型（模型会随字号/皮肤/换行漂移）。

一个测量口径的坑：`scrollHeight` 恒 ≥ `clientHeight`，用它判断"内容比盒子矮"永远得不出肯定答案 —— 必须量内容子元素的实际排布范围（`max(bottom) - min(top) + padding`）。

**实测效果与它的局限（重要）**：收紧确实生效 —— 待办 6 行→3 行、速记 4 行→2 行、零裁字、可撤销。但**屏幕上的留白几乎没变少**，因为当时工作台用的是 `minmax(rowMin, 1fr)` 的**撑满视口**行模型：行数变少 → 每行变高 → 卡片又被拉回同样高度。也就是说"密度"问题的根不在卡片 span，而在**行高被拉伸**这个决策（x-hub 也是撑满视口，所以它有同样的观感）。

**已按结论改模型（同日）**：工作台改为**固定行高 + 页面滚动**（见 §3.1 行高列）。改完卡片真正贴着内容走，收紧才有视觉收益。同时确认两个动作是正交的：收紧只改 span、整理才把空行合掉，**只有连着点两者才会减少总行数** —— 这条组合效果已写成 E2E 断言锁住。

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

**为什么模板放引擎层**：模板的全部价值在于"排出来是满的"，而这句话必须能被纯函数数格子证明。`tests/engine/templates.test.ts` 47 条（8 张 × 5 条 + 全局 2 条 + 反向自测 4 条）：每张模板不重叠、不出列、**已用矩形内 0 空洞**、行数 ≤10、形态与 minW/minH 合法、铺出来逐格等于模板定义（含**形态名**）、且是 tidy/spread 的不动点。放在组件里就只能靠眼睛看 —— 而"靠眼睛看排版"这一轮已经翻过一次车。

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
所以记一笔现状：**这个应用只连两个域名，两个都是 GET、都不带凭据。**

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

### 10.14 下一步

1. ~~收紧与整理要不要合成一键「紧凑」~~ → **已加**：`compact() = fitContent() + store.tidy()`，原子按钮全部保留。刻意**不做成一步历史**，仍是两步 —— 撤销可以只退回其中一半，E2E 锁住了这一点（紧凑让总行数严格变少、两次 Ctrl+Z 逐格回到起点 —— 断言用相对量，不写死出厂版面的行数，否则改默认值会把测试改成假绿）。
2. ~~方案册 UI 的缺口：暂无"新建空白方案"与拖拽排序~~ → **已补**：`createBlankScheme` + `moveScheme` 两个纯函数，UI 上给「新建空白」按钮、拖把手排序、`Alt+↑/↓` 键盘排序。
   顺带修掉一个会咬人的规则：`parseBook` 原来对 `items` 为空的方案直接丢弃，于是**用户刚建的空白方案会在下次启动时被悄悄吃掉**。现在区分两种空 —— doc 本来就空（合法，保留）vs 有内容但清洗后一条不剩（外来数据里的未知模块，仍然丢弃并给 warning）。
3. ~~数据落地：localStorage → 数据根目录下的 JSON~~ → **已做**，见 §7 与 §11.3。

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
设置页每行一个「改键」按钮，按下后在 **document 捕获阶段**听 keydown 并 `stopPropagation` —— 挂在 bubble 上会先让应用自己的 Ctrl+Z / Esc 跑掉（Esc 还会顺手关掉设置面板）。裸键（`M`）被 `parse_chord` 拒绝：全局裸键会吞掉系统里所有该键的输入。这条**没有 Rust 单测**：一引用 `parse_chord`，windows-gnu 的测试二进制就 `STATUS_ENTRYPOINT_NOT_FOUND`（去掉立刻恢复），所以由探针端到端验。

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

**打包**：**当前线上发布产物是 `Modulo_0.3.0_x64-setup.exe`**（NSIS，1 865 657 字节，`sha256 0b879d72631a7a72d182e67fb31a460104b7365b696448e2a6e1b21ae18d6779`，包内 `modulo.exe` 5 711 872 字节 / `sha256 3b475a5b7c2873cb7d6d56a92a3816719716221ae45bd8d2d057194e37778264`，构建自 `4c5b54c`、打包时工作树干净；**该二进制本机探针 49/49** —— 原始行 `2026-10-03T05:02:28.732Z 49/49`；tag `v0.3.0` 落在最后发版前的构建提交 `4c5b54c`，与 `v0.1.x`「落在版本号定型那笔」差一次核对修复 —— 版本定型那笔 `5d2c642` 带着会被环境抖动打红的 docs-check，不该当发布点，理由见 CHANGELOG 0.3.0 发布节）。上一版 **`Modulo_0.2.0_x64-setup.exe`**（NSIS，1 860 690 字节，`sha256 f4ff0413510809c44cfbc75e9faad5436f68fcc715488cb42a71a8f528852559`，包内 `modulo.exe` 5 706 752 字节 / `sha256 e99ddec087bb34f8e6277901c7faa6848e1fd2ea35d434f4b2a5b6d6f66e57d9`，构建自 `2e73795`、打包时工作树干净，**该二进制本机探针 49/49** —— 原始行 `2026-10-02T22:02:51.248Z 49/49`；tag `v0.2.0` 按惯例落在版本号定型那笔 `ef07a92`）。上一版 **`Modulo_0.1.1_x64-setup.exe`**（NSIS，1 859 053 字节 = 1.77 MiB，`sha256 47aad05abc9c5ef2958cbf6252b780a23253acd616f69d18e6f4b7a4e73121c6`，构建自 `53b0ed9`，打包时工作树干净；该二进制本机探针 47/47 —— 原始那行是 `2026-10-02T18:50:25.522Z 47/47`，来自本机 `evidence/probe-history.log`）。**注意 `evidence/` 在 `.gitignore` 里**（`.gitignore:3`），这两份日志是**本机**证据、不随仓库分发，所以凡是拿它当出处的地方都得把关键那一行原文抄进文档，否则公开仓库里的读者点不开。上一版 `Modulo_0.1.0_x64-setup.exe`（1 858 935 字节，`sha256 4658ada982c7e439…`，构建自 `0c42fc9`）**发布当天就被 §11.5 的起步版面重排作废** —— 这正好说明「尺寸 + sha256 + 源 commit」三件套有什么用：包与代码的差距是可查的事实，不是一句「感觉应该没问题」。v0.1.0 的 Release 页面已加取代声明（不动已公开的 tag：下过 0.1.0 的人手里的校验和必须继续对得上）。v0.1.0 发布前重切过一次：上一版是 `1 852 946 字节 / sha256 4a1c90a7… / 构建自 782a520`，缺本轮的改键能力与新默认组合键。先前担心的「NSIS 工具链在本机下载不动」没有发生 —— 它走 github.com 的 release 直链（取不动的是 raw.githubusercontent 那一类），下载后还会校验哈希。上一版包栽过一次：它的 `modulo.exe` 链于 21:23:11，而 `lib.rs` 最后写入是 21:24:47 —— **包比代码早，不能证明里面含最终的 `fit_window`**。教训是记产物必须同时记尺寸、哈希**和源 commit**：只看时间戳还会漏掉"包里有未提交代码"这种情况。

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
1. **显式重排**（`store.ts:32-57`）：两带各自铺满 12 列 —— 第一带 时钟 5×3 + 便签 3×3 + 待办 4×6（待办竖在右侧一整列，既是主卡也撑住两带高度），第二带 速记 4×3 + 最近改动 4×3。
2. **`spreadLayout` 兜底**：手排只保证"当下这两带是满的"，以后改 registry 的 ideal 尺寸或加第 6 个模块，还得靠 tidy+fillRows 收。

**中间踩到的两个反直觉点**：
- **只靠 `fillRows` 会把事情弄糟**：它按"顶边相同的卡"为一组铺宽，**某一带只剩一张卡时会被拉成通栏** —— 实测速记变成 12 列横幅装 1 条内容，空洞率 0 了但更难看。所以宽度必须自己排，`fillRows` 只当兜底；守卫里也加了"任何卡不许超过理想宽 1.5 倍"（`tests/vue/starter.test.ts`）。
- **`addItem` 不吃尺寸**：它只按形态 ideal 找空位，给 x,y 也只是搜索起点。所以起步版面必须 `addItem → resizeItem → moveItem` 三步走（`store.ts:47-51`），少了 move 那步，12 宽的通栏会被塞到下一带，速记就成了上面那种"单卡带"。
- 待办必须留 4 逻辑列：N=4 档是 `ceil(w/3)`，3 列会被压成 1 物理列（实测 159px），条目文字直接裁掉（`clipped=2`）。

**顺带暴露的测试设计问题（这条最值钱）**：改完 0 空洞之后，**三条 E2E 立刻挂了** —— 「整理：行数变少」「撑满：首行带从缺角铺满」「版面方案：按撑满改版面」，它们全都建立在"出厂版面本来就有洞"上，也就是**一直在测"排版排得烂"，而不是测"这三个工具有用"**。默认一修好，它们就空转了。现在这三条改成自己喂夹具（`SLOPPY_DOC`，就是旧版那份真实出厂坐标），另加一条正向守卫「出厂版面：首行带铺满且整屏不留空洞」。
**教训**：凡是"点一下 X 会变化"的断言，都要问一句"这个变化是 X 造成的，还是默认状态本来就烂"。夹具要自带，不能蹭默认。

**新增守卫**：`tests/vue/starter.test.ts` 7 条（0 空洞、无整行空、不重叠、minW/minH 下限、1.5× 理想宽上限、tidy/spread 不动点），并且它 import 的是**真注册表** —— 为此把 `.vue` 组件映射从 `cardRegistry.ts` 拆到 `cardComponents.ts`（尺寸契约文件必须能被 node 环境的单测直接 import，抄一份 fixture 进测试等于装了个会撒谎的守卫）。

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
3. Release 里**必须同时上传安装包 + `.sig` + `latest.json`**。端点就是
   `https://github.com/Levango7/Modulo/releases/latest/download/latest.json`。

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
