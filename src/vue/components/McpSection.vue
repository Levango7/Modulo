<script setup lang="ts">
/**
 * 设置页「实验室 → MCP 服务」（改天换地 PR-F4a，生态位第四格的第一笔）。
 *
 * 这一版**只做配置与落盘**，不做连接：真正 spawn 子进程、说 JSON-RPC、把工具喂给模型
 * 的那半在 Rust 侧（F4c）。界面必须把这件事**说出来** —— 一个能填、能存、却点了连不上
 * 的表单，比没有这个表单更糟（同「桌面」组不放网页版可见项的理由）。
 *
 * 三条纪律（与 `AiLabSection.vue` 同源）：
 * 1. **打开面板零网络、零进程**：列表读的是启动时 hydrate 的镜像（`modulo.mcp.v1` 已登记
 *    `DATA_KEYS`），不在这里做任何探测。
 * 2. **不代装、不自带**：文案写明「Modulo 不带任何 server，也不替你安装它需要的运行环境」，
 *    否则用户会把它当内置功能报 bug。
 * 3. **删除两步**：与模型服务那张卡一致（第一下变「确认删除」，第二下才真删）。
 */
import { inject, ref } from 'vue'
import type { StorageAdapter } from '../store'
import { createMcp } from '../useMcp'
import {
  formatCommand,
  joinArgs,
  MCP_ARGS_MAX,
  MCP_CMD_MAX,
  MCP_MAX,
  MCP_NAME_MAX,
  type McpDraft,
  type McpServer,
} from '../mcp'

const storage = inject<StorageAdapter>('storage')!
const { servers, add, update, remove, toggle } = createMcp(storage)

/** null = 表单收起；`{ id: null }` = 新增；`{ id: 's1' }` = 改那一条 */
const form = ref<{ id: string | null; draft: McpDraft } | null>(null)
const error = ref<string | null>(null)
const confirmDelete = ref<string | null>(null)

const emptyDraft = (): McpDraft => ({ name: '', command: '', args: '' })

function openAdd(): void {
  error.value = null
  confirmDelete.value = null
  form.value = { id: null, draft: emptyDraft() }
}

function openEdit(s: McpServer): void {
  error.value = null
  confirmDelete.value = null
  form.value = {
    id: s.id,
    // 必须走 joinArgs（splitArgs 的逆函数）：早先这里用 `args.join(' ')`，带空格的参数
    // 一进表单就丢了引号，点保存会被静默拆成多段（QA 抓到的 B1）。
    draft: { name: s.name, command: s.command, args: joinArgs(s.args) },
  }
}

function cancel(): void {
  form.value = null
  error.value = null
}

function submit(): void {
  const f = form.value
  if (!f) return
  const err = f.id === null ? add(f.draft) : update(f.id, f.draft)
  if (err) {
    error.value = err
    return
  }
  form.value = null
  error.value = null
}

function removeOne(id: string): void {
  if (confirmDelete.value !== id) {
    confirmDelete.value = id
    return
  }
  confirmDelete.value = null
  remove(id)
  // 正在编辑的那条被删掉了：表单必须跟着收，否则「保存」会打在一个已经不存在的 id 上
  if (form.value?.id === id) {
    form.value = null
    // 表单收起时错误提示也要清 —— 否则那句红字会挂在列表下面，除了再开一次表单没有消退路径
    error.value = null
  }
}

/** 启停：顺手把「确认删除」撤掉，免得它跨操作一直挂着、下一次点击就成了误删 */
function toggleOne(id: string, enabled: boolean): void {
  confirmDelete.value = null
  toggle(id, enabled)
}
</script>

<template>
  <section data-mcp-section>
    <h3>MCP 服务</h3>
    <p class="muted small">
      MCP（Model Context Protocol）是让 AI 调用本机工具的标准协议。在这里登记一个
      <b>本机 server 的命令与参数</b>；等桌面端的通道接上之后，对话里模型就能用它的工具。
      <b>Modulo 不自带任何 server，也不替你安装它需要的运行环境</b>（Node、Python 之类都得你自己装好）；
      命令与参数原样交给系统执行，不经过 shell。
    </p>
    <p class="muted small" data-mcp-stage>
      这一版只把配置存下来。真正连上 server、让模型调用工具，要等桌面端的 MCP 通道接上（下一笔）。
    </p>

    <!-- 兜底：目前三条把 form 置 null 的路径（取消 / 保存成功 / 删除正在编辑的那条）
         都会顺手清 error，所以这段现在不可达。留着是为了将来新增的收起路径不用再想一遍 -->
    <p v-if="error && !form" class="err" role="alert" data-mcp-error>{{ error }}</p>

    <ul v-if="servers.length" class="list">
      <li v-for="s in servers" :key="s.id" :data-mcp="s.id">
        <div class="line">
          <span class="state" :data-mcp-state="s.enabled ? 'on' : 'off'">
            {{ s.enabled ? '已开启' : '已关闭' }}
          </span>
          <b class="name" data-mcp-name>{{ s.name }}</b>
          <span class="grow" />
          <button data-mcp-toggle @click="toggleOne(s.id, !s.enabled)">
            {{ s.enabled ? '停用' : '启用' }}
          </button>
          <button data-mcp-edit @click="openEdit(s)">编辑</button>
          <button class="danger" data-mcp-delete @click="removeOne(s.id)">
            {{ confirmDelete === s.id ? '确认删除' : '删除' }}
          </button>
        </div>
        <p class="meta">
          <code data-mcp-command>{{ formatCommand(s) }}</code>
          <span v-if="s.args.length"> · {{ s.args.length }} 个参数</span>
        </p>
      </li>
    </ul>

    <p v-else-if="!form" class="muted small" data-mcp-empty>
      还没有登记服务。点下面的按钮，填入一个本机可执行的命令（例如
      <code>npx</code> 加参数 <code>-y @modelcontextprotocol/server-filesystem</code>）。
    </p>

    <div v-if="!form" class="row">
      <button class="primary" data-mcp-add :disabled="servers.length >= MCP_MAX" @click="openAdd">
        + 添加服务
      </button>
      <span v-if="servers.length >= MCP_MAX" class="muted small">
        最多 {{ MCP_MAX }} 个，先删一个再加
      </span>
    </div>

    <!-- 就地展开，不弹二级窗（同模型服务那张卡） -->
    <div v-if="form" class="editor" data-mcp-form>
      <div class="row">
        <label class="field grow">
          <span>名字（≤{{ MCP_NAME_MAX }} 字）</span>
          <!-- maxlength 走 HTML 规范的 UTF-16 计数，比闸门的码点更严（40 个 emoji 只能进 20 个）；
               方向是"更早拦住"而不是"悄悄改写"，闸门仍按码点复核，见 §12.75 -->
          <input v-model="form.draft.name" :maxlength="MCP_NAME_MAX" data-mcp-form-name />
        </label>
        <label class="field grow">
          <span>命令（可执行文件或命令名，≤{{ MCP_CMD_MAX }} 字）</span>
          <input v-model="form.draft.command" :maxlength="MCP_CMD_MAX" placeholder="npx" data-mcp-form-command />
        </label>
      </div>
      <label class="field">
        <span>参数（一行，空格分隔；带空格的参数用双引号包起来，最多 {{ MCP_ARGS_MAX }} 个）</span>
        <input v-model="form.draft.args" placeholder="-y @modelcontextprotocol/server-filesystem" data-mcp-form-args />
      </label>
      <p v-if="error" class="err" role="alert" data-mcp-form-error>{{ error }}</p>
      <div class="row">
        <button class="primary" data-mcp-save @click="submit">
          {{ form.id === null ? '添加' : '保存' }}
        </button>
        <button data-mcp-cancel @click="cancel">取消</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.small {
  font-size: 12px;
}
.muted {
  color: var(--text-3);
}
.err {
  margin: var(--space-2) 0 0;
  font-size: 12px;
  color: var(--c-red);
}
button.danger {
  color: var(--c-red);
}
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
  margin-top: var(--space-2);
}
.field.grow {
  flex: 1 1 220px;
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
.state,
.name {
  font-size: 12px;
}
.state {
  color: var(--text-3);
}
.meta {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-3);
}
.meta code {
  font-size: 11px;
  word-break: break-all;
}
.editor {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}
</style>
