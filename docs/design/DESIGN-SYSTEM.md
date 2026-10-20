# 设计系统（图样层）

> 本文描述**已经存在**的视觉语言与组件约束，并标出补齐项。所有数值以
> `src/tokens/tokens.css` 为准；本文不复述全部令牌，只定规则与缺口。
> 状态：v0.1（2026-10-20 校准）。关联：[信息架构](INFORMATION-ARCHITECTURE.md) · [功能规格](FUNCTIONAL-SPEC.md)

## 1. 令牌体系

组件**一律引用变量，禁止硬编码色值**（`tokens.css` 文件头已写明）。

| 类别 | 令牌 | 值 / 规则 |
|---|---|---|
| 品牌色 | `--accent`、`--brand-50/500/600`、`--brand-glow` | 每皮肤各自定义；`brand-50` 是"很淡的一层品牌色"，**暗色下必须朝背景混色**（见 §4） |
| 文字 | `--text-1/2/3/4` | 1 正文、2 次要、3 弱化、4 辅助；3 与 4 不得承担正文职责 |
| 背景 | `--bg-page`、`--bg-card`、`--bg-card-solid`、`--bg-card-soft`、`--input-bg` | 卡片默认半透明（`--bg-card`），需要不透明时用 `--bg-card-solid` |
| 表面 | `--frost-surface`、`--frost-edge` | 玻璃感表面由径向渐变 + 内高光构成，不额外叠 `backdrop-filter` 以外的效果 |
| 边框 | `--border-soft`、`--border-strong` | 分割线用 soft；可交互边界用 strong |
| 遮罩 | `--scrim` | 模态与浮层 |
| 语义色 | `--c-green/red/amber/blue/purple` | **只用于状态**（涨跌、告警、成功），不作装饰 |
| 圆角 | `--radius-sm/md/lg/xl/pill` | 8 / 8 / 12 / 16 / 999 |
| 间距 | `--space-1..6` | 4 / 8 / 12 / 16 / 20 / 24；布局间距用 `--gap`（=16） |
| 阴影 | `--shadow-card`、`--shadow-hover`、`--shadow-focus` | `--shadow-focus` 是**焦点环保留字**，键盘可见性依赖它 |
| 层级 | `--z-base/sticky/overlay/menu/modal/toast` | 0 / 10 / 100 / 110 / 120 / 200；不得写死数字 |
| 动效 | `--dur-micro` 150ms、`--dur-pop` 200ms、`--ease-out` | 只用于状态过渡与弹出；不做装饰性动画 |

### 缺口（建议补）
- **没有字号/行高档位**：当前只有 `body { font: 13px/1.55 }`。建议加 `--font-xs/sm/md/lg/xl`
  与对应行高，避免卡片各写各的。
- **没有间距的"页面级"令牌**（如页面内边距、卡片内边距），建议补 `--pad-card`、`--pad-page`。

## 2. 三皮肤 × 明暗

| 皮肤 | 特征 | 实现位置 |
|---|---|---|
| **aurora 柔光**（默认） | 苔绿强调、亚麻白底、环境光渐变、玻璃表面 | `:root`（**不建空块**：任何 `[data-skin='aurora']` 规则都会盖掉暗色值） |
| **ink 墨纸** | 高对比、无渐变、小圆角、单色强调 | `[data-skin='ink']` + `[data-skin='ink'][data-theme='dark']` |
| **candy 亮彩** | 暖底、饱和强调、大圆角、厚实落影 | `[data-skin='candy']` |

规则：
1. 新增皮肤必须同时提供**明暗两套**令牌，且通过对比度矩阵（§4）。
2. 皮肤只改令牌，不改结构；任何"为某皮肤写一条选择器"的例外都要在注释里写明理由。

## 3. 排版与布局

- 字体：`system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`；
  13px / 1.55。中文界面，数字建议用等宽或 `font-variant-numeric: tabular-nums`（时钟、行情、计时器必须）。
- 网格：12 逻辑列，按容器宽度投影 **12 / 8 / 6 / 4 / 1**（`packages/engine/src/breakpoints.ts`）；
  卡片有 min/ideal 尺寸，投影负责降档与不产生碎片卡。
- 断点：<480px 进入堆叠布局；编辑态用列表式。
- 密度：紧凑 / 标准 / 宽松三档与行高联动；"收紧"当前逐卡读 DOM（`useDensity.ts`），
  目标改为按令牌计算，避免布局抖动。

## 4. 对比度与可访问性（已有机器门禁）

`tests/e2e/contrast-matrix.spec.ts` 是**渲染层不变量测试**（真实 Chrome + production build）：

- 矩阵：**3 皮肤 × 明暗 2 主题**；
- 口径：实测 ≥ `max(ABS_FLOOR, 基线 × 0.9)`，`ABS_FLOOR = 1.5`；
- 半透明令牌先按 `--bg-page` 合成再计算；`color-mix()` 用 canvas 落成 8bit sRGB（`visual-kit/measure.ts`）；
- 2026-10-17 的真实漏网：`button:hover`（`--text-1` / `--brand-50`）在暗色下三皮肤实测
  **1.04 / 1.01 / 1.01**，低于 ABS_FLOOR —— 已补 `text-1/brand-50` 配对并修令牌。

**已知低于 WCAG AA 4.5 的两处现状**（门禁按"不退化"守，不强制立刻改）：
1. `candy` 亮色 `accent/bg-page = 2.68`，而 `SettingsPanel.vue` 有把 `--accent` 当文字色的用法；
2. 亮色 `text-3/bg-page ≈ 3.2`（三皮肤一致），若 `text-3` 承担正文职责则不达标。

**待补**：
- 焦点可见性：`--shadow-focus` 已存在，但需要一条"所有可交互元素 `:focus-visible` 必可见"的断言；
- `prefers-reduced-motion` 尚未处理（动效虽少，但应尊重）；
- 键盘陷阱检查（模态 / 浮窗 / 命令面板的焦点归还）。

## 5. 组件状态矩阵

每个可交互组件必须定义六态；当前**没有统一实现**，按组件各写。目标：抽 `useInteractive` 组合式
或统一 class，并给关键组件补状态截图基线。

| 状态 | 视觉 | 约束 |
|---|---|---|
| default | 正常令牌 | — |
| hover | `--shadow-hover` 或底色变化 | 对比度必须过矩阵（本次漏网处） |
| active | 轻微下沉或加深 | 不改变布局尺寸 |
| focus-visible | `--shadow-focus` | 键盘可见，鼠标点击不显示 |
| disabled | `--text-3` + 降透明 | 不得只靠颜色，需 `aria-disabled` |
| loading | 骨架 / 局部 spinner | 不阻塞其他卡片 |

## 6. 文案与图标

- 语言：中文（未做 i18n）。文案风格：短句、动词开头；错误文案必须包含"发生了什么 + 能做什么"。
- 图标：线性图标 + 22×22 命中区（行头按钮已有此约束）。
- 数字：时钟 / 行情 / 计时器一律 `tabular-nums`，避免跳动。

## 7. 设计交付物（建议）

1. `docs/assets/` 保留三张主截图 + 新增：编辑态、设置、命令面板、浮窗、窄屏；
2. 组件状态基线（截图为资产，不进像素比对，只做人审）；
3. 每次改令牌跑 `npm run test:e2e -- contrast-matrix`，并把结果写进 PR。
