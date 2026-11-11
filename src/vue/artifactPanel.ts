/**
 * 右栏产物面板的判定层（F-15 P0，契约 `docs/design/F-15-AGENT-UI.md` §1.2）。
 *
 * 为什么单独成文件：本仓**没有组件测试设施**（无 @vue/test-utils、无 jsdom），
 * 判定逻辑留在 `.vue` 里就只剩 E2E 一层兜底，而 E2E 跑不了"宽度夹取的四条边界"
 * 这种密集体力活。抽出纯函数之后，「拖到 200 该落到 320」「坏存档该回落到 420」
 * 这类判定能在 node 里逐条断言（`tests/vue/artifactPanel.test.ts`）。
 *
 * 四条口径（都写死在下面，不许在组件里另算一遍）：
 * 1. **宽度**：默认 420，拖拽夹在 [320, 720]。夹取对**任何**输入都给得出合法值 ——
 *    存档被手改成 `1e9` / `-1` / `"abc"` / `NaN` 时不能让面板消失。
 * 2. **对话区保底 480**：面板再宽也不许把对话压到读不动（契约 §1.2 末句）。
 *    所以真正生效的宽度是 `min(想要的宽度, 可用宽 − 480)`。
 * 3. **窄屏（< 1100）改成浮层**：此时面板**不占列宽**（`width = 0`），
 *    展开与否由组件里那个**不落盘**的 `overlayOpen` 决定 —— 它属于"这一次看了一眼"，
 *    不该跨启动记住（契约说的是"默认折叠"，不是"记住窄屏展开过"）。
 * 4. **落盘只存三样**：宽度 / 折叠 / 当前视图。键名进 `DATA_KEYS`，
 *    漏登记的症状不是报错，是"拖完了、重启回到 420"。
 */

/** 落盘键。**必须登记进 `fileStorage.ts` 的 `DATA_KEYS`**，否则桌面端 `get` 恒为 null */
export const ART_DOC_KEY = 'modulo.artifactpanel.v1'

export const ART_WIDTH_DEFAULT = 420
export const ART_WIDTH_MIN = 320
export const ART_WIDTH_MAX = 720

/** 窄屏阈值：低于它右栏不再挤压对话，改成底部浮层 */
export const ART_NARROW = 1100

/** 面板展开时对话区的最小可读宽度（契约 §1.2：展开时对话区不重排到不可读） */
export const ART_CHAT_MIN = 480

/**
 * 「画布」视图的最低面板宽度（2026-11-11 真浏览器实测后加）。
 *
 * 为什么要有这条：`CanvasEditor` 的 `.editor` 是 `220px minmax(0, 1fr)` ——
 * 左边一列模块库固定 220px，右边才是画布；它收成上下堆叠的那条断点
 * （`@media (max-width: 992px)`）**看的是视口宽，不是自带宽**，所以在 1600 的窗口里
 * 把编辑器塞进 420 的右栏，库照样占 220、画布只剩 ~170px —— 12 个逻辑列每列 14px，
 * 卡片全糊在一起（截图实测）。640 是"画布还剩 ~400px"的下限。
 *
 * 低于它不渲染 `CanvasEditor`，改成一句可操作的说明（右栏拉到 680）。
 * 硬把一个坏界面摆出来比不摆更糟 —— 与"未实现的能力不显示假按钮"同一条纪律。
 *
 * 真正的修法是让 `.editor` 认**容器宽**（`@container`）而不是视口宽，那要动
 * `CanvasEditor.vue` 的样式归属，属于下一笔（已写进交付说明，不在 P0 里悄悄做）。
 */
export const ART_CANVAS_MIN = 640

/** 画布视图在这个宽度下画得出东西吗（组件与提示按钮共用这一条判定） */
export function canvasFits(bodyWidth: number): boolean {
  return bodyWidth >= ART_CANVAS_MIN
}

/** 「拉宽到能看画布」的一步到位宽度（`ART_CANVAS_MIN` + 一点余量，仍受 720 上限约束） */
export const ART_CANVAS_SUGGEST = 680

/** 右栏三种产物视图 —— 各自对应一个**现有**组件，不新写渲染器 */
export type ArtifactView = 'layout' | 'canvas' | 'stack'

/**
 * 分段控件的三个选项。顺序是"最常看的在最左"：版面是 agent 的默认产出，
 * 画布 / 堆叠是两种编排视角，用户很少一进来就要它们。
 */
export const ARTIFACT_VIEWS: readonly { id: ArtifactView; label: string; hint: string }[] = [
  { id: 'layout', label: '版面', hint: '按现在的宽度投影出来的版面（就是一个普通的工作台视图）' },
  { id: 'canvas', label: '画布', hint: '按格拖拽的编辑器：能改就说明它在真改版面，Ctrl+Z 撤得掉' },
  { id: 'stack', label: '堆叠', hint: '窄宽度的编排视图：上下移动、改高度、换形态' },
]

export interface ArtState {
  width: number
  collapsed: boolean
  view: ArtifactView
}

export const ART_DEFAULT_STATE: ArtState = {
  width: ART_WIDTH_DEFAULT,
  collapsed: false,
  view: 'layout',
}

/**
 * 宽度夹取。**任何**输入都返回合法宽度：
 * 非有限数（`NaN` / `Infinity` / 非 number）回落默认值，其余四舍五入后夹进 [320, 720]。
 * 不抛错、不返回 NaN —— 它喂给的是 `style.width`，一个 NaN 会让整列消失。
 */
export function clampArtWidth(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return ART_WIDTH_DEFAULT
  return Math.min(ART_WIDTH_MAX, Math.max(ART_WIDTH_MIN, Math.round(n)))
}

export function isArtifactView(v: unknown): v is ArtifactView {
  return v === 'layout' || v === 'canvas' || v === 'stack'
}

/**
 * 读存档。**逐字段回落**而不是"整份坏了就全默认"：
 * 用户手改坏一个 `view` 不该连带丢掉他拖了半天的宽度。
 * 坏 JSON / 非对象 / 缺键一律当作"这一格没写"。
 */
export function parseArtState(raw: string | null): ArtState {
  if (!raw) return { ...ART_DEFAULT_STATE }
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return { ...ART_DEFAULT_STATE }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ...ART_DEFAULT_STATE }
  const o = doc as Record<string, unknown>
  return {
    width: clampArtWidth(o.width),
    collapsed: o.collapsed === true,
    view: isArtifactView(o.view) ? o.view : ART_DEFAULT_STATE.view,
  }
}

export function serializeArtState(s: ArtState): string {
  return JSON.stringify({ width: clampArtWidth(s.width), collapsed: s.collapsed, view: s.view })
}

/** 窄屏：面板改为浮层，不挤压对话 */
export function isNarrow(winW: number): boolean {
  return winW < ART_NARROW
}

export interface ArtLayoutInput {
  /** 窗口宽（判窄屏） */
  winW: number
  /** 对话那一行真正可用的宽度（判"对话区保底 480"） */
  available: number
  state: ArtState
  /** 窄屏下"这一次打开了吗" —— **不落盘**，见文件头第 3 条 */
  overlayOpen: boolean
}

export interface ArtLayout {
  narrow: boolean
  /** 面板占的列宽；0 = 不占地方（折叠，或窄屏走浮层） */
  width: number
  /** 是否以浮层（而不是右栏）呈现 */
  overlay: boolean
}

/**
 * 由「窗口宽 + 可用宽 + 存档 + 浮层开关」算出这一帧的摆法。
 *
 * 宽屏：折叠 ⇒ 0；展开 ⇒ `min(夹取后的宽度, 可用宽 − 480)`，下限 0
 * （可用宽小到连 480 都保不住时宁可不显示，也不把对话压成一条缝）。
 * 窄屏：永远 0 列宽，展开与否交给浮层开关。
 */
export function artLayout(i: ArtLayoutInput): ArtLayout {
  const narrow = isNarrow(i.winW)
  if (narrow) return { narrow, width: 0, overlay: i.overlayOpen }
  if (i.state.collapsed) return { narrow, width: 0, overlay: false }
  const room = i.available - ART_CHAT_MIN
  const width = Math.min(clampArtWidth(i.state.width), room)
  return { narrow, width: Math.max(0, width), overlay: false }
}
