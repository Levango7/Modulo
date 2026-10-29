<script setup lang="ts">
/**
 * 设置页「实验室 → AI 模型服务」（F-12 一期，设计稿 `docs/design/F-12-AI-WIRING.md`）。
 *
 * 这一块存在的理由很具体：会议详情里那个「摘要」按钮**早就在**，但它依赖一个从未被配置过
 * 的 provider —— 点下去只会得到「还没有可用的模型服务」，而设置里根本没有配的地方（死路）。
 *
 * 三条纪律：
 * 1. **打开面板零网络**：列表读的是启动时 hydrate 的镜像（`ai-settings.v1` 已登记
 *    `DATA_KEYS`），只有点「测试连接」才调 `ai_providers` —— 那条命令会对每个 provider
 *    顺序发一次 `GET /models`（各 3s），挂在挂载上等于"打开设置要等 N×3 秒"。
 * 2. **密钥只走 `ai_set_key`**：输入框是 password、存完立刻清空、界面上只有「已配置」，
 *    任何序列化路径都不碰它（`aiSettings.ts` 的文档里没有这个字段）。
 * 3. **删除先删密钥再删配置**：反过来会留下凭据库孤儿（钥匙串里永远躺着一条没人读的密钥）。
 */
import { computed, inject, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { StorageAdapter } from '../store'
import {
  AI_DOC_KEY,
  addProvider,
  checkDraft,
  keySaveOutcome,
  makeProviderId,
  mergeProbe,
  parseAiDoc,
  PROVIDER_KINDS,
  providerHost,
  removeProvider,
  serializeAiDoc,
  updateProvider,
  type AiProvider,
  type ProviderDraft,
  type ProviderKind,
  type ProviderView,
} from '../aiSettings'

interface FormState {
  /** null = 新增；否则是正在改的那条 */
  id: string | null
  kind: ProviderKind
  baseUrl: string
  model: string
  key: string
  error: string | null
}

const storage = inject<StorageAdapter>('storage')!
const providers = ref<AiProvider[]>(parseAiDoc(storage.get(AI_DOC_KEY)))
/** 探测结果与密钥状态：**不落盘**。它是一次探测的结果，重启后回到「未测试」，不假装记得 */
const ready = ref<Record<string, boolean>>({})
const keys = ref<Record<string, boolean>>({})
const testing = ref<string | null>(null)
const probeError = ref<Record<string, string>>({})
const notice = ref<string | null>(null)

const form = ref<FormState | null>(null)
const confirmDelete = ref<string | null>(null)
const keyOpen = ref<string | null>(null)
const keyDraft = ref('')
const keyError = ref<string | null>(null)

const kindLabel: Record<ProviderKind, string> = { 'openai-compatible': 'OpenAI 兼容', ollama: 'Ollama' }

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function persist(list: AiProvider[]): void {
  providers.value = list
  storage.set(AI_DOC_KEY, serializeAiDoc(list))
}

function openAdd(): void {
  form.value = { id: null, kind: 'openai-compatible', baseUrl: '', model: '', key: '', error: null }
  notice.value = null
}

function openEdit(p: AiProvider): void {
  form.value = { id: p.id, kind: p.kind, baseUrl: p.baseUrl, model: p.model, key: '', error: null }
  notice.value = null
}

async function saveForm(): Promise<void> {
  const f = form.value
  if (!f) return
  const bad = checkDraft(f)
  if (bad) {
    f.error = bad
    return
  }
  const draft: ProviderDraft = { kind: f.kind, baseUrl: f.baseUrl, model: f.model }
  const id = f.id ?? makeProviderId(Date.now(), providers.value)
  persist(f.id ? updateProvider(providers.value, f.id, draft) : addProvider(providers.value, id, draft))
  form.value = null
  // 表单里的密钥直接交给凭据库（不经过任何序列化）。失败时配置已经存下了 ——
  // 这句要说清"哪一步没成"，不要让人以为整条配置都没保存
  if (f.key.trim()) {
    try {
      await invoke('ai_set_key', { providerId: id, key: f.key })
      keys.value = { ...keys.value, [id]: true }
    } catch (e) {
      notice.value = `配置已保存，但密钥没能存进系统凭据库：${msg(e)}`
    }
  }
}

async function saveKey(id: string, text: string): Promise<void> {
  const outcome = keySaveOutcome(text)
  if (!outcome.ok) {
    keyError.value = outcome.error
    return
  }
  try {
    await invoke('ai_set_key', { providerId: id, key: text })
    keys.value = { ...keys.value, [id]: true }
    keyDraft.value = outcome.draftAfter
    keyOpen.value = null
    keyError.value = null
  } catch (e) {
    keyError.value = `没能存进系统凭据库：${msg(e)}`
  }
}

async function removeKey(id: string): Promise<void> {
  try {
    await invoke('ai_delete_key', { providerId: id })
    keys.value = { ...keys.value, [id]: false }
    keyError.value = null
  } catch (e) {
    keyError.value = `没能从系统凭据库删掉：${msg(e)}`
  }
}

/** 二次确认：第一次点只是把按钮变成「确认删除」 */
async function removeOne(id: string): Promise<void> {
  if (confirmDelete.value !== id) {
    confirmDelete.value = id
    return
  }
  confirmDelete.value = null
  try {
    // 先删密钥（幂等），再改文档。删不掉就整条留着 —— 留着孤儿比留着一条点不动的配置更糟
    await invoke('ai_delete_key', { providerId: id })
  } catch (e) {
    notice.value = `密钥没能从系统凭据库删掉，这条配置先留着：${msg(e)}`
    return
  }
  keys.value = { ...keys.value, [id]: false }
  persist(removeProvider(providers.value, id))
}

/**
 * 探测一条（`ai_providers` 一次探全部 —— 它没有按 id 探的入口，N 个 provider 就是 N×3s）。
 * 失败分两种：**探测不通过**（`ready:false`，是这一条的局部状态）与**命令本身失败**
 * （IPC/配置读不出来，如实摆出来，不猜原因）。
 */
async function test(id: string): Promise<void> {
  testing.value = id
  try {
    const views = await invoke<ProviderView[]>('ai_providers')
    const probe = mergeProbe(views ?? [])
    ready.value = probe.ready
    keys.value = { ...keys.value, ...probe.keys }
    const rest = { ...probeError.value }
    delete rest[id]
    probeError.value = rest
  } catch (e) {
    probeError.value = { ...probeError.value, [id]: msg(e) }
  } finally {
    testing.value = null
  }
}

const statusOf = (id: string): 'ready' | 'down' | 'untested' => {
  const r = ready.value[id]
  return r === undefined ? 'untested' : r ? 'ready' : 'down'
}

const keyLines = computed(() =>
  Object.fromEntries(
    providers.value.map((p) => [p.id, keys.value[p.id] ? '已配置' : p.kind === 'ollama' ? '通常不需要' : '未配置']),
  ),
)
</script>

<template>
  <section>
    <h3>AI 模型服务</h3>
    <p class="muted small">
      接入你自己的模型服务（OpenAI 兼容接口，或本机 Ollama）。配好之后，会议详情里的「摘要」就能用了。
      <b>密钥只存在这台机器的系统凭据管理器里</b>，不进配置文件、不进备份、不上云。
    </p>

    <p v-if="notice" class="notice" role="alert" data-ai-notice>{{ notice }}</p>

    <ul v-if="providers.length" class="list">
      <li v-for="p in providers" :key="p.id" :data-provider="p.id">
        <div class="line">
          <span class="status" :data-status="statusOf(p.id)">
            <template v-if="statusOf(p.id) === 'ready'">● 可用</template>
            <template v-else-if="statusOf(p.id) === 'down'">✕ 连不上</template>
            <template v-else>○ 未测试</template>
          </span>
          <b class="host" data-provider-host>{{ providerHost(p.baseUrl) }}</b>
          <span class="kind">{{ kindLabel[p.kind] }}</span>
          <span class="grow" />
          <button :disabled="testing === p.id" data-ai-test @click="test(p.id)">
            {{ testing === p.id ? '测试中…' : '测试连接' }}
          </button>
          <button data-ai-edit @click="openEdit(p)">编辑</button>
          <button class="danger" data-ai-delete @click="removeOne(p.id)">
            {{ confirmDelete === p.id ? '确认删除' : '删除' }}
          </button>
        </div>
        <p class="meta">
          <code>{{ p.baseUrl }}</code> · <code>{{ p.model }}</code> ·
          <span data-key-state>密钥：{{ keyLines[p.id] }}</span>
          <button class="link" data-ai-key-open @click="keyOpen = keyOpen === p.id ? null : p.id">
            {{ keyOpen === p.id ? '收起' : '设置密钥' }}
          </button>
          <button v-if="keys[p.id]" class="link" data-ai-key-clear @click="removeKey(p.id)">清除密钥</button>
        </p>
        <p v-if="probeError[p.id]" class="err" role="alert" data-ai-probe-error>{{ probeError[p.id] }}</p>
        <div v-if="keyOpen === p.id" class="keybox">
          <label class="field grow">
            <span>密钥（只写不读，存完输入框立刻清空）</span>
            <input v-model="keyDraft" type="password" autocomplete="off" data-ai-key />
          </label>
          <button class="primary" data-ai-key-save @click="saveKey(p.id, keyDraft)">保存密钥</button>
        </div>
        <p v-if="keyOpen === p.id && keyError" class="err" role="alert" data-ai-key-error>{{ keyError }}</p>
      </li>
    </ul>

    <p v-else-if="!form" class="muted small" data-ai-empty>
      还没有模型服务。填入一个 <b>OpenAI 兼容</b> 的服务地址（或本机 Ollama 的地址），密钥只存在本机凭据管理器里。
    </p>

    <div v-if="!form" class="row">
      <button class="primary" data-ai-add @click="openAdd">+ 添加模型服务</button>
    </div>

    <!-- 就地展开，不弹二级窗：设置里再套一层对话框，Esc 与焦点归属都会变得难解释 -->
    <div v-if="form" class="editor" data-ai-form>
      <div class="row">
        <label class="field">
          <span>类型</span>
          <select v-model="form.kind" data-ai-kind>
            <option v-for="k in PROVIDER_KINDS" :key="k" :value="k">{{ kindLabel[k] }}</option>
          </select>
        </label>
        <label class="field grow">
          <span>服务地址</span>
          <input v-model="form.baseUrl" type="text" placeholder="https://api.example.com/v1" data-ai-url />
        </label>
      </div>
      <div class="row">
        <label class="field grow">
          <span>模型</span>
          <input v-model="form.model" type="text" placeholder="gpt-4o-mini / qwen2.5:7b" data-ai-model />
        </label>
        <label class="field">
          <span>密钥（可空）</span>
          <input v-model="form.key" type="password" autocomplete="off" data-ai-key-input />
        </label>
      </div>
      <p v-if="form.error" class="err" role="alert" data-ai-form-error>{{ form.error }}</p>
      <div class="row">
        <button class="primary" data-ai-save @click="saveForm">保存</button>
        <button data-ai-cancel @click="form = null">取消</button>
      </div>
    </div>

    <p class="hint">
      明文 <code>http://</code> 只接受本机地址（<code>localhost</code> / <code>127.0.0.1</code>），云端必须用 https；
      内网与保留地址（<code>10.x</code>、<code>192.168.x</code>、<code>*.internal</code> 等）一律拒绝 ——
      这条通道会把内容发出去，公司自建的网关得改成公网地址或先做转发。
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
  flex: 1 1 240px;
}
.field span {
  font-size: 11px;
  color: var(--text-3);
}
.field input,
.field select {
  padding: 6px var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-1);
  font-size: 12px;
}
.small {
  font-size: 12px;
}
.list {
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--space-2);
}
.list li {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}
.line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  font-size: 12px;
}
.grow {
  flex: 1;
}
.host {
  font-size: 12px;
}
.kind {
  font-size: 11px;
  color: var(--text-3);
}
.status {
  font-size: 11px;
  color: var(--text-3);
}
.status[data-status='ready'] {
  color: var(--c-green);
}
.status[data-status='down'] {
  color: var(--c-red);
}
.meta {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.meta code {
  font-size: 11px;
}
.keybox {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.editor {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--border-soft) 18%, transparent);
}
button.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}
button.danger {
  color: var(--c-red);
}
.err {
  margin: var(--space-2) 0 0;
  font-size: 12px;
  color: var(--c-red);
}
.notice {
  margin: var(--space-2) 0 0;
  font-size: 12px;
  color: var(--c-amber);
}
.hint {
  margin: var(--space-3) 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-3);
}
</style>
