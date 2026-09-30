import type { Component } from 'vue'
import type { ModuleRegistry } from '../engine'
import ClockCard from '../app/cards/ClockCard.vue'
import StickyCard from '../app/cards/StickyCard.vue'
import TodoCard from '../app/cards/TodoCard.vue'
import NotesCard from '../app/cards/NotesCard.vue'

/** 模块目录：尺寸契约（min/ideal，逻辑列单位）在这里声明，引擎据此钳制与降档 */
export const REGISTRY: ModuleRegistry = [
  {
    id: 'clock',
    title: '时钟',
    defaultVariant: 'big',
    variants: [
      { id: 'big', name: '大时钟', minW: 3, minH: 3, idealW: 4, idealH: 3 },
      { id: 'lunar', name: '日期卡', minW: 2, minH: 2, idealW: 3, idealH: 2 },
      { id: 'minimal', name: '极简时间', minW: 2, minH: 1, idealW: 2, idealH: 1 },
    ],
  },
  {
    id: 'sticky',
    title: '便签',
    defaultVariant: 'note',
    variants: [
      { id: 'note', name: '便签', minW: 2, minH: 2, idealW: 2, idealH: 3 },
      { id: 'wide', name: '宽便签', minW: 4, minH: 2, idealW: 5, idealH: 3 },
    ],
  },
  {
    id: 'todo',
    title: '待办',
    defaultVariant: 'list',
    variants: [
      { id: 'list', name: '清单', minW: 3, minH: 3, idealW: 4, idealH: 6 },
      { id: 'compact', name: '紧凑', minW: 2, minH: 2, idealW: 3, idealH: 3 },
    ],
  },
  {
    id: 'notes',
    title: '速记',
    defaultVariant: 'overview',
    variants: [
      { id: 'overview', name: '概览', minW: 2, minH: 2, idealW: 4, idealH: 4 },
      { id: 'tall', name: '长列表', minW: 3, minH: 4, idealW: 4, idealH: 8 },
    ],
  },
  {
    id: 'recent',
    title: '最近改动',
    defaultVariant: 'bar',
    variants: [{ id: 'bar', name: '通栏', minW: 4, minH: 1, idealW: 12, idealH: 2 }],
  },
]

export const CARD_COMPONENTS: Record<string, Component> = {
  clock: ClockCard,
  sticky: StickyCard,
  todo: TodoCard,
  notes: NotesCard,
  recent: NotesCard,
}
