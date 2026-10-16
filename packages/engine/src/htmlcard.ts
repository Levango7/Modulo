/**
 * HTML 扩展（2026-10-13 批 5 第一半）：用户写一段 HTML 片段，宿主把它放进
 * **沙箱 iframe** 渲染成一张卡。
 *
 * ## 与 x-hub 的差别（写在这里，因为它决定这个模块长什么样）
 *
 * x-hub 的扩展要求"源码目录 + manifest + 构建约定"，开发者门槛在那里。这条路把它压到
 * 最低：**一段 HTML 片段就是一张卡** —— 没有 manifest、没有打包、没有目录约定。
 * 想要更深的（数据读写/文件/通知）那是"桥 API"的事，本层**故意不给**。
 *
 * ## 安全模型（由真实边界决定，不是设计口号）
 *
 * 片段跑在 `sandbox="allow-scripts"` 的 iframe 里，2026-10-13 用真 Chrome 实测：
 * **父级 DOM / 浏览器存储 / cookie 全部 SecurityError 拒绝**（opaque origin），
 * 只有 `postMessage` 这条通道可用。因此：
 * - 宿主**永不**把 cookie / storage / 内部对象交给片段；
 * - 进出的只有 `postMessage`，且**信封要带标记 + 结构要过校验**（`isExtMessage`）——
 *   任意页面都能 postMessage 过来，不校验就等于把随机消息当数据用；
 * - 片段是用户自己写的/自己粘贴的，**信任级别 = "你愿意在浏览器里打开一个文件"**，
 *   这份判断由卡片上的说明与文档承担，不由代码假装能替人做。
 *
 * ## 注入方式：JSON 字符串字面量 + 由宿主转成 DOM，绝不把片段拼进脚本源码旁边
 *
 * 把片段写成 JS 字符串常量再解析，是唯一能同时满足"原样渲染"与"结构上无法提前闭合
 * 外壳脚本"的写法。**注意校验层（`validateSnippet`）刻意不管 `</script>`** —— 最初
 * 在那里拦过，结果把所有带脚本的正常片段全拒了（`<script>…</script>` 本来就该出现那个
 * 字面量）；安全的正确落点是注入方式本身，而不是输入过滤（详见 `validateSnippet` 注释）。
 */
export const MAX_SNIPPET_BYTES = 16_000
/** 卡片上的小标题（也当 iframe 的 title，无障碍） */
export const MAX_HTML_TITLE = 24
/** 一张工作台最多几个自定卡（与其它名单同量级，别让人把备份撑爆） */
export const MAX_HTML_CARDS = 8

export interface HtmlCard {
  id: string
  title: string
  /** 用户写的 HTML 片段（可以含 <style>/<script>），原样保存 */
  html: string
}

export interface SnippetCheck {
  ok: boolean
  /** 不通过时的原因（一句话，直接显示给用户） */
  reason?: string
}

/**
 * 输入校验：给明确原因，不静默改写。
 *
 * **刻意不校验 `</script>`**：片段是完整的 HTML，`<script>…</script>` 是用户写脚本的
 * 标准写法，拦掉它等于"说不让写脚本"（而这张卡的全部价值就是能写）。**注入安全不在这
 * 一层**：片段经 `snippetLiteral` 变成**安全字面量**（`</` 转义为 `<\/`），外壳脚本
 * 在解析层面碰不到片段的任何字节 —— 这是结构性保证，不依赖输入过滤。
 * （早先版本在这里拦过 `</script>`，结果是把所有带脚本的正常片段全拒了 ——
 *  2026-10-13/14 实测踩到，撤回。）
 */
export function validateSnippet(input: string): SnippetCheck {
  const s = input.trim()
  if (!s) return { ok: false, reason: '写点什么吧：一段 HTML 就行（比如 <b>你好</b>）' }
  if (s.length > MAX_SNIPPET_BYTES) {
    return { ok: false, reason: `片段太长（${s.length} 字符，上限 ${MAX_SNIPPET_BYTES}）` }
  }
  return { ok: true }
}

/**
 * 把片段包成一个完整文档。宿主的外壳职责只有三件：
 * 1. 给片段可预期的页底/文字色（跟随主题令牌，`opts` 注入）；
 * 2. 装一层**桥**：宿主把 `init` 消息里的变量交给片段；
 * 3. 用 DOMParser 解析片段并注入 —— `<script>` 需要显式重建才会执行（DOM 规范使然，
 *    这正好让"片段里的脚本"与"外壳脚本"在解析层面彻底分开）。
 *
 * 片段**不需要**自己包 `<html>`；写了也能用（浏览器容错）。
 */
/**
 * 片段的安全字面量：**本卡的注入防线**（引擎里唯一与"渲染"有关的纯逻辑）。
 *
 * `JSON.stringify` 只管引号与反斜杠，**不管 `</`** —— 片段里一个普通的 `</script>`
 * 就能把外壳脚本提前闭合（2026-10-13 实测：注入 IIFE 整段被当文本、卡片空白）。
 * 这里把 `</` 转义成 `<\/`（JS 字符串里等价于 `</`，解析器认不出它是结束标签）。
 *
 * **这一行就是全部防线** —— 它不依赖输入过滤，任何字节进来都出不去。
 * 外壳 HTML 本身（桥与 DOM 注入）在宿主层
 * （`src/app/cards/HtmlCard.vue`）：那是**渲染实现**，引擎保持环境无关
 * —— 纯度守卫会拦宿主环境的全局标识符，那是它的铁律不是建议。
 */
export function snippetLiteral(html: string): string {
  return JSON.stringify(html).replace(/<\//g, '<\\/')
}

/**
 * 桥的入站信封校验。**任何页面都能 postMessage 过来**，所以宿主侧必须：
 * 1. 认定来源就是你那张卡的 iframe（由调用方比对 `event.source`）；
 * 2. 信封带 `__modulo: 'ext'` 标记；
 * 3. `payload` 是可序列化的朴素 JSON（拒绝函数/原型链/环/超大对象）。
 * 三条都过才交给卡片逻辑；否则丢弃。
 */
export function isExtMessage(
  data: unknown,
  fromWindow: unknown,
  expected: unknown,
): data is { __modulo: 'ext'; payload: unknown } {
  if (!data || typeof data !== 'object') return false
  if (fromWindow !== expected) return false
  const d = data as { __modulo?: unknown; payload?: unknown }
  if (d.__modulo !== 'ext') return false
  return plainJson(d.payload, 0)
}

/** 只接受朴素 JSON（深度 ≤ 6、总节点 ≤ 512）—— 不让不可序列化/环状结构进来 */
export function plainJson(v: unknown, depth: number, budget = { n: 0 }): boolean {
  if (depth > 6) return false
  if (++budget.n > 512) return false
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return true
  if (Array.isArray(v)) return v.every((x) => plainJson(x, depth + 1, budget))
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v)
    if (proto !== Object.prototype && proto !== null) return false
    return Object.values(v as Record<string, unknown>).every((x) => plainJson(x, depth + 1, budget))
  }
  return false
}

/** 清洗整份自定卡名单：丢坏的、按上限截、id 撞了顺延（同其它卡片数据的骨架） */
export function sanitizeHtmlCards(
  list: Readonly<{ id?: unknown; title?: unknown; html?: unknown }>[],
): { cards: HtmlCard[]; rejected: number } {
  const cards: HtmlCard[] = []
  const seen = new Set<string>()
  let rejected = 0
  for (const raw of list) {
    if (cards.length >= MAX_HTML_CARDS) break
    if (typeof raw?.html !== 'string') {
      rejected++
      continue
    }
    if (!validateSnippet(raw.html).ok) {
      rejected++
      continue
    }
    let id = typeof raw.id === 'string' && raw.id ? raw.id : `h${cards.length + 1}`
    while (seen.has(id)) id = `${id}_`
    seen.add(id)
    cards.push({
      id,
      title: (typeof raw.title === 'string' ? raw.title.trim() : '').slice(0, MAX_HTML_TITLE) || '自定卡',
      html: raw.html,
    })
  }
  return { cards, rejected }
}
