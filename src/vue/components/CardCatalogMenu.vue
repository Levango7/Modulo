<script setup lang="ts">
import { computed, inject } from 'vue'
import type { LayoutStore } from '../store'

/**
 * 「全部还没放置的卡片」目录菜单 —— 与顶栏各下拉同一套外观（实底 + 模糊 + 分组吸顶）。
 *
 * 从 `App.vue` 的顶栏「添加卡片」下拉抽出来，因为入口搬进了编辑器模块库
 * （2026-10-12 用户口径："添加卡片应该是布局编辑里面才有的选项"）——
 * 两处各留一份样式必然走散（这个仓库已有一条"永远会红的守卫"式的教训）。
 * 只负责渲染与点选；**开合、定位、外点关闭由调用方管**（顶栏是 absolute、
 * 编辑器里是 fixed——定位语义本来就不同）。
 */
const props = defineProps<{ menuId?: string; style?: Record<string, string> }>()
const emit = defineEmits<{ (e: 'pick', id: string): void }>()
const store = inject<LayoutStore>('store')!

/** id 供调用方做外点判断（菜单可能被 Teleport 到 body） */
const menuId = props.menuId

const missingByGroup = computed(() => {
  const groups: { name: string; cards: { id: string; title: string; blurb?: string }[] }[] = []
  for (const m of store.reg) {
    if (store.placedIds.value.has(m.id)) continue
    const name = m.group ?? '其他'
    let g = groups.find((x) => x.name === name)
    if (!g) {
      g = { name, cards: [] }
      groups.push(g)
    }
    g.cards.push(m)
  }
  return groups
})
</script>

<template>
  <div :id="menuId" class="add-menu" role="menu" aria-label="可添加的卡片" :style="props.style">
    <template v-for="g in missingByGroup" :key="g.name">
      <div class="gh" role="presentation">{{ g.name }}</div>
      <button v-for="m in g.cards" :key="m.id" role="menuitem" @click="emit('pick', m.id)">
        <span class="t">{{ m.title }}</span>
        <span class="v">{{ m.blurb }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
/* 菜单是压在任意内容上的浮层：卡片档半透明（亮彩皮肤 86%）会直接透字 ——
   用户实拍：待办清单从「整理/紧凑」菜单里透出来。用「实底」令牌 + 背景模糊，
   实测菜单空白列亮度波动 5 级 → 0 级。 */
.add-menu {
  padding: var(--space-1);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 208px;
  max-width: 260px;
  background: var(--bg-card-solid);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-hover);
  /* 卡片到 49 张后不限高就是一堵墙：限高 + 自身滚动 */
  max-height: min(70vh, 520px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.add-menu .gh {
  font-size: 10px;
  color: var(--text-4);
  /* 分组头吸顶：滚到第二组时仍能看见「现在在哪一组」 */
  position: sticky;
  top: calc(var(--space-1) * -1);
  z-index: 1;
  background: var(--bg-card-solid);
  margin: 0 calc(var(--space-1) * -1);
  padding: var(--space-2) var(--space-3) var(--space-1);
  backdrop-filter: blur(12px);
}
.add-menu [role='menuitem'] {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  color: inherit;
}
.add-menu [role='menuitem']:hover,
.add-menu [role='menuitem']:focus-visible {
  background: var(--bg-card-soft);
}
/* 按下要有实感：button:active 的 0.96 缩放会让相邻项跳动，这里改背景加深 */
.add-menu [role='menuitem']:active {
  background: var(--brand-50);
  transform: none;
}
.add-menu .t {
  font-size: 13px;
  color: var(--text-1);
}
.add-menu .v {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-3);
}
</style>
