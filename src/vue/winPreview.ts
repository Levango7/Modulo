/**
 * 窗口预览（WinViewCard）的**纯逻辑**：档位夹取、列表过滤、标题截断、停止原因人话、
 * 帧字节归一化与魔数识别。这里不碰 DOM / Tauri，能在 node 环境直接断言。
 *
 * 为什么把「帧字节的归一化与识别」放在这一层而不是卡片里：卡片只留「建 Blob、换
 * objectURL」这类必须碰 DOM 的胶水；而识别（魔数）与归一化（通道可能来的三种形态）
 * 是**会撒谎**的判定 —— 认错了会把整帧丢进 `application/octet-stream`，浏览器
 * 就不再解码，表现为一块永远不更新的黑，所以必须有测试钉住。
 */

/**
 * 一行可预览窗口。与 Rust `src-tauri/src/capture/winlist.rs` 的 `WindowInfo` 同形
 * （serde `rename_all = "camelCase"`）。
 */
export interface WinInfo {
  /**
   * 窗口句柄（HWND）。Rust 侧声明为 `isize`（`winlist.rs:28` 把 HWND 裸指针转成
   * `isize`；`preview.rs:87` 的入参也是 `isize`），serde 把 `isize` 序列化成
   * **JSON number**，所以 JS 端拿到的是 number 而不是字符串。
   * Windows 的 HWND 是内核句柄表下标，值通常在几十万到几百万量级，远小于
   * `Number.MAX_SAFE_INTEGER`（2^53 ≈ 9e15），因此按 number 处理无精度风险。
   * 若后端哪天改成高地址指针值（> 2^53）就必须改成字符串传输 —— 见本文件同名注释。
   */
  hwnd: number
  title: string
  /** 进程镜像名，如 notepad.exe；取不到为空串（Rust 不编名字） */
  process: string
  pid: number
  rect: { x: number; y: number; w: number; h: number }
  /** 已最小化：无法捕获，不能起预览（Rust `win_preview_start` 会直接人话报错） */
  isMinimized: boolean
  /** 受系统保护（WDA_MONITOR / WDA_EXCLUDEFROMCAPTURE）：能起预览，但 WGC 只出黑帧 */
  isProtected: boolean
}

/** fps 合法档位。Rust `preview_geom.rs` 的合法区间是 1–15，这里只给建议档。 */
export const FPS_TIERS = [5, 10, 15] as const
export type FpsTier = (typeof FPS_TIERS)[number]
/** 默认帧率档 */
export const FPS_DEFAULT: FpsTier = 10

/** maxWidth 合法档位。Rust 侧区间 320–1920，只缩不放。 */
export const WIDTH_TIERS = [640, 960, 1280] as const
export type WidthTier = (typeof WIDTH_TIERS)[number]
/** 默认宽度封顶档 */
export const WIDTH_DEFAULT: WidthTier = 960

/** 列表里标题的截断长度 */
export const TITLE_MAX = 42

/**
 * 夹取 fps：**非法值一律回落默认档**，不做"就近取档"。理由与后端不同 ——
 * 后端 `clamp_fps` 要兜住任意 u8，前端只需保证发出去的一定是合法档；
 * 就近取档会把 `7` 静默变成 `5`，界面显示的档与实际不符，那才是骗人。
 * 注意：**永不返回 0** —— 0 会被后端当成"缺省"再落回它自己的 6fps 默认档，
 * 与界面显示的档就对不上了。
 */
export function clampFps(value: unknown): FpsTier {
  return (FPS_TIERS as readonly unknown[]).includes(value) ? (value as FpsTier) : FPS_DEFAULT
}

/** 夹取 maxWidth：口径同上（非法值回落默认档） */
export function clampMaxWidth(value: unknown): WidthTier {
  return (WIDTH_TIERS as readonly unknown[]).includes(value) ? (value as WidthTier) : WIDTH_DEFAULT
}

/**
 * 过滤窗口：按 `title` 或 `process` 匹配，大小写不敏感。空查询（含纯空白）返回全量副本。
 * 只匹配这两个字段 —— 用户认窗口靠的就是"叫什么、谁开的"，`pid` 与 `hwnd` 不该被
 * 当成搜索词（搜 "1234" 意外命中一堆 pid 是噪音不是功能）。
 */
export function filterWindows(list: readonly WinInfo[], query: string): WinInfo[] {
  const q = query.trim().toLowerCase()
  if (!q) return list.slice()
  return list.filter((w) => w.title.toLowerCase().includes(q) || w.process.toLowerCase().includes(q))
}

/**
 * 截断标题：先把连续空白折成单个空格再 trim（窗口标题里常有 \t 与成串空格，
 * 不折的话截断位置会被空白吃掉），超长则保留 `max-1` 个字符 + 一个省略号，
 * 让结果长度**不超过** `max`（而不是 `max` 个字符再加省略号）。
 */
export function truncateTitle(title: string, max: number = TITLE_MAX): string {
  if (max <= 0) return ''
  const clean = title.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}

/** 会话停止原因词表（契约 enum：user / window-closed / error） */
export type StopReason = 'user' | 'window-closed' | 'error'

/**
 * 停止原因 → 人话。`window-closed` 是唯一需要"解释发生了什么"的一档：
 * 用户没点停止，画面却没了，必须说清是被预览的窗口被关了，而不是卡坏了。
 */
export function stopReasonText(reason: unknown): string {
  switch (reason) {
    case 'user':
      return '预览已停止'
    case 'window-closed':
      return '被预览的窗口已关闭，预览已停止'
    case 'error':
      return '预览出错，已停止'
    default:
      return '预览已停止'
  }
}

/** 窗口状态标记 */
export type WinFlag = 'minimized' | 'protected'

/** 一条窗口身上的标记（顺序固定：最小化在前，因为它是"根本不能预览"的那档） */
export function windowFlags(w: Pick<WinInfo, 'isMinimized' | 'isProtected'>): WinFlag[] {
  const out: WinFlag[] = []
  if (w.isMinimized) out.push('minimized')
  if (w.isProtected) out.push('protected')
  return out
}

/** 标记文案（状态双编码里的"文字"那一半，另一半是图标） */
export function windowFlagText(flag: WinFlag): string {
  return flag === 'minimized' ? '已最小化' : '受保护'
}

/** 标记的解释：为什么标出来 —— 不解释，用户就要对着黑屏猜 */
export function windowFlagHint(flag: WinFlag): string {
  return flag === 'minimized'
    ? '窗口最小化时抓不到画面，先还原窗口再预览'
    : '系统保护内容（视频/隐私窗口等）只能抓到黑帧，这是 Windows 的限制，不是卡片坏了'
}

/** 能否起预览。受保护窗口**可以**起（黑帧照出，卡内说明），最小化窗口不行。 */
export function canPreview(w: Pick<WinInfo, 'isMinimized'>): boolean {
  return !w.isMinimized
}

/**
 * 帧字节的 MIME 判定：**只看魔数，不看约定**。后端虽然现在固定发 JPEG，
 * 但"约定 JPEG"一旦哪天变成 PNG/WebP，靠约定就会把整帧标错类型而静默不渲染。
 * 认不出返回 `application/octet-stream`（会走到 `@error`，比假装是 JPEG 更早暴露）。
 */
export function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  return 'application/octet-stream'
}

/**
 * 把通道来的帧负载归一化成字节。**防御式三分支**：Tauri 文档（`@tauri-apps/api/core.d.ts`
 * 第 73–77 行）说 `InvokeResponseBody::Raw` 以 `ArrayBuffer` 交付，但这是**文档所述**，
 * 我未在桌面壳实跑核验；不同打包路径下也可能是 `Uint8Array`（视图）或 `number[]`。
 * 三种都兼容，空负载 / 认不出的形态返回 null（丢帧而不是渲染垃圾）。
 *
 * 返回类型刻意写成 `Uint8Array<ArrayBuffer>`（TS 5.7 起 `Uint8Array` 按底层缓冲泛型化）：
 * 调用方要把它塞进 `new Blob([...])`，而 `BlobPart` **只收 `ArrayBuffer` 底** ——
 * 视图分支若直接返回 `new Uint8Array(view.buffer, …)`，类型是 `Uint8Array<ArrayBufferLike>`
 * （可能是 `SharedArrayBuffer`），在 `Blob` 那里当场编译不过（实测 `vue-tsc` 报 TS2322）。
 * 修法是**复制一份**：既把类型收紧，也顺手切断"帧还在用、通道已经把底层缓冲改写"的别名风险。
 * 一帧几十 KB，这个拷贝可以忽略（真正的成本在 JPEG 解码那一步）。
 */
export function toFrameBytes(payload: unknown): Uint8Array<ArrayBuffer> | null {
  if (payload instanceof ArrayBuffer) {
    return payload.byteLength > 0 ? new Uint8Array(payload) : null
  }
  if (ArrayBuffer.isView(payload)) {
    const view = payload as ArrayBufferView
    if (view.byteLength === 0) return null
    return new Uint8Array(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  }
  if (Array.isArray(payload)) {
    return payload.length > 0 ? Uint8Array.from(payload as number[]) : null
  }
  return null
}

/** 帧尺寸文案（`960×540`）。量不到（0 / 非有限值）返回空串，界面就别显示这一格。 */
export function formatFrameSize(w: number, h: number): string {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return ''
  return `${Math.round(w)}×${Math.round(h)}`
}
