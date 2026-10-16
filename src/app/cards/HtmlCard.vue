<script setup lang="ts">
/**
 * 自定卡（HTML 扩展，2026-10-13 批 5）：一段 HTML 片段渲染成一张卡。
 *
 * ## 隔离（这条卡存在的全部理由）
 *
 * 片段跑在 `sandbox="allow-scripts"` 的 iframe 里 —— **没有 `allow-same-origin`**，
 * 于是它的 origin 是 opaque，实测（真 Chrome）**父级 DOM / localStorage / cookie 全部
 * SecurityError**。它拿不到应用任何数据，能做的只有把自己画出来，以及用 `postMessage`
 * 往外送东西（宿主侧按 `isExtMessage` 三查后才收）。
 *
 * ## 一句话说清信任边界（也写在卡面上）
 *
 * **片段 = 你愿意在浏览器里打开的一个文件**。写下它的那一刻，这份判断就是你的 ——
 * 沙箱保证的是"它动不了应用数据"，不是"它没有副作用"（它照样能联网、能占 CPU）。
 *
 * ## 怎么编辑
 *
 * 卡里同时干三件事：渲染（iframe）/ 编辑（textarea）/ 管理（多张切换）。编辑态直接
 * 换掉渲染区（不是弹层）—— 卡就那么大，浮层比内容还挤。
 */
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { Code, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'
import { snippetLiteral, isExtMessage } from '@levango7/engine/htmlcard'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string; chromeless?: boolean }>()
const cards = inject<CardDataApi>('cardData')!

const activeId = ref('')
const editing = ref(false)
const adding = ref(false)
const draftTitle = ref('')
const draftHtml = ref('')
const errorMsg = ref('')
/** iframe 的 revision：改完内容靠它强刷（同 src 不会重新加载） */
const revision = ref(0)
const frameEl = ref<HTMLIFrameElement | null>(null)
const toast = ref('')

const list = computed(() => cards.state.htmlCards)
const active = computed(() => list.value.find((c) => c.id === activeId.value) ?? list.value[0] ?? null)

/**
 * 宿主 → 片段的初始化消息：只送**变量**（主题色/卡片尺寸），不送任何宿主能力。
 * `targetOrigin` 只能是 `'*'`（opaque origin 无法指定）；安全性靠**出站内容**而不是
 * 出站地址 —— 里面没有任何应用数据。
 */
/**
 * 外壳文档（宿主层）：桥 + **安全字面量**注入。片段的安全保证来自 `snippetLiteral`
 * （引擎，`</` 已转义），这里只做"把它变成 DOM"这一步：`<script>` 需要显式重建才
 * 执行，其余节点 importNode —— 于是"片段里的脚本"与"外壳脚本"在解析层面彻底分开。
 */
function shell(card: { title: string; html: string }): string {
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
  window.MODULO = { vars: {} };
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || d.__modulo !== 'init') return;
    window.MODULO.vars = d.vars || {};
    if (typeof window.onModuloInit === 'function') { try { window.onModuloInit(window.MODULO.vars) } catch (err) {} }
  });
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
  if (!win || !active.value) return
  win.postMessage(
    {
      __modulo: 'init',
      vars: {
        title: active.value.title,
        dark: document.documentElement.dataset.theme === 'dark',
        width: frameEl.value?.clientWidth ?? 0,
        height: frameEl.value?.clientHeight ?? 0,
      },
    },
    '*',
  )
}

/** 片段 → 宿主的消息：三查（来源是你这个 iframe / 信封有标记 / payload 是朴素 JSON） */
function onMessage(e: MessageEvent): void {
  const win = frameEl.value?.contentWindow ?? null
  if (!isExtMessage(e.data, e.source, win)) return
  // 当前只有一种用途：片段想告诉用户点什么（不落盘、不做动作）—— 显示成一条小提示
  const p = e.data.payload as { notice?: unknown }
  if (typeof p.notice === 'string') {
    toast.value = p.notice.slice(0, 120)
    window.setTimeout(() => (toast.value = ''), 2500)
  }
}

watch(
  () => [activeId.value, revision.value] as const,
  () => sendInit(),
  { flush: 'post' },
)
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
window.addEventListener('message', onMessage)

function startAdd(): void {
  adding.value = true
  editing.value = false
  draftTitle.value = ''
  draftHtml.value = '<b>你好</b> —— 这里可以写 HTML，脚本也能跑（沙箱里，碰不到应用数据）'
  errorMsg.value = ''
}
function startEdit(): void {
  if (!active.value) return
  editing.value = true
  adding.value = false
  draftTitle.value = active.value.title
  draftHtml.value = active.value.html
  errorMsg.value = ''
}
/** 输入变了就把上一条错误清掉 —— 否则"改对了还挂着旧原因"，用户会以为改的没用 */
function clearError(): void {
  if (errorMsg.value) errorMsg.value = ''
}

function save(): void {
  if (adding.value) {
    const err = cards.addHtmlCard(draftTitle.value, draftHtml.value)
    if (err) return void (errorMsg.value = err)
    const created = list.value[list.value.length - 1]
    if (created) activeId.value = created.id
    adding.value = false
  } else if (active.value) {
    const err = cards.updateHtmlCard(active.value.id, { title: draftTitle.value, html: draftHtml.value })
    if (err) return void (errorMsg.value = err)
    editing.value = false
  }
  revision.value++
}
function cancel(): void {
  adding.value = false
  editing.value = false
  errorMsg.value = ''
}
function removeActive(): void {
  if (!active.value) return
  cards.removeHtmlCard(active.value.id)
  activeId.value = list.value[0]?.id ?? ''
  revision.value++
}

/** 卡片尺寸或主题变了 → 把变量再送一遍（片段的 `onModuloInit` 会收到） */
watch(
  () => document.documentElement.dataset.theme,
  () => sendInit(),
)
</script>

<template>
  <div class="hcard">
    <header class="hhead">
      <select v-if="list.length > 1" v-model="activeId" aria-label="选择自定卡" @change="revision++">
        <option v-for="c in list" :key="c.id" :value="c.id">{{ c.title }}</option>
      </select>
      <span v-else class="htitle">{{ active?.title ?? '自定卡' }}</span>
      <span class="hacts">
        <button v-if="active && !editing" title="编辑片段" @click="startEdit"><Code :size="12" /></button>
        <button v-if="active && !editing" title="重新载入" @click="revision++"><RefreshCw :size="12" /></button>
        <button v-if="active && !editing" title="删除这张自定卡" @click="removeActive"><Trash2 :size="12" /></button>
        <button v-if="!active && !adding" title="新建一张自定卡" @click="startAdd"><Plus :size="12" /></button>
      </span>
    </header>

    <div v-if="adding || editing" class="hedit">
      <input v-model="draftTitle" class="htinput" placeholder="卡片小标题（可空）" aria-label="自定卡标题" @input="clearError" />
      <textarea
        v-model="draftHtml"
        class="htarea"
        spellcheck="false"
        aria-label="HTML 片段"
        @input="clearError"
        placeholder="<b>你好</b>：可以写 HTML、<style> 和 <script>（沙箱里跑）"
      />
      <p v-if="errorMsg" class="herr">{{ errorMsg }}</p>
      <div class="hrow">
        <button class="hok" @click="save">保存</button>
        <button class="hcancel" @click="cancel">取消</button>
        <span class="htip">片段跑在沙箱里：碰不到应用数据，但其副作用（联网/占 CPU）由你负责</span>
      </div>
    </div>

    <div v-else-if="active" class="hbody">
      <iframe
        ref="frameEl"
        class="hframe"
        sandbox="allow-scripts"
        :title="active.title"
        :srcdoc="shell(active)"
        :key="`${active.id}:${revision}`"
        @load="sendInit"
      />
      <p v-if="toast" class="htoast">{{ toast }}</p>
    </div>

    <div v-else class="hempty">
      <p>还没有自定卡：写一段 HTML，它就会在这里渲染出来。</p>
      <button class="hok" @click="startAdd"><Plus :size="11" /> 新建</button>
      <p class="htip">沙箱隔离：片段跑在独立 origin 里，读不到应用的数据</p>
    </div>
  </div>
</template>

<style scoped>
.hcard {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.hhead {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
}
.htitle {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hhead select {
  font: inherit;
  font-size: 12px;
  background: var(--input-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-2);
  max-width: 60%;
}
.hacts {
  margin-left: auto;
  display: inline-flex;
  gap: 2px;
}
.hacts button {
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
}
.hacts button:hover {
  color: var(--text-1);
  background: var(--bg-card-soft);
}
.hbody {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.hframe {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: transparent;
}
.htoast {
  position: absolute;
  left: 6px;
  bottom: 6px;
  margin: 0;
  font-size: 11px;
  color: var(--text-2);
  background: var(--bg-card-solid);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
}
.hedit {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.htinput {
  font-size: 11px;
  padding: 1px 4px;
  background: var(--input-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
}
.htarea {
  flex: 1;
  min-height: 0;
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
.hrow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.hok,
.hcancel {
  border: 1px solid var(--border-strong);
  background: var(--bg-card-soft);
  color: var(--text-1);
  border-radius: var(--radius-sm);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.hcancel:hover {
  color: var(--c-red);
}
.htip {
  font-size: 11px;
  color: var(--text-4);
}
.herr {
  margin: 0;
  font-size: 11px;
  color: var(--c-red);
}
.hempty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-size: 11px;
  color: var(--text-3);
  text-align: center;
}
.hempty p {
  margin: 0;
}
</style>
