<script setup lang="ts">
/**
 * 设置页「实验室 → 织布机运行时」（β1 可选组件，用户 2026-11-24 裁决）。
 *
 * 这一节管的是**织布机的运行环境**，不是 MCP 服务本身：
 *   下载一份自包含的运行时（CPython + 织布机源码），装到 `%APPDATA%/app.modulo/loom/<版本>/`，
 *   版本目录并列、可回退；装好后给一段**可复制的 MCP 配置**（用户自己决定粘不粘）。
 *
 * 四条纪律（与 β 决策稿一致）：
 * 1. **打开面板不下载**：挂载只读本地状态（`loom_runtime_state`）；下载只在用户点了
 *    「安装 / 更新」之后发生，校验和不过就删、绝不留下半个目录。
 * 2. **不静默重试**：下载 / 校验 / 解压任何一步失败都人话，重试由用户决定。
 * 3. **不静默改 MCP 配置**：装好只给一段 JSON（`mcpConfigSnippet`），粘不粘由用户决定。
 * 4. **不静默删当前版**：`loom_runtime_remove` 拒删当前在用的那一版（按钮也不给）。
 */
import { computed, onMounted, ref } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import {
  humanBytes,
  mcpConfigSnippet,
  parseLoomManifest,
  safeLoomDashboardUrl,
  type LoomManifest,
  type LoomVersionChoice,
} from '../loomRuntime'

interface LoomState {
  current: string | null
  root: string
  versions: string[]
}
interface LoomProgress {
  stage: string
  received: number
  total: number
}
interface LoomDashboardInfo {
  running: boolean
  url: string | null
  version: string | null
  pid: number | null
}

/** 清单的默认地址（与运行时包同一个 Release；私有镜像 / 离线盘可以改这一格） */
const DEFAULT_MANIFEST_URL =
  'https://github.com/Levango7/Modulo/releases/download/loom-runtime-v0.1.0/loom-runtime.json'

const manifestUrl = ref(DEFAULT_MANIFEST_URL)
const manifest = ref<LoomManifest | null>(null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const state = ref<LoomState | null>(null)
const busy = ref(false)
const progress = ref<LoomProgress | null>(null)
const copied = ref(false)
const dashboard = ref<LoomDashboardInfo | null>(null)
const dashboardOpen = ref(false)
const dashboardBusy = ref(false)
const dashboardUrl = computed(() => safeLoomDashboardUrl(dashboard.value?.url))

const versions = computed<LoomVersionChoice[]>(() => {
  const current = state.value?.current ?? null
  return (state.value?.versions ?? []).map((version) => ({
    version,
    current: version === current,
    removable: version !== current,
  }))
})

const destDir = computed(() =>
  state.value?.current ? `${state.value.root}/${state.value.current}` : '',
)

async function refresh(): Promise<void> {
  state.value = await invoke<LoomState>('loom_runtime_state')
}

async function check(): Promise<void> {
  error.value = null
  manifest.value = null
  try {
    const r = await invoke<{ text: string; error: string }>('fetch_text', { url: manifestUrl.value })
    if (r.error) {
      error.value = `清单拉不下来：${r.error}`
      return
    }
    const m = parseLoomManifest(r.text)
    if (!m) {
      error.value = '清单形状不对（要 schemaVersion:1 + version + url + sha256 四样）'
      return
    }
    manifest.value = m
  } catch (e) {
    error.value = String(e)
  }
}

async function install(): Promise<void> {
  const m = manifest.value
  if (!m || busy.value) return
  busy.value = true
  error.value = null
  notice.value = null
  progress.value = null
  const chan = new Channel<LoomProgress>((p) => {
    progress.value = p
  })
  try {
    state.value = await invoke<LoomState>('loom_runtime_download', {
      url: m.url,
      sha256: m.sha256,
      version: m.version,
      onProgress: chan,
    })
    notice.value = `已装好 ${m.version}（${humanBytes(m.bytes ?? 0)}）`
    manifest.value = null
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
    progress.value = null
  }
}

async function useVersion(v: string): Promise<void> {
  error.value = null
  notice.value = null
  try {
    state.value = await invoke<LoomState>('loom_runtime_use', { version: v })
    notice.value = `已切到 ${v}`
  } catch (e) {
    error.value = String(e)
  }
}

async function remove(v: string): Promise<void> {
  error.value = null
  notice.value = null
  try {
    state.value = await invoke<LoomState>('loom_runtime_remove', { version: v })
    notice.value = `已删掉 ${v}`
  } catch (e) {
    error.value = String(e)
  }
}

async function copyConfig(): Promise<void> {
  const dir = destDir.value
  if (!dir) return
  const json = mcpConfigSnippet(`${dir}/python/python.exe`, `${dir}/run-mcp.py`)
  await navigator.clipboard.writeText(json)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

async function refreshDashboard(): Promise<void> {
  try {
    dashboard.value = await invoke<LoomDashboardInfo>('loom_dashboard_status')
  } catch (e) {
    error.value = String(e)
  }
}

async function openDashboard(): Promise<void> {
  if (dashboardBusy.value) return
  dashboardBusy.value = true
  error.value = null
  try {
    const current = dashboard.value?.running
      ? dashboard.value
      : await invoke<LoomDashboardInfo>('loom_dashboard_start')
    dashboard.value = current
    if (!current.running || !safeLoomDashboardUrl(current.url)) {
      throw new Error('交付面板返回了非法地址：只接受 127.0.0.1 的回环根地址')
    }
    dashboardOpen.value = true
  } catch (e) {
    error.value = String(e)
  } finally {
    dashboardBusy.value = false
  }
}

async function openExternal(): Promise<void> {
  const target = dashboardUrl.value
  if (!target) return
  error.value = null
  const failure = await invoke<string | null>('launch_target', { target })
  if (failure) error.value = failure
}

async function stopDashboard(): Promise<void> {
  if (dashboardBusy.value) return
  dashboardBusy.value = true
  error.value = null
  try {
    dashboard.value = await invoke<LoomDashboardInfo>('loom_dashboard_stop')
    dashboardOpen.value = false
    notice.value = '交付面板服务已停止'
  } catch (e) {
    error.value = String(e)
  } finally {
    dashboardBusy.value = false
  }
}

onMounted(() => {
  void refresh()
  void refreshDashboard()
})
</script>

<template>
  <div class="loom" data-loom-section>
    <h4>织布机运行时（可选）</h4>
    <p class="muted small">
      织布机（nexusloom）是文档生成流水线。这里只装它的<b>运行环境</b>（CPython + 织布机源码），
      装到 <code>%APPDATA%/app.modulo/loom/&lt;版本&gt;/</code>，版本目录并列、可回退。
      <b>不装进安装包</b>：要用了才下载，校验和不过就删。
      装好后把那段 MCP 配置粘到下面任意一条服务里即可。
    </p>

    <div class="row">
      <input v-model="manifestUrl" class="url" data-loom-url aria-label="运行时清单地址" />
      <button data-loom-check :disabled="busy" @click="check">检查更新</button>
    </div>

    <p v-if="state?.current" class="hint" data-loom-current>
      当前：<b>{{ state.current }}</b> · {{ destDir }}
    </p>
    <p v-else class="hint" data-loom-empty>还没装运行时。</p>

    <div v-if="manifest" class="row" data-loom-manifest>
      <span class="hint">
        可装 <b>{{ manifest.version }}</b>（{{ humanBytes(manifest.bytes ?? 0) }}）{{ manifest.note ? ` · ${manifest.note}` : '' }}
      </span>
      <button data-loom-install :disabled="busy" @click="install">
        {{ state?.current === manifest.version ? '重装' : state?.current ? '更新' : '安装' }}
      </button>
    </div>

    <p v-if="progress" class="hint" data-loom-progress>
      {{ progress.stage }} · {{ humanBytes(progress.received) }} / {{ humanBytes(progress.total) }}
    </p>

    <ul v-if="versions.length" class="versions" data-loom-versions>
      <li v-for="v in versions" :key="v.version">
        <span>{{ v.version }}{{ v.current ? '（在用）' : '' }}</span>
        <button v-if="!v.current" :data-loom-use="v.version" @click="useVersion(v.version)">用这个</button>
        <button v-if="v.removable" :data-loom-remove="v.version" @click="remove(v.version)">删掉</button>
      </li>
    </ul>

    <button v-if="state?.current" data-loom-copy @click="copyConfig">
      {{ copied ? '已复制 ✓' : '复制 MCP 配置' }}
    </button>
    <p v-if="copied" class="hint">把这段 JSON 填进下面某条服务的「命令 + 参数」即可（不会替你改配置）。</p>

    <div class="row">
      <button
        v-if="state?.current || dashboard?.running"
        data-loom-open-dashboard
        :disabled="dashboardBusy"
        @click="openDashboard"
      >
        {{ dashboardBusy ? '处理中…' : dashboard?.running ? '打开交付面板' : '启动交付面板' }}
      </button>
      <span class="hint" data-loom-dashboard-status>
        {{ dashboard?.running ? `服务运行中 · ${dashboard.url}` : '交付面板未启动' }}
      </span>
    </div>

    <p v-if="notice" class="hint" data-loom-notice>{{ notice }}</p>
    <p v-if="error" class="err" role="alert" data-loom-error>{{ error }}</p>

    <div
      v-if="dashboardOpen && dashboardUrl"
      class="dashboard-scrim"
      data-loom-dashboard
      role="dialog"
      aria-modal="true"
      aria-label="织布机交付面板"
    >
      <div class="dashboard-dialog">
        <div class="dashboard-head">
          <div>
            <h4>织布机交付面板</h4>
            <p class="hint">{{ dashboardUrl }} · 关闭页面不停止服务</p>
          </div>
          <div class="row">
            <button data-loom-open-external @click="openExternal">系统浏览器</button>
            <button data-loom-stop-dashboard :disabled="dashboardBusy" @click="stopDashboard">停止服务</button>
            <button data-loom-close-dashboard @click="dashboardOpen = false">关闭</button>
          </div>
        </div>
        <iframe
          data-loom-frame
          :src="dashboardUrl"
          title="织布机任务、交付账本与审批面板"
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
          referrerpolicy="no-referrer"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.loom {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-soft);
}
.row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
}
.url {
  flex: 1;
  min-width: 200px;
  padding: 4px var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-1);
  font-size: 12px;
}
.versions {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.versions li {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  font-size: 12px;
  color: var(--text-2);
}
.hint {
  font-size: 12px;
  color: var(--text-3);
}
.err {
  font-size: 12px;
  color: var(--c-red, #c0392b);
}
.dashboard-scrim {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  padding: var(--space-4);
  background: rgb(20 24 22 / 52%);
}
.dashboard-dialog {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: min(1440px, 100%);
  height: min(900px, 100%);
  margin: auto;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-lg, 0 18px 60px rgb(0 0 0 / 28%));
}
.dashboard-head {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-soft);
}
.dashboard-head h4,
.dashboard-head p {
  margin: 0;
}
.dashboard-dialog iframe {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: 0;
  background: #fff;
}
@media (max-width: 640px) {
  .dashboard-scrim {
    padding: 0;
  }
  .dashboard-dialog {
    border-radius: 0;
  }
}
</style>
