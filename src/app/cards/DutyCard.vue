<script setup lang="ts">
/**
 * 值班表：一份名单，按周期轮着排班。
 *
 * 排班规则是**引擎里写死的一种**（从锚点起按天序轮转，同日内按班次顺延），
 * 不是可配置的正则式 —— 可配置的排班规则是另一个产品，而且是最容易出错的软件。
 * 需要复杂规则时正解是接一个日历系统。
 *
 * 名录为空时显示"待排"，而不是回落到第一个名字 —— 那会让一张没填的表看起来像已经排好了。
 */
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { blockTimeLabel, currentDuty, DEFAULT_SHIFT_BLOCKS, monthDuties, type DutySlot } from '@levango7/engine/shift'
import { Plus, Trash2, UserRound } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 60_000)
onBeforeUnmount(() => window.clearInterval(tick))

const draft = ref('')
/** 锚点为空 = "从今天起轮"，界面上把空串当今天读一次，不往存储里塞一个随时会过期的日期 */
const anchorDate = computed(() => (cards.state.duty.anchor ? new Date(cards.state.duty.anchor) : now.value))
const roster = computed(() => cards.state.duty.roster)

const current = computed(() => currentDuty(roster.value, DEFAULT_SHIFT_BLOCKS, anchorDate.value, now.value))
/** 显式标注返回类型：`v-for` 的两层嵌套在 vue-tsc 下会被推成多一层数组，显式标注省掉一轮试错 */
const table = computed<{ label: string; weekdays: readonly string[]; cells: (DutySlot | null)[][] }>(() =>
  monthDuties(roster.value, DEFAULT_SHIFT_BLOCKS, anchorDate.value, now.value, now.value),
)

function add(): void {
  const n = draft.value.trim()
  if (!n) return
  cards.addDuty(n)
  draft.value = ''
}
</script>

<template>
  <div class="card duty" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">值班表 · {{ roster.length || '待排' }} 人</span>
        <span v-if="current" class="now">{{ blockTimeLabel(current.block) }}</span>
      </div>

      <div v-if="current" class="cur">
        <UserRound class="ico" :size="13" />
        <span class="cname">{{ current.person ?? '待排' }}</span>
        <span class="cblock">{{ current.block.label }}</span>
      </div>

      <template v-if="variant === 'panel' && roster.length">
        <div class="grid" role="img" :aria-label="`${table.label} 值班表`">
          <div class="wd" aria-hidden="true">
            <span v-for="w in table.weekdays" :key="w">{{ w }}</span>
          </div>
          <div v-for="(week, wi) in table.cells" :key="wi" class="week">
            <span
              v-for="(s, ci) in week"
              :key="ci"
              class="cell"
              :class="{ blank: !s }"
              :data-today="s ? s.isToday : false"
              :data-future="s ? s.future : false"
              :title="s ? `${s.date} ${s.block.label} ${s.person ?? '待排'}` : ''"
            >
              {{ s ? (s.person ? s.person.slice(0, 1) : '—') : '' }}
            </span>
          </div>
        </div>
      </template>

      <div class="roster">
        <input v-model="draft" class="in" maxlength="16" placeholder="加一个人" aria-label="值班人" @keydown.enter.prevent="add()" />
        <button class="add" title="加入名单" aria-label="加入值班名单" @click="add()"><Plus :size="12" /></button>
      </div>

      <ul v-if="variant === 'panel' && roster.length" class="names">
        <li v-for="(n, i) in roster" :key="`${n}-${i}`">
          <span class="nm">{{ n }}</span>
          <button class="del" :aria-label="`移出 ${n}`" @click="cards.removeDuty(i)"><Trash2 :size="10" /></button>
        </li>
      </ul>
      <p v-else-if="!roster.length" class="hint">名单空着，每格显示「待排」</p>
    </div>
  </div>
</template>

<style scoped>
.duty .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.now {
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cur {
  display: flex;
  align-items: baseline;
  gap: 5px;
}
.ico {
  color: var(--mod, var(--brand-500));
  align-self: center;
}
.cname {
  font-size: clamp(15px, 5.4cqw, 22px);
  color: var(--text-1);
  line-height: 1.2;
}
.cblock {
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
  white-space: nowrap;
}
.grid {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.wd,
.week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
}
.wd span {
  font-size: clamp(11px, 1.6cqw, 12px);
  color: var(--text-3);
  text-align: center;
  line-height: 1.2;
}
.cell {
  aspect-ratio: 1;
  min-inline-size: 0;
  border-radius: 2px;
  background: color-mix(in srgb, var(--mod, var(--brand-500)) 14%, transparent);
  color: var(--text-2);
  font-size: clamp(11px, 1.8cqw, 12px);
  display: grid;
  place-items: center;
  overflow: hidden;
}
.cell.blank {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--border-soft);
}
.cell[data-future='true'] {
  opacity: 0.45;
}
.cell[data-today='true'] {
  box-shadow: inset 0 0 0 1px var(--text-2);
  color: var(--text-1);
}
.roster {
  display: flex;
  gap: 4px;
}
.in {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 2px 4px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
}
.add {
  flex: 0 0 auto;
  display: inline-flex;
  padding: 2px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-3);
  cursor: pointer;
}
.add:hover,
.add:focus-visible {
  color: var(--text-1);
}
.names {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 4px;
}
.names li {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-inline-end: 3px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-2);
}
.nm {
  white-space: nowrap;
}
.del {
  display: inline-flex;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.del:hover,
.del:focus-visible {
  color: var(--text-1);
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 11px);
  color: var(--text-3);
}
</style>