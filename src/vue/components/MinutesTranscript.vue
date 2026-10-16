<script setup lang="ts">
/**
 * 速记的实时字幕区：只负责"把句子摆出来 + 新句到达时贴到底"。
 *
 * 抽成子组件是因为**滚动这件事必须碰真 DOM**（`nextTick` + `scrollTop`），
 * 而卡本体那半要留给可单测的纯逻辑（`src/vue/minutesLive.ts`）—— 一张卡里
 * "能断言的"和"要真浏览器的"混在同一个文件里，两者都会变糊。
 *
 * 贴底刻意用 `scrollTop = scrollHeight` 而不是 `scrollIntoView({behavior:'smooth'})`：
 * 平滑滚动是插值动画，不在这张卡的动效范围内；长会里逐句平滑滚会一直糊着。
 */
import { nextTick, ref, watch } from 'vue'
import { Captions } from 'lucide-vue-next'
import { formatSegmentTime, type Segment } from '../minutesLive'

const props = defineProps<{ segments: Segment[]; active: boolean }>()

const log = ref<HTMLElement | null>(null)
/** 用户往上翻历史时不抢他的滚动位置；等他滚回贴底再恢复自动贴底（聊天窗的通行做法） */
let pinned = true

function onScroll(): void {
  const el = log.value
  if (!el) return
  pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24
}

watch(
  () => props.segments.length,
  async () => {
    if (!pinned) return
    await nextTick()
    if (log.value) log.value.scrollTop = log.value.scrollHeight
  },
)
</script>

<template>
  <ol ref="log" class="log" role="log" aria-live="polite" aria-relevant="additions" @scroll="onScroll">
    <li v-if="!segments.length" class="idle">
      <Captions :size="14" />
      <span>{{ active ? '在听，还没断出完整的句子' : '开始后，断出的句子会逐条出现在这里' }}</span>
    </li>
    <li v-for="s in segments" :key="s.startMs">
      <span class="at">{{ formatSegmentTime(s.startMs) }}</span>
      <span class="tx">{{ s.text }}</span>
    </li>
  </ol>
</template>

<style scoped>
.log {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1 1 auto;
  min-block-size: 36px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: clamp(2px, 1cqw, 6px);
}
.log li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-1);
}
.at {
  flex: none;
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}
.tx {
  min-width: 0;
  overflow-wrap: anywhere;
}
.idle {
  align-items: center;
  color: var(--text-2);
}
</style>
