<script setup lang="ts">
/**
 * 设置页里的「完整备份」一块。
 *
 * 抽出来不是为了行数好看，而是因为它带着一条**破坏性动作**：恢复会覆盖用户写的字。
 * 这类东西一旦混在一个 600 行组件里，很容易在改别处时被顺手改掉而没人发现 ——
 * 单独成组件之后，"它有确认块、它有事实摘要"这两件事都在一个短文件里看得完。
 */
import { inject } from 'vue'
import type { BackupApi } from '../useBackup'

const backup = inject<BackupApi>('backup')!
</script>

<template>
  <section>
    <h3>完整备份</h3>
    <div class="row wrap">
      <button @click="backup.exportBackup()">导出备份（含内容）</button>
      <button @click="backup.chooseBackupToRestore()">从备份恢复…</button>
    </div>
    <!--
      恢复是覆盖，所以先把这份包里有什么摆出来再问一次。
      「版面可 Ctrl+Z 退回」是真的（走 store.importJson），但内容与方案册不是 —— 所以确认按钮必须显式。
    -->
    <div v-if="backup.pending.value" class="confirm" role="group" aria-label="确认恢复">
      <p class="muted">
        这份备份里有 <strong>{{ backup.pending.value.modules }}</strong> 个模块、<strong>{{ backup.pending.value.todos }}</strong> 条待办、<strong>{{ backup.pending.value.notes }}</strong> 条速记<template v-if="backup.pending.value.sticky">、有便签正文</template><template v-if="backup.pending.value.countdown">、设过倒数日</template>，<strong>{{ backup.pending.value.schemes }}</strong> 套版面方案。
      </p>
      <p class="muted">恢复会覆盖当前的版面与卡片内容。版面可 Ctrl+Z 退回，文字与方案不能。</p>
      <div class="row">
        <button class="primary" @click="backup.confirmRestore()">确认恢复</button>
        <button @click="backup.cancelRestore()">取消</button>
      </div>
    </div>
    <p class="hint">
      备份文件装着<b>版面、方案册和卡片内容</b>（便签 / 待办 / 速记的正文、倒数日）—— 换机器或重装时靠它。
      下面那两枚只搬版面与方案，不含文字。
    </p>
    <ul v-if="backup.notices.value.length" class="notices">
      <li v-for="(n, i) in backup.notices.value" :key="i">{{ n }}</li>
    </ul>
  </section>
</template>

<style scoped>
.confirm {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px solid color-mix(in srgb, var(--c-amber) 45%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--c-amber) 8%, transparent);
  display: grid;
  gap: var(--space-2);
}
.confirm p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}
.confirm strong {
  font-weight: 500;
  color: var(--text-1);
}
button.primary {
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 500;
}
</style>
