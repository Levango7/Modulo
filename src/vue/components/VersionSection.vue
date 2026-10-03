<script setup lang="ts">
/**
 * 设置页里的「版本」一块：显示当前版本 + 一枚「检查更新」。
 *
 * 定位要说清楚：**它不是自动更新**，只是"有新版了，去看一眼"。
 * 自动更新要代码签名（证书 + updater 公钥），那是另一笔要花的钱，
 * 而眼下更急的问题是"装过旧版的人根本不知道出了新版"。
 *
 * 两条克制：
 * ① **不在启动时自动查** —— 一次启动不该顺手给 GitHub 发请求，改成用户点了才查；
 * ② 桌面壳里不给「点开下载页」的按钮 —— WebView 里 `target="_blank"` 不会打开系统浏览器，
 *    一枚点了没反应的按钮比一段可复制的地址糟糕得多。
 */
import { inject } from 'vue'
import { isDesktop } from '../useShell'
import { useUpdateCheck } from '../useUpdateCheck'
import type { StorageAdapter } from '../store'

const updates = useUpdateCheck(inject<StorageAdapter>('storage') ?? undefined)
</script>

<template>
  <section>
    <h3>版本</h3>
    <div class="row wrap">
      <span class="muted">当前 {{ updates.current }}</span>
      <button :disabled="updates.state.value.status === 'checking'" @click="updates.check(true)">
        {{ updates.state.value.status === 'checking' ? '检查中…' : '检查更新' }}
      </button>
    </div>
    <p v-if="updates.state.value.status === 'found'" class="update" role="status">
      有新版 <strong>{{ updates.state.value.info.latest }}</strong>（{{ updates.current }}）。
      <a v-if="!isDesktop" :href="updates.state.value.info.url" target="_blank" rel="noreferrer">去看下载页</a>
      <code v-else>{{ updates.state.value.info.url }}</code>
      <span v-if="updates.state.value.info.notes" class="muted"> {{ updates.state.value.info.notes }}</span>
    </p>
    <p v-else-if="updates.state.value.status === 'current'" class="muted hint">已是最新。</p>
    <p v-else-if="updates.state.value.status === 'failed'" class="muted hint">
      查不到（{{ updates.state.value.message }}）。这不影响任何功能，下次再点一次就行。
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
</style>
