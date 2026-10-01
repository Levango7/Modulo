<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Copy, Minus, X } from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'

/** 无边框窗口自带的标题栏。只在桌面壳里渲染，网页版仍然由浏览器自己的标签页承担标题。 */
const win = getCurrentWindow()
const maximized = ref(false)
let unlisten: (() => void) | undefined

onMounted(async () => {
  maximized.value = await win.isMaximized()
  unlisten = await win.onResized(async () => {
    maximized.value = await win.isMaximized()
  })
})
onBeforeUnmount(() => unlisten?.())
</script>

<template>
  <div class="titlebar">
    <!-- deep：裸 data-tauri-drag-region 只在事件 target 恰好是本元素时生效，点 Logo/标题文字都不算。
         双击最大化也不接管 —— Tauri 注入的 drag.js 已经在 mousedown(detail=2) 里做了，
         自己再加一个 @dblclick 会与它各切一次，净效果是不最大化。 -->
    <div class="tb-drag" data-tauri-drag-region="deep">
      <BrandMark :size="14" />
      <span class="tb-title">Modulo</span>
    </div>
    <div class="tb-actions">
      <button class="tb-btn" aria-label="最小化" title="最小化" @click="win.minimize()"><Minus :size="13" /></button>
      <button
        class="tb-btn"
        :aria-label="maximized ? '还原' : '最大化'"
        :title="maximized ? '还原' : '最大化'"
        @click="win.toggleMaximize()"
      >
        <Copy v-if="maximized" :size="12" />
        <span v-else class="tb-square" />
      </button>
      <button class="tb-btn tb-close" aria-label="关闭" title="关闭" @click="win.close()"><X :size="14" /></button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: stretch;
  height: 34px;
  flex: none;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-soft);
  user-select: none;
}
.tb-drag {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
}
.tb-title {
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--text-2);
}
.tb-actions {
  display: flex;
  flex: none;
}
.tb-btn {
  width: 44px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--text-2);
  cursor: default;
}
.tb-btn:hover {
  background: var(--bg-card-soft);
  color: var(--text-1);
}
.tb-close:hover {
  background: var(--c-red);
  color: #fff;
}
.tb-square {
  width: 9px;
  height: 9px;
  border: 1.5px solid currentColor;
  border-radius: 1px;
}
</style>
