<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref } from 'vue'
import { CornerDownLeft, Search, X } from 'lucide-vue-next'
import type { LayoutStore } from '../store'
import type { CardDataApi } from '../cardData'
import type { CommandBus } from '../commandBus'
import { SCOPE_LABEL, SCOPE_ORDER, commandStates, type CommandContext, type CommandState } from '../commands'
import { fuzzyScore, searchCards, searchContent, type PaletteHit } from '../paletteIndex'

/**
 * 命令面板（Ctrl+K，2026-10-13 批 2）。
 *
 * **三态一入口**：命令（COMMANDS 表）/ 卡片（注册表）/ 内容（用户写的字），
 * 结果按域分区而不是混成一列 —— 跨域比"匹配分"没有意义。
 *
 * 面板**不自己判断可用性**：条目从同一张命令表读、可用性走同一条 `when`，
 * 所以"这里能点的"与"键盘按得到的"永远一致。不可用的条目留在原地并写明原因
 * （而不是消失）—— 用户搜"收紧"能知道"为什么现在不行"，这比查无此物有帮助。
 */
const props = defineProps<{ ctx: CommandContext }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'goCard', id: string): void }>()

const store = inject<LayoutStore>('store')!
const cardData = inject<CardDataApi>('cardData')!
const bus = inject<CommandBus>('commandBus')!

const query = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const activeIndex = ref(0)

interface Row {
  hit: PaletteHit
  enabled: boolean
  reason: string | null
}

/** 命令域：走同一条 commandStates —— 可用性与原因和键盘派发完全同源 */
function commandRows(): Row[] {
  const states = commandStates(props.ctx)
  const byQ = query.value.trim()
  const rows: Row[] = []
  for (const st of states) {
    if (byQ) {
      const s = fuzzyScore(byQ, `${st.def.label} ${st.def.hint} ${SCOPE_LABEL[st.def.scope]}`)
      if (s === null) continue
    }
    rows.push({
      hit: {
        key: `command:${st.def.id}`,
        kind: 'command',
        title: st.def.label,
        sub: st.def.binding ? `${st.def.hint}（${st.def.binding}）` : st.def.hint,
        score: commandScore(st),
      },
      enabled: st.enabled,
      reason: st.reason,
    })
  }
  // 面板默认序：scope 分组序 → 表内顺序（稳定），搜索时按匹配分
  rows.sort((a, b) => {
    if (byQ) return b.hit.score - a.hit.score
    const sa = SCOPE_ORDER.indexOf(bus.byId(a.hit.key.slice('command:'.length))!.scope)
    const sb = SCOPE_ORDER.indexOf(bus.byId(b.hit.key.slice('command:'.length))!.scope)
    return sa - sb
  })
  return rows
}
function commandScore(st: CommandState): number {
  const q = query.value.trim()
  if (!q) return 0
  return fuzzyScore(q, `${st.def.label} ${st.def.hint}`) ?? -1
}

/** 卡片域与内容域：只在输入非空时呈现（空查询时列满屏不是"面板"，是噪音） */
const cardRows = computed<Row[]>(() => {
  const q = query.value.trim()
  if (!q) return []
  return searchCards(store.reg, q).map((hit) => ({ hit, enabled: true, reason: null }))
})
const contentRows = computed<Row[]>(() => {
  const q = query.value.trim()
  if (!q) return []
  return searchContent(cardData.state, q).map((hit) => ({ hit, enabled: true, reason: null }))
})

const allRows = computed<Row[]>(() => [...commandRows(), ...cardRows.value, ...contentRows.value])
const groups = computed(() => {
  const byQ = query.value.trim()
  const out: { label: string; rows: Row[]; offset: number }[] = []
  let offset = 0
  const push = (label: string, rows: Row[]) => {
    if (!rows.length) return
    out.push({ label, rows, offset })
    offset += rows.length
  }
  if (byQ) {
    push('命令', commandRows().filter((r) => r.enabled).concat(commandRows().filter((r) => !r.enabled)))
    push('卡片', cardRows.value)
    push('内容', contentRows.value)
  } else {
    // 空查询：命令按 scope 分区呈现（这是"能力目录"的读法）
    for (const scope of SCOPE_ORDER) {
      const rows = commandRows().filter((r) => bus.byId(r.hit.key.slice('command:'.length))!.scope === scope)
      push(SCOPE_LABEL[scope], rows)
    }
  }
  return out
})

function rowIndex(row: Row): number {
  for (const g of groups.value) {
    const i = g.rows.indexOf(row)
    if (i >= 0) return g.offset + i
  }
  return -1
}

function runRow(row: Row): void {
  if (!row.enabled) return
  if (row.hit.kind === 'command') {
    const id = row.hit.key.slice('command:'.length)
    const r = bus.dispatch(id)
    if (r.ok) {
      // 界面类命令（打开弹层/切视图）执行后让位；纯动作类留在面板里继续操作（连续整理很常见）
      const def = bus.byId(id)
      if (def?.effect) emit('close')
    }
    return
  }
  if (row.hit.cardId) {
    emit('goCard', row.hit.cardId)
    emit('close')
  }
}

function onKeydown(e: KeyboardEvent): void {
  const rows = allRows.value
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault()
    activeIndex.value = rows.length ? (activeIndex.value + 1) % rows.length : 0
    scrollActive()
    return
  }
  if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
    e.preventDefault()
    activeIndex.value = rows.length ? (activeIndex.value - 1 + rows.length) % rows.length : 0
    scrollActive()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const row = rows[activeIndex.value]
    if (row) runRow(row)
  }
}
function scrollActive(): void {
  void nextTick(() => {
    document.querySelector('.palette .row.active')?.scrollIntoView({ block: 'nearest' })
  })
}

onMounted(() => {
  inputEl.value?.focus()
})
</script>

<template>
  <div class="p-scrim" @click.self="emit('close')">
    <div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <div class="p-input">
        <Search :size="14" class="p-ico" />
        <input
          ref="inputEl"
          v-model="query"
          placeholder="搜命令、卡片、你写下的内容…"
          aria-label="命令面板输入"
          @keydown="onKeydown"
          @input="activeIndex = 0"
        />
        <button class="p-close" title="关闭 (Esc)" @click="emit('close')"><X :size="13" /></button>
      </div>
      <div class="p-body" role="listbox">
        <template v-for="g in groups" :key="g.label">
          <div class="p-gh" role="presentation">{{ g.label }}</div>
          <button
            v-for="row in g.rows"
            :key="row.hit.key"
            class="row"
            role="option"
            :aria-selected="rowIndex(row) === activeIndex"
            :aria-disabled="!row.enabled"
            :class="{ active: rowIndex(row) === activeIndex, off: !row.enabled }"
            @mouseenter="activeIndex = rowIndex(row)"
            @click="runRow(row)"
          >
            <span class="r-main">
              <span class="r-title">{{ row.hit.title }}</span>
              <span class="r-sub">{{ row.enabled ? row.hit.sub : `不可用：${row.reason}` }}</span>
            </span>
            <CornerDownLeft v-if="rowIndex(row) === activeIndex && row.enabled" :size="12" class="r-enter" />
          </button>
        </template>
        <p v-if="!groups.length" class="p-empty">没有匹配。「命令」按动词想、卡片按名字搜、内容搜你写下的字。</p>
      </div>
      <footer class="p-foot">
        <span><kbd>↑↓</kbd> 选择 · <kbd>Enter</kbd> 执行 · <kbd>Esc</kbd> 关闭</span>
        <span class="muted">命令 {{ bus.defs.length }} 条 · 卡片 {{ cardRows.length }} · 内容 {{ contentRows.length }}</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.p-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: start center;
  padding-top: 12vh;
  background: color-mix(in oklab, var(--scrim) 70%, transparent);
}
.palette {
  width: min(560px, calc(100vw - 48px));
  max-height: min(60vh, 520px);
  display: flex;
  flex-direction: column;
  background: var(--bg-card-solid);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-hover);
  overflow: hidden;
}
.p-input {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-soft);
}
.p-ico {
  color: var(--text-3);
  flex: none;
}
.p-input input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-1);
  font-size: 14px;
  outline: none;
}
.p-close {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.p-close:hover {
  background: var(--bg-card-soft);
  color: var(--text-1);
}
.p-body {
  overflow-y: auto;
  padding: var(--space-1) var(--space-1) var(--space-2);
  scrollbar-gutter: stable;
}
.p-gh {
  position: sticky;
  top: 0;
  z-index: 1;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--text-4);
  background: var(--bg-card-solid);
  padding: var(--space-2) var(--space-3) var(--space-1);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.row.active:not(.off) {
  background: var(--brand-50);
}
.row.off {
  cursor: default;
  opacity: 0.55;
}
.r-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.r-title {
  font-size: 13px;
  color: var(--text-1);
}
.r-sub {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.r-enter {
  color: var(--text-3);
  flex: none;
}
.p-empty {
  margin: var(--space-4) var(--space-3);
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
}
.p-foot {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border-soft);
  font-size: 11px;
  color: var(--text-3);
}
.p-foot kbd {
  font-family: inherit;
  border: 1px solid var(--border-soft);
  border-radius: 3px;
  padding: 0 3px;
  font-size: 10px;
}
</style>
