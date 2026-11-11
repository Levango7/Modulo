<script setup lang="ts">
/**
 * 执行时间线（F-15 P0 §1.5）：把「提议 → 照做 → 结果」画成一条纵向的、一行一步的链。
 *
 * 只用现有数据（`ChatTurn.actions` / `actionsState` / 执行结果的逐条状态），
 * 行与状态的映射全在 `aiActions.timelineRows`（纯函数、有单测）—— 这里只画。
 *
 * 三条 DOM 约束（E2E 压在上面，改动前先看 `chat-dock.spec.ts` 的 acts 那几条）：
 * 1. `data-ai-acts` / `data-ai-act` / `data-ai-act-run` / `data-ai-act-skip` /
 *    `data-ai-acts-note` / `data-ai-act-bad` 一个都不能改名；
 * 2. `li[data-ai-act]` 的**文字必须只有动作本身**（用例逐字比 `nth-child(2)`）——
 *    所以状态点是个无文字的 span，状态词放在 li 外面；
 * 3. 「待确认」时不显示状态词（那句话由标题行说「等你点头」），
 *    执行完才逐行标出成功 / 失败 / 未执行。
 */
import { computed } from 'vue'
import type { ActStep, TimelineRow } from '../aiActions'
import type { ToolRow } from '../aiChat'

const props = defineProps<{
  rows: TimelineRow[]
  /** 结构化工具事件的行（P1a）。与 `rows` **两条数据路径并存**，一块一块画，互不覆盖 */
  tools?: ToolRow[]
  /** 块顶那句话（"它想这么做（等你点头）"这类，由父组件按状态给；空串 = 不画标题） */
  head: string
  /** 看不懂的坏行（人话，一行）；空则不画那一行 */
  badText?: string | null
  state?: 'pending' | 'done' | 'dismissed'
  /** 「已照做」那行的说明（含"做了一半"的实况） */
  note?: string | null
}>()
const emit = defineEmits<{ (e: 'run'): void; (e: 'skip'): void }>()

/** 状态点的人话。**执行完才显示**（见文件头第 3 条） */
const STEP_LABEL: Record<ActStep, string> = {
  pending: '待确认',
  running: '执行中',
  ok: '成功',
  fail: '失败',
  skipped: '未执行',
}

/** 点完「照做」之后才逐行标状态；待确认时只画空心点 */
const showWords = computed(() => props.state === 'done' || props.state === 'dismissed')
const canRun = computed(() => props.state === 'pending' && props.rows.length > 0)

/**
 * 提议块要不要画。**不能无条件画**：只有工具行的那一轮（模型直接调工具、没有文字提议）
 * 也走这个组件，无条件画会在工具块上面留一个空盒子。
 */
const hasActs = computed(
  () =>
    !!props.head ||
    props.rows.length > 0 ||
    !!props.badText ||
    canRun.value ||
    (props.state === 'done' && !!props.note),
)

/**
 * 工具行按轮次分块：**每一轮一根竖线**（`round` 是 agent 循环的分段，不是同一条线上的装饰）。
 * 分组在这里做而不是父组件：它只与"行"有关，与那一轮发生了什么无关。
 */
const toolGroups = computed(() => {
  const out: { n: number; rows: ToolRow[] }[] = []
  for (const r of props.tools ?? []) {
    const last = out[out.length - 1]
    if (last && last.n === r.round) last.rows.push(r)
    else out.push({ n: r.round, rows: [r] })
  }
  return out
})
</script>

<template>
  <div v-if="hasActs" class="acts" data-ai-acts>
    <p v-if="head" class="head">{{ head }}</p>
    <ul v-if="rows.length" class="steps">
      <li
        v-for="(r, k) in rows"
        :key="k"
        class="step"
        :data-step="r.step"
        :title="STEP_LABEL[r.step]"
      >
        <span class="dot" aria-hidden="true" />
        <span class="txt" data-ai-act>{{ r.label }}</span>
        <span v-if="showWords" class="st" :data-step-word="r.step">{{ STEP_LABEL[r.step] }}</span>
      </li>
    </ul>
    <p v-if="badText" class="bad" data-ai-act-bad>
      <span class="dot" aria-hidden="true" />{{ badText }}
    </p>
    <div v-if="canRun" class="btns">
      <button type="button" class="btn" data-ai-act-run @click="emit('run')">照做</button>
      <button type="button" class="btn ghost" data-ai-act-skip @click="emit('skip')">算了</button>
    </div>
    <p v-else-if="state === 'done' && note" class="note" data-ai-acts-note>{{ note }}</p>
  </div>

  <!--
    结构化工具事件（P1a）：`toolStart` → 进行中，`toolEnd` → 成功 / 失败。
    **属性名与提议块完全分开**（`data-tool-*` vs `data-ai-act*`）：两条路径同在一条
    消息里时，E2E 按 `[data-ai-acts] li` 数行，混用会让"提议有几条"这个数变成两条路径之和。
  -->
  <div v-if="tools && tools.length" class="tools" data-tool-steps>
    <p class="head" data-tool-head>它自己动手的步骤</p>
    <div v-for="g in toolGroups" :key="g.n" class="group">
      <p class="round" data-tool-round>{{ `第 ${g.n} 轮` }}</p>
      <ul class="steps">
        <li
          v-for="r in g.rows"
          :key="r.id"
          class="step"
          :data-step="r.step"
          :data-tool-step="r.step"
          :data-tool-id="r.id"
          :title="STEP_LABEL[r.step]"
        >
          <span class="dot" aria-hidden="true" />
          <span class="txt" data-tool-act>{{ r.label }}</span>
          <span v-if="r.detail" class="detail" :title="r.detail">{{ r.detail }}</span>
          <span class="st" :data-tool-step-word="r.step">{{ STEP_LABEL[r.step] }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.acts {
  margin: var(--space-2) 0 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--border-soft) 12%, transparent);
  max-width: 100%;
}
.head {
  margin: 0 0 var(--space-1);
  font-size: 12px;
  color: var(--text-3);
}
/* 竖线就是"时间线"本身：从第一个点连到最后一个点，末项不画（不许悬空） */
.steps {
  margin: 0;
  padding: 0 0 0 14px;
  list-style: none;
  position: relative;
}
.steps::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 8px;
  bottom: 8px;
  width: 1px;
  background: var(--border-soft);
}
.step {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 2px 0;
  font-size: 13px;
  color: var(--text-1);
}
.dot {
  position: absolute;
  left: -14px;
  top: 8px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-3);
}
.txt {
  flex: 1;
  min-width: 0;
}
.st {
  flex: none;
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
/* 五个状态点：颜色 + **位置/形状** 双编码（不只靠颜色分） */
.step[data-step='pending'] .dot {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--text-3);
}
.step[data-step='running'] .dot {
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}
.step[data-step='ok'] .dot {
  background: var(--c-green);
}
.step[data-step='fail'] .dot {
  background: var(--c-red);
}
.step[data-step='skipped'] .dot {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--text-3);
  opacity: 0.6;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .step[data-step='running'] .dot {
    animation: none;
  }
}
.bad {
  position: relative;
  margin: var(--space-1) 0 0;
  padding-left: 14px;
  font-size: 12px;
  color: var(--c-red);
}
.bad .dot {
  left: 0;
  top: 7px;
  background: var(--c-red);
}
.btns {
  display: flex;
  gap: var(--space-2);
  margin-top: 6px;
}
.btn {
  font: inherit;
  font-size: 13px;
  padding: 2px 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
}
.btn:hover {
  border-color: var(--accent);
}
.ghost {
  color: var(--text-3);
}
.note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-3);
}
/* —— 工具块（P1a）：外形与提议块同一套，只多"轮次"与"结果摘要"两样 —— */
.tools {
  margin: var(--space-2) 0 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--border-soft) 12%, transparent);
  max-width: 100%;
}
.round {
  margin: var(--space-1) 0 0;
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
/* 结果摘要压在一行的右半边：太长就省略，全文在 title 里（不挤掉动作名） */
.detail {
  flex: 0 1 auto;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-3);
}
</style>
