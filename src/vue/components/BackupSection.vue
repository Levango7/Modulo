<script setup lang="ts">
/**
 * 设置页里的「完整备份」一块。
 *
 * 抽出来不是为了行数好看，而是因为它带着一条**破坏性动作**：恢复会覆盖用户写的字。
 * 这类东西一旦混在一个 600 行组件里，很容易在改别处时被顺手改掉而没人发现 ——
 * 单独成组件之后，"它有确认块、它有事实摘要"这两件事都在一个短文件里看得完。
 */
import { inject, onMounted } from 'vue'
import type { BackupApi } from '../useBackup'

const backup = inject<BackupApi>('backup')!
// 列表来自盘上的索引：进设置页时刷新一次，别让用户看到上次打开时的旧列表
onMounted(() => backup.refreshAuto())
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
      <!--
        来历摆在覆盖之前。一份备份会跟着用户换机器、换版本到处搬，
        「哪一版、哪天导出的」答不上来时，覆盖就是在赌。
      -->
      <p v-if="backup.pending.value.parsed.meta" class="muted meta">
        导出自 <strong>Modulo {{ backup.pending.value.parsed.meta.app || '未知版本' }}</strong>
        <template v-if="backup.pending.value.parsed.meta.createdAt">（{{ backup.pending.value.parsed.meta.createdAt }}）</template>
        <template v-if="backup.pending.value.parsed.meta.version !== null">，备份格式 v{{ backup.pending.value.parsed.meta.version }}</template>。
      </p>
      <p class="muted">恢复会覆盖当前的版面与卡片内容。版面可 Ctrl+Z 退回，文字与方案不能。</p>
      <div class="row">
        <button class="primary" @click="backup.confirmRestore()">确认恢复</button>
        <button @click="backup.cancelRestore()">取消</button>
      </div>
    </div>
    <div v-if="backup.autoSupported.value" class="auto">
      <h4>自动备份（保留最近 7 份）</h4>
      <p class="muted small">每日首次启动、恢复前、版本变化后的首次启动各留一份；只存在本机。</p>
      <div class="row wrap">
        <button @click="backup.runAutoBackup('manual')">立即备份</button>
        <button @click="backup.refreshAuto()">刷新列表</button>
      </div>
      <ul v-if="backup.autoBackups.value.length" class="auto-list">
        <li v-for="m in backup.autoBackups.value" :key="m.slot">
          <span class="at">{{ new Date(m.at).toLocaleString() }}</span>
          <span class="muted meta">{{ backup.reasonLabel(m.reason) }} · {{ Math.round(m.bytes / 1024) }} KB · Modulo {{ m.app }}</span>
          <button @click="backup.restoreAuto(m)">恢复这份</button>
        </li>
      </ul>
      <p v-else class="muted small">还没有自动备份 —— 首次启动或距上一份满 24 小时时会自动生成。</p>
    </div>
    <p v-else class="muted small">网页版不启用自动备份（localStorage 有配额限制）；请定期手动导出。</p>
    <p class="hint">
      备份文件装着<b>版面、方案册、卡片内容与外观设置</b>（含记账 / 四象限 / 习惯 / 订阅等全部卡片数据）—— 换机器或重装时靠它。
      恢复前会把包里有什么先摆出来，确认之后才整份覆盖；<b>恢复前会自动留一份现场</b>（桌面版）。
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
.confirm p.meta {
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}
.confirm strong {
  font-weight: 500;
  color: var(--text-1);
}
.auto {
  margin-top: var(--space-3);
  display: grid;
  gap: var(--space-2);
}
.auto h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
}
.auto-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
  max-height: 180px;
  overflow: auto;
}
.auto-list li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}
.auto-list .at {
  font-variant-numeric: tabular-nums;
}
.auto-list .meta {
  flex: 1;
  font-size: 11px;
}
button.primary {
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 500;
}
</style>
