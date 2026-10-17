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
})()
