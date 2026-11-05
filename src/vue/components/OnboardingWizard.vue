<script setup lang="ts">
/**
 * 首启一屏（2026-11-05 改天换地 PR-C；前身是三步向导 F-10）。
 * 设计口径见 `docs/PRODUCT.md` §1.1，正文见 `src/vue/onboarding.ts` 文件头。
 *
 * 只有一条纪律要守：**它不替用户改任何东西**。三个动作各自有明确后果且都经用户点击：
 * 「让 AI 开始」只打开对话坞（不碰版面）；「我从空白开始」清空版面（一步历史，可 Ctrl+Z）；
 * 「先看模板」只打开模板选择器。 Esc / × / 点遮罩 = 跳过，什么都不动。
 *
 * 跳过与走完都记 `done`（见 `onboarding.ts`），所以"再也不弹"与"以后还想看"分别由
 * 「跳过」和「设置 → 关于 → 重新播放首启引导」承接 —— 不需要一个"别再显示"的复选框。
 */
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useFocusTrap } from '../useFocusTrap'
import type { OnboardingApi } from '../onboarding'
import type { LayoutStore } from '../store'

/** App 提供的两个"开门"动作：开对话坞 / 开模板选择器（都不直接改数据） */
export interface WelcomeApi {
  startAI: () => void
  templates: () => void
}

const store = inject<LayoutStore>('store')!
const onboarding = inject<OnboardingApi>('onboarding')!
const welcome = inject<WelcomeApi>('welcome')!

const rootEl = ref<HTMLElement | null>(null)
useFocusTrap(rootEl)

function startAI(): void {
  welcome.startAI()
  onboarding.finish({ skipped: false })
}

function blank(): void {
  // 清空版面走 store.clear()：一步历史，用户反悔就 Ctrl+Z（与手动删空等价）
  store.clear()
  onboarding.finish({ skipped: false })
}

function templates(): void {
  welcome.templates()
  onboarding.finish({ skipped: false })
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
    <div ref="rootEl" class="wizard" role="dialog" aria-modal="true" aria-label="首启" tabindex="-1">
      <button class="x" title="跳过 (Esc)" data-skip @click="skip"><X :size="16" /></button>
      <h2>这一屏，交给 AI 布置。</h2>
      <p class="sub">说一句话，它建卡、记账、总结、盯梢——产出留在你布置得明的桌面上。</p>
      <div class="actions">
        <button class="primary" data-start @click="startAI">让 AI 开始</button>
        <button class="ghost" data-blank @click="blank">我从空白开始</button>
        <button class="ghost" data-templates @click="templates">先看模板</button>
      </div>
      <p class="fine">不用注册；数据在这台机器上。</p>
    </div>
  </div>
</template>

<style scoped>
.wizard {
  position: relative;
  width: min(460px, calc(100vw - 48px));
  max-height: min(86vh, 720px);
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-5) var(--space-5);
  background: var(--bg-card-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-hover);
}
.welcome h2 {
  margin: 0;
  font-size: 22px;
  letter-spacing: 0.01em;
}
.sub {
  margin: 0;
  max-width: 360px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2);
}
.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  margin-top: var(--space-2);
}
.actions .primary {
  padding: var(--space-3);
  font-size: 14px;
  font-weight: 600;
}
.actions .ghost {
  padding: var(--space-3);
  font-size: 13px;
}
.fine {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
}
/* 弹窗本体（scrim / .welcome 的卡片感）：沿用向导时代的壳 —— 居中、遮罩、圆角 */
.scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: var(--scrim);
}
.x {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  border: none;
  background: transparent;
  color: var(--text-3);
  display: grid;
  place-items: center;
}
</style>
