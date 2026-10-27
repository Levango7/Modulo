/**
 * 桌面壳最小桩：让网页构建在 headless 里走"桌面形态"（内置测试专用，不是产品代码）。
 *
 * 为什么需要它：脱离浮窗的入口按 `isDesktop`（`'__TAURI_INTERNALS__' in window`）显隐，
 * 而真实窗口创建只在桌面壳里发生 —— 网页构建里桩掉 Tauri 核心，就能把**前端这一段**
 * （按钮 → invoke('float_card') → floats-changed → 投影过滤）在 CI 里真跑一遍。
 * 窗口系统那一半由 Rust 单测与真机验收覆盖。
 */
;(() => {
  const floats = []
  const win = {
    label: 'main',
    isAlwaysOnTop: async () => true,
    setAlwaysOnTop: async () => {},
    startDragging: async () => {},
    close: async () => {},
    show: async () => {},
    hide: async () => {},
    destroy: async () => {},
    setFocus: async () => {},
    onMoved: async () => () => {},
    onResized: async () => () => {},
    onCloseRequested: async () => () => {},
  }
  // —— 事件协议（按 @tauri-apps/api v2 的真实形状实现）——
  // api 的 listen() 会 invoke('plugin:event|listen', { event, handler })，
  // handler 是 transformCallback 注册得到的**数字 id**；事件到达时按 id 找到并调用。
  const callbacks = new Map()
  const eventListeners = new Map()
  let cbId = 1
  const transformCallback = (cb, once) => {
    const id = cbId++
    callbacks.set(id, { cb, once })
    return id
  }
  const unregisterCallback = (id) => callbacks.delete(id)
  const emit = (event, payload) => {
    for (const id of eventListeners.get(event) ?? []) {
      const entry = callbacks.get(id)
      if (!entry) continue
      try {
        entry.cb({ event, payload, id })
      } finally {
        if (entry.once) {
          callbacks.delete(id)
          eventListeners.get(event)?.delete(id)
        }
      }
    }
  }
  const listen = async (event, handler) => {
    const id = transformCallback(handler)
    const set = eventListeners.get(event) ?? new Set()
    set.add(id)
    eventListeners.set(event, set)
    return id
  }
  const unlisten = async (id) => {
    unregisterCallback(id)
    for (const set of eventListeners.values()) set.delete(id)
  }

  // —— WebDAV 网盘桩（2026-10-27，多端同步 E2E）——
  // 「盘」是 localStorage，但前缀与本机数据根**分开**：`__stubdoc.` 是这台机器的数据目录，
  // `__stubdav.` 是远端网盘。混成一个前缀，"远端那份有没有被动过"这类断言就自证不了自己了。
  // 形状对齐 Rust `webdav.rs`，报错文案照 `humanize_status` 抄 —— 测试据此断言的才是
  // 用户真会看到的那句话。**412 走 `{conflict:true}` 而不是异常**：整条链能分清
  // "别的设备抢先写了"和"网络坏了"，前提就是这个形状。
  const DAV_FILE = 'modulo.__stubdav.file.'
  const DAV_ETAG = 'modulo.__stubdav.etag.'
  const DAV_SEQ = 'modulo.__stubdav.seq'
  const DAV_CRED = 'modulo.__stubdav.cred'
  const davCfg = () => {
    try {
      return JSON.parse(localStorage.getItem('modulo.__stubdav.cfg') ?? '{}')
    } catch {
      return {}
    }
  }
  const davNames = () => {
    const out = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? ''
      if (k.startsWith(DAV_FILE)) out.push(k.slice(DAV_FILE.length))
    }
    return out
  }
  const davCred = () => {
    try {
      return JSON.parse(localStorage.getItem(DAV_CRED) ?? 'null')
    } catch {
      return null
    }
  }
  /** 口令核对：内存里那份不对，就只看凭据库里有没有这一对（Rust `resolve_password` 同一条顺序） */
  const davDeny = (user, password) => {
    const cfg = davCfg()
    if (cfg.unreachable) return new Error('连不上网盘：stub 按配置拒绝')
    if (!user) return new Error('用户名不能为空')
    if (password === cfg.password) return null
    const stored = davCred()
    if (password === null && stored && stored.user === user) return null
    return new Error('网盘说口令不对或没有权限（401）')
  }
  const davPut = (name, body, ifMatch) => {
    const current = localStorage.getItem(DAV_ETAG + name) ?? null
    if (ifMatch !== null && ifMatch !== current) return { conflict: true }
    // 「别的设备抢先写了」的确定性模拟：条件写撞上 412，但不改盘上内容。
    // 真环境里这一撞发生在 GET 与 PUT 之间，E2E 没法掐那个瞬间，只能由测试安排。
    const cfg = davCfg()
    if (ifMatch !== null && Number(cfg.conflictPuts) > 0) {
      localStorage.setItem('modulo.__stubdav.cfg', JSON.stringify({ ...cfg, conflictPuts: Number(cfg.conflictPuts) - 1 }))
      return { conflict: true }
    }
    const seq = Number(localStorage.getItem(DAV_SEQ) ?? '0') + 1
    localStorage.setItem(DAV_SEQ, String(seq))
    localStorage.setItem(DAV_FILE + name, body)
    localStorage.setItem(DAV_ETAG + name, `"${seq}"`)
    return { conflict: false }
  }

  const invoke = (cmd, args) => {
    window.__STUB_CALLS__ = window.__STUB_CALLS__ || []
    window.__STUB_CALLS__.push({ cmd, args })
    // 事件插件：listen/unlisten/emit 都经它的命令名进来
    if (cmd === 'plugin:event|listen') return listen(args?.event, callbacks.get(args?.handler)?.cb ?? (() => {}))
    if (cmd === 'plugin:event|unlisten') return unlisten(args?.eventId)
    if (cmd === 'plugin:event|emit') {
      emit(args?.event, args?.payload)
      return Promise.resolve()
    }
    switch (cmd) {
      case 'list_floats':
        return Promise.resolve(floats.slice())
      case 'float_card': {
        const id = String(args?.cardId ?? '')
        if (!floats.some((f) => f.card_id === id)) {
          floats.push({ card_id: id, x: null, y: null, w: Number(args?.defaultW ?? 320), h: Number(args?.defaultH ?? 260) })
        }
        // 广播：主窗订阅了 modulo:floats-changed
        queueMicrotask(() => emit('modulo:floats-changed', floats.slice()))
        return Promise.resolve(true)
      }
      case 'unfloat_card': {
        const id = String(args?.cardId ?? '')
        for (let i = floats.length - 1; i >= 0; i--) if (floats[i].card_id === id) floats.splice(i, 1)
        queueMicrotask(() => emit('modulo:floats-changed', floats.slice()))
        return Promise.resolve(undefined)
      }
      case 'focus_float': {
        // 聚焦是纯窗口操作：改 z 序，**不动登记、不广播**。桩里只需要如实回答"那张窗还在不在"
        // （不在 ⇒ false，前端静默），调用本身由 __STUB_CALLS__ 记账，测试据此断言真的发了命令。
        const id = String(args?.cardId ?? '')
        return Promise.resolve(floats.some((f) => f.card_id === id))
      }
      case 'read_doc':
        return Promise.resolve(localStorage.getItem('modulo.__stubdoc.' + args?.name) ?? null)
      case 'write_doc':
        localStorage.setItem('modulo.__stubdoc.' + args?.name, String(args?.content ?? ''))
        return Promise.resolve(undefined)
      case 'data_dir':
        return Promise.resolve('/stub')
      case 'set_hide_on_close':
      case 'set_shortcut':
        return Promise.resolve(undefined)
      case 'global_shortcuts':
        return Promise.resolve([{ kind: 'summon', keys: 'Ctrl+Shift+Space' }, { kind: 'ontop', keys: 'Ctrl+Shift+T' }])
      // —— 会议速记桩（2026-10-17）：数据由测试经 __STUB_MEETINGS__ / __STUB_TRANSCRIPTS__
      //    预置，形状与 Rust session_store.rs 的 serde camelCase 输出逐字段一致。
      //    删除/摘要**原地改桩数据**：这样「列表徽标回读落盘值」这条前端行为也能被真测 ——
      //    桩数据不变的话，reload 回来的永远是旧值，那条断言就成了摆设。
      case 'meeting_list':
        return Promise.resolve((window.__STUB_MEETINGS__ ?? []).slice())
      case 'meeting_get': {
        const t = (window.__STUB_TRANSCRIPTS__ ?? {})[String(args?.id ?? '')]
        return t
          ? Promise.resolve(t)
          : Promise.reject(new Error('找不到会话 ' + String(args?.id)))
      }
      case 'meeting_delete': {
        const id = String(args?.id ?? '')
        const list = window.__STUB_MEETINGS__
        if (Array.isArray(list)) {
          const i = list.findIndex((m) => m.id === id)
          if (i >= 0) list.splice(i, 1)
        }
        if (window.__STUB_TRANSCRIPTS__) delete window.__STUB_TRANSCRIPTS__[id]
        return Promise.resolve(undefined)
      }
      case 'meeting_summarize': {
        const id = String(args?.id ?? '')
        const t = (window.__STUB_TRANSCRIPTS__ ?? {})[id]
        const summary = (t && t.summary) || '桩摘要：' + id + ' 的要点已生成'
        if (t) t.summary = summary
        const m = (window.__STUB_MEETINGS__ ?? []).find((x) => x.id === id)
        if (m) m.hasSummary = true
        return Promise.resolve({ summary })
      }
      // —— WebDAV 同步命令（形状与 Rust webdav.rs 的 8 条命令一一对应）——
      case 'webdav_probe': {
        const deny = davDeny(String(args?.user ?? ''), args?.password ?? null)
        if (deny) return Promise.reject(deny)
        return Promise.resolve({ status: davCfg().probeStatus ?? 207 })
      }
      case 'webdav_get': {
        const user = String(args?.user ?? '')
        const deny = davDeny(user, args?.password ?? null)
        if (deny) return Promise.reject(deny)
        if (davCfg().getFails) return Promise.reject(new Error('读网盘响应失败：stub 按配置拒绝'))
        const name = String(args?.name ?? '')
        const body = localStorage.getItem(DAV_FILE + name)
        // null = 网盘上还没有这个文件（404）。前端据此走"首次同步"，而不是当成错误
        if (body === null) return Promise.resolve(null)
        return Promise.resolve({ body, etag: localStorage.getItem(DAV_ETAG + name) })
      }
      case 'webdav_put': {
        const user = String(args?.user ?? '')
        const deny = davDeny(user, args?.password ?? null)
        if (deny) return Promise.reject(deny)
        if (davCfg().putFails) return Promise.reject(new Error('写网盘失败：stub 按配置拒绝'))
        return Promise.resolve(
          davPut(String(args?.name ?? ''), String(args?.body ?? ''), args?.ifMatch ?? null),
        )
      }
      case 'webdav_list': {
        const deny = davDeny(String(args?.user ?? ''), args?.password ?? null)
        if (deny) return Promise.reject(deny)
        const cfg = davCfg()
        if (cfg.listFails) {
          // 「下一次 list 失败」用一次就消掉：轮转失败只该记一条 warning，
          // 而"点刷新列表"仍然要能成 —— 否则这两条路径分不开。
          localStorage.setItem(
            'modulo.__stubdav.cfg',
            JSON.stringify({ ...cfg, listFails: Number(cfg.listFails) - 1 }),
          )
          return Promise.reject(new Error('网盘拒绝了这个操作（403）'))
        }
        return Promise.resolve(davNames())
      }
      case 'webdav_delete': {
        const deny = davDeny(String(args?.user ?? ''), args?.password ?? null)
        if (deny) return Promise.reject(deny)
        const name = String(args?.name ?? '')
        localStorage.removeItem(DAV_FILE + name)
        localStorage.removeItem(DAV_ETAG + name)
        return Promise.resolve(undefined)
      }
      // 凭据库：status 只回答"存过没有"，**口令永不回传渲染层**（Rust 侧同一条规矩）
      case 'sync_cred_status':
        return Promise.resolve(localStorage.getItem(DAV_CRED) !== null)
      case 'sync_cred_set':
        localStorage.setItem(
          DAV_CRED,
          JSON.stringify({ endpoint: String(args?.endpoint ?? ''), user: String(args?.user ?? ''), password: String(args?.password ?? '') }),
        )
        return Promise.resolve(undefined)
      case 'sync_cred_clear':
        localStorage.removeItem(DAV_CRED)
        return Promise.resolve(undefined)
      default:
        return Promise.resolve(null)
    }
  }
  const once = (event, handler) => listen(event, handler)
  window.__TAURI_INTERNALS__ = {
    // 注意：应用经 `@tauri-apps/api` 的包装调用的是**这里的 invoke** ——
    // 早期版本我在这里塞了个不带广播的副本，结果 float_card 记了调用却没人收到事件
    // （卡片不从工作台消失）。所有桩行为都必须走上面那一个 invoke。
    invoke,
    transformCallback,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    plugins: { path: { sep: String.fromCharCode(92), delimiter: ';' }, event: { TauriEvent: { WINDOW_RESIZED: 'tauri://resize' } } },
    convertFileSrc: (p) => p,
    os: { platform: () => 'windows' },
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: unlisten }
  window.__TAURI_INTERNALS__.listen = listen
  window.__TAURI_INTERNALS__.once = once
  // 供测试断言：测试发起的"关浮窗"（模拟 Rust 侧广播）
  window.__STUB_UNFLOAT__ = (id) => invoke('unfloat_card', { cardId: id })
  // —— 供网盘同步的用例直接摆弄"远端"（绕开前端，才能断言前端真的读的是盘而不是内存）——
  /** 模拟**另一台设备**直接往网盘写一份：无条件写 + ETag 前进，于是本机那次条件写该撞 412 */
  window.__STUB_DAV_WRITE__ = (name, body) => davPut(String(name), String(body ?? ''), null)
  window.__STUB_DAV_ETAG__ = (name) => localStorage.getItem(DAV_ETAG + String(name))
  window.__STUB_DAV_NAMES__ = davNames
  window.__STUB_DAV_CFG__ = (patch) =>
    localStorage.setItem('modulo.__stubdav.cfg', JSON.stringify({ ...davCfg(), ...patch }))
  /** 凭据库里存的那条原文（只有测试用它来证明"口令确实进过这条通道"，界面从不读它） */
  window.__STUB_DAV_CRED__ = davCred
})()
