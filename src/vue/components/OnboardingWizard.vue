<script setup lang="ts">
/**
 * 首启三步向导（F-10，2026-10-28）。设计稿见 `docs/design/F-10-SETTINGS-IA.md` §4。
 *
 * 只有一条纪律要守：**它不替用户改任何东西**。第 1 步点一张模板才应用（照旧可 Ctrl+Z），
 * 第 2 步点一下才改外观，第 3 步只是把三条"你可能不知道"摆出来然后关掉。
 *
 * 跳过与走完都记 `done`（见 `onboarding.ts`），所以"再也不弹"与"以后还想看"分别由
 * 「跳过」和「设置 → 关于 → 重新播放首启引导」承接 —— 不需要一个"别再显示"的复选框。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import * as E from '@levango7/engine'
import { Check, X } from 'lucide-vue-next'
import { ACCENTS, MODES, SKINS } from '../appearance'
import { useFocusTrap } from '../useFocusTrap'
import { clampStep, isLastStep, ONBOARDING_STEPS, stepAt } from '../onboarding'
import type { OnboardingApi } from '../onboarding'
import type { LayoutStore } from '../store'
import { isDesktop } from '../useShell'
import type { AppearanceApi } from '../useAppearance'

const store = inject<LayoutStore>('store')!
const appearance = inject<AppearanceApi>('appearance')!
const onboarding = inject<OnboardingApi>('onboarding')!
const a = appearance.state

const rootEl = ref<HTMLElement | null>(null)
useFocusTrap(rootEl)

const step = ref(0)
const current = computed(() => stepAt(step.value))
const last = computed(() => isLastStep(step.value))
const total = ONBOARDING_STEPS.length
/** 第 1 步点过哪一张（只为给一个"已经换过去了"的勾，不改判定） */
const picked = ref<string | null>(null)

const templates = E.TEMPLATES

function pick(id: string): void {
  if (store.applyTemplate(id)) picked.value = id
}

function next(): void {
  if (last.value) {
    onboarding.finish({ skipped: false })
    return
  }
  step.value = clampStep(step.value + 1)
}

function back(): void {
  step.value = clampStep(step.value - 1)
}

function skip(): void {
  onboarding.finish({ skipped: true })
}

/** Esc = 跳过（与「×」同义）；捕获阶段拦下，别让 App 的全局按键再处理一遍 */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  skip()
}
onMounted(() => document.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="scrim" @click.self="skip">
    <div ref="rootEl" class="wizard" role="dialog" aria-modal="true" aria-label="首启引导" tabindex="-1">
      <header class="head">
        <div>
          <p class="kicker">第 {{ step + 1 }} 步 / 共 {{ total }} 步</p>
          <h2>{{ current.title }}</h2>
        </div>
        <button class="skip" title="跳过引导 (Esc)" data-skip @click="skip">跳过</button>
        <button class="x" title="跳过引导 (Esc)" @click="skip"><X :size="16" /></button>
      </header>

      <p class="hint">{{ current.hint }}</p>

      <!-- ① 挑版面：点一张即时生效 -->
      <div v-if="current.id === 'layout'" class="templates" role="group" aria-label="版面模板">
        <button
          v-for="t in templates"
          :key="t.id"
          class="tpl"
          :data-tpl="t.id"
          :data-active="picked === t.id"
          @click="pick(t.id)"
        >
          <span class="tpl-name">{{ t.name }}<Check v-if="picked === t.id" :size="13" class="tick" /></span>
          <span class="tpl-blurb">{{ t.blurb }}</span>
          <span class="tpl-aud">{{ t.audience }}</span>
        </button>
      </div>

      <!-- ② 选外观：即时预览 -->
      <div v-else-if="current.id === 'look'" class="look">
        <div class="skins">
          <button
            v-for="s in SKINS"
            :key="s.id"
            class="skin"
            :data-active="a.skin === s.id"
            @click="appearance.set({ skin: s.id })"
          >
            <span class="dot" :data-s="s.id" />
            <span class="name">{{ s.label }}</span>
            <span class="desc">{{ s.desc }}</span>
          </button>
        </div>
        <div class="seg">
          <button v-for="m in MODES" :key="m.id" :data-active="a.mode === m.id" @click="appearance.set({ mode: m.id })">
            {{ m.label }}
          </button>
        </div>
        <div class="accents">
          <button
            v-for="c in ACCENTS"
            :key="c.id"
            class="swatch"
            :title="c.label"
            :data-active="a.accent === c.id"
            :data-auto="c.value === 'auto'"
            :style="c.value === 'auto' ? undefined : { background: c.value }"
            @click="appearance.set({ accent: c.value })"
          >
            <Check v-if="a.accent === c.id" :size="12" />
          </button>
        </div>
      </div>

      <!-- ③ 三条"你可能不知道" -->
      <ul v-else class="facts">
        <li v-if="isDesktop">
          <kbd>Ctrl+Shift+Space</kbd> 在哪儿都能把它叫到前面；快捷键能在「设置 → 桌面」里改。
        </li>
        <li v-if="isDesktop">点关闭是<strong>收进托盘</strong>，不是退出 —— 不想这样可以在同一组里关掉。</li>
        <li>
          想在家里和公司两台机器上接着用：<strong>设置 → 数据 → 多端同步</strong>，
          用你自己的网盘，不注册账号，数据不经过任何第三方服务。
        </li>
        <li v-if="!isDesktop">设置一共分五组（桌面版多一组「桌面」），要找的东西都能在「设置」里定位到。</li>
      </ul>

      <footer class="foot">
        <button v-if="step > 0" class="ghost" data-back @click="back">上一步</button>
        <button v-if="current.id === 'layout'" class="ghost" data-skip-step @click="next">先不选</button>
        <button class="primary" :data-next="current.id" @click="next">{{ last ? '开始用' : '下一步' }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--scrim);
  display: grid;
  place-items: center;
  padding: var(--space-4);
}
.wizard {
  width: min(620px, 100%);
  max-height: min(86vh, 720px);
  overflow: auto;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-hover);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}
.head h2 {
  margin: 2px 0 0;
  font-size: 17px;
}
.kicker {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
}
.skip {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-2);
}
.x {
  border: none;
  background: transparent;
  display: grid;
  place-items: center;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}
.templates {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-2);
}
.tpl {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  padding: var(--space-3);
}
.tpl-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.tpl-blurb {
  font-size: 12px;
  color: var(--text-2);
}
.tpl-aud {
  font-size: 11px;
  color: var(--text-3);
}
.tpl[data-active='true'] {
  border-color: var(--accent);
}
.tpl .tick {
  color: var(--brand-500);
}
.look {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.skins {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2);
}
.skin {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px var(--space-2);
  text-align: left;
  padding: var(--space-3);
}
.skin .name {
  font-weight: 600;
}
.skin .desc {
  grid-column: 2;
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.4;
}
.skin .dot {
  grid-row: span 2;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
}
.dot[data-s='ink'] {
  background: linear-gradient(135deg, #fff 50%, #c93c16 50%);
}
.dot[data-s='aurora'] {
  background: linear-gradient(135deg, #eceff6, #ffb8d0);
}
.dot[data-s='candy'] {
  background: linear-gradient(135deg, #ffd9a0, #ff5c8a);
}
.skin[data-active='true'] {
  border-color: var(--accent);
}
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--bg-card-soft);
  border: 1px solid var(--border-soft);
  align-self: flex-start;
}
.accents {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.swatch {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--border-strong);
}
.swatch svg {
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.55));
}
.swatch[data-auto='true'] {
  background: conic-gradient(#f43f5e, #f59e0b, #22c55e, #3b82f6, #8b5cf6, #f43f5e);
}
.swatch[data-active='true'] {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
.facts {
  margin: 0;
  padding-left: 1.2em;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2);
}
.facts kbd {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  background: var(--bg-card-soft);
  white-space: nowrap;
}
.foot {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
  margin-top: var(--space-2);
}
.ghost {
  background: transparent;
}
.primary {
  font-weight: 600;
}
</style>
