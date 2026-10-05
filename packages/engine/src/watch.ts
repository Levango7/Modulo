/**
 * 网页监控：一份 https 名单，定期探活。
 *
 * ## 这一版的边界，写在文件头是因为它决定了这张卡能承诺什么
 *
 * 桌面壳会在**桌面侧**发请求（前端 `fetch` 会被 CORS 拦）。一旦有了这条能力，它就成了
 * SSRF 的入口 —— 尤其本应用的 CSP 正是它自己配的，而 CSP 拦不住走 Rust 侧的请求：
 * 页面一旦被 XSS 攻破，就能借这条通道探测内网，而那正是 CSP 唯一想防的事。
 *
 * 所以边界收在最小：
 * - **只允许 https** —— 明文一律拒绝。没有明文信道，也就没有被动嗅探与中间人改包
 * - **IP 字面量落在私有/保留网段就拒绝** —— `169.254.169.254`（云实例元数据端点，
 *   拿到它等于拿到临时凭据）、`127.x`、`10/8`、`172.16/12`、`192.168/16`、`100.64/10`、
 *   `::1`、`fc00::/7`、`fe80::/10`，以及 IPv4-mapped 的绕法
 * - **不跟随重定向** —— 3xx 原样报出，堵掉「公网 URL 302 到内网」这条路径
 * - **只有 URL** —— 无自定义 header、无方法可选、无请求体、不带 Cookie 与 Authorization
 * - **DNS rebinding 不防** —— `evil.com` 解析到 `127.0.0.1` 这种靠域名绕开的，挡不住。
 *   理由：请求本来就是以用户身份发出的，本机任何进程都能做同样的事，边际风险很小；
 *   而真正会被误伤的是「顺手填个内网地址」和「云元数据端点」这两类实际会踩的坑。
 *
 * **代价要说清楚**：因为拒绝私网，这张卡**监控不了自家 NAS / 路由器**。这是刻意的 ——
 * 那是另一个特性、另一套边界，不该顺手塞进来。
 *
 * 这个模块只管「什么 URL 算数」；真正的请求在 `src-tauri/src/net.rs`，那里的判据与这里
 * **必须是同一套**，所以两边都各写了一份并各自单测 —— 前端这份是为了输入时立刻有反馈，
 * Rust 那份才是安全边界（前端能被 XSS 改，Rust 不能）。
 */

/** 一个监控项 */
export interface Watch {
  id: string
  /** 展示名；空则取主机名 */
  label: string
  /** 必须是 https 开头、且主机名不是私有 IP 字面量 */
  url: string
}

export const MAX_WATCH = 12
export const MAX_WATCH_LABEL = 24
export const MAX_URL = 300

/**
 * IPv6 字面量 → 16 字节。展开 `::` 简写、认尾部内嵌的 IPv4。
 *
 * 必须真的展开成字节才能判网段：写 `(head & 0xC0) === 0x80` 那种字符串层面的小算术
 * 会算错 —— `fe80::1` 的第一组是 "fe80"，当成一个数就是 65152 而不是 0xfe，
 * 于是 fe80::/10 整段漏网。所以这里老老实实补齐成 8 组再拆字节。
 *
 * 解析不了就返回 null（调用方据此当成"不是 IP 字面量"）。
 */
export function ipv6Bytes(input: string): number[] | null {
  let s = input.trim().replace(/^\[|\]$/g, '')
  if (!s.includes(':')) return null

  // 尾部内嵌 IPv4（::ffff:127.0.0.1 这种）先转成两组十六进制。
    // 注意 `slice(0, index)` 取到的前缀**已经带着结尾的冒号**（'::ffff:' 而不是 '::ffff'），
    // 再补一个就变成 '::ffff::7f00:1'，双冒号会让后面的展开整个错位。
    const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (v4) {
    const oct = [v4[1], v4[2], v4[3], v4[4]].map((x) => Number(x))
    if (oct.some((n) => n > 255)) return null
    const hi = ((oct[0] << 8) | oct[1]).toString(16)
    const lo = ((oct[2] << 8) | oct[3]).toString(16)
    s = `${s.slice(0, v4.index)}${hi}:${lo}`
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - tail.length
  if (halves.length === 1 && head.length !== 8) return null
  if (halves.length === 2 && fill < 0) return null

  const groups = [...head, ...Array<string>(Math.max(0, fill)).fill('0'), ...tail]
  if (groups.length !== 8) return null

  const bytes: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null
    const n = parseInt(g, 16)
    bytes.push((n >> 8) & 0xff, n & 0xff)
  }
  return bytes
}

/** 私有/保留网段 → 拒绝理由。查不到（公网或域名）时返回 null。 */
export function blockedReason(host: string): string | null {
  const raw = host.replace(/^\[/, '').replace(/\]$/, '')
  if (raw.includes(':')) {
    const b = ipv6Bytes(raw)
    if (!b) return null
    if (b.every((x) => x === 0) || b.slice(0, 15).every((x) => x === 0) && b[15] === 1) {
      return '本机回环'
    }
    // fc00::/7：首字节 fc–fd
    if (b[0] === 0xfc || b[0] === 0xfd) return '唯一本地地址'
    // fe80::/10：首字节必须是 fe，且第二字节高两位为 10（这是 /10，跨了两个字节）
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return '链路本地地址'
    // IPv4-mapped（::ffff:a.b.c.d）要看被映射的那个 v4，否则 ::ffff:127.0.0.1 会漏网
    const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff
    if (mapped) {
      return blockedReason(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`)
    }
    return null
  }

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(raw)
  if (!m) return null
  const [a, b] = [Number(m[1]), Number(m[2])]
  if (a === 0) return '0.0.0.0/8'
  if (a === 10) return '10/8（私有网段）'
  if (a === 100 && b >= 64 && b < 128) return '100.64/10（CGNAT）'
  if (a === 127) return '127/8（本机回环）'
  if (a === 169 && b === 254) return '169.254/16（含云实例元数据端点）'
  if (a === 172 && b >= 16 && b < 32) return '172.16/12（私有网段）'
  if (a === 192 && b === 168) return '192.168/16（私有网段）'
  if (a === 192 && b === 0) return '192.0.0/24'
  if (a === 198 && (b === 18 || b === 19)) return '198.18/15（基准测试网段）'
  if (a === 198 && b === 51) return '198.51.100/24（文档示例网段）'
  if (a === 203 && b === 0) return '203.0.113/24（文档示例网段）'
  if (a >= 224 && a <= 239) return '组播地址'
  return null
}

/**
 * `scheme://[userinfo@]host[:port][/path][?query][#frag]`
 *
 * **自己解析而不用 `new URL`**：引擎的 tsconfig 只放 `lib: ["ES2022"]`，**不放 DOM 是
 * 刻意的**（见该文件注释）—— 一旦碰 `URL` 或任何浏览器全局对象，`npm run engine:build`
 * 就编译不过。顺带一提：`tests/engine-purity.test.ts` 是用正则扫源码的，所以**连注释里
 * 提到那些名字都会红**（本行当年就因此改过一次措辞）。
 * `links.ts` 当年也是因为这个才用正则的，这里保持一致。
 */
const URL_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?[^#]*)?(?:#.*)?$/i

/** 从 authority 里取出 host。IPv6 字面量带方括号，要连括号一起摘掉。 */
function hostOf(authority: string): { host: string; port: string | null } {
  const noUserinfo = authority.split('@').pop() ?? authority
  if (noUserinfo.startsWith('[')) {
    const end = noUserinfo.indexOf(']')
    if (end < 0) return { host: noUserinfo.slice(1), port: null }
    const after = noUserinfo.slice(end + 1)
    return { host: noUserinfo.slice(1, end), port: after.startsWith(':') ? after.slice(1) : null }
  }
  const i = noUserinfo.indexOf(':')
  return i < 0 ? { host: noUserinfo, port: null } : { host: noUserinfo.slice(0, i), port: noUserinfo.slice(i + 1) }
}

/**
 * 认一个监控 URL。返回 null 表示不收。
 *
 * 补齐规则：用户敲 `example.com` 是常态，所以无 scheme 的输入按 `https://` 补。
 * 但**只收 https** —— 不会像快捷链接那样放行 http/mailto/ftp：那张卡只是复制一段文字，
 * 这张卡会让程序真的去请求它。
 */
export function normalizeUrl(input: string): string | null {
  const s = input.trim()
  if (!s || s.length > MAX_URL) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    // 显式给了 scheme：只认 https，其余（http/ftp/file/javascript:）一律拒
    if (!/^https:/i.test(s)) return null
  } else if (/\s/.test(s)) {
    // 没给 scheme：可能被冒用成 `evil.com\t@127.0.0.1` 这种，所以拒绝任何空白字符
    return null
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
  const m = URL_RE.exec(withScheme)
  if (!m) return null
  if (m[1].toLowerCase() !== 'https') return null

  const { host, port } = hostOf(m[2])
  if (!host) return null
  if (port !== null && (!/^\d{1,5}$/.test(port) || Number(port) > 65535)) return null
  // userinfo（https://user:pass@host/）会把凭据带进备份，也会让主机名看起来像别的东西
  if (m[2].includes('@')) return null
  if (blockedReason(host)) return null

  // 片段（#section）对探活毫无意义，去掉，省得备份里存一堆没用的锚点
  const out = `https://${host}${port ? `:${port}` : ''}${m[3] || '/'}`
  return out.length <= MAX_URL ? out : null
}

export function normalizeWatchLabel(input: string, url: string): string {
  const t = input.trim().slice(0, MAX_WATCH_LABEL)
  if (t) return t
  const m = URL_RE.exec(url)
  const host = m ? hostOf(m[2]).host : ''
  return (host || '未命名').slice(0, MAX_WATCH_LABEL)
}

/**
 * 清洗整份名单。
 *
 * **顺带做边界 5**：导入别人的备份时，名单里可能夹带私网地址 —— 那些条目在这里
 * 直接丢掉，而不是等到探活时才失败（那会变成「一条条报错」，看不出是被挡了）。
 * 丢掉的数量由调用方回显，用户才知道自己的备份里有过什么。
 */
export function sanitizeWatch(
  list: Readonly<{ id?: unknown; label?: unknown; url?: unknown }>[],
): { watch: Watch[]; rejected: number } {
  const out: Watch[] = []
  const seen = new Set<string>()
  let rejected = 0
  for (const raw of list) {
    if (out.length >= MAX_WATCH) break
    if (typeof raw?.url !== 'string') {
      rejected++
      continue
    }
    const url = normalizeUrl(raw.url)
    if (!url) {
      rejected++
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    out.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : url,
      label: normalizeWatchLabel(typeof raw.label === 'string' ? raw.label : '', url),
      url,
    })
  }
  return { watch: out, rejected }
}