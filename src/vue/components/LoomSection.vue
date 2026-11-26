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
import { computed, inject, onMounted, ref } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import {
  humanBytes,
  mcpConfigSnippet,
  parseLoomManifest,
  planLoomMcpServer,
  type LoomManifest,
  type LoomVersionChoice,
} from '../loomRuntime'
import type { McpApi } from '../useMcp'

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
// 与 McpSection 同一份（App provide）：点「添加」写的是用户看得到的那个清单，不是另一份镜像
const mcp = inject<McpApi>('mcp')!

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

/**
 * 一键添加到 MCP 服务（β1 收尾 r47）：**只有点这一下才写配置**（不是静默改）。
 * 写入只动织布机自己那一条（`run-mcp.py` 签名）；MCP 总开关与「允许本会话」两道闸门
 * 不替用户开 —— 提示里说清楚还差哪一步。
 */
function enableLoom(): void {
  const dir = destDir.value
  if (!dir) return
  error.value = null
  const plan = planLoomMcpServer(mcp.servers.value, `${dir}/python/python.exe`, `${dir}/run-mcp.py`)
  const tail = `${mcp.gate.value ? '' : '；MCP 总开关还关着，到下面的 MCP 服务里打开'}。首次使用前，到该条目点「允许本会话」`
  if (plan.action === 'same') {
    notice.value = `已经在下面的 MCP 服务清单里（loom 条目），无需改动${tail}`
    return
  }
  const err = plan.action === 'add' ? mcp.add(plan.draft) : mcp.update(plan.id!, plan.draft)
  if (err) {
    error.value = err
    return
  }
  notice.value = `${plan.action === 'add' ? '已添加到下面的 MCP 服务清单（loom 条目）' : '已把 loom 条目指向当前版本'}${tail}`
}

onMounted(() => void refresh())
</script>

<template>
  <div class="loom" data-loom-section>
    <h4>织布机运行时（可选）</h4>
    <p class="muted small">
      织布机（nexusloom）是文档生成流水线。这里只装它的<b>运行环境</b>（CPython + 织布机源码），
      装到 <code>%APPDATA%/app.modulo/loom/&lt;版本&gt;/</code>，版本目录并列、可回退。
      <b>不装进安装包</b>：要用了才下载，校验和不过就删。
      装好后点「添加到 MCP 服务」即可（或复制配置手动粘）；首次使用还要在该条目「允许本会话」。
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

    <div v-if="state?.current" class="row">
      <button data-loom-enable @click="enableLoom">添加到 MCP 服务</button>
      <button data-loom-copy @click="copyConfig">
        {{ copied ? '已复制 ✓' : '复制 MCP 配置' }}
      </button>
    </div>
    <p v-if="copied" class="hint">把这段 JSON 填进下面某条服务的「命令 + 参数」即可（不会替你改配置）。</p>

    <p v-if="notice" class="hint" data-loom-notice>{{ notice }}</p>
    <p v-if="error" class="err" role="alert" data-loom-error>{{ error }}</p>
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
</style>
