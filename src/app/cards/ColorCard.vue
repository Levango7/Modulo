<script setup lang="ts">
/**
 * 颜色工具：取色 → HEX / RGB / HSL 三种表示 + 在这个底色上"白字还是黑字"的建议。
 * 换算与 WCAG 对比度全在引擎（`color.ts`，往返与 #000/#fff=21 这类硬事实各有单测）。
 */
import { computed, ref } from 'vue'
import { contrastRatio, parseHex, readableOn, rgbToHsl } from '@modulo/engine/color'

const props = defineProps<{ variant: string }>()

const hex = ref('#e4572e')
const rgb = computed(() => parseHex(hex.value))
const hsl = computed(() => (rgb.value ? rgbToHsl(rgb.value) : null))
const hint = computed(() => (rgb.value ? readableOn(rgb.value) : null))
const whiteContrast = computed(() => (rgb.value ? contrastRatio(rgb.value, { r: 255, g: 255, b: 255 }).toFixed(2) : null))
</script>

<template>
  <div class="card colorconv" :data-v="variant">
    <div class="card-body">
      <div class="head">
        <input v-model="hex" type="color" class="pick" aria-label="选颜色" />
        <input v-model="hex" class="hexin" aria-label="HEX 值" spellcheck="false" />
        <span class="chip" :style="{ background: rgb ? hex : 'transparent' }" />
      </div>
      <template v-if="rgb && hsl">
        <div class="kv"><span>RGB</span><code>{{ rgb.r }}, {{ rgb.g }}, {{ rgb.b }}</code></div>
        <div class="kv"><span>HSL</span><code>{{ hsl.h }}, {{ hsl.s }}%, {{ hsl.l }}%</code></div>
        <div class="kv"><span>对比</span><code>对白 {{ whiteContrast }} → 建议配{{ hint }}</code></div>
      </template>
      <p v-else class="hint">HEX 写法不认识 —— 应该是 #RGB 或 #RRGGBB</p>
    </div>
  </div>
</template>

<style scoped>
.colorconv .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1.1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.head {
  display: flex;
  align-items: center;
  gap: clamp(4px, 1.4cqw, 10px);
  min-width: 0;
}
.pick {
  width: clamp(22px, 6cqw, 34px);
  height: clamp(22px, 6cqw, 34px);
  padding: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  flex: none;
}
.hexin {
  flex: 1;
  min-width: 0;
  font-size: clamp(11px, 2.6cqw, 13px);
  padding: 2px 6px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-family: ui-monospace, monospace;
}
.chip {
  width: clamp(18px, 5cqw, 28px);
  height: clamp(18px, 5cqw, 28px);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  flex: none;
}
.kv {
  display: flex;
  justify-content: space-between;
  gap: clamp(4px, 1.6cqw, 10px);
  font-size: clamp(11px, 2.6cqw, 13px);
}
.kv span {
  color: var(--text-3);
}
.kv code {
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
</style>
