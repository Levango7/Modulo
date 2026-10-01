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

一个 key 一个存储单元，全部走同一个同步的 `StorageAdapter` 接口（`store.ts` 里定义），实现按宿主切换：

| key | 内容 |
|---|---|
| `modulo.layout.v1` | 当前版面 `LayoutDoc`（`schemaVersion: 1`） |
| `modulo.schemes.v1` | 命名方案册 |
| `modulo.carddata.v1` | 便签文本 / 待办 / 速记 |
| `modulo.appearance.v1` | 皮肤 × 明暗 × 强调色 |
| `modulo.shell.v1` | 桌面壳开关（关闭是否收进托盘） |

- **网页版**：`localStorage`。
- **桌面壳**：`%APPDATA%\app.modulo\data\<key>.json`，一个 key 一个文件，整个目录拷走就是备份。由 `read_doc`/`write_doc` 两条命令实现（`src-tauri/src/storage.rs`）。
  - **原子写**：先写同目录临时文件再 `rename`。直接截断写会在崩溃/断电时留下半份 JSON，而这个文件就是用户的全部版面。
  - **同一个 key 的写强制排队**（`serialize()`）：两次并发写会共用同一个临时文件名，前一次还没 rename 就被后一次截断，落盘的可能是两份内容拼起来的半份。串行化做在 `createFileStorage` 内部，调用方忘不掉。
  - **文件名走白名单**：只允许小写字母/数字/`.`/`_`/`-`，且不许以点开头或含连续点，再统一加 `.json`。挡掉 `/` `\` `:` 就出不了数据目录。这条是 Rust 侧单测锁的。
  - **写失败会挂在界面上**（`storage.error` 顶出一条红框）。静默失败的存储迟早会变成"我明明存了"的数据丢失。
  - 存储适配器是**同步**接口而写文件是异步的，所以启动时一次性 hydrate 成内存镜像，之后 `get` 读镜像、`set` 立刻异步写穿。**不做防抖**：拖拽只在 `pointerup` 提交一次，写频率就是用户动作频率。
  - 首次启动会把桌面壳早期只存在 WebView2 localStorage 里的数据搬进文件；迁移单向，磁盘已有内容时以磁盘为准，避免旧 localStorage 覆盖新数据。
- 读取一律过 `validate.ts` / `parseBook`：校验 id/整数坐标、按形态 min 钳制、标题 trim+截断、失效 variant 归一，再从上往下扫描逐项消解重叠（x-hub 这套"不信任盘上数据"的做法照抄思路、码重写）。
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

### 10.2 多选与真实交互实测（`evidence/interact.json`，脚本 `scripts/interact.mjs`）

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

### 10.3 验证固化进 CI（2026-10-01）

上面那些交互断言原来只是我手动跑的脚本，等于没有防线。现在：

- `tests/e2e/layout.spec.ts` —— 5 条真浏览器断言（vitest + puppeteer-core 驱动系统 Chrome，CI 上走 `CHROME_PATH=/usr/bin/google-chrome`）：三档视口的列数/溢出/裁字/最小字号、编辑器可聚焦格 >0、方向键移动 + Ctrl+Z 回退、框选→成组拖拽→整体撤销、390px 自动堆叠模式、拖拽全程零 console 报错。
- `vitest.e2e.setup.ts` 用 vite 的 `build()` + `preview({port:0})` 起随机端口，避免与本机其它 dev server 抢端口。
- `npm run verify` = typecheck（`tsconfig.json` 严格无 DOM + `tsconfig.e2e.json` 带 DOM，分层：产品代码拿不到 `document`）→ 单测 → 构建 → E2E。`.github/workflows/ci.yml` 就按这四步跑。
- 首批 CI 落地时的本地实测：103 单测 + 5 E2E 全绿，E2E 约 43s（含构建）；此后各轮持续增补，当前规模看 README。

对照 §1 那条事实——x-hub 写了 164 个 Rust 测试但 CI 只跑 `vue-tsc + cargo check`，一个测试都不执行——这条 CI 是它的反面教材，不是可选项。

### 10.4 按需整理 tidy（2026-10-01 已实现）

`src/engine/tidy.ts`：单趟"上+左"重力聚拢，锁定项不动、其余绕开它落位，兜底放到 `maxRow` 之下（那一行必然空闲）。两个实现细节是被测试逼出来的：

1. **两趟分开聚拢（先左后上）会造出重叠** —— 找不到空位时"原样返回"就撞上了前一趟已挪动过的卡片。随机版面性质测试抓到后改成单趟联合扫描。
2. **单次整理可能让版面更高**（推荐布局实测 11 行 → 12 行：左聚把窄卡挤到下一列，通栏只能再往下落）。改为同时算"仅上聚"与"上+左聚"两个候选取更矮者，并**迭代到不动点**保证幂等。现在有两条硬保证：`usedRows` 只会变小不会变大（200 组随机版面断言）、tidy 两次等于一次。

工作台与编辑器共用顶部「整理」按钮；撤销/重做同时上移为**全局**键盘能力（E2E 抓到过：在工作台点整理后按 Ctrl+Z 无效，因为监听只挂在编辑器组件上）。

诚实边界：整理能把 11 行压到 9 行、消除纵向空档，但**不会让版面"看起来满"**——5 张卡在 12 列里仍会留下中部横向空白（见 `evidence/tidy-before.png` / `tidy-after.png`）。要真正解决稀疏感，需要的是"按可用宽度重新分配卡片宽度"的模式，属于视觉/排版策略层，由 §10.5 的撑满模式接手。

### 10.5 视觉方向与撑满模式（2026-10-01）

**三套 skin 做成正式预设**（用户裁决：都保留，默认 `ink`）：`aurora 柔光`（原状，最接近 x-hub）/ `ink 墨纸`（高对比、无渐变、小圆角、等宽数字）/ `candy 亮彩`（暖底饱和、20px 大圆角、厚实落影）。全部只覆盖令牌层，组件零改动；另加**模块身份色** `--mod`（按 `data-module` 给表头图标上色，跨 skin 复用）。选择存 `localStorage['modulo.skin']`，顶栏「外观」循环切换。同数据截图：`evidence/skin-{aurora,ink,candy}{,-editor}.png`。

**撑满模式**（`src/engine/spread.ts`）：按**顶边 y 相同**的行分组（组内须两两横向不相交），按原比例放大到铺满 12 列。四条约束：只变宽不变窄（所以形态 `minW` 天然继续成立）、含锁定项的行跳过、放大后与组外卡片相撞则整行放弃、`spreadLayout = fillRows(tidyLayout(doc))`。效果见 `evidence/ink-default.png` → `ink-spread.png`：中部空洞消失。

一个设计错误被 E2E 抓出来：第一版按"传递性行带"分组，但真实版面里卡片纵向错位，保守的相交检查直接跳过整组，**撑满完全没生效**（覆盖率断言停在 0.65）。改成按顶边分行后才对。

**撤销/重做上移为 App 级全局键盘能力**：原本只挂在编辑器组件上，在工作台点「整理」后按 Ctrl+Z 无效 —— E2E 抓到，属于"键盘可达"这条卖点上的真实漏洞。

### 10.6 外观设置页（2026-10-01）

顶栏的循环按钮换成正式设置面板（`SettingsPanel.vue`）：**视觉方向**（三张带说明的卡）× **明暗**（亮/暗/跟随系统）× **强调色**（"跟随皮肤" + 7 个预设）。状态逻辑抽成纯函数放 `src/vue/appearance.ts`（`parseAppearance` 逐字段校验、非法回退默认、强调色只收 6 位 hex 以防注入 style；另有 `resolveTheme` / `accentColor`），DOM 应用与 `prefers-color-scheme` 监听在 `useAppearance.ts`，存档 `localStorage['modulo.appearance.v1']`。

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

引擎层 `src/engine/schemes.ts` 是纯函数方案册：`createScheme / renameScheme / updateScheme / removeScheme / parseBook / mergeBooks / bookToJson`，上限 24 套、名称 trim+截断到 32、重名自动加序号。`parseBook` 对**每一条**方案跑 `sanitizeItems`（未知模块剔除、尺寸钳到形态最小值、重叠让位），空方案丢弃并留 warning，`activeId` 指向不存在的方案时归空；`mergeBooks` 保证导入不覆盖用户已有方案（id 与名称各自加后缀）。10 条单测覆盖。

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

### 10.12 下一步

1. ~~收紧与整理要不要合成一键「紧凑」~~ → **已加**：`compact() = fitContent() + store.tidy()`，原子按钮全部保留。刻意**不做成一步历史**，仍是两步 —— 撤销可以只退回其中一半，E2E 锁住了这一点（紧凑后 11 行→8 行，两次 Ctrl+Z 回到 11 行）。
2. ~~方案册 UI 的缺口：暂无"新建空白方案"与拖拽排序~~ → **已补**：`createBlankScheme` + `moveScheme` 两个纯函数，UI 上给「新建空白」按钮、拖把手排序、`Alt+↑/↓` 键盘排序。
   顺带修掉一个会咬人的规则：`parseBook` 原来对 `items` 为空的方案直接丢弃，于是**用户刚建的空白方案会在下次启动时被悄悄吃掉**。现在区分两种空 —— doc 本来就空（合法，保留）vs 有内容但清洗后一条不剩（外来数据里的未知模块，仍然丢弃并给 warning）。
3. ~~数据落地：localStorage → 数据根目录下的 JSON~~ → **已做**，见 §7 与 §11.3。

---

## 11. 桌面壳（第二轮，2026-10-01）

Tauri 2 最小壳：`src-tauri/` 只声明一个主窗口（1280×800，最小 380×560，居中、可缩放），能力只申请 `core:default`（§11.3 起补了四条窗口动作），**不申请文件、shell、通知权限**。前端一行没改就能跑，因为壳只是把已有的 web 构建装进 WebView2。

**构建与运行已实测**：`npx tauri build --no-bundle` 在注入 MSYS2 PATH 后 5m09s 完成，产物 `src-tauri/target/release/modulo.exe` **5.42 MB**；启动后窗口标题为 `Modulo`、进程稳定存活（验证完即关闭）。未打安装包（NSIS 需要联网下载打包工具，留到发布那一轮）。

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

标题栏只在 `isDesktop` 为真时渲染 —— 网页版和 E2E 完全不受影响，`npm run verify` 的 14 条 E2E 仍然是原样通过的。

一个容易踩的布局坑：标题栏不能塞进 `.shell`，因为 `.shell` 有 16px 内边距，标题栏会浮在窗口中间。改成外面套一层 `.app`（flex column），`.shell` 从 `height: 100%` 换成 `flex: 1; min-height: 0`。

**托盘**：`TrayIconBuilder`（要开 tauri 的 `tray-icon` feature）。左键双击唤出/隐藏，右键出菜单（显示/隐藏、窗口置顶、退出）。刻意 `show_menu_on_left_click(false)` —— 否则单击就弹菜单，双击永远触发不了。图标用 `default_window_icon()`，不额外引 `image` feature。

**全局快捷键**：`tauri-plugin-global-shortcut`，`Alt+Shift+M` 唤出/隐藏、`Alt+Shift+T` 置顶。**逐个注册而不是批量**：插件的 `Builder::with_shortcuts` 在 setup 里 `?` 上抛，一个组合键被别的程序占用就会让整个应用启动失败（`run()` 直接 panic 成"Modulo 启动失败"）。改成在 `setup` 里自己 `register()` 并吞掉错误。

注册失败本身是静默的，只在 stderr 打一行等于没有 —— 所以把结果存进状态、开一个 `global_shortcuts` 命令给设置页显示「已注册 / 被占用」。快捷键文案也因此只有一份（Rust 侧），前端不再抄一遍常量。

**「点关闭」默认是退出，不是收进托盘**：Windows 会把新出现的托盘图标塞进溢出浮层，默认藏进去等于把用户关在门外。设置页里有开关可以改成收进托盘，持久化在前端 localStorage，启动时推给 Rust（Rust 侧不落地）。

**权限收紧**：能力清单从只写 `core:default` 改成显式补四条（`allow-minimize / allow-toggle-maximize / allow-close / allow-start-dragging`）—— `core:window:default` 其实只有只读 getter，自制标题栏的按钮一个都不在里面。同时**刻意不给** `allow-create` / `allow-destroy`：x-hub 代价最高的那批 WebView2 bug 都在运行期建窗/销毁窗上，这里用权限层把它堵死，而不是靠口头约定。

**真机自检（`npm run desktop:probe`，30/30）**：不模拟鼠标 —— `SetCursorPos` 会抢走用户真实的指针和焦点，点错地方赔不起。改成给 WebView2 开远调端口（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port`），用 CDP 在页面里点**真实的 DOM 按钮**，再从 Win32 侧读窗口状态，走的是同一条代码路径。已验证：无边框标题栏渲染且带拖拽区、三个按钮都能点、最小化真的进图标态（`rect` 变成 -32000 那个经典值）、最大化铺满工作区、再点回原尺寸、`WS_THICKFRAME` 样式位仍在（所以边缘可拉伸）、托盘图标直接可见没被收进溢出浮层、收进托盘开关两个方向都生效。

原先说「三件事自动化够不着」，现在只剩一件。**双击拖拽区最大化**改成派发真的 `mousedown(detail=2)`（走 drag.js 而不是自己的 dblclick），顺带把「标题文字、Logo 都算拖拽区」一并断言了。**`Alt+Shift+M` 在系统层面真的触发**则借 `WScript.Shell.SendKeys('%+m')`：SendInput 进的是系统输入队列，`RegisterHotKey` 能收到 —— 按两次、看窗口收起再回来，全程不碰物理键盘。剩下**拖标题栏移动窗口**仍需人手确认：`start_dragging` 会进 Windows 的原生模态拖动循环，合成鼠标事件撑不起这个循环。

写这个探针时踩到一个坑值得记下来：`.NET` 的 `Process.MainWindowHandle` 在窗口最小化期间会漂到一个 6×6 的辅助窗口上，于是 `IsIconic` 永远读到 false —— 每次重新查句柄的写法会把「真的最小化了」误报成「没有」。必须第一次拿到 hwnd 后钉死回传。

开发中由测试与取证逼出的三处修正已并入正文：§3.2 的单位口径（逻辑列 vs 物理列）、`findFreeSpot` 在空版面/整列占满时丢失请求 y 的缺陷（回退位改为 `max(maxRow, start)`）、投影取整由 `round` 改 `ceil`（4 列档实测会开出空洞）。
