<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { Minimize2, Pin, X } from 'lucide-vue-next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { CARD_COMPONENTS } from '../vue/cardComponents'
import type { CardDataApi } from '../vue/cardData'
import { unfloatCard } from './api'

/**
 * 浮窗外壳：一条 24px 的把手条 + 卡片本体。
 *
 * 把手条承担三件事：拖动窗口（`startDragging`）、置顶开关、还原/关闭。
 * 关掉 = 卡片回工作台（Rust 侧收到 Destroyed 摘登记并广播，主窗据此复位）。
 * 卡片本体直接复用 `CARD_COMPONENTS[cardId]` —— 与工作台同一组件、同一外观，
 * 这正是相对"iframe 里塞网页"的差别所在。
 */
const props = defineProps<{
  cardId: string
  storage: { get: (k: string) => string | null; set: (k: string, v: string) => void }
  cardData: CardDataApi
}>()

/**
 * 浮窗拿到的 `cardId` 是**实例 id**（多开后可能是 `todo:2`）。组件与形态都要按它所属的模块解析：
 * 版面条目里有 `module` 就用它，旧档/单实例没有这个字段时模块 id 与实例 id 相同。
 */
const layoutItem = computed(() => {
  try {
    const raw = props.storage.get('modulo.layout.v1')
    const doc = raw ? JSON.parse(raw) : null
    const p = doc?.items?.find?.((i: { id: string }) => i.id === props.cardId)
    return p && typeof p === 'object' ? (p as { variant?: unknown; module?: unknown }) : null
  } catch {
    return null
  }
})
const moduleId = computed(() => (typeof layoutItem.value?.module === 'string' ? layoutItem.value.module : props.cardId))
const comp = computed(() => CARD_COMPONENTS[moduleId.value])
/** 浮窗里的形态取存档里的当前形态；卡片不在版面上时按各组件默认走 */
const variant = computed(() => (typeof layoutItem.value?.variant === 'string' ? layoutItem.value.variant : undefined))
/** 便签/待办这类卡有 chromeless 变体：浮窗里去掉卡头（把手条已经承担了标题职责） */
const chromeless = computed(() => moduleId.value === 'sticky' || moduleId.value === 'notes')

async function togglePin(): Promise<void> {
  try {
    const w = getCurrentWindow()
    const onTop = await w.isAlwaysOnTop()
    await w.setAlwaysOnTop(!onTop)
  } catch {
    /* 桌面壳之外不存在；静默 */
  }
}

function close(): void {
  void unfloatCard(props.cardId)
}

onMounted(() => {
  // Esc 关窗（与主窗习惯一致）
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}
</script>

<template>
  <div class="float-root">
    <header class="fbar" :data-tauri-drag-region="true">
      <span class="ftitle">{{ cardId }}</span>
      <span class="factions">
        <button title="置顶开关" @click.stop="togglePin"><Pin :size="11" /></button>
        <button title="还原到工作台（Esc）" @click.stop="close"><Minimize2 :size="11" /></button>
        <button title="关闭（卡片回工作台）" class="closer" @click.stop="close"><X :size="11" /></button>
      </span>
    </header>
    <main class="fbody">
      <component :is="comp" v-if="comp" :variant="variant" :module-id="cardId" :chromeless="chromeless" />
      <p v-else class="muted">这张卡暂不支持浮窗</p>
    </main>
  </div>
</template>

<style scoped>
.float-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.fbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 24px;
  padding: 0 var(--space-2);
  background: var(--bg-card-soft);
  border-bottom: 1px solid var(--border-soft);
  cursor: grab;
  user-select: none;
  flex: none;
}
.fbar:active {
  cursor: grabbing;
}
.ftitle {
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.factions {
  display: inline-flex;
  gap: 2px;
}
.factions button {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--text-3);
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 0;
}
.factions button:hover {
  background: var(--bg-card-soft);
  color: var(--text-1);
}
.factions .closer:hover {
  color: var(--c-red);
}
.fbody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-2);
  container-type: size;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
  text-align: center;
  margin-top: 40%;
}
</style>
