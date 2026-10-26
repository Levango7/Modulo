<script setup lang="ts">
/**
 * 原生卡（扩展路线第三层，2026-10-27）：一张组件演两个角色，由 `moduleId` prop 区分 ——
 *
 * - **管理态**（模块 id `extcard`，静态注册表的一员）：导入卡包（一段 JSON：manifest +
 *   入口 HTML）/ 列出已装 / 卸载。装好的卡**不在这里渲染** —— 每份卡包有自己的模块库条目
 *   （`ext:<id>`，由 `useExtensions` 同步进注册表），像内置卡一样添加、缩放、多开、脱离浮窗。
 * - **运行态**（模块 id `ext:<id>`）：渲染那份卡包的入口 HTML（沙箱 iframe），并把**桥**
 *   的三个方法（getState / setState / notify）接到宿主。卡包卸载后版面上残留的实例如实
 *   说"已卸载"，不白屏；刷新后 `parseLayout` 会把未知模块的条目清掉。
 *
 * ## 隔离边界（与自定卡同一条实测结论，见引擎 `htmlcard.ts` 文件头）
 *
 * 入口跑在 `sandbox="allow-scripts"` 的 iframe 里（无 allow-same-origin ⇒ opaque origin，
 * 父级 DOM / 存储 / cookie 全部 SecurityError）。桥是唯一新增通道：请求端要过
 * `isExtMessage` 三查 + `parseBridgeRequest`（方法白名单 + 形状 + 字节上限），
 * 不认识的请求**不回话** —— 枚举方法面得不到任何回声。
 *
 * ## 桥的能力面（第一版，扩能力必须先在这里过理由）
 *
 *   getState()                 读本扩展的持久状态（按扩展共享，两张实例同一份）
 *   setState(value)            写回（朴素 JSON ≤ 16 KiB；null = 清空）
 *   notify(text)               发一条系统通知 —— 走 `shouldSendSystemNotification`
 *                              同一道总门：只在桌面壳、且设置里开着系统通知时投递；
 *                              应答恒 ok（投递是尽力而为，失败不回滚用户动作）。
 *
 * **桥应答的 targetOrigin 只能是 '*'**（opaque origin 无法指定目标）—— 与 sendInit
 * 同一条注释的理由：安全性靠出站内容（只回该扩展自己的状态与确认），不靠出站地址。
 */
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import {
  MAX_EXT_CARDS,
  bridgeReply,
  extIdOf,
  extModuleId,
  isExtMessage,
  isExtModule,
  parseBridgeRequest,
  snippetLiteral,
  type ExtCard as ExtCardDef,
} from '@levango7/engine/extcard'
import { sendSystemNotifications, shouldSendSystemNotification } from '../../vue/notify'
import { isDesktop } from '../../vue/useShell'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string; chromeless?: boolean; moduleId?: string }>()
const cards = inject<CardDataApi>('cardData')!
/** notify 的总门数据源；结构化最小类型 —— 这张卡不该知道提醒层的全部形状 */
const reminders = inject<{ state: { settings: { systemNotifications: boolean } } } | null>('reminders', null)

/** 管理态（extcard）还是运行态（ext:<id>）—— 分叉只此一处 */
const isManager = computed(() => !props.moduleId || !isExtModule(props.moduleId))

/* ---------------- 管理态 ---------------- */

const draftJson = ref('')
const errorMsg = ref('')

const installed = computed(() => cards.state.extCards)

function importPack(): void {
  const err = cards.addExtCard(draftJson.value)
  if (err) {
    errorMsg.value = err
    return
  }
  draftJson.value = ''
  errorMsg.value = ''
}
function clearError(): void {
  if (errorMsg.value) errorMsg.value = ''
}
function remove(id: string): void {
  cards.removeExtCard(id)
}

/* ---------------- 运行态 ---------------- */

const ext = computed<ExtCardDef | null>(() =>
  isManager.value ? null : (cards.state.extCards.find((c) => extModuleId(c.id) === props.moduleId) ?? null),
)
const frameEl = ref<HTMLIFrameElement | null>(null)
/** iframe 的 revision：内容变了靠它强刷（同 src 不会重新加载） */
const revision = ref(0)

/**
 * 外壳文档（宿主层）：与 HtmlCard 的 shell 同构，外加**桥客户端**。安全仍然全部来自
 * `snippetLiteral`（`</` 已转义，外壳脚本在解析层碰不到片段的任何字节）。
 */
function shell(card: ExtCardDef): string {
  const title = card.title.replace(/[<>"]/g, '')
  const literal = snippetLiteral(card.html)
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: transparent; color: var(--text-1);
    font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif; }
  body { padding: 8px; }
</style></head>
<body>
<script>
  window.MODULO = { vars: {}, bridge: null };
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.__modulo === 'init') {
      window.MODULO.vars = d.vars || {};
      if (typeof window.onModuloInit === 'function') { try { window.onModuloInit(window.MODULO.vars) } catch (err) {} }
      return;
    }
    if (d.__modulo === 'bridge') {
      var resolve = __pending[d.rid];
      if (!resolve) return;
      delete __pending[d.rid];
      resolve({ ok: !!d.ok, value: d.value, error: d.error });
    }
  });
  var __seq = 0; var __pending = {};
  window.MODULO.bridge = {
    call: function (method, args) {
      return new Promise(function (resolve) {
        var rid = 'r' + (++__seq);
        __pending[rid] = resolve;
        parent.postMessage({ __modulo: 'ext', payload: { bridge: { rid: rid, method: method, args: args === undefined ? null : args } } }, '*');
      });
    },
    getState: function () { return window.MODULO.bridge.call('getState'); },
    setState: function (v) { return window.MODULO.bridge.call('setState', v === undefined ? null : v); },
    notify: function (text) { return window.MODULO.bridge.call('notify', { text: String(text) }); }
  };
  ;(function () {
    var SNIPPET = ${literal};
    var parsed = new DOMParser().parseFromString(SNIPPET, 'text/html');
    var nodes = Array.prototype.slice.call(parsed.body.childNodes);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.tagName === 'SCRIPT') {
        var s = document.createElement('script');
        s.textContent = node.textContent || '';
        document.body.appendChild(s);
      } else {
        document.body.appendChild(document.importNode(node, true));
      }
    }
  })();
<\/script>
</body></html>`
}

function sendInit(): void {
  const win = frameEl.value?.contentWindow
  if (!win || !ext.value) return
  win.postMessage(
    {
      __modulo: 'init',
      vars: {
        title: ext.value.title,
        dark: document.documentElement.dataset.theme === 'dark',
        width: frameEl.value?.clientWidth ?? 0,
        height: frameEl.value?.clientHeight ?? 0,
      },
    },
    '*',
  )
}

function reply(rid: string, ok: boolean, value?: unknown, error?: string): void {
  frameEl.value?.contentWindow?.postMessage(bridgeReply(rid, ok, value, error), '*')
}

async function deliverNotify(text: string, title: string): Promise<void> {
  if (!reminders) return
  if (!shouldSendSystemNotification(isDesktop, reminders.state.settings.systemNotifications)) return
  await sendSystemNotifications([{ key: `extcard:${title}`, title, body: text }])
}

/** 扩展 → 宿主的桥请求。三查不过 / 方法不认识 → 什么都不发生（不回话） */
function onMessage(e: MessageEvent): void {
  const win = frameEl.value?.contentWindow ?? null
  if (!ext.value) return
  if (!isExtMessage(e.data, e.source, win)) return
  const req = parseBridgeRequest(e.data.payload)
  if (!req) return
  const id = ext.value.id
  if (req.method === 'getState') {
    reply(req.rid, true, cards.state.extState[id] ?? null)
  } else if (req.method === 'setState') {
    const err = cards.setExtState(id, req.args)
    if (err === null) reply(req.rid, true, req.args)
    else reply(req.rid, false, undefined, err)
  } else {
    void deliverNotify((req.args as { text: string }).text, ext.value.title)
    reply(req.rid, true, null)
  }
}

onBeforeUnmount(() => window.removeEventListener('message', onMessage))
window.addEventListener('message', onMessage)

/** 尺寸或主题变了 → 变量重发（片段的 onModuloInit 会收到）；状态/名单变了 iframe 按需自己拉 */
watch(
  () => document.documentElement.dataset.theme,
  () => sendInit(),
)
</script>

<template>
  <!-- 管理态：导入 / 列表 / 卸载 -->
  <div v-if="isManager" class="xcard">
    <header class="xhead">
      <span class="xtitle">原生卡</span>
      <span class="xcount">{{ installed.length }} / {{ MAX_EXT_CARDS }}</span>
    </header>

    <div v-if="installed.length" class="xlist">
      <div v-for="c in installed" :key="c.id" class="xrow">
        <span class="xname">{{ c.title }}</span>
        <span class="xmeta">{{ c.group }} · {{ c.variants.length }} 个形态</span>
        <button class="xdel" title="卸载这张扩展卡（版面上的实例刷新后消失）" @click="remove(c.id)">
          <Trash2 :size="12" />
        </button>
      </div>
      <p class="xtip">装好的卡在「添加卡片」里，按分组归位；卸载后它的状态一并清除。</p>
    </div>
    <p v-else class="xempty">还没有装任何卡包。把卡包 JSON 粘到下面，导入后它会成为一张普通卡片。</p>

    <div class="ximport">
      <textarea
        v-model="draftJson"
        class="xtarea"
        spellcheck="false"
        aria-label="卡包 JSON"
        placeholder='{"id":"hello","title":"问候","html":"<b>你好</b>","variants":[{"id":"std","name":"标准","minW":2,"minH":2,"idealW":3,"idealH":3}]}'
        @input="clearError"
      />
      <p v-if="errorMsg" class="xerr">{{ errorMsg }}</p>
      <div class="xrowbtn">
        <button class="xok" :disabled="!draftJson.trim()" @click="importPack"><Plus :size="11" /> 导入卡包</button>
        <span class="xtip">沙箱隔离：碰不到应用数据；桥只有读写自身状态与发通知</span>
      </div>
    </div>
  </div>

  <!-- 运行态：渲染卡包入口；卸载残留实例如实说明 -->
  <div v-else-if="ext" class="xcard">
    <div class="xbody">
      <iframe
        ref="frameEl"
        class="xframe"
        sandbox="allow-scripts"
        :title="ext.title"
        :srcdoc="shell(ext)"
        :key="`${ext.id}:${revision}`"
        @load="sendInit"
      />
    </div>
  </div>
  <div v-else class="xcard">
    <p class="xempty">这张扩展卡已被卸载。删掉这个格子即可；刷新后版面会自动清掉它。</p>
  </div>
</template>

<style scoped>
.xcard {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: var(--space-1);
}
.xhead {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  flex: none;
}
.xtitle {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}
.xcount {
  font-size: 11px;
  color: var(--text-4);
}
.xlist {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow: auto;
}
.xrow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 11px;
}
.xname {
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.xmeta {
  color: var(--text-4);
  margin-left: auto;
  white-space: nowrap;
}
.xdel {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--text-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 0;
  flex: none;
}
.xdel:hover {
  color: var(--c-red);
  background: var(--bg-card-soft);
}
.xempty {
  margin: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  font-size: 11px;
  color: var(--text-3);
}
.ximport {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: auto;
}
.xtarea {
  height: 72px;
  resize: none;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
  padding: 4px;
  background: var(--input-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
}
.xerr {
  margin: 0;
  font-size: 11px;
  color: var(--c-red);
}
.xrowbtn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.xok {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid var(--border-strong);
  background: var(--bg-card-soft);
  color: var(--text-1);
  border-radius: var(--radius-sm);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.xok:disabled {
  opacity: 0.5;
  cursor: default;
}
.xtip {
  margin: 0;
  font-size: 11px;
  color: var(--text-4);
}
.xbody {
  flex: 1;
  min-height: 0;
  display: flex;
}
.xframe {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: transparent;
}
</style>
