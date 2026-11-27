<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 18 })
</script>

<template>
  <!--
    2026-11-28 视觉刀 1：与 build/icon.svg 同形的「teal 圆角方底 + 四段分笔 M」（笔间留缝）。
    固定品牌色，放弃随皮肤变色（2026-11-28 刀 1 裁决，与 APP 图标统一）：
    底 chip 固定 #2E8F79，不再 var(--accent)；四段描边也不随皮肤走。
    几何 = build/icon.svg 的 1024 格 ÷42.67（viewBox 24，stroke-width 2.1 ≈ 88/42.67，
    stroke-linecap round、不 fill），rx 5.25 ≈ 224/42.67。缝宽同 build/icon.svg：
    腿-斜水平缝 30、顶点缝 12（1024 格），此处 0.7 / 0.28。
  -->
  <svg class="mark" :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="5.25" fill="#2E8F79"/>
    <g fill="none" stroke-width="2.1" stroke-linecap="round">
      <path d="M4.45 19.1V6" stroke="#ffffff"/>
      <path d="M7.22 7.27 10.83 13.24" stroke="#f6b39b"/>
      <path d="M13.17 13.24 16.78 7.27" stroke="#bfeadb"/>
      <path d="M19.55 19.1V6" stroke="#ffffff"/>
    </g>
  </svg>
</template>

<style scoped>
.mark {
  display: block;
  flex: none;
}
</style>
