<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { X } from 'lucide-vue-next'
import * as E from '../../engine'
import { useFocusTrap } from '../useFocusTrap'
import type { LayoutStore } from '../store'

/**
 * 模板选择器。目标只有一个：**第一次打开的人不用读说明书就能有一张好版面**。
 *
 * 每张卡片带一张按真实格子画的迷你示意图 —— 排法这种东西看图三秒就懂，
 * 读文字描述要三十秒，而且描述永远不如形状直观。
 */
const emit = defineEmits<{ (e: 'close'): void; (e: 'edit'): void }>()
const store = inject<LayoutStore>('store')!
const rootEl = ref<HTMLElement | null>(null)
useFocusTrap(rootEl)

const COLS = 12

const cards = computed(() =>
  E.TEMPLATES.map((t) => {
    const rows = Math.max(...t.cells.map((c) => c.y + c.h))
    return {
      ...t,
      rows,
      names: t.cells.map((c) => E.findModule(store.reg, c.id)?.title ?? c.id),
    }
  }),
)

const current = computed(() => store.templateId.value)
const justApplied = ref<string | null>(null)

function pick(id: string) {
  if (!store.applyTemplate(id)) return
  justApplied.value = id
  emit('close')
}

/** 关闭交给父层去记"这次先不挑"（Esc 与点关闭必须走同一条路，否则行为会分叉） */
function close() {
  emit('close')
}
</script>

<template>
  <div class="scrim" @click.self="close">
    <div ref="rootEl" class="picker" role="dialog" aria-modal="true" aria-labelledby="tpl-title" tabindex="-1">
      <header>
        <div>
          <h2 id="tpl-title">选一种排法</h2>
          <p class="sub">点一张就换成那个版面。不满意 <kbd>Ctrl+Z</kbd> 退回，或者自己去编辑器挪。</p>
        </div>
        <button class="tb-btn" aria-label="关闭" @click="close"><X :size="16" /></button>
      </header>

      <ul class="grid">
        <li v-for="t in cards" :key="t.id">
          <button class="card" :data-active="current === t.id" :data-just="justApplied === t.id" @click="pick(t.id)">
            <span
              class="mini"
              aria-hidden="true"
              :style="{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${t.rows}, 1fr)` }"
            >
              <span
                v-for="c in t.cells"
                :key="c.id"
                :data-module="c.id"
                :style="{ gridColumn: `${c.x + 1} / span ${c.w}`, gridRow: `${c.y + 1} / span ${c.h}` }"
              />
            </span>
            <span class="head">
              <strong>{{ t.name }}</strong>
              <em v-if="current === t.id" class="badge">使用中</em>
              <em v-else-if="justApplied === t.id" class="badge ok">已换成这张</em>
              <span class="count muted">{{ t.cells.length }} 张卡</span>
            </span>
            <span class="blurb">{{ t.blurb }}</span>
            <span class="who muted">{{ t.audience }}</span>
            <span class="legend muted">{{ t.names.join(' · ') }}</span>
          </button>
        </li>
      </ul>

      <footer>
        <p class="muted hint">
          这些都是起点，不是限制：随便拖、随便缩放都改得回来。想把自己排的那份存起来随时切换，去
          <strong>外观 → 版面方案 → 另存为</strong>。
        </p>
        <button class="wide" @click="emit('edit')">自己去编辑器排</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  z-index: var(--z-modal);
}
.picker {
  /**
   * 920 → 1180：8 张模板在 3 列下要排 3 行（实测内容高 862 > 可视 759，得滚）。
   * 加宽成 4 列把行数砍到 2 行，比压卡片高度划算 —— 每张卡只有 96px 高的预览，
   * 再矮就读不出排法了，而"看图挑"正是这个弹层唯一的价值。
   * 模板再多下去（≥12 张）会重新需要滚，那时该做的是分组而不是继续加宽。
   */
  width: min(1180px, 100%);
  max-height: min(86vh, 760px);
  overflow: auto;
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-hover);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}
header > div {
  flex: 1;
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: 17px;
}
.sub {
  margin: var(--space-1) 0 0;
  font-size: 12.5px;
  color: var(--text-2);
}
kbd {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 11px;
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(232px, 1fr));
  gap: var(--space-3);
}
.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  text-align: left;
  padding: var(--space-3);
  background: var(--bg-card-soft);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--dur-micro) var(--ease-out), transform var(--dur-micro) var(--ease-out);
}
.card:hover {
  border-color: var(--brand-500);
  transform: translateY(-1px);
}
.card[data-active='true'] {
  border-color: var(--brand-500);
  box-shadow: var(--shadow-focus);
}
.card[data-just='true'] {
  border-color: var(--c-green);
}
.mini {
  display: grid;
  gap: 3px;
  height: 96px;
  padding: 4px;
  background: var(--bg-page);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
}
.mini > span {
  border-radius: 3px;
  background: color-mix(in oklab, var(--mod, var(--text-3)) 42%, var(--bg-card));
  outline: 1px solid color-mix(in oklab, var(--mod, var(--text-3)) 60%, transparent);
}
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 14px;
}
.head strong {
  font-weight: 600;
}
.badge {
  font-style: normal;
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--brand-50);
  color: var(--brand-600);
}
.badge.ok {
  background: color-mix(in oklab, var(--c-green) 18%, var(--bg-card));
  color: var(--c-green);
}
.count {
  margin-left: auto;
  font-size: 11px;
}
.blurb {
  font-size: 12.5px;
  line-height: 1.45;
}
.who,
.legend {
  font-size: 11.5px;
}
.legend {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--text-3);
}
footer {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.hint {
  flex: 1;
  min-width: 200px;
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
}
@media (max-width: 520px) {
  .picker {
    padding: var(--space-4);
  }
  .mini {
    height: 78px;
  }
}
</style>
