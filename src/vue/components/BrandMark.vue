<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 18 })
</script>

<template>
  <!-- 与 build/icon.svg 同一套网格：5 列 × 3 行的九块模块拼成字母 M -->
  <svg class="mark" :width="size" :height="size" viewBox="0 0 1024 1024" aria-hidden="true">
    <g class="mark-leg">
      <rect x="160" y="190" width="120" height="196" rx="40" /><rect x="160" y="414" width="120" height="196" rx="40" /><rect x="160" y="638" width="120" height="196" rx="40" />
      <rect x="744" y="190" width="120" height="196" rx="40" /><rect x="744" y="414" width="120" height="196" rx="40" /><rect x="744" y="638" width="120" height="196" rx="40" />
    </g>
    <g class="mark-v">
      <rect x="306" y="190" width="120" height="196" rx="40" /><rect x="598" y="190" width="120" height="196" rx="40" />
      <rect x="452" y="414" width="120" height="196" rx="40" />
    </g>
  </svg>
</template>

<style scoped>
.mark {
  display: block;
  flex: none;
}
.mark-leg {
  fill: var(--text-1);
}
.mark-v {
  fill: var(--accent);
}
</style>
