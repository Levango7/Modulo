<script setup lang="ts">
/**
 * 设置页「实验室 → MCP 服务」（改天换地 PR-F4a，生态位第四格的第一笔）。
 *
 * 配置与落盘在这里，**连接的手在 Rust 侧**（§12.86：`ai::mcp` 真 spawn 子进程说 JSON-RPC）。
 * 界面这一版多了两件真能做的事（J1 执行半）：给某个服务**本会话放行**，以及**预览它的工具清单**。
 * 两件都有代价，所以必须说出来：允许只覆盖这一次会话，列工具会真的把子进程拉起来。
 *
 * 四条纪律：
 * 1. **打开面板零网络、零进程**：列表读的是启动时 hydrate 的镜像（`modulo.mcp.v1` 已登记
 *    `DATA_KEYS`）；只有用户点「列出工具」那一下才会起进程，不在这里做任何探测。
 * 2. **不代装、不自带**：文案写明「Modulo 不带任何 server，也不替你安装它需要的运行环境」，
 *    否则用户会把它当内置功能报 bug。
 * 3. **删除两步**：与模型服务那张卡一致（第一下变「确认删除」，第二下才真删）。
 * 4. **配置状态从 App 注入，不自己 new 一份**（见下面 ①）。这一条不是风格问题：
 *    各 new 一份 ref，设置里刚确认的服务，对话坞那边根本看不见。
 */
import { inject, ref } from 'vue'
import type { McpApi } from '../useMcp'
import type { McpExecutionApi } from '../useMcpExecution'
import type { McpToolEntry } from '../mcpTools'
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

/**
 * ① 配置状态**必须**是 App 那一份（`App.vue` 里 `provide('mcp')` / `provide('mcpExecution')`）。
 *
 * 早先这里自己 `createMcp(storage)`：设置页一个 ref、坞一个 ref，各读各的 ——
 * 用户在设置里配好、点了允许，回到对话坞那边看见的还是另一份（未确认）。
 * 确认态同理：Rust `McpState.confirmed` 只认 `mcp_confirm` 记下的那一份记录，
 * 前端若各持一份，就会出现「这边说已允许、那边说没允许」的分叉。
 */
const { servers, gate, setGate, add, update, remove, toggle } = inject<McpApi>('mcp')!
const mcpExec = inject<McpExecutionApi>('mcpExecution')!

/** null = 表单收起；`{ id: null }` = 新增；`{ id: 's1' }` = 改那一条 */
const form = ref<{ id: string | null; draft: McpDraft } | null>(null)
const error = ref<string | null>(null)
const confirmDelete = ref<string | null>(null)

/**
 * 一行「列出工具」的结果。四格齐全（不给可选字段），模板里就不用到处写非空判断 ——
 * `loading` / `error` / `tools` 三态互斥，`notice` 与成功态并存（「没列全」的如实标注）。
 */
interface ToolRow {
  loading: boolean
  tools: McpToolEntry[]
  error: string | null
  notice: string | null
}

/**
 * serverId → 一次「列出工具」的界面态。**没有键 = 还没点过**（区别于"点过、结果为空"）。
 * 与 `mcpExec` 里的成功缓存不是一份东西：缓存归执行层（失败的绝不进缓存），
 * 这里只记"这一行现在该画什么"。
 */
const toolState = ref<Record<string, ToolRow>>({})
/** serverId → 确认失败的那句话。单独一格：成功后要能清掉，混进 toolState 会被误当成清单失败 */
const confirmError = ref<Record<string, string>>({})

const emptyRow = (): ToolRow => ({ loading: false, tools: [], error: null, notice: null })
const EMPTY_ROW: ToolRow = emptyRow()

/** 取一行工具态。用 `Object.hasOwn`：手改坏的 id 若是 `constructor`，下标会命中原型链 */
function rowOf(id: string): ToolRow {
  return Object.hasOwn(toolState.value, id) ? toolState.value[id] : EMPTY_ROW
}
/** 这一行点过「列出工具」没有（空清单也要画出来，所以不能只看 `tools.length`） */
function hasRow(id: string): boolean {
  return Object.hasOwn(toolState.value, id)
}
function setRow(id: string, row: ToolRow): void {
  toolState.value = { ...toolState.value, [id]: row }
}
function dropKey<T>(map: Record<string, T>, id: string): Record<string, T> {
  if (!Object.hasOwn(map, id)) return map
  const next = { ...map }
  delete next[id]
  return next
}

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

/**
 * 什么时候要 `forget`（清这个服务的确认态与清单缓存）—— 只在这三件事**真的发生**时：
 *
 * 1. **服务被删**：条目没了，确认态与缓存失去归属。
 * 2. **命令或参数变了**：同一个 id 背后已经是另一个进程。用户确认的是"这条命令"，
 *    不是"这个 id"；把旧的放行顺延到新命令上，等于把闸门开给了没被允许的东西。
 * 3. **启用态变了**：停用的服务既不确认也不列（`gather` 与 Rust 那道闸门都跳过它），
 *    留着的确认态只是死数据；再启用时应当重新过一遍确认。
 *
 * 反过来，**原样保存**不清（包括只改了名字）：清一下就把用户刚做的确认抹掉了。
 * 名字不参与任何命令的构造 —— 它在工具条目里只是给人看的 `serverName`。
 */
function connKey(s: McpServer): string {
  return JSON.stringify([s.command, s.args])
}

function forgetRow(id: string): void {
  mcpExec.forget(id)
  toolState.value = dropKey(toolState.value, id)
  confirmError.value = dropKey(confirmError.value, id)
}

function submit(): void {
  const f = form.value
  if (!f) return
  // 变更前的快照：只有"连法"变了才清（见 forgetRow 头注释）
  const before = f.id === null ? null : (servers.value.find((s) => s.id === f.id) ?? null)
  const err = f.id === null ? add(f.draft) : update(f.id, f.draft)
  if (err) {
    error.value = err
    return
  }
  if (before) {
    const after = servers.value.find((s) => s.id === f.id)
    if (after && connKey(before) !== connKey(after)) forgetRow(after.id)
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
  // 条目没了：确认态与清单缓存都失去归属，留着只会让「已允许」挂在一个不存在的服务上
  forgetRow(id)
  // 正在编辑的那条被删掉了：表单必须跟着收，否则「保存」会打在一个已经不存在的 id 上
  if (form.value?.id === id) {
    form.value = null
    // 表单收起时错误提示也要清 —— 否则那句红字会挂在列表下面，除了再开一次表单没有消退路径
    error.value = null
  }
}

/**
 * 启停：顺手把「确认删除」撤掉，免得它跨操作一直挂着、下一次点击就成了误删。
 * 这里 `enabled` **一定**变了（调用点传的是 `!s.enabled`），所以无条件 forget —— 对应上述第 3 条。
 */
function toggleOne(s: McpServer): void {
  confirmDelete.value = null
  toggle(s.id, !s.enabled)
  forgetRow(s.id)
}

/**
 * 三个闸门，缺一不可：总开关关着 ⇒ Rust 三条命令一律拒；服务停用 ⇒ 它本来就不参与；
 * 列工具还额外要求「已确认」—— 未确认就去列，Rust 那道闸门会当场拒，
 * 用户看到的是一条"失败"，而他其实只是漏了上一步。
 */
function canConfirm(s: McpServer): boolean {
  return gate.value && s.enabled && !mcpExec.isConfirmed(s.id)
}
function canListTools(s: McpServer): boolean {
  return gate.value && s.enabled && mcpExec.isConfirmed(s.id)
}

/** 按钮为什么点不了 —— 写在 `title` 上，不另占一行字（这一行本来就挤） */
function confirmHint(s: McpServer): string {
  if (!gate.value) return '总开关关着，开了才能连'
  if (!s.enabled) return '这条服务已停用，先启用它'
  if (mcpExec.isConfirmed(s.id)) return '本会话已允许。重启 Modulo 之后要再允许一次'
  return '允许之后，本会话里模型就能用它的工具（不会自己调用）'
}
function toolsHint(s: McpServer): string {
  if (!gate.value) return '总开关关着，开了才能连'
  if (!s.enabled) return '这条服务已停用，先启用它'
  if (!mcpExec.isConfirmed(s.id)) return '先允许本会话使用，再列工具'
  return '看这个服务有哪些工具；第一次要拉起子进程，可能要几秒'
}

/**
 * 允许本会话使用。**不做「撤销确认」**：Rust 侧没有撤销命令，前端单边撤销会让
 * "界面说没允许、后端说允许"两头分叉 —— 不如如实不做（要收回就把服务停用或删掉）。
 */
async function askConfirm(s: McpServer): Promise<void> {
  confirmDelete.value = null
  if (!canConfirm(s)) return
  const why = await mcpExec.confirm(s)
  // 失败必须说出来，而且**不能**在这里把状态画成已允许（执行层已经保证不记失败）
  if (why) {
    confirmError.value = { ...confirmError.value, [s.id]: why }
    return
  }
  confirmError.value = dropKey(confirmError.value, s.id)
}

async function showTools(s: McpServer): Promise<void> {
  confirmDelete.value = null
  // 连点两下不发两趟：第一次就要 spawn 子进程，第二趟纯属白等
  if (!canListTools(s) || rowOf(s.id).loading) return
  setRow(s.id, { ...emptyRow(), loading: true })
  const r = await mcpExec.listTools(s)
  // 联合类型靠 `'error' in r` 分（与 `mcp.ts` 的 AddResult 同一手法）
  if ('error' in r) {
    setRow(s.id, { ...emptyRow(), error: r.error })
    return
  }
  setRow(s.id, { ...emptyRow(), tools: r.tools, notice: r.notice ?? null })
}
</script>

<template>
  <section data-mcp-section>
    <h3>MCP 服务</h3>
    <p class="muted small">
      MCP（Model Context Protocol）是让 AI 调用本机工具的标准协议。在这里登记一个
      <b>本机 server 的命令与参数</b>，本会话里允许之后，模型就能用它的工具。
      <b>Modulo 不自带任何 server，也不替你安装它需要的运行环境</b>（Node、Python 之类都得你自己装好）；
      命令与参数原样交给系统执行，不经过 shell。
    </p>
    <p class="muted small" data-mcp-stage>
      允许是<b>这一次会话</b>的事：重启 Modulo 之后要重新允许。允许之后可以先在这里看它有哪些工具，
      真正在对话里调用工具的入口在对话坞。
    </p>

    <!-- 功能总开关：本地灰度的唯一手段。关掉后配置仍留在盘上（列表不隐藏），
         只是 Rust 侧三条命令一律拒，且**不会拉起任何已配置的服务**。 -->
    <div class="row gate-row" data-mcp-gate-row>
      <button
        role="switch"
        :aria-checked="gate"
        :class="{ on: gate }"
        data-mcp-gate
        @click="setGate(!gate)"
      >
        MCP 功能：{{ gate ? '已开启' : '已关闭' }}
      </button>
      <span class="muted small">
        关掉后已配置的服务不会被拉起；配置仍保留，随时可以再打开。
      </span>
    </div>

    <!-- 兜底：目前三条把 form 置 null 的路径（取消 / 保存成功 / 删除正在编辑的那条）
         都会顺手清 error，所以这段现在不可达。留着是为了将来新增的收起路径不用再想一遍 -->
    <p v-if="error && !form" class="err" role="alert" data-mcp-error>{{ error }}</p>

    <p v-if="!gate && servers.length" class="muted small" data-mcp-gate-off-note>
      总开关已关闭：下面这些服务现在不会被执行。
    </p>

    <ul v-if="servers.length" class="list" :class="{ off: !gate }">
      <li v-for="s in servers" :key="s.id" :data-mcp="s.id">
        <div class="line">
          <span class="state" :data-mcp-state="s.enabled ? 'on' : 'off'">
            {{ s.enabled ? '已开启' : '已关闭' }}
          </span>
          <b class="name" data-mcp-name>{{ s.name }}</b>
          <span class="grow" />
          <button data-mcp-toggle @click="toggleOne(s)">
            {{ s.enabled ? '停用' : '启用' }}
          </button>
          <button data-mcp-edit @click="openEdit(s)">编辑</button>
          <button class="danger" data-mcp-delete @click="removeOne(s.id)">
            {{ confirmDelete === s.id ? '确认删除' : '删除' }}
          </button>
        </div>
        <!-- 本会话闸门（J1 执行半）。文案一律带「本会话」：确认态只在内存，
             Rust 重启即清 —— 少这两个字，用户会以为这是永久授权。 -->
        <div class="row session-row">
          <button data-mcp-confirm :disabled="!canConfirm(s)" :title="confirmHint(s)" @click="askConfirm(s)">
            {{ mcpExec.isConfirmed(s.id) ? '已允许（本会话）' : '本会话允许使用' }}
          </button>
          <span
            class="state"
            :class="{ on: mcpExec.isConfirmed(s.id) }"
            :data-mcp-confirm-state="mcpExec.isConfirmed(s.id) ? 'on' : 'off'"
          >
            {{ mcpExec.isConfirmed(s.id) ? '本会话已允许' : '本会话未允许' }}
          </span>
          <span class="grow" />
          <button data-mcp-tools :disabled="!canListTools(s)" :title="toolsHint(s)" @click="showTools(s)">
            列出工具
          </button>
        </div>
        <!-- 确认失败（网页版会拿到「网页版没有桌面壳…」那句话，原样展示，不特判后静默） -->
        <p v-if="confirmError[s.id]" class="err" role="alert" data-mcp-confirm-error>{{ confirmError[s.id] }}</p>
        <!-- 工具清单预览：三态 + 一条「没列全」。空清单也是一条如实的结果，不能画成"什么都没发生" -->
        <div v-if="hasRow(s.id)" class="tools">
          <p v-if="rowOf(s.id).loading" class="meta" data-mcp-tool-loading>
            正在列工具…（第一次要拉起子进程，可能要几秒）
          </p>
          <p v-else-if="rowOf(s.id).error" class="err" role="alert" data-mcp-tool-error>{{ rowOf(s.id).error }}</p>
          <ul v-else-if="rowOf(s.id).tools.length" class="tool-list" data-mcp-tool-list>
            <li v-for="t in rowOf(s.id).tools" :key="t.name" data-mcp-tool>{{ t.name }}</li>
          </ul>
          <p v-else class="meta" data-mcp-tool-empty>这个服务连上了，但没有列出任何工具。</p>
          <p v-if="rowOf(s.id).notice" class="meta" data-mcp-tool-notice>没列全：{{ rowOf(s.id).notice }}</p>
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
               方向是"更早拦住"而不是"悄悄改写"，闸门仍按码点复核，见 §12.76 -->
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
/* 总开关关掉时列表仍在（用户要能看见自己配过什么），只是置灰提示「现在不会跑」 */
.list.off {
  opacity: 0.55;
}
.gate-row {
  align-items: center;
}
button[role='switch'].on {
  border-color: var(--c-green);
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
/* 「本会话已允许」与总开关同一种绿：允许 = 放行，两处说的是同一件事 */
.state.on {
  color: var(--c-green);
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
/* 这一行的按钮与左边那行操作对着看：允许 / 状态 / 列工具 */
.session-row {
  align-items: center;
}
.tools {
  margin-top: var(--space-1);
}
.tool-list {
  margin: 0;
  padding-left: var(--space-3);
  font-size: 11px;
  color: var(--text-2);
  line-height: 1.6;
}
.editor {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}
</style>
