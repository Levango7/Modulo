<script setup lang="ts">
/**
 * 数据图表卡：记账 / 打卡的迷你趋势图。
 *
 * 关键定位：**它是别的卡的数据的另一种看法** —— 自己一行数据都不存，
 * 读记账（`ledger.entries`）与打卡（`habit.days`）的同源 cardData。好处是
 * 图永远和源卡一致，且删掉图表卡不动任何数据。
 *
 * 图形是纯 SVG（viewBox 0 0 100 100 + preserveAspectRatio none 随卡面拉伸），
 * 几何全在引擎 `chart.ts`（可单测）；线条加 non-scaling-stroke 防拉伸变粗。
 * 没有引入任何图表库 —— 这个体量的迷你图，一个 polyline / 几个 rect 就够，
 * 图表库的体积和 API 面都不划算。
 *
 * F-01 阶段 2 之后（2026-11-01）：记账 / 习惯的内容**按实例分**了，而这张卡读的是
 * 它们的同源 cardData —— 只读顶层就回到"第二张不进图表的眼"。保守口径：源 ≥2 时
 * 出一个 `<select>` 切换（与热力图翻月份同一条**会话内**状态，不落盘），**默认仍是
 * 第一实例**，单源时界面与行为逐字不变。选哪份的判定在 `pickSource`（纯函数，单测锁）。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { barSlots, linePoints, scaleSeries } from '@levango7/engine/chart'
import { dailyTotals, formatMoneyShort } from '@levango7/engine/ledger'
import { lastNDays, streakDays } from '@levango7/engine/habit'
import type { CardDataApi } from '../../vue/cardData'
import { allHabits, allLedgers, pickSource } from '../../vue/instanceData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 5 * 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const LEDGER_DAYS = 30
const HABIT_DAYS = 28

/**
 * 选中的源是**会话内**状态（local ref，刷新即回到第一实例）—— 与热力图 `shift` 翻月份
 * 同一条先例：它是"这张卡现在看哪份"的视图偏好，不是内容，因此不写进 `byInstance`
 * （存储形状零变更；要不要持久化是产品问题，如实记在 CHANGELOG）。
 */
const ledgerPick = ref<string | null>(null)
const habitPick = ref<string | null>(null)

/** select 的 v-model 代理：option 的 value 用空串表示"顶层那一份"（id 为 null） */
const ledgerPickModel = computed<string>({
  get: () => ledgerPick.value ?? '',
  set: (v) => {
    ledgerPick.value = v || null
  },
})
const habitPickModel = computed<string>({
  get: () => habitPick.value ?? '',
  set: (v) => {
    habitPick.value = v || null
  },
})

const ledgerSources = computed(() => allLedgers(cards.state))
const habitSources = computed(() => allHabits(cards.state))

const ledger = computed(() => {
  if (props.variant !== 'ledger') return null
  const src = pickSource(ledgerSources.value, ledgerPick.value)
  const pts = dailyTotals(src.entries, now.value, LEDGER_DAYS)
  const scale = scaleSeries(pts.map((p) => p.cents))
  return { pts, scale, slots: barSlots(pts.length), total: pts.reduce((s, p) => s + p.cents, 0) }
})

const habit = computed(() => {
  if (props.variant !== 'habit') return null
  const src = pickSource(habitSources.value, habitPick.value)
  const days = lastNDays(src.habit.days, now.value, HABIT_DAYS)
  const scale = scaleSeries(days.map((d) => (d.done ? 1 : 0)))
  return {
    days,
    scale,
    streak: streakDays(src.habit.days, now.value),
    doneCount: days.filter((d) => d.done).length,
    name: src.habit.name,
  }
})

/** 未命名的习惯给个带序号的兜底标签（与 `aiChat.ts` 的「标题（n）」同一写法） */
const habitLabel = (i: number, name: string) => name || `习惯打卡（${i + 1}）`

/** 柱高：值越大越高的条形；0 值给一条 0.6 单位的基线痕，看得出"这一天存在但没花" */
const barY = (frac: number) => 100 - 6 - frac * 88
const barH = (frac: number) => Math.max(frac * 88, 0.6)
</script>

<template>
  <div class="card chart" :data-v="variant">
    <div class="card-body">
      <template v-if="variant === 'ledger' && ledger">
        <div class="top">
          <span class="label">近 {{ LEDGER_DAYS }} 天花费</span>
          <select
            v-if="ledgerSources.length > 1"
            v-model="ledgerPickModel"
            class="src"
            aria-label="选择记账实例"
          >
            <option v-for="(s, i) in ledgerSources" :key="s.id ?? 'first'" :value="s.id ?? ''">
              记账（{{ i + 1 }}）
            </option>
          </select>
          <span class="sum">{{ formatMoneyShort(ledger.total) }}</span>
        </div>
        <svg v-if="ledger.scale.max > 0" viewBox="0 0 100 100" preserveAspectRatio="none" class="chart" aria-hidden="true">
          <rect
            v-for="(s, i) in ledger.slots"
            :key="i"
            :x="s.x"
            :width="s.w"
            :y="barY(ledger.scale.fracs[i])"
            :height="barH(ledger.scale.fracs[i])"
            rx="0.5"
            class="bar"
            :data-hot="i === ledger.slots.length - 1"
          />
        </svg>
        <p v-else class="hint">记一笔账（记账卡），这里就有每天的花费柱状图</p>
        <p v-if="ledger.scale.max > 0" class="cap">柱高相对当日花费，最高一天 {{ formatMoneyShort(ledger.scale.max) }}</p>
      </template>

      <template v-else-if="variant === 'habit' && habit">
        <div class="top">
          <span class="label">近 {{ HABIT_DAYS }} 天打卡</span>
          <!-- 单源：习惯名仍是那一行字（与改造前逐字相同）；多源：下拉本身就是名字展示 -->
          <select
            v-if="habitSources.length > 1"
            v-model="habitPickModel"
            class="src"
            aria-label="选择习惯实例"
          >
            <option v-for="(s, i) in habitSources" :key="s.id ?? 'first'" :value="s.id ?? ''">
              {{ habitLabel(i, s.habit.name) }}
            </option>
          </select>
          <span class="sum" v-else-if="habit.name">{{ habit.name }}</span>
        </div>
        <svg v-if="habit.scale.max > 0" viewBox="0 0 100 100" preserveAspectRatio="none" class="chart" aria-hidden="true">
          <polyline :points="linePoints(habit.scale.fracs)" class="line" />
        </svg>
        <p v-else class="hint">在打卡卡上勾一天，这里就有趋势线</p>
        <p v-if="habit.scale.max > 0" class="cap">打卡 {{ habit.doneCount }} / {{ HABIT_DAYS }} 天 · 连续 {{ habit.streak }} 天</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.chart .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1.2cqw, 9px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}
.label {
  font-size: clamp(11px, 2.4cqw, 13px);
  color: var(--text-2);
}
.sum {
  font-size: clamp(11px, 2.6cqw, 14px);
  font-weight: 600;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  max-width: 60%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 源切换下拉：样式照 HttpCard 的 `.whead select`（同一条 select 皮肤），
   但顶行是 label + select + sum 三件，这里收紧到 40%，别把合计挤出去 */
.src {
  font: inherit;
  font-size: clamp(11px, 2.4cqw, 12px);
  font-weight: 600;
  color: var(--text-2);
  background: var(--input-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  max-width: 40%;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chart {
  width: 100%;
  height: auto;
  flex: 1 1 auto;
  min-height: 0;
  aspect-ratio: 5 / 2;
}
.bar {
  fill: color-mix(in srgb, var(--mod, var(--brand-500)) 55%, transparent);
}
.bar[data-hot='true'] {
  fill: var(--mod, var(--brand-500));
}
.line {
  fill: none;
  stroke: var(--mod, var(--brand-500));
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.cap,
.hint {
  margin: 0;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  line-height: 1.4;
}
</style>
