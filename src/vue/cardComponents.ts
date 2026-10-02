import type { Component } from 'vue'
import ClockCard from '../app/cards/ClockCard.vue'
import StickyCard from '../app/cards/StickyCard.vue'
import TodoCard from '../app/cards/TodoCard.vue'
import NotesCard from '../app/cards/NotesCard.vue'

/**
 * 模块 id → 渲染组件。单独一个文件是因为 `cardRegistry.ts` 只放尺寸契约、必须能被
 * node 环境的单测直接 import（vitest 默认环境没装 vue 插件，碰 .vue 就解析不了），
 * 而这张表偏偏要 import 四个 .vue。
 */
export const CARD_COMPONENTS: Record<string, Component> = {
  clock: ClockCard,
  sticky: StickyCard,
  todo: TodoCard,
  notes: NotesCard,
  recent: NotesCard,
}
