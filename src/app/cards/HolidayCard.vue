<script setup lang="ts">
/**
 * 节假日与调休卡。
 *
 * 数据是官方年表（`holiday.ts` 文件头注明文号），卡片**只做查询与展示**：
 * - `next` 形态：下一个还没放完的假期 —— 名字、日期段、倒计时、补班提示。
 *   今年全过完且明年未公布时，如实显示「待公布」；元旦固定 1 月 1 日所以天数是事实，
 *   但**放几天是官方定的** —— 那一行必须带「安排待公布」，不能把天数当成放假承诺。
 * - `list` 形态：全年七节一览（已过灰 / 进行中高亮 / 未到显示倒计时）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { formatDateLabel } from '@levango7/engine/countdown'
import { newYearEstimate, nextHoliday, yearView } from '@levango7/engine/holiday'

const props = defineProps<{ variant: string }>()

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 60 * 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const year = computed(() => now.value.getFullYear())
const next = computed(() => nextHoliday(now.value))
const ny = computed(() => newYearEstimate(now.value))
const rows = computed(() => yearView(year.value, now.value))

const rangeLabel = (s: string, e: string) => (s === e ? formatDateLabel(s) : `${formatDateLabel(s)} ~ ${formatDateLabel(e)}`)
const workdaysLabel = (w: string[]) => w.map((d) => d.slice(5).replace('-', '/')).join('、')
</script>

<template>
  <div class="card holiday" :data-v="variant">
    <div class="card-body">
      <template v-if="variant === 'next'">
        <template v-if="next">
          <div class="kicker">下一个假期</div>
          <div class="name">{{ next.plan.name }}</div>
          <div class="range">{{ rangeLabel(next.plan.start, next.plan.end) }} · 共 {{ next.length }} 天</div>
          <div class="count" :data-soon="next.phase === 'upcoming' && next.daysUntil <= 7">
            <template v-if="next.phase === 'ongoing'">假期进行中</template>
            <template v-else-if="next.daysUntil === 0">今天开始</template>
            <template v-else>还有 {{ next.daysUntil }} 天</template>
          </div>
          <p v-if="next.plan.workdays.length" class="work">调休补班：{{ workdaysLabel(next.plan.workdays) }}</p>
        </template>
        <template v-else>
          <div class="kicker">{{ year }} 年的假期都过完了</div>
          <div class="name dim">{{ year + 1 }} 年安排待公布</div>
          <p class="cap">官方惯例每年 11 月前后发布下一年安排；元旦固定 1 月 1 日，放几天以通知为准。</p>
          <div class="count">距 {{ ny.date.slice(0, 4) }} 年元旦还有 {{ ny.days }} 天</div>
        </template>
      </template>

      <template v-else>
        <div class="top"><span class="kicker">{{ year }} 年全年安排</span></div>
        <ul class="rows">
          <li v-for="v in rows" :key="v.plan.name" :data-phase="v.phase">
            <span class="hname">{{ v.plan.name }}</span>
            <span class="hdr">{{ rangeLabel(v.plan.start, v.plan.end) }}</span>
            <span class="st">
              <template v-if="v.phase === 'past'">已过</template>
              <template v-else-if="v.phase === 'ongoing'">进行中</template>
              <template v-else>还有 {{ v.daysUntil }} 天</template>
            </span>
          </li>
        </ul>
        <p class="src">数据：国务院办公厅 {{ year }} 年节假日安排</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.holiday .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1.2cqw, 9px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.kicker {
  font-size: clamp(11px, 2cqw, 12px);
  color: var(--text-3);
}
.name {
  font-size: clamp(16px, 5cqw, 30px);
  font-weight: 600;
  color: var(--text-1);
  line-height: 1.15;
}
.name.dim {
  color: var(--text-2);
}
.range {
  font-size: clamp(11px, 2.4cqw, 13px);
  color: var(--text-2);
}
.count {
  font-size: clamp(13px, 3.4cqw, 20px);
  font-weight: 600;
  color: var(--mod, var(--brand-500));
  font-variant-numeric: tabular-nums;
}
.count[data-soon='true'] {
  color: var(--c-red);
}
.work {
  margin: 0;
  font-size: clamp(11px, 2cqw, 12px);
  color: var(--c-amber);
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  line-height: 1.4;
}
.top {
  display: flex;
  align-items: center;
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-block-size: 46cqh;
  overflow: auto;
}
.rows li {
  display: flex;
  align-items: baseline;
  gap: clamp(4px, 1.6cqw, 10px);
  min-width: 0;
  padding: 1px 2px;
  border-radius: var(--radius-sm);
}
.rows li[data-phase='ongoing'] {
  background: color-mix(in srgb, var(--brand-500) 12%, transparent);
}
.hname {
  flex: none;
  font-size: clamp(11px, 2.4cqw, 13px);
  font-weight: 600;
  color: var(--text-1);
}
.hdr {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.st {
  flex: none;
  font-size: clamp(11px, 2cqw, 12px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.rows li[data-phase='ongoing'] .st {
  color: var(--mod, var(--brand-500));
  font-weight: 600;
}
.src {
  margin: 0;
  font-size: clamp(10px, 1.8cqw, 11px);
  color: var(--text-3);
}
</style>
