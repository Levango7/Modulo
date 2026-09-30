<script setup lang="ts">
import { inject, ref } from 'vue'
import { Check, X } from 'lucide-vue-next'
import { ACCENTS, MODES, SKINS } from '../appearance'
import { useFocusTrap } from '../useFocusTrap'
import type { AppearanceApi } from '../useAppearance'

defineEmits<{ (e: 'close'): void }>()
const appearance = inject<AppearanceApi>('appearance')!
const a = appearance.state
const panelEl = ref<HTMLElement | null>(null)
useFocusTrap(panelEl)
</script>

<template>
  <div class="scrim" @click.self="$emit('close')">
    <div ref="panelEl" class="panel" role="dialog" aria-modal="true" aria-label="设置" tabindex="-1">
      <header class="head">
        <h2>外观</h2>
        <button class="x" title="关闭 (Esc)" @click="$emit('close')"><X :size="16" /></button>
      </header>

      <section>
        <h3>视觉方向</h3>
        <div class="skins">
          <button
            v-for="s in SKINS"
            :key="s.id"
            class="skin"
            :data-skin-option="s.id"
            :data-active="a.skin === s.id"
            @click="appearance.set({ skin: s.id })"
          >
            <span class="dot" :data-s="s.id" />
            <span class="name">{{ s.label }}</span>
            <span class="desc">{{ s.desc }}</span>
            <Check v-if="a.skin === s.id" :size="14" class="tick" />
          </button>
        </div>
      </section>

      <section>
        <h3>明暗</h3>
        <div class="seg">
          <button v-for="m in MODES" :key="m.id" :data-active="a.mode === m.id" @click="appearance.set({ mode: m.id })">
            {{ m.label }}
          </button>
        </div>
      </section>

      <section>
        <h3>强调色</h3>
        <div class="accents">
          <button
            v-for="c in ACCENTS"
            :key="c.id"
            class="swatch"
            :title="c.label"
            :data-active="a.accent === c.id"
            :data-auto="c.value === 'auto'"
            @click="appearance.set({ accent: c.value })"
          >
            <Check v-if="a.accent === c.id" :size="12" />
          </button>
        </div>
        <p class="hint">「跟随皮肤」= 每套方向用它自己的强调色；选具体颜色则会覆盖皮肤默认值。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--scrim);
  display: grid;
  place-items: center;
  padding: var(--space-4);
}
.panel {
  width: min(560px, 100%);
  max-height: min(80vh, 640px);
  overflow: auto;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-hover);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.head {
  display: flex;
  align-items: center;
}
.head h2 {
  margin: 0;
  font-size: 16px;
}
.x {
  margin-left: auto;
  border: none;
  background: transparent;
  display: grid;
  place-items: center;
}
section h3 {
  margin: 0 0 var(--space-3);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
}
.skins {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2);
}
.skin {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px var(--space-2);
  text-align: left;
  padding: var(--space-3);
}
.skin .name {
  font-weight: 600;
}
.skin .desc {
  grid-column: 2;
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.4;
}
.skin .dot {
  grid-row: span 2;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
}
.dot[data-s='ink'] {
  background: linear-gradient(135deg, #fff 50%, #1f6feb 50%);
}
.dot[data-s='aurora'] {
  background: linear-gradient(135deg, #eceff6, #ffb8d0);
}
.dot[data-s='candy'] {
  background: linear-gradient(135deg, #ffd9a0, #ff5c8a);
}
.tick {
  position: absolute;
  top: 6px;
  right: 6px;
  color: var(--brand-500);
}
/* 选中态是品牌色实底，说明文字与勾必须跟着翻白，否则蓝底蓝字看不见 */
.skin[data-active='true'] .name,
.skin[data-active='true'] .desc,
.skin[data-active='true'] .tick {
  color: #fff;
}
.skin[data-active='true'] .desc {
  opacity: 0.82;
}
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--bg-card-soft);
  border: 1px solid var(--border-soft);
}
.accents {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.swatch {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  background: currentColor;
}
.swatch:nth-child(1) {
  color: transparent;
  background: conic-gradient(#f43f5e, #f59e0b, #22c55e, #3b82f6, #8b5cf6, #f43f5e);
}
.swatch:nth-child(2) { color: #5b5bf5; }
.swatch:nth-child(3) { color: #0ea5e9; }
.swatch:nth-child(4) { color: #0d9488; }
.swatch:nth-child(5) { color: #16a34a; }
.swatch:nth-child(6) { color: #d97706; }
.swatch:nth-child(7) { color: #e11d48; }
.swatch:nth-child(8) { color: #7c3aed; }
.swatch[data-active='true'] {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
.hint {
  margin: var(--space-3) 0 0;
  font-size: 12px;
  color: var(--text-3);
}
</style>
