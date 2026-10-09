import { emptyDoc } from '@levango7/engine/types'
import type { LayoutDoc, ModuleRegistry } from '@levango7/engine/types'

export const REGISTRY: ModuleRegistry = [
  {
    id: 'clock',
    title: '时钟',
    defaultVariant: 'big',
    variants: [
      { id: 'big', name: '大时钟', minW: 3, minH: 3, idealW: 4, idealH: 3 },
      { id: 'lunar', name: '今日阴阳历', minW: 2, minH: 2, idealW: 3, idealH: 3 },
      { id: 'minimal', name: '极简时间', minW: 2, minH: 1, idealW: 2, idealH: 2 },
    ],
  },
  {
    id: 'sticky',
    title: '便签',
    defaultVariant: 'note',
    variants: [{ id: 'note', name: '便签', minW: 2, minH: 1, idealW: 2, idealH: 2 }],
  },
  {
    id: 'todo',
    title: '待办',
    defaultVariant: 'list',
    variants: [{ id: 'list', name: '列表', minW: 3, minH: 3, idealW: 4, idealH: 5 }],
  },
  {
    id: 'recent',
    title: '最近使用',
    defaultVariant: 'bar',
    variants: [{ id: 'bar', name: '通栏', minW: 3, minH: 1, idealW: 12, idealH: 3 }],
  },
]

export function doc(items: LayoutDoc['items']): LayoutDoc {
  return { ...emptyDoc(), items }
}

/** 造一个内容不同但合法的时钟项，供历史栈测试区分快照 */
export function clockItem(seed: number): LayoutDoc['items'][number] {
  return { id: 'clock', variant: 'big', x: 0, y: 0, w: 4, h: 3, title: `t${seed}` }
}
