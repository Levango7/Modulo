<script setup lang="ts">
/**
 * 「取消」确认框（2026-10-24，App.vue 拆分 Cut C2 / 编辑事务 2026-10-12 的原物）。
 *
 * 只弹在**有改动**的取消上 —— 无改动时取消直接走人，不打扰。
 * 不是 `window.confirm`：原生弹窗在 Tauri 里样式跟不上，而且它不能被
 * Esc / 外点关闭的统一逻辑收编（Esc 七层级联见 `useGlobalKeys.ts`）。
 *
 * 组件**零状态**（同 `AppToolbar.vue` / `NoticeStrip.vue`）：开与关、改动计数都由 App
 * 持有，这里只做"显示 + 把三个动作 emit 回去"。
 *
 * 硬约束：**DOM 逐字不变** —— E2E 的 `tx-scrim` class、`role=dialog` / `aria-modal` /
 * `aria-label="放弃这次编辑"`、两个按钮文本（「继续编辑」/「放弃改动」）全压在这上面。
 */
defineProps<{
  /** 是否弹出 */
  open: boolean
  /** 版面改动的处数（文案里如实说一句，让用户知道会丢多少） */
  changeCount: number
}>()

const emit = defineEmits<{
  /** 点遮罩 / 点「继续编辑」：关掉，继续编辑 */
  dismiss: []
  /** 点「放弃改动」：整份还原到进编辑器之前（还原本身也能 Ctrl+Z 找回） */
  confirm: []
}>()
</script>

<template>
  <div v-if="open" class="tx-scrim" role="dialog" aria-modal="true" aria-label="放弃这次编辑" @click.self="emit('dismiss')">
    <div class="tx-dialog">
      <h4>放弃这次编辑？</h4>
      <p class="muted">版面有 {{ changeCount }} 处改动，取消后全部还原到进编辑器之前（还原本身也能 Ctrl+Z 找回）。</p>
      <div class="tx-actions">
        <button class="wide" @click="emit('dismiss')">继续编辑</button>
        <button class="wide danger" @click="emit('confirm')">放弃改动</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tx-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: grid;
  place-items: center;
  background: var(--scrim);
}
.tx-dialog {
  width: min(380px, calc(100vw - 48px));
  padding: var(--space-5);
  background: var(--bg-card-solid);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-hover);
}
.tx-dialog h4 {
  margin: 0 0 var(--space-2);
  font-size: 15px;
}
.tx-dialog p {
  margin: 0 0 var(--space-4);
  font-size: 13px;
  line-height: 1.6;
}
.tx-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
.tx-actions button.wide {
  height: 28px;
}
/* 放弃类是破坏性动作：hover 用危险色的淡底，不用品牌色 */
.tx-actions button.danger {
  border-color: var(--c-red);
  color: var(--c-red);
}
.tx-actions button.danger:hover {
  background: color-mix(in oklab, var(--c-red) 12%, var(--bg-card));
}
</style>
