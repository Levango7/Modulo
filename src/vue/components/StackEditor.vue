<script setup lang="ts">
import { computed, inject } from 'vue'
import * as E from '@modulo/engine'
import type { LayoutStore } from '../store'

const store = inject<LayoutStore>('store')!
const reg = store.reg

/** 窄屏（物理列数 <4）不画挤成一团的画布，改成列表式编排。x-hub 在 390px 下画布只剩 88px，就是缺这一档。 */
const items = computed(() => [...store.doc.value.items].sort((a, b) => a.y - b.y || a.x - b.x))

const titleOf = (p: E.Placement) => p.title ?? E.findModule(reg, p.id)?.title ?? p.id
const variantsOf = (p: E.Placement) => E.findModule(reg, p.id)?.variants ?? []
const variantName = (p: E.Placement) => E.resolveVariant(E.findModule(reg, p.id), p.variant)?.name ?? ''

function move(index: number, dir: -1 | 1) {
  const list = items.value
  const target = list[index + dir]
  const cur = list[index]
  if (!target) return
  /** 把当前卡移到邻居的 y，引擎的碰撞让位会自动把邻居顶下去 = 一次操作完成换位 */
  store.move(cur.id, target.x, target.y)
}

function step(p: E.Placement, dw: number, dh: number) {
  store.resize(p.id, p.w + dw, p.h + dh)
}
</script>

<template>
  <div class="stack">
    <p class="hint">窄屏按堆叠顺序编排（上下移动会自动把邻居顶开）</p>
    <div v-for="(p, i) in items" :key="p.id" class="row">
      <div class="meta">
        <div class="name">{{ titleOf(p) }}</div>
        <div class="sub muted">{{ variantName(p) }} · {{ p.w }}×{{ p.h }}<span v-if="p.locked"> · 已锁定</span></div>
      </div>
      <div class="ops">
        <button :disabled="i === 0" title="上移" @click="move(i, -1)">↑</button>
        <button :disabled="i === items.length - 1" title="下移" @click="move(i, 1)">↓</button>
        <button title="高度减一" @click="step(p, 0, -1)">H−</button>
        <button title="高度加一" @click="step(p, 0, 1)">H+</button>
        <button
          v-for="v in variantsOf(p)"
          :key="v.id"
          :data-active="v.id === p.variant"
          @click="store.setVariant(p.id, v.id)"
        >
          {{ v.name }}
        </button>
        <button :data-active="p.locked" @click="store.toggleLock(p.id)">{{ p.locked ? '🔒' : '🔓' }}</button>
        <button @click="store.remove(p.id)">×</button>
      </div>
    </div>
    <p v-if="!items.length" class="muted">版面是空的，先去宽一点的屏幕排一版，或点顶部「版面模板」挑一种排法。</p>
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow: auto;
  padding-bottom: var(--space-5);
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
}
.name {
  font-weight: 600;
}
.sub {
  font-size: 12px;
}
.meta {
  min-width: 120px;
  flex: 1;
}
.ops {
  display: flex;
  gap: var(--space-1);
  flex-wrap: wrap;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
