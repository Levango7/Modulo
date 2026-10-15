<script setup lang="ts">
/**
 * 窗口预览卡的「窗口列表」子区域（枚举结果 + 过滤 + 选择）。抽出来只为让卡片本体
 * 守住 450 行纪律 —— 不新增注册卡，也不改任何注册表。
 *
 * 过滤逻辑不在这里实现，走 `winPreview.ts` 的 `filterWindows`（纯函数、有单测）；
 * 本组件只负责输入框与渲染。
 */
import { computed, ref } from 'vue'
import { Minimize2, RefreshCw, ShieldAlert } from 'lucide-vue-next'
import { canPreview, filterWindows, truncateTitle, windowFlagHint, windowFlagText, windowFlags, type WinInfo } from '../winPreview'

const props = defineProps<{
  items: WinInfo[]
  selected: number | null
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  (e: 'select', w: WinInfo): void
  (e: 'refresh'): void
}>()

const query = ref('')
const rows = computed(() => filterWindows(props.items, query.value))
</script>

<template>
  <div class="wlist">
    <div class="bar">
      <input v-model="query" class="in" type="search" placeholder="按标题或进程过滤" aria-label="过滤窗口" />
      <button class="tbtn" title="重新枚举窗口" aria-label="刷新窗口列表" :disabled="loading" @click="emit('refresh')">
        <RefreshCw :size="12" :class="{ spin: loading }" />
      </button>
    </div>

    <p v-if="error" class="hint">枚举窗口失败：{{ error }}</p>

    <ul v-else-if="rows.length" class="wins">
      <li v-for="w in rows" :key="w.hwnd" :data-on="w.hwnd === selected">
        <button class="wbtn" :disabled="!canPreview(w)" :title="w.title" @click="emit('select', w)">
          <span class="t">{{ truncateTitle(w.title) }}</span>
          <span class="p">{{ w.process || '未知进程' }}</span>
        </button>
        <span v-for="f in windowFlags(w)" :key="f" class="flag" :data-f="f" :title="windowFlagHint(f)">
          <Minimize2 v-if="f === 'minimized'" :size="12" />
          <ShieldAlert v-else :size="12" />
          {{ windowFlagText(f) }}
        </span>
      </li>
    </ul>

    <p v-else class="hint">
      {{ query ? '没有匹配的窗口，换个关键词试试' : '当前没有可预览的窗口（只列可见、有标题、无属主的顶层窗口）' }}
    </p>
  </div>
</template>

<style scoped>
.wlist {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
}
.in {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  padding: 2px 6px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
}
.tbtn {
  flex: none;
  display: inline-flex;
  padding: 2px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.tbtn:hover,
.tbtn:focus-visible {
  color: var(--text-1);
}
.tbtn:disabled {
  opacity: 0.5;
  cursor: default;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.wins {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-block-size: 40cqh;
  overflow: auto;
}
.wins li {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.wbtn {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 5px;
  text-align: start;
  border: 1px solid transparent;
  background: transparent;
}
.wbtn:disabled {
  opacity: 0.45;
  cursor: default;
}
.wins li[data-on='true'] .wbtn {
  border-color: var(--brand-500);
  background: color-mix(in srgb, var(--brand-500) 10%, transparent);
}
.t {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2.1cqw, 12px);
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p {
  flex: none;
  max-inline-size: 40%;
  font-size: clamp(11px, 1.8cqw, 11px);
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.flag {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: clamp(11px, 1.8cqw, 11px);
  color: var(--text-2);
  white-space: nowrap;
}
.flag[data-f='minimized'] svg {
  color: var(--c-amber);
}
.flag[data-f='protected'] svg {
  color: var(--text-3);
}
.hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
</style>
