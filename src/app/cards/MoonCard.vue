<script setup lang="ts">
/**
 * 月相：纯本地计算（朔望月近似，±半天上下），不联网、不加 CSP。
 * 卡片上写 **≈** —— 要精确到小时那是天文年历的事。动画只用一个圆 + 阴影的近似画法。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { daysToFullMoon, moonPhase } from '@modulo/engine/moon'

const props = defineProps<{ variant: string }>()

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 30 * 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const moon = computed(() => moonPhase(now.value))
const toFull = computed(() => daysToFullMoon(now.value))
/** 照亮比例转成"阴影偏移"的近似画法：新月全暗、满月全亮（不做精确的地影几何） */
const shadowShift = computed(() => `${(1 - moon.value.illum) * 100}%`)
</script>

<template>
  <div class="card moon" :data-v="variant">
    <div class="card-body">
      <div class="row">
        <span class="ball" :style="{ '--lit': `${moon.illum * 100}%` }" aria-hidden="true">
          <i :style="{ insetInlineStart: shadowShift }" />
        </span>
        <div class="txt">
          <div class="name">≈ {{ moon.name }}</div>
          <div class="pct">照亮 {{ Math.round(moon.illum * 100) }}%</div>
        </div>
      </div>
      <p class="cap">
        <template v-if="toFull < 0.5">就是满月前后</template>
        <template v-else>≈ 离满月还有 {{ Math.round(toFull) }} 天</template>
        · 朔望月近似
      </p>
    </div>
  </div>
</template>

<style scoped>
.moon .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1.2cqw, 9px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.row {
  display: flex;
  align-items: center;
  gap: clamp(6px, 2.4cqw, 16px);
  min-width: 0;
}
.ball {
  position: relative;
  display: block;
  flex: none;
  width: clamp(26px, 9cqw, 52px);
  height: clamp(26px, 9cqw, 52px);
  border-radius: 50%;
  background: color-mix(in srgb, var(--text-1) 88%, transparent);
  overflow: hidden;
  border: 1px solid var(--border-soft);
}
.ball i {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  background: color-mix(in srgb, var(--text-4) 45%, transparent);
}
.txt {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.name {
  font-size: clamp(14px, 4.4cqw, 22px);
  color: var(--text-1);
}
.pct {
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2.1cqw, 11px);
  color: var(--text-3);
  line-height: 1.5;
}
</style>
