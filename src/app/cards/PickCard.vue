<script setup lang="ts">
/**
 * 随机抽签：一份名单，点一下抽一个。可给每项加权。
 *
 * 名单存在 `cardData.pickList`（**跟着完整备份走**）—— 用户敲的字是内容。
 * 抽签逻辑在 `@levango7/engine/random` 的 `pickWeighted`，**RNG 由这里注入**
 * （`crypto.getRandomValues` 包成 `() => number`）：引擎不碰环境全局，假 RNG 就能把
 * "权重 0 永远抽不到""全 0 权重怎么办"这些边角在单测里钉死。
 */
import { computed, inject, ref } from 'vue'
import { pickWeighted } from '@levango7/engine/random'
import { Dices, Plus, Trash2 } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

/** 引擎要 `() => number`（[0,1)）。这里才摸 crypto —— 引擎的构建 lib 里没有它 */
function rng(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] / 0x1_0000_0000
}

const draft = ref('')
const picked = ref<string | null>(null)
/** 抽签结果是谁决定的标记：换名单后立刻作废旧结果，不能让"上一次抽到 X"对新名单生效 */
const pickedFor = ref(0)

const list = computed(() => cards.state.pickList)
const signature = computed(() => list.value.map((x) => `${x.id}:${x.weight}`).join('|'))
const result = computed(() => (picked.value !== null && pickedFor.value === hash() ? picked.value : null))

function add(): void {
  const t = draft.value.trim()
  if (!t) return
  cards.addPick(t)
  draft.value = ''
}

function draw(): void {
  const hit = pickWeighted(list.value, rng)
  picked.value = hit ? hit.label : null
  pickedFor.value = hash()
}

/** 名单的指纹：加一条 / 改权重都算换了一份名单，旧结果随之作废 */
function hash(): number {
  const s = signature.value
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
</script>

<template>
  <div class="card pick" :data-v="variant">
    <div class="card-body">
      <template v-if="list.length">
        <div class="top">
          <span class="label">抽签 · {{ list.length }} 项</span>
          <Dices class="ico" :size="14" />
        </div>

        <p class="result" :data-empty="result === null">
          <template v-if="result !== null">{{ result }}</template>
          <template v-else-if="list.some((x) => (x.weight ?? 1) > 0)">点下面抽一个</template>
          <template v-else>权重全是 0，抽不出来</template>
        </p>

        <div class="acts">
          <button class="primary" :disabled="!list.some((x) => (x.weight ?? 1) > 0)" @click="draw()">抽</button>
          <input v-model="draft" class="in" maxlength="24" placeholder="加一项" aria-label="新增抽签项" @keydown.enter.prevent="add()" />
          <button class="add" title="加入名单" aria-label="加入名单" @click="add()"><Plus :size="13" /></button>
        </div>

        <ul v-if="variant === 'panel'" class="list">
          <li v-for="x in list" :key="x.id">
            <span class="li">{{ x.label }}</span>
            <label class="w">
              <span class="wl">×{{ x.weight ?? 1 }}</span>
              <input
                class="wi"
                type="number"
                min="0"
                max="99"
                step="1"
                :aria-label="`${x.label} 的权重`"
                :value="x.weight ?? 1"
                @input="cards.setPickWeight(x.id, Number(($event.target as HTMLInputElement).value))"
              />
            </label>
            <button class="del" :aria-label="`删除 ${x.label}`" @click="cards.removePick(x.id)"><Trash2 :size="11" /></button>
          </li>
        </ul>
      </template>

      <template v-else>
        <div class="top">
          <Dices class="ico" :size="16" />
        </div>
        <p class="hint">敲几行进来，就能抽了</p>
        <div class="acts">
          <input v-model="draft" class="in" placeholder="比如：谁去取快递" aria-label="新增抽签项" @keydown.enter.prevent="add()" />
          <button class="add" title="加入名单" aria-label="加入名单" @click="add()"><Plus :size="13" /></button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pick .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1.2cqw, 9px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.ico {
  color: var(--mod, var(--brand-500));
}
.result {
  margin: 0;
  font-size: clamp(13px, 4.6cqw, 20px);
  line-height: 1.35;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.result[data-empty='true'] {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-3);
}
.acts {
  display: flex;
  align-items: center;
  gap: 4px;
}
.acts .primary {
  flex: 0 0 auto;
  font-size: clamp(12px, 3cqw, 14px);
  padding: 2px 12px;
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 600;
}
.acts .primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
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
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-block-size: 40cqh;
  overflow: auto;
}
.list li {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.li {
  flex: 1 1 auto;
  min-width: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.w {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 3px;
}
.wl {
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.wi {
  inline-size: 3.2em;
  font-size: clamp(11px, 2cqw, 11px);
  padding: 0 2px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.del {
  flex: 0 0 auto;
  display: inline-flex;
  padding: 1px;
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
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
</style>
