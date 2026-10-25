<script setup lang="ts">
/**
 * 设置页里的「多端同步」一块（WebDAV：用户自带网盘）。
 *
 * 这一块的设计约束只有一条：**同步会覆盖数据，界面上必须看得见它在干什么**。
 * 所以有三处不能省：① 端点/用户名/口令各自明说存在哪（口令默认只在内存）；
 * ② 有下载时先出确认块，逐段写清"为什么以网盘为准"；③ 每次动作的结果都落在
 * 状态行与提示列表里，不靠 toast 一闪而过。
 */
import { inject, onMounted, ref } from 'vue'
import { describePending, type SyncApi } from '../useSync'

const sync = inject<SyncApi>('sync')!
const endpoint = ref(sync.settings.value.endpoint)
const user = ref(sync.settings.value.user)

const saveFields = () =>
  sync.save({
    endpoint: endpoint.value.trim(),
    user: user.value.trim(),
    remember: sync.settings.value.remember,
  })

async function toggleRemember(e: Event) {
  const on = (e.target as HTMLInputElement).checked
  if (on) saveFields()
  try {
    await sync.rememberPassword(on)
  } catch (err) {
    sync.status.value = 'error'
    sync.message.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(() => void sync.init())

const statusLabel = { idle: '', busy: '进行中…', ok: '完成', error: '失败' } as const
</script>

<template>
  <section>
    <h3>多端同步</h3>
    <p class="muted small">
      用你自己的网盘（支持 WebDAV，如 Nextcloud / 坚果云）在几台机器之间搬数据。<b>不注册账号</b> ——
      地址、用户名、口令都是你自己的；同步的是版面、方案册、卡片内容与外观设置，<b>不含密钥与各类缓存</b>。
    </p>

    <template v-if="sync.usable">
      <div class="row wrap">
        <label class="field grow">
          <span>网盘目录</span>
          <input v-model="endpoint" type="url" placeholder="https://dav.example.com/dav/modulo/" @change="saveFields" />
        </label>
        <label class="field">
          <span>用户名</span>
          <input v-model="user" type="text" autocomplete="username" @change="saveFields" />
        </label>
      </div>
      <div class="row wrap">
        <label class="field grow">
          <span>口令</span>
          <input
            v-model="sync.password.value"
            type="password"
            autocomplete="current-password"
            :placeholder="sync.hasStored.value ? '已保存在系统凭据库（留空即用它）' : '只在这台机器的内存里'"
          />
        </label>
        <label class="check">
          <input type="checkbox" :checked="sync.settings.value.remember" @change="toggleRemember" />
          <span>记住口令（存进 Windows 凭据管理器）</span>
        </label>
      </div>
      <div class="row wrap">
        <button @click="saveFields">保存设置</button>
        <button @click="sync.test()">测试连接</button>
        <button class="primary" :disabled="sync.status.value === 'busy'" @click="sync.syncNow()">立即同步</button>
      </div>
      <p v-if="sync.settings.value.lastSyncAt" class="muted small">
        上次同步：{{ new Date(sync.settings.value.lastSyncAt).toLocaleString() }} · 本机标识
        <code>{{ sync.settings.value.deviceId }}</code>
      </p>
      <p v-else class="muted small">还没同步过。第一次会把本机这几段整份推到你填的目录。</p>

      <!--
        覆盖前的确认：逐段说清为什么以网盘为准。上传不在这里问 ——
        它只动网盘上的那份，而且覆盖前会先把远端那份留成历史副本。
      -->
      <div v-if="sync.pending.value" class="confirm" role="group" aria-label="确认以网盘为准">
        <p class="muted">这几段网盘上更新，确认后会写入本机：</p>
        <ul>
          <li v-for="d in sync.pending.value.decisions.filter((x) => x.winner === 'remote')" :key="d.section">
            <b>{{ d.section }}</b> —— {{ d.reason }}
          </li>
        </ul>
        <p class="muted small">{{ describePending(sync.pending.value) }}</p>
        <div class="row">
          <button class="primary" @click="sync.confirmApply()">确认以网盘为准</button>
          <button @click="sync.cancelApply()">取消</button>
        </div>
      </div>

      <p v-if="sync.message.value" class="status" :class="sync.status.value">
        <span v-if="statusLabel[sync.status.value]">{{ statusLabel[sync.status.value] }}：</span>{{ sync.message.value }}
      </p>
      <ul v-if="sync.notices.value.length" class="notices">
        <li v-for="(n, i) in sync.notices.value" :key="i">{{ n }}</li>
      </ul>
    </template>
    <p v-else class="muted small">网页版没有同步通道（同步要由桌面壳发 WebDAV 请求）；桌面版可用。</p>

    <p class="hint">
      同步按<b>段</b>合并：版面、方案册、卡片内容、外观各算一段，谁更新听谁的；两边内容一致就不搬。
      口令默认只在内存里，勾了「记住口令」才进系统凭据管理器（卸载不会带走它）。
      自家 NAS 需要公网 https 域名或反向代理 —— 本程序拒绝内网地址，与连通性监控同一条边界。
    </p>
  </section>
</template>

<style scoped>
.row {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: var(--space-2);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field.grow {
  flex: 1 1 260px;
}
.field span {
  font-size: 11px;
  color: var(--text-3);
}
.field input {
  padding: 6px var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-1);
  font-size: 12px;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  padding-bottom: 6px;
}
p.small {
  font-size: 12px;
}
.status {
  margin: var(--space-2) 0 0;
  font-size: 12px;
  color: var(--text-2);
}
.status.error {
  color: var(--c-red);
}
.status.ok {
  color: var(--c-green);
}
.confirm {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px solid color-mix(in srgb, var(--c-amber) 45%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--c-amber) 8%, transparent);
  display: grid;
  gap: var(--space-2);
}
.confirm ul {
  margin: 0;
  padding-left: var(--space-4);
  font-size: 12px;
  line-height: 1.6;
}
.confirm p {
  margin: 0;
  font-size: 12px;
}
.notices {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-4);
  font-size: 12px;
  color: var(--text-3);
}
.hint {
  margin: var(--space-3) 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-3);
}
</style>
