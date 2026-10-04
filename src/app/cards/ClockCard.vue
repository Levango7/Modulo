<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps<{ variant: string }>()

const now = ref(new Date())
const timer = window.setInterval(() => (now.value = new Date()), 1000)
onBeforeUnmount(() => window.clearInterval(timer))

const hh = (n: number) => String(n).padStart(2, '0')
const time = computed(() => `${hh(now.value.getHours())}:${hh(now.value.getMinutes())}`)
const seconds = computed(() => hh(now.value.getSeconds()))
const date = computed(() =>
  now.value.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }),
)
const quotes = ['博观而约取，厚积而薄发。', '千里之行，始于足下。', '不积跬步，无以至千里。']
const quote = computed(() => quotes[now.value.getDate() % quotes.length])
</script>

<template>
  <div class="card clock" :data-v="variant">
    <div class="card-body">
      <template v-if="variant !== 'minimal'">
        <div class="time">{{ time }}<span v-if="variant === 'big'" class="sec">{{ seconds }}</span></div>
        <div class="date">{{ date }}</div>
        <div v-if="variant === 'big'" class="quote">{{ quote }}</div>
      </template>
      <div v-else class="time minimal">{{ time }}</div>
    </div>
  </div>
</template>

<style scoped>
/* 内容随格子连续缩放：clamp(绝对下限, 容器查询单位, 绝对上限) —— 12 列到 1 列都不裁字 */
.clock .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(2px, 1.4cqw, 10px);
  padding: clamp(8px, 2.2cqw, 24px);
}
.time {
  font-size: clamp(20px, 9cqw, 64px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.time.minimal {
  font-size: clamp(22px, 11cqw, 72px);
}
.sec {
  font-size: max(11px, 0.45em);
  font-weight: 500;
  color: var(--text-3);
  margin-left: 0.15em;
}
.date {
  font-size: clamp(12px, 1.6cqw, 16px);
  color: var(--text-2);
  white-space: nowrap;
}
.quote {
  font-size: clamp(12px, 1.5cqw, 15px);
  color: var(--brand-600);
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
