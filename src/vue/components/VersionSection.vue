<script setup lang="ts">
/**
 * 设置页里的「版本」一块。
 *
 * 两条路，按运行环境分（判定在 `useUpdateCheck` 里）：
 * - **网页版**：只查 GitHub Releases，显示"有新版"与下载页链接 —— 浏览器里没有安装能力。
 * - **桌面壳**：查 Release 里的 `latest.json`，可以**下载 → 本地验签 → 重启并安装**。
 *
 * 克制照旧：**不在启动时自动查**、不自动下载、不自动安装 —— 三件事都由用户点出来。
 * 桌面壳里仍不给「点开下载页」的链接：WebView 里 `target="_blank"` 不会打开系统浏览器。
 */
import { computed, inject } from 'vue'
import { formatBytes, progressPct } from '@levango7/engine/update'
import { useUpdateCheck } from '../useUpdateCheck'
import type { StorageAdapter } from '../store'

const updates = useUpdateCheck(inject<StorageAdapter>('storage') ?? undefined)
const st = computed(() => updates.state.value)
const busy = computed(() => st.value.status === 'checking' || st.value.status === 'downloading' || st.value.status === 'installing')
</script>

<template>
  <section>
    <h3>版本</h3>
    <div class="row wrap">
      <span class="muted">当前 {{ updates.current }}</span>
      <button :disabled="busy" @click="updates.check(true)">
        {{ st.status === 'checking' ? '检查中…' : '检查更新' }}
      </button>
    </div>

    <p v-if="st.status === 'found'" class="update" role="status">
      有新版 <strong>{{ st.info.latest }}</strong>（{{ updates.current }}）。
      <button v-if="updates.desktop" @click="updates.download()">下载更新</button>
      <a v-else :href="st.info.url" target="_blank" rel="noreferrer">去看下载页</a>
      <span v-if="st.info.notes" class="muted"> {{ st.info.notes }}</span>
    </p>

    <p v-else-if="st.status === 'downloading'" class="update" role="status">
      正在下载 {{ formatBytes(st.progress.downloaded) }}<template v-if="progressPct(st.progress) !== null">（{{ progressPct(st.progress) }}%）</template>……
    </p>

    <p v-else-if="st.status === 'downloaded'" class="update" role="status">
      下载完成，签名校验通过。
      <button @click="updates.install()">重启并安装</button>
      <span class="muted">会先关掉 Modulo，装完自动重开。</span>
    </p>

    <p v-else-if="st.status === 'installing'" class="muted hint">正在安装，Modulo 会自行重启……</p>
    <p v-else-if="st.status === 'current'" class="muted hint">已是最新。</p>
    <p v-else-if="st.status === 'failed'" class="muted hint">
      没成（{{ st.message }}）。这不影响任何功能，下次再点一次就行。
    </p>
    <p v-else-if="updates.desktop" class="hint">
      桌面版可以直接在应用内更新：点「检查更新」→「下载更新」→「重启并安装」，下载后会先在本地验签。
      仍不在启动时联网，这三件事都要你自己点。安装包没有 Authenticode 代码签名，Windows 首次运行仍会提示「未知发布者」。
    </p>
    <p v-else class="hint">
      Modulo 不会自动更新，也不会在启动时联网。查一下只发一次请求到 GitHub。
      安装包没有代码签名，Windows SmartScreen 会提示「未知发布者」—— 核对 Release 页上的 sha256 再运行。
    </p>
  </section>
</template>

<style scoped>
.update {
  margin: var(--space-3) 0 0;
  font-size: 12px;
  line-height: 1.6;
}
.update strong {
  font-weight: 500;
  color: var(--text-1);
}
.update a {
  color: var(--brand-600);
}
.update button {
  margin: 0 var(--space-2);
}
</style>
