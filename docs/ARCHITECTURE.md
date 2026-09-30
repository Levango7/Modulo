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
├─ src\
│  ├─ engine\              ★ 纯 TS。禁止 import vue / @tauri / document / window
│  │  ├─ types.ts          LayoutDoc / Placement / ModuleDef / VariantDef / FitLevel
│  │  ├─ geometry.ts       collides(a,b) · rectsOverlap · maxRow
│  │  ├─ fit.ts            fitState(p, variant) → below|mid|ideal|room
│  │  ├─ spot.ts           findFreeSpot(items,w,h,x,y) 同列带向下找最近空位
│  │  ├─ ops.ts            add/move/resize/setVariant/remove/setTitle/toggleLock —— 纯函数，返回新 doc
│  │  ├─ history.ts        不可变 doc + 引用栈 + 合并策略
│  │  ├─ breakpoints.ts    容器宽 → 物理列数 N + 最小行高
│  │  ├─ projection.ts     ★ project(doc, N) → 物理矩形集 + 收起清单
│  │  ├─ downgrade.ts      投影后宽度不足时的形态自动降档 / 收起判定
│  │  ├─ validate.ts       盘上数据解析、钳制、重叠消解（不信任存储）
│  │  └─ serialize.ts      JSON schema + schemaVersion 迁移
│  ├─ vue\                 唯一允许碰框架的适配层
│  │  ├─ store.ts          模块级 shallowRef 单例（无 Pinia）
│  │  ├─ useDrag.ts        指针拖拽/缩放（move 与 resize 语义不同，见 §4）
│  │  ├─ useKeyboard.ts    roving tabindex + 方向键编排
│  │  ├─ useFlip.ts        Web Animations API 让位动效
│  │  └─ components\       GridLayout.vue / GridCell.vue / CanvasEditor.vue / StackEditor.vue
│  ├─ app\                 视图装配：工作台 / 编辑器 / 设置 / 卡片
│  │  └─ cards\            Clock / Sticky / Todo / Notes（全部接容器查询）
│  ├─ tokens\              设计令牌（纯 CSS 变量，亮/暗两套）
│  └─ persist\             IndexedDB + localStorage 兜底 + JSON 导入导出
├─ tests\
│  ├─ engine\              单测（每个纯函数）
│  ├─ property\            fast-check：投影不变量 I1–I4
│  └─ e2e\                 Playwright：键盘全流程 / 拖拽 / 三档断点截图
└─ docs\ARCHITECTURE.md
```

**引擎纯度由一条测试守住**：`tests/engine-purity.test.ts` 扫 `src/engine/**/*.ts` 的 import，出现 `vue`、`@tauri`、`document`、`window` 即失败。不引 eslint 插件。

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

| 容器宽 | N 物理列 | 编辑模式 |
|---|---|---|
| ≥1200 | 12（原生，零投影损失） | 画布 |
| 960–1199 | 8 | 画布 |
| 720–959 | 6 | 画布 |
| 480–719 | 4 | 画布（紧凑） |
| <480 | **1 = 堆叠模式** | 堆叠编辑器 |

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
- 6px 位移阈值区分点击与拖动；`pointerType` 分流：鼠标直接拖，触摸需长按 250ms 进拖拽态（x-hub 全局零引用 `pointerType`，触摸与鼠标一套逻辑）。
- 拖动中：跟随光标的 ghost + 落点预览矩形 + 尺寸/适配文字标签。
- **移动与缩放的冲突语义故意不同**（承袭 x-hub 的好设计）：
  - 移动 → 目标被占时同列带向下找最近空位，**绝不弹回**；
  - 缩放 → 目标非法（越界/重叠/低于形态 min）时**拒绝并回退**到拖前尺寸。
- 缩放过程中实时改 `w/h`，让内容当场重排（不是松手才变）。
- 无贪心压实：删掉中间一块不会整屏跳。

### 4.2 让位动效（x-hub 完全没有）
`.cell` 用 FLIP：投影/移动导致其他格子位置变化时，`element.animate()` 播 160ms `transform` 过渡；`prefers-reduced-motion` 下直接跳位。

### 4.3 键盘（x-hub 为 0 分）
- 格子 roving tabindex，`Tab` 进出版面、`方向键` 在格子间跳焦点。
- 焦点在格子上时：`方向键`=移动 1 格｜`Shift+方向键`=改宽/高 1 格｜`Enter`=开形态菜单｜`Delete`=移除｜`L`=锁定切换｜`Ctrl+Z / Ctrl+Shift+Z`=撤销/重做。
- 焦点环用 `--shadow-focus` 令牌，禁止 `outline:none` 裸删。

### 4.4 多选与批量（x-hub 无）
`Shift+点击` 增选；空白处按下拖动 = 框选；选中集支持整体偏移、整体删除、整体锁定。

### 4.5 历史
50 步；合并策略：一次拖拽 = 一条历史；连续缩放 300ms 内合并；标题输入按失焦合并。

---

## 5. 设计令牌（纯 CSS 变量，不引 Tailwind）

```css
:root {                       /* 亮 */
  --bg-page; --bg-card; --bg-card-solid; --bg-card-soft; --input-bg;
  --text-1; --text-2; --text-3; --text-4;
  --border-soft; --border-strong; --scrim;
  --brand-500; --brand-600; --brand-50; --brand-glow;
  --c-*: 8 色 + -ink/-soft 变体;
  --radius-xs/sm/md/lg/xl;    /* 8/8/12/16/999，禁止 >24 */
  --space-1..6;               /* 4/8/12/16/20/24 */
  --shadow-card/item/hover/dock/focus;
  --z-base/sticky/overlay/menu/modal/toast/lightbox;   /* ★ 集中定义，x-hub 此处散落各组件 */
  --dur-micro:150ms; --dur-pop:200ms; --ease-out;
}
[data-theme="dark"] { /* 覆盖 */ }
```

- 主题三轴照做：模式（亮/暗/系统）× 预设（单色 + 渐变）× 强调色（`--accent` + `color-mix` 派生 brand 全族）。
- **卡片表面**：MVP 用静态烘焙渐变假装毛玻璃，常驻层**不用真 `backdrop-filter`**，真 blur 只给弹窗/菜单等瞬态层（x-hub 用 GPU 从 ~26% 回落换来的结论，我们直接继承，不重新踩）。
- **卡片内容一律容器查询**：`.cell{container-type:size}` + `clamp(绝对下限, Ncq…, 绝对上限)`。x-hub 只有 2/13 张卡这么做了，我们 4 张卡全做 —— 这是"任意尺寸不裁字"的唯一可靠路径。
- 字号下限硬约束：正文 ≥12px，投影降档必须优先保住这条线（x-hub 在 720px 下编辑器预览正文掉到 6.7px）。

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

---

## 7. 持久化

```
LayoutDoc (schemaVersion:1)      → IndexedDB key: layout
settings (主题/断点覆盖/字号)     → key: settings，字段级补丁写
cardData (便签文本/待办/笔记)     → key: card:<moduleId>
```
- 读取一律过 `validate.ts`：校验 id/整数坐标、按形态 min 钳制、标题 trim+截断、失效 variant 归一，再从上往下扫描逐项消解重叠（x-hub 这套"不信任盘上数据"的做法照抄思路、码重写）。
- 导出/导入 = 单个 JSON（含 schemaVersion），导入走同一 validate。
- 迁移：`migrations: Record<fromVersion, (doc)=>doc>`，当前只有 1→2 的占位接口，不写实现。

---

## 8. MVP 范围与验收

**做**：引擎（含投影）｜画布编辑器 + 堆叠编辑器｜撤销重做｜键盘｜多选｜FLIP｜4 张卡（Clock 三形态 / Sticky / Todo / Notes）｜三轴主题｜本地持久化 + 导入导出。

**不做**：扩展系统、AI、剪贴板历史、账号、市场、自动更新、开机自启、托盘、全局快捷键、任何独立窗口。

**验收判据（可测，不靠感觉）**
1. 360 / 720 / 1440px 三档：无横向滚动、无碎片卡（任何可见卡宽 ≥ 其形态 minW 对应像素）、正文 ≥12px。
2. 纯键盘完成"加卡→移动→缩放→切形态→撤销 5 步"。
3. 13 格画布拖动实测帧率 ≥55fps（Performance API，不许估）。
4. `tests/property` 随机 200 例布局 × 5 档 N，投影 I1–I4 全绿。
5. 引擎单测分支覆盖 ≥90%。
6. 与 x-hub 同数据、同视口并排截图对比（基线已存 `workspace/evidence/`）。

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

## 11. 实现状态

| 日期 | 内容 | 验证 |
|---|---|---|
| 2026-10-01 | 引擎层 11 个纯函数模块落地（types/geometry/spot/fit/ops/history/breakpoints/downgrade/projection/validate/serialize）+ 11 个测试文件 | `tsc --noEmit` 干净；`vitest run` **87/87 通过**（含 5 条 fast-check 属性测试，各 200 例随机布局 × 7 档列数）；`tests/engine-purity.test.ts` 逐文件守住"引擎零框架/DOM 依赖" |
| 2026-10-01 | Vue 适配层 + 工作台 + 画布编辑器 + 堆叠编辑器 + 4 张卡 + 设计令牌（`src/vue/`、`src/app/cards/`、`src/tokens/`）；`scripts/shoot.mjs` 无头取证 | 93/93 通过；`vite build` 干净（JS 37.6 kB gzip）；三档视口实测见下 |

### 11.1 三档视口实测（`evidence/`，与 x-hub 同口径对比）

| 视口 | 物理列 | 横向溢出 | 最窄可见卡 | 被裁文字 | 最小字号 | 编辑器可聚焦格 |
|---|---|---|---|---|---|---|
| 1440 | 12 | 无 | 221px | 0 | 11px | **5**（x-hub 0） |
| 720 | 4 | 无 | 160px | 0 | 11px | **5**（x-hub 0） |
| 390 | 1（堆叠） | 无 | 358px | 0 | 11px | 堆叠编辑器（x-hub 画布仅 88px） |

对照 x-hub 同视口：390px 下它仍是 12 列、便签卡被压成 **50px**、时钟截成 `23:43…`。差异点全部来自投影 + 形态降档 + 堆叠编辑模式这三件事。

遗留观感问题（已知、非阻塞）：窄列数下取整会让个别小卡（如 1 物理列的便签）右侧留出一段空档 —— 这是"宁可挤不可漏"的 ceil 策略换来的代价，属于 A1 方案的固有精度上限，A2 加权列带能否消掉待 §3.4 的对照实验。

### 11.2 多选与真实交互实测（`evidence/interact.json`，脚本 `scripts/interact.mjs`）

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

当前状态：101/101 测试、`tsc --noEmit` 干净、`vite build` 41.0 kB gzip、无 console 报错。

### 11.3 验证固化进 CI（2026-10-01）

上面那些交互断言原来只是我手动跑的脚本，等于没有防线。现在：

- `tests/e2e/layout.spec.ts` —— 5 条真浏览器断言（vitest + puppeteer-core 驱动系统 Chrome，CI 上走 `CHROME_PATH=/usr/bin/google-chrome`）：三档视口的列数/溢出/裁字/最小字号、编辑器可聚焦格 >0、方向键移动 + Ctrl+Z 回退、框选→成组拖拽→整体撤销、390px 自动堆叠模式、拖拽全程零 console 报错。
- `vitest.e2e.setup.ts` 用 vite 的 `build()` + `preview({port:0})` 起随机端口，避免与本机其它 dev server 抢端口。
- `npm run verify` = typecheck（`tsconfig.json` 严格无 DOM + `tsconfig.e2e.json` 带 DOM，分层：产品代码拿不到 `document`）→ 单测 → 构建 → E2E。`.github/workflows/ci.yml` 就按这四步跑。
- 本地实测：103 单测 + 5 E2E 全绿，E2E 约 43s（含构建）。

对照 §1 那条事实——x-hub 写了 164 个 Rust 测试但 CI 只跑 `vue-tsc + cargo check`，一个测试都不执行——这条 CI 是它的反面教材，不是可选项。

### 11.4 按需整理 tidy（2026-10-01 已实现）

`src/engine/tidy.ts`：单趟"上+左"重力聚拢，锁定项不动、其余绕开它落位，兜底放到 `maxRow` 之下（那一行必然空闲）。两个实现细节是被测试逼出来的：

1. **两趟分开聚拢（先左后上）会造出重叠** —— 找不到空位时"原样返回"就撞上了前一趟已挪动过的卡片。随机版面性质测试抓到后改成单趟联合扫描。
2. **单次整理可能让版面更高**（推荐布局实测 11 行 → 12 行：左聚把窄卡挤到下一列，通栏只能再往下落）。改为同时算"仅上聚"与"上+左聚"两个候选取更矮者，并**迭代到不动点**保证幂等。现在有两条硬保证：`usedRows` 只会变小不会变大（200 组随机版面断言）、tidy 两次等于一次。

工作台与编辑器共用顶部「整理」按钮；撤销/重做同时上移为**全局**键盘能力（E2E 抓到过：在工作台点整理后按 Ctrl+Z 无效，因为监听只挂在编辑器组件上）。

诚实边界：整理能把 11 行压到 9 行、消除纵向空档，但**不会让版面"看起来满"**——5 张卡在 12 列里仍会留下中部横向空白（见 `evidence/tidy-before.png` / `tidy-after.png`）。要真正解决稀疏感，需要的是"按可用宽度重新分配卡片宽度"的模式，属于视觉/排版策略层，由 §11.5 的撑满模式接手。

### 11.5 视觉方向与撑满模式（2026-10-01）

**三套 skin 做成正式预设**（用户裁决：都保留，默认 `ink`）：`aurora 柔光`（原状，最接近 x-hub）/ `ink 墨纸`（高对比、无渐变、小圆角、等宽数字）/ `candy 亮彩`（暖底饱和、20px 大圆角、厚实落影）。全部只覆盖令牌层，组件零改动；另加**模块身份色** `--mod`（按 `data-module` 给表头图标上色，跨 skin 复用）。选择存 `localStorage['modulo.skin']`，顶栏「外观」循环切换。同数据截图：`evidence/skin-{aurora,ink,candy}{,-editor}.png`。

**撑满模式**（`src/engine/spread.ts`）：按**顶边 y 相同**的行分组（组内须两两横向不相交），按原比例放大到铺满 12 列。四条约束：只变宽不变窄（所以形态 `minW` 天然继续成立）、含锁定项的行跳过、放大后与组外卡片相撞则整行放弃、`spreadLayout = fillRows(tidyLayout(doc))`。效果见 `evidence/ink-default.png` → `ink-spread.png`：中部空洞消失。

一个设计错误被 E2E 抓出来：第一版按"传递性行带"分组，但真实版面里卡片纵向错位，保守的相交检查直接跳过整组，**撑满完全没生效**（覆盖率断言停在 0.65）。改成按顶边分行后才对。

**撤销/重做上移为 App 级全局键盘能力**：原本只挂在编辑器组件上，在工作台点「整理」后按 Ctrl+Z 无效 —— E2E 抓到，属于"键盘可达"这条卖点上的真实漏洞。

### 11.6 外观设置页（2026-10-01）

顶栏的循环按钮换成正式设置面板（`SettingsPanel.vue`）：**视觉方向**（三张带说明的卡）× **明暗**（亮/暗/跟随系统）× **强调色**（"跟随皮肤" + 7 个预设）。状态逻辑抽成纯函数放 `src/vue/appearance.ts`（`parseAppearance` 逐字段校验、非法回退默认、强调色只收 6 位 hex 以防注入 style；另有 `resolveTheme` / `accentColor`），DOM 应用与 `prefers-color-scheme` 监听在 `useAppearance.ts`，存档 `localStorage['modulo.appearance.v1']`。

实现中被抓到两例，都记在这里避免重犯：
- 模板里写 `a.value.skin` —— `a` 是 setup 返回的 ref，模板已自动解包，运行时直接 `Cannot read properties of undefined`（E2E 打不开面板才发现，单测覆盖不到）。
- 选中态皮肤卡是品牌色实底，说明文字与勾沿用 `--text-3` / `--brand-500` 就成了"蓝底蓝字"，必须随实底翻白。

### 11.7 键盘补完（2026-10-01）

- **空格**切换当前格的选入/移出（与 Shift+点选共用 `toggleSelect`），提示条与 `aria-label` 同步更新。
- **焦点跟随**：格子 ref 注册表 + `focusCell()`；删除后焦点落到**距离最近的**剩余卡片而不是掉回 `body`；方向键移动/缩放后焦点保持在同一张卡（keyed v-for 复用元素，E2E 实测确认）；聚焦时 `scrollIntoView({block:'nearest'})` 把卡片带进视口。
- 批量删除走 `removeSelectedAndRefocus()`，以被删集合中第一张为锚点找最近落点。
- 新增 E2E 断言链：空格选入→取消、移动后焦点不丢、Delete 后 `activeElement` 仍是某张卡。

### 11.8 下一步

1. 多套命名版面 + 导入导出 UI（引擎 `serialize` 已就绪，缺界面）。
2. 卡片内容密度：待办这类卡在高分辨率下内部留白偏多，需要按行数自适应高度。
3. 面板可达性：Esc 可关、遮罩点击可关已具备，还缺焦点陷阱与打开时聚焦。

开发中由测试与取证逼出的三处修正已并入正文：§3.2 的单位口径（逻辑列 vs 物理列）、`findFreeSpot` 在空版面/整列占满时丢失请求 y 的缺陷（回退位改为 `max(maxRow, start)`）、投影取整由 `round` 改 `ceil`（4 列档实测会开出空洞）。
