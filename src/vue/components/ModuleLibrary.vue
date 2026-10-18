<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { LayoutGrid, Plus } from 'lucide-vue-next'
import type { LayoutStore } from '../store'
import CardCatalogMenu from './CardCatalogMenu.vue'
import { preloadCard } from '../cardComponents'

/**
 * 「全部卡片」下拉（2026-10-12 从顶栏搬进来）：模块库只列**还没放置**的卡，
 * 但卡片到 49 张后，库里的卡挨个看也不如按分组翻一遍目录来得快 ——
 * 这正是原「添加卡片」菜单的用途，只是入口按用户口径（"添加卡片应该是布局编辑里面
 * 才有的选项"）收进编辑器。菜单有 max-height 且 aside 是滚动容器，会把它裁掉 ——
 * 所以定位用 fixed + 按钮的矩形现算（随 open 一次性写入）。菜单本体是
 * `CardCatalogMenu.vue`（与将来可能的其他调用方共用一套外观）。
 *
 * **2026-10-19 从 `CanvasEditor.vue` 拆出（那时它 834 行）。为什么单独成文件**：
 * 接口只有三个（store 注入 + `startNew` + 自己的开合状态），而它是全文件**最近还在
 * churn 的块**（加卡预取、目录搬移都落在这里）—— churn 集中的块不该和键盘编排枢纽
 * 共享一个作业面：改一次预取要认领整份 834 行的读写面。
 */
const store = inject<LayoutStore>('store')!
const reg = store.reg

defineProps<{
  /** 从库里拖出一张：走画布同一套拖拽状态机（`useCanvasDrag` 挂在画布的 gridEl 上，所以由母组件注入） */
  startNew: (id: string, variantId: string, e: PointerEvent) => void
}>()

const addOpen = ref(false)
const addBtnEl = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const missingCount = computed(() => reg.filter((m) => !store.placedIds.value.has(m.id)).length)
async function toggleAddMenu(): Promise<void> {
  if (addOpen.value) {
    addOpen.value = false
    return
  }
  addOpen.value = true
  await nextTick()
  const r = addBtnEl.value?.getBoundingClientRect()
  if (r) {
    menuStyle.value = {
      position: 'fixed',
      left: `${Math.round(r.left)}px`,
      top: `${Math.round(r.bottom + 6)}px`,
      zIndex: 'var(--z-menu)',
    }
  }
}
/** 点菜单空白处/外部就关：菜单可能被裁出 aside，用文档级监听 */
function onDocPointerDown(e: PointerEvent): void {
  if (!addOpen.value) return
  const t = e.target as Node
  if (addBtnEl.value?.contains(t)) return
  const menuEl = document.getElementById('editor-add-menu')
  if (menuEl?.contains(t)) return
  addOpen.value = false
}
/** 从目录里加一张：落位交给引擎的 findFreeSpot（与库里拖入同一条路径） */
function addFromCatalog(id: string): void {
  addOpen.value = false
  store.add(id, 0, 0)
}

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
})
onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
})

/**
 * 给 Esc 编排用（母组件 `CanvasEditor.escapePressed` 转调这里）：目录开着时由它吞掉
 * 这一下，返回 true 表示"这层还有可退的"，App 才不会把 Esc 当成"取消这次编辑"
 * （有改动还会弹确认）。**为什么不把 addOpen 留在母组件**：开合状态与菜单定位是
 * 一件事，拆开就是两份真相。
 */
function closeMenu(): boolean {
  if (!addOpen.value) return false
  addOpen.value = false
  return true
}
defineExpose({ closeMenu })
</script>

<template>
  <aside class="lib">
    <h3>
      <LayoutGrid :size="14" /> 模块库
      <CardCatalogMenu v-if="addOpen" :menu-id="'editor-add-menu'" :style="menuStyle" @pick="addFromCatalog" />
      <button
        ref="addBtnEl"
        class="add-cat"
        :disabled="!missingCount"
        :title="missingCount ? '还没放置的卡片都在这里（与库里拖入同一条落位路径）' : '所有卡片都已在版面上'"
        aria-haspopup="menu"
        :aria-expanded="addOpen"
        @click="toggleAddMenu"
      >
        <Plus :size="12" /> 全部卡片
      </button>
    </h3>
    <p v-if="!store.available.value.length" class="muted small">全部模块都已放置</p>
    <div v-for="m in store.available.value" :key="m.id" class="lib-item" @pointerenter="preloadCard(m.id)">
      <div class="lib-title" @pointerdown="startNew(m.id, m.defaultVariant, $event)">{{ m.title }}</div>
      <div class="lib-variants">
        <button
          v-for="v in m.variants"
          :key="v.id"
          class="chip"
          :data-active="v.id === m.defaultVariant"
          @pointerdown="startNew(m.id, v.id, $event)"
        >
          {{ v.name }} {{ v.idealW }}×{{ v.idealH }}
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.lib {
  overflow: auto;
  padding-right: var(--space-2);
}
.lib h3 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
  margin: 0 0 var(--space-3);
}
/* 「全部卡片」目录入口：贴 h3 右侧的小按钮。字号跟 h3 同档（11px 下限守 E2E） */
.add-cat {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 var(--space-2);
  font-size: 11px;
  letter-spacing: 0.02em;
  text-transform: none;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--bg-card);
  color: var(--text-2);
  cursor: pointer;
}
.add-cat:hover:not(:disabled) {
  color: var(--text-1);
  border-color: var(--brand-500);
}
.add-cat:disabled {
  opacity: 0.5;
  cursor: default;
}
.lib-item {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  padding: var(--space-3);
  margin-bottom: var(--space-3);
  /* pan-y：竖直滑动交给浏览器滚列表；抓手（.lib-title / .chip）各自 touch-action: none，
     划在那上面 = 拖卡片进画布，不交还滚动 —— 与画布侧的标题带同一套区域语义 */
  touch-action: pan-y;
  transition: box-shadow var(--dur-micro) var(--ease-out), transform var(--dur-micro) var(--ease-out);
}
.lib-item:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}
.lib-title {
  font-weight: 600;
  margin-bottom: var(--space-2);
  cursor: grab;
  touch-action: none;
}
.lib-variants {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.chip {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  cursor: grab;
  touch-action: none;
}
.small {
  font-size: 12px;
}
/* 窄屏：库收成一条限高滚动带。`.editor` 改上下堆叠那半条规则留在母文件 —— 一条媒体
   查询横跨两个文件，这是"共享样式制造两份真相"的现实形状，只能各管各的那一半。 */
@media (max-width: 992px) {
  .lib {
    max-height: 196px;
  }
}
</style>
