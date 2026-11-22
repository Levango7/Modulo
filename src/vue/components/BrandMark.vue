<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 18 })
</script>

<template>
  <!-- 与 build/icon.svg 同一笔 M：应用内单色描边，不带底色块 -->
  <svg class="mark" :width="size" :height="size" viewBox="0 0 1024 1024" aria-hidden="true">
    <path class="mark-m" d="M296 732V292l216 268 216-268v440" stroke-width="116" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.mark {
  display: block;
  flex: none;
}
.mark-m {
  fill: none;
  stroke: var(--accent);
}
</style>
