<script setup lang="ts">
/**
 * 左栏（改天换地 PR-D）：**会话列表一级化** —— 会话不再藏在坞的历史面板里。
 *
 * 三段（自上而下）：
 * ① 模式：工作台 / 布局编辑（既有 view 切换的两条路，只是进了栏）；
 * ② 会话：AI 对话的清单（`useAiSessions`，与坞共用同一份状态）——
 *    点击切进去（坞把 turns 换成那条）、「新对话」开新的、每条两步删除；
 * ③ 用户区：本地模式的事实说明（没有账号，数据在这台机器上）。
 *
 * 纪律：栏只"选"不"发"——发消息仍只有坞一个入口；两步删除的第一次点击只标记
 * （与会议详情删稿、坞原历史面板同一手法）。
 */
import { computed, inject, onMounted, ref } from 'vue'
import { BookMarked, CalendarClock, FilePlus, MessageSquarePlus, Play, Power, Trash2, Workflow, X } from 'lucide-vue-next'
import type { AiSessionsApi } from '../useAiSessions'
import type { KnowledgeApi } from '../useKnowledge'
import type { CronApi } from '../useCron'
import type { SkillsApi } from '../useSkills'
import type { WorkflowApi } from '../useWorkflow'
import { AI_DOC_KEY, parseAiDoc } from '../aiSettings'
import { lastRun, type CronRun, type CronTask } from '../cron'
import {
  lastRun as lastWorkflowRun,
  WORKFLOW_MAX_STEPS,
  type WorkflowFlow,
  type WorkflowRun,
} from '../workflow'
import { isDesktop } from '../useShell'
import { charsLabel } from '../aiChat'
import type { StorageAdapter } from '../store'
import {
  docExcerpt,
  KNOWLEDGE_EXCERPT_MAX,
  KNOWLEDGE_FILE_MAX_BYTES,
  type PickedDoc,
} from '../knowledge'
import { skillExcerpt, SKILL_NAME_MAX, SKILL_TEXT_MAX } from '../skills'

const props = defineProps<{ view: 'workbench' | 'chat' | 'edit' }>()
const emit = defineEmits<{ (e: 'select-view', v: 'workbench' | 'chat' | 'edit'): void }>()

const sessions = inject<AiSessionsApi>('aiSessions')!
const knowledge = inject<KnowledgeApi>('knowledge')!
const cron = inject<CronApi>('cron')!
const skills = inject<SkillsApi>('skills')!
const workflow = inject<WorkflowApi>('workflow')!
const storage = inject<StorageAdapter>('storage')!
/** 模型服务清单（建任务时选一个；与坞读的是同一份镜像，零 IO） */
const providers = computed(() => parseAiDoc(storage.get(AI_DOC_KEY)))

/**
 * 「定时」节（PR-F2）。三条边界都写进过 §12.67，界面上照着说：
 * - 到点自动跑 AI = 未经确认花钱 ⇒ 任务只能显式建、运行记录全部可见；
 * - **错过不补跑**（空态文案里就说清，不让用户以为后台会追赶）；
 * - 结果不自动写版面 —— 展开看到的是那次对话的结果原文（全文在会话历史里）。
 */
const cronAdding = ref(false)
const cronTime = ref('09:00')
const cronPrompt = ref('')
const cronProvider = ref('')
const cronNotice = ref<string | null>(null)
const cronConfirm = ref<string | null>(null)
const cronOpen = ref<string | null>(null)

function startCronAdd(): void {
  cronAdding.value = !cronAdding.value
  if (!cronProvider.value) cronProvider.value = providers.value[0]?.id ?? ''
}

function submitCron(): void {
  const rejected = cron.add({ prompt: cronPrompt.value, time: cronTime.value, providerId: cronProvider.value })
  cronNotice.value = rejected.length ? rejected.join('；') : null
  if (!rejected.length) {
    cronPrompt.value = ''
    cronAdding.value = false
  }
}

function statusLine(t: CronTask): string {
  const r = lastRun(cron.runs.value, t.id)
  if (!r) return t.enabled ? '等第一次' : '已停用'
  const tail = when(r.at * 1000)
  if (r.status === 'ok') return `跑完 · ${tail}`
  if (r.status === 'error') return `失败 · ${tail}`
  return `错过 · ${tail}`
}

function lastOf(t: CronTask): CronRun | undefined {
  return lastRun(cron.runs.value, t.id)
}

function runMeta(r: CronRun): string {
  return `${r.status === 'ok' ? '结果' : '原因'} · ${when(r.at * 1000)}`
}

function toggleCronOpen(id: string): void {
  cronOpen.value = cronOpen.value === id ? null : id
  cronConfirm.value = null
}

function toggleCronEnabled(id: string): void {
  cron.toggle(id)
}

function dropCron(id: string): void {
  if (cronConfirm.value !== id) {
    cronConfirm.value = id
    return
  }
  cronConfirm.value = null
  if (cronOpen.value === id) cronOpen.value = null
  cron.remove(id)
}

/**
 * 「工作流」这一节（PR-F3）。四条边界写进 §12.68，界面上照着说：
 * - **首败即停**：某一步没跑通，后面几步不再跑 —— 后面几步的前提就是上一步的产出；
 * - **跑一遍才花钱**：没有定时器，只由用户点「跑一遍」触发（定时任务管"什么时候跑"）；
 * - **一次只跑一个**：并发跑等于双倍花钱，用户只点了一下；
 * - 步骤数 2–6：一步是"聊天"，两步以上才是"流程"。
 */
const wfAdding = ref(false)
const wfName = ref('')
/** 每一步一行；空行由建流程时的闸门拒收（§12.68：超长/空都拒收，不静默改写） */
const wfSteps = ref<string[]>(['', ''])
const wfProvider = ref('')
const wfNotice = ref<string | null>(null)
const wfConfirm = ref<string | null>(null)
const wfOpen = ref<string | null>(null)

function startWorkflowAdd(): void {
  wfAdding.value = !wfAdding.value
  if (!wfProvider.value) wfProvider.value = providers.value[0]?.id ?? ''
  if (!wfSteps.value.length) wfSteps.value = ['', '']
}

function addWorkflowStep(): void {
  if (wfSteps.value.length >= WORKFLOW_MAX_STEPS) {
    wfNotice.value = `最多 ${WORKFLOW_MAX_STEPS} 步（一步就是一次模型调用）`
    return
  }
  wfNotice.value = null
  wfSteps.value = [...wfSteps.value, '']
}

function removeWorkflowStep(i: number): void {
  wfSteps.value = wfSteps.value.filter((_, n) => n !== i)
}

function submitWorkflow(): void {
  const rejected = workflow.add({
    name: wfName.value,
    prompts: wfSteps.value,
    providerId: wfProvider.value,
  })
  wfNotice.value = rejected.length ? rejected.join('；') : null
  if (!rejected.length) {
    wfName.value = ''
    wfSteps.value = ['', '']
    wfAdding.value = false
  }
}

function wfStatus(f: WorkflowFlow): string {
  if (workflow.running.value === f.id) return '正在跑…'
  const r = lastWorkflowRun(workflow.runs.value, f.id)
  if (!r) return `${f.steps.length} 步 · 等第一次`
  const tail = when(r.at * 1000)
  return r.status === 'ok' ? `跑完 · ${tail}` : `没跑通 · ${tail}`
}

function wfLast(f: WorkflowFlow): WorkflowRun | undefined {
  return lastWorkflowRun(workflow.runs.value, f.id)
}

function wfRunMeta(r: WorkflowRun): string {
  return `${r.status === 'ok' ? '结果' : '原因'} · ${when(r.at * 1000)}`
}

/** 第几步的那句提示词（标出来，让人知道是哪一步出的事；长了只留开头） */
function wfStepPrompt(f: WorkflowFlow, stepId: string): string {
  const p = f.steps.find((s) => s.id === stepId)?.prompt ?? ''
  return p.length > 40 ? `${p.slice(0, 40)}…` : p
}

function runWorkflow(id: string): void {
  if (!workflow.run(id)) {
    wfNotice.value = '已经有一个工作流在跑了 —— 一次只跑一条（并发跑等于双倍花钱）'
    return
  }
  wfNotice.value = null
}

function toggleWorkflowOpen(id: string): void {
  wfOpen.value = wfOpen.value === id ? null : id
  wfConfirm.value = null
}

function dropWorkflow(id: string): void {
  if (wfConfirm.value !== id) {
    wfConfirm.value = id
    return
  }
  wfConfirm.value = null
  if (wfOpen.value === id) wfOpen.value = null
  workflow.remove(id)
}

/**
 * 「资料」这一节（PR-F1）。三条与坞里那套保持一致：
 * - 导入前先按体积拦（读进内存之前拦，才真省内存）；
 * - 拒收理由**逐条**回给用户（一次选五个文件要知道哪个没进、为什么）；
 * - 删除两步、预览显示的是**喂给模型的同一段摘录**（不是全文的另一种样子）。
 */
const fileEl = ref<HTMLInputElement | null>(null)
const openDoc = ref<string | null>(null)
const docNotice = ref<string | null>(null)
const confirmDoc = ref<string | null>(null)
/** 与 composer 的「＋ 文件」同一份扩展名提示（收不收由 `addDocs` 判，扩展名能骗人） */
const DOC_ACCEPT =
  '.txt,.md,.markdown,.json,.csv,.tsv,.log,.yml,.yaml,.toml,.ini,.xml,.html,.css,.js,.ts,.vue,.py,.rs,.go,.java,.sh'

function pickDoc(): void {
  fileEl.value?.click()
}

async function onPicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // 清 value：同一个文件再选一次也要能触发 change
  input.value = ''
  const read: PickedDoc[] = []
  const rejected: string[] = []
  for (const f of files) {
    if (f.size > KNOWLEDGE_FILE_MAX_BYTES) {
      rejected.push(`${f.name} 超过 ${Math.round(KNOWLEDGE_FILE_MAX_BYTES / 1000)}KB，先别入库`)
      continue
    }
    try {
      read.push({ name: f.name, text: await f.text() })
    } catch {
      rejected.push(`${f.name} 读不出来（可能不是文本文件）`)
    }
  }
  const why = [...rejected, ...knowledge.add(read)]
  docNotice.value = why.length ? why.join('；') : null
}

function toggleDoc(id: string): void {
  openDoc.value = openDoc.value === id ? null : id
  confirmDoc.value = null
}

/** 两步移除（与会话行、会议详情删稿同一手法） */
function dropDoc(id: string): void {
  if (confirmDoc.value !== id) {
    confirmDoc.value = id
    return
  }
  confirmDoc.value = null
  if (openDoc.value === id) openDoc.value = null
  knowledge.remove(id)
}

/**
 * 「技能」这一节（PR-F3）。与资料同一套行样式 / 两步移除，差别只在录入方式：
 * 技能是用户手写的**一段提示词模板**（名字 + 正文），不是导入文件。
 * 判定（同名 / 空 / 非文本 / 超长拒收 / 份数）全在 `skills.ts`，这里只把拒收理由
 * 逐条说出来、把预览显示成**喂给模型的同一段全文**（不截断，见 §12.68）。
 */
const skillAdding = ref(false)
const skillName = ref('')
const skillText = ref('')
const skillNotice = ref<string | null>(null)
const openSkill = ref<string | null>(null)
const confirmSkill = ref<string | null>(null)

function startSkillAdd(): void {
  skillAdding.value = !skillAdding.value
  skillNotice.value = null
}

function submitSkill(): void {
  const why = skills.add([{ name: skillName.value, text: skillText.value }])
  skillNotice.value = why.length ? why.join('；') : null
  if (!why.length) {
    skillName.value = ''
    skillText.value = ''
    skillAdding.value = false
  }
}

function toggleSkill(id: string): void {
  openSkill.value = openSkill.value === id ? null : id
  confirmSkill.value = null
}

function dropSkill(id: string): void {
  if (confirmSkill.value !== id) {
    confirmSkill.value = id
    return
  }
  confirmSkill.value = null
  if (openSkill.value === id) openSkill.value = null
  skills.remove(id)
}

/** 两步删除：第一次点只标记，第二次点同一行才真删（与坞原历史面板同一手法） */
const confirmId = ref<string | null>(null)

function pick(id: string): void {
  if (confirmId.value) confirmId.value = null
  void sessions.load(id)
}

async function remove(id: string): Promise<void> {
  if (confirmId.value !== id) {
    confirmId.value = id
    return
  }
  confirmId.value = null
  await sessions.remove(id)
}

function when(at: number): string {
  const d = Math.floor((Date.now() - at) / 60000)
  if (d < 1) return '刚刚'
  if (d < 60) return `${d} 分钟前`
  if (d < 1440) return `${Math.floor(d / 60)} 小时前`
  return `${Math.floor(d / 1440)} 天前`
}

onMounted(() => void sessions.refresh())
</script>

<template>
  <aside class="rail" aria-label="会话栏">
    <nav class="modes" aria-label="视图">
      <button :data-active="view === 'chat'" data-mode="chat" title="和 AI 说话，让它来布置这一屏" @click="emit('select-view', 'chat')">
        聊天
      </button>
      <button :data-active="view === 'workbench'" data-mode="workbench" @click="emit('select-view', 'workbench')">
        工作台
      </button>
      <button :data-active="view === 'edit'" data-mode="edit" @click="emit('select-view', 'edit')">布局编辑</button>
    </nav>

    <div class="sessions" role="group" aria-label="AI 会话">
      <div class="sessions-head">
        <span class="label">会话</span>
        <button class="new" title="新对话" aria-label="新对话" data-new-chat @click="sessions.startNew()">
          <MessageSquarePlus :size="14" />
        </button>
      </div>
      <p v-if="sessions.error.value" class="err">{{ sessions.error.value }}</p>
      <p v-else-if="!sessions.items.value.length" class="empty">还没有会话。点右下角说第一句话，它就会出现在这里。</p>
      <ul v-else class="list">
        <li v-for="s in sessions.items.value" :key="s.id">
          <button class="item" :data-active="sessions.activeId.value === s.id" :data-session="s.id" @click="pick(s.id)">
            <span class="t">{{ s.title || '未命名对话' }}</span>
            <span class="m">{{ when(s.updatedAt) }} · {{ s.messageCount }} 条</span>
          </button>
          <button
            class="del"
            :title="confirmId === s.id ? '再点一次确认删除' : '删除会话'"
            :aria-label="`删除会话：${s.title || '未命名对话'}`"
            :data-confirm="confirmId === s.id"
            @click.stop="remove(s.id)"
          >
            <Trash2 :size="13" />
          </button>
        </li>
      </ul>
    </div>

    <!-- PR-F1：资料（本地文档 → 聊天里 @ 引用）。放会话下面：两者都是"这次要用什么" -->
    <div class="docs" role="group" aria-label="资料">
      <div class="sessions-head">
        <span class="label">资料</span>
        <button class="new" title="导入资料（文本文件）" aria-label="导入资料" data-add-doc @click="pickDoc">
          <FilePlus :size="14" />
        </button>
        <input
          ref="fileEl"
          type="file"
          multiple
          class="file-input"
          data-doc-file
          :accept="DOC_ACCEPT"
          @change="onPicked"
        />
      </div>
      <p v-if="docNotice" class="err" data-doc-notice>{{ docNotice }}</p>
      <p v-if="!knowledge.docs.value.length" class="empty">导入 Markdown / txt 等文本，聊天里用 @ 引用它。</p>
      <ul v-else class="doc-list">
        <li v-for="d in knowledge.docs.value" :key="d.id">
          <div class="doc-line">
            <button
              class="item"
              :data-doc="d.id"
              :data-open="openDoc === d.id"
              :title="`${d.name}`"
              @click="toggleDoc(d.id)"
            >
              <span class="t">{{ d.name }}</span>
              <span class="m">{{ charsLabel(d.chars) }}{{ d.truncated ? ' · 已截断' : '' }}</span>
            </button>
            <button
              class="del"
              :data-confirm="confirmDoc === d.id"
              :title="confirmDoc === d.id ? '再点一次确认移除' : '移除资料'"
              :aria-label="`移除资料：${d.name}`"
              @click.stop="dropDoc(d.id)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
          <div v-if="openDoc === d.id" class="preview-wrap">
            <p class="preview-hint">喂给模型的就是这一段（摘录上限 {{ KNOWLEDGE_EXCERPT_MAX }} 字）</p>
            <pre class="preview" data-doc-preview>{{ docExcerpt(d) }}</pre>
          </div>
        </li>
      </ul>
    </div>

    <!-- PR-F3 技能：本地提示词模板 → 聊天里 @ 展开进 system 块。与资料同层，放它下面 -->
    <div class="docs" role="group" aria-label="技能">
      <div class="sessions-head">
        <span class="label">技能</span>
        <button class="new" title="存一条技能（提示词模板）" aria-label="存一条技能" data-skill-add @click="startSkillAdd">
          <BookMarked :size="14" />
        </button>
      </div>
      <p v-if="skillNotice" class="err" data-skill-notice>{{ skillNotice }}</p>
      <div v-if="skillAdding" class="skill-form">
        <input
          v-model="skillName"
          class="skill-name"
          data-skill-name
          :maxlength="SKILL_NAME_MAX"
          placeholder="起个名字，比如「周报助手」"
          aria-label="技能名字"
        />
        <textarea
          v-model="skillText"
          rows="3"
          class="skill-text"
          data-skill-text
          placeholder="写一段会反复用的提示词，聊天里 @ 选中它就展开"
          aria-label="技能正文"
        />
        <p class="preview-hint">纯文本模板：名字 {{ SKILL_NAME_MAX }} 字内、正文 {{ SKILL_TEXT_MAX }} 字内；超长整条拒收、不截断。</p>
        <div class="cron-actions">
          <button class="cron-submit" data-skill-submit :disabled="!skillName.trim() || !skillText.trim()" @click="submitSkill">存技能</button>
          <button class="cron-cancel" data-skill-cancel @click="skillAdding = false; skillNotice = null">取消</button>
        </div>
      </div>
      <p v-if="!skills.skills.value.length && !skillAdding" class="empty">
        存一段常用的提示词（比如「把要点写成三句话」），聊天里用 @ 选中它，整段展开进对话。
      </p>
      <ul v-else class="doc-list">
        <li v-for="s in skills.skills.value" :key="s.id">
          <div class="doc-line">
            <button
              class="item"
              :data-skill="s.id"
              :data-open="openSkill === s.id"
              :title="s.name"
              @click="toggleSkill(s.id)"
            >
              <span class="t">{{ s.name }}</span>
              <span class="m">{{ charsLabel(s.chars) }}</span>
            </button>
            <button
              class="del"
              :data-confirm="confirmSkill === s.id"
              :title="confirmSkill === s.id ? '再点一次确认移除' : '移除技能'"
              :aria-label="`移除技能：${s.name}`"
              @click.stop="dropSkill(s.id)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
          <div v-if="openSkill === s.id" class="preview-wrap">
            <p class="preview-hint">@ 选中时展开进对话的就是这一整段；多条引用合计仍由既有的 2000 字预算统一封顶。</p>
            <pre class="preview" data-skill-preview>{{ skillExcerpt(s) }}</pre>
          </div>
        </li>
      </ul>
    </div>

    <!-- PR-F2 定时任务：桌面才有模型服务通道，网页版整节不渲染（不摆发不出去的假界面） -->
    <div v-if="isDesktop" class="docs" role="group" aria-label="定时任务">
      <div class="sessions-head">
        <span class="label">定时</span>
        <button class="new" title="加一个定时任务" aria-label="加定时任务" data-cron-add @click="startCronAdd">
          <CalendarClock :size="14" />
        </button>
      </div>
      <p v-if="cronNotice" class="err" data-cron-notice>{{ cronNotice }}</p>
      <div v-if="cronAdding" class="cron-form">
        <input v-model="cronTime" type="time" class="cron-time" data-cron-time aria-label="每天几点跑" />
        <textarea
          v-model="cronPrompt"
          rows="2"
          class="cron-prompt"
          data-cron-prompt
          placeholder="到点让 AI 做什么？比如：把今天的待办整理成三句话。"
          aria-label="任务提示词"
        />
        <select v-if="providers.length > 1" v-model="cronProvider" class="cron-provider" data-cron-provider aria-label="用哪个模型服务">
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.model || p.id }}</option>
        </select>
        <p v-else-if="providers.length === 1" class="preview-hint">用模型服务：{{ providers[0].model || providers[0].id }}</p>
        <p v-else class="preview-hint">还没有模型服务 —— 先去「设置 → 实验室」配一个再建任务。</p>
        <div class="cron-actions">
          <button class="cron-submit" data-cron-submit :disabled="!cronPrompt.trim()" @click="submitCron">建任务</button>
          <button class="cron-cancel" data-cron-cancel @click="cronAdding = false">取消</button>
        </div>
      </div>
      <p v-if="!cron.tasks.value.length && !cronAdding" class="empty">
        到点让 AI 替你跑一句：比如每天早上把待办整理成三句话。应用没开着就记「错过」，不补跑。
      </p>
      <ul v-else class="doc-list">
        <li v-for="t in cron.tasks.value" :key="t.id">
          <div class="doc-line" :class="{ off: !t.enabled }">
            <button
              class="item"
              :data-cron-task="t.id"
              :data-open="cronOpen === t.id"
              :title="`${t.time} · ${t.prompt}（点开看最近一次）`"
              @click="toggleCronOpen(t.id)"
            >
              <span class="t">{{ t.time }} · {{ t.prompt }}</span>
              <span class="m" :data-cron-status="t.id">{{ statusLine(t) }}</span>
            </button>
            <button
              class="del"
              :data-cron-toggle="t.id"
              :title="t.enabled ? '停用（不再到点执行）' : '启用'"
              :aria-label="t.enabled ? `停用任务：${t.prompt}` : `启用任务：${t.prompt}`"
              @click.stop="toggleCronEnabled(t.id)"
            >
              <Power :size="13" />
            </button>
            <button
              class="del"
              :data-confirm="cronConfirm === t.id"
              :title="cronConfirm === t.id ? '再点一次确认删除' : '删除任务'"
              :aria-label="`删除任务：${t.prompt}`"
              @click.stop="dropCron(t.id)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
          <div v-if="cronOpen === t.id && lastOf(t)" class="preview-wrap">
            <p class="preview-hint" data-cron-run-meta>{{ runMeta(lastOf(t)!) }}</p>
            <pre v-if="lastOf(t)!.text" class="preview" data-cron-run-preview>{{ lastOf(t)!.text }}</pre>
            <pre v-else class="preview" data-cron-run-error>{{ lastOf(t)!.error }}</pre>
          </div>
        </li>
      </ul>
    </div>

    <!-- PR-F3 工作流：把几步串起来替我跑一遍。同样只有桌面有模型服务通道，网页版整节不渲染 -->
    <div v-if="isDesktop" class="docs" role="group" aria-label="工作流">
      <div class="sessions-head">
        <span class="label">工作流</span>
        <button class="new" title="加一个工作流" aria-label="加工作流" data-wf-add @click="startWorkflowAdd">
          <Workflow :size="14" />
        </button>
      </div>
      <p v-if="wfNotice" class="err" data-wf-notice>{{ wfNotice }}</p>
      <div v-if="wfAdding" class="cron-form">
        <input
          v-model="wfName"
          class="cron-time wf-name"
          data-wf-name
          placeholder="这个流程叫什么？"
          aria-label="工作流名字"
        />
        <div v-for="i in wfSteps.length" :key="i" class="wf-step">
          <textarea
            v-model="wfSteps[i - 1]"
            rows="2"
            class="cron-prompt"
            :data-wf-step="i - 1"
            :placeholder="`第 ${i} 步：这一步让 AI 做什么？`"
            :aria-label="`第 ${i} 步提示词`"
          />
          <button
            v-if="wfSteps.length > 1"
            class="wf-step-del"
            :data-wf-step-remove="i - 1"
            title="删掉这一步"
            :aria-label="`删掉第 ${i} 步`"
            @click="removeWorkflowStep(i - 1)"
          >
            <X :size="12" />
          </button>
        </div>
        <button class="wf-add-step" data-wf-add-step @click="addWorkflowStep">加一步</button>
        <select v-if="providers.length > 1" v-model="wfProvider" class="cron-provider" data-wf-provider aria-label="用哪个模型服务">
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.model || p.id }}</option>
        </select>
        <p v-else-if="providers.length === 1" class="preview-hint">用模型服务：{{ providers[0].model || providers[0].id }}</p>
        <p v-else class="preview-hint">还没有模型服务 —— 先去「设置 → 实验室」配一个再建工作流。</p>
        <div class="cron-actions">
          <button class="cron-submit" data-wf-submit :disabled="!wfName.trim()" @click="submitWorkflow">建工作流</button>
          <button class="cron-cancel" data-wf-cancel @click="wfAdding = false">取消</button>
        </div>
      </div>
      <p v-if="!workflow.flows.value.length && !wfAdding" class="empty">
        把几步串成一条：先让它搜集，再让它归纳。点「跑一遍」才花钱，某一步没通就停在那儿。
      </p>
      <ul v-else class="doc-list">
        <li v-for="f in workflow.flows.value" :key="f.id">
          <div class="doc-line">
            <button
              class="item"
              :data-wf-flow="f.id"
              :data-open="wfOpen === f.id"
              :title="`${f.name} · ${f.steps.length} 步（点开看最近一次）`"
              @click="toggleWorkflowOpen(f.id)"
            >
              <span class="t">{{ f.name }}</span>
              <span class="m" :data-wf-status="f.id">{{ wfStatus(f) }}</span>
            </button>
            <button
              class="del"
              :data-wf-run="f.id"
              :title="workflow.running.value ? '已经有一个在跑了' : '跑一遍'"
              :aria-label="`跑一遍工作流：${f.name}`"
              @click.stop="runWorkflow(f.id)"
            >
              <Play :size="13" />
            </button>
            <button
              class="del"
              :data-confirm="wfConfirm === f.id"
              :title="wfConfirm === f.id ? '再点一次确认删除' : '删除工作流'"
              :aria-label="`删除工作流：${f.name}`"
              @click.stop="dropWorkflow(f.id)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
          <div v-if="wfOpen === f.id && wfLast(f)" class="preview-wrap">
            <p class="preview-hint" data-wf-run-meta>{{ wfRunMeta(wfLast(f)!) }}</p>
            <div v-for="(s, i) in wfLast(f)!.steps" :key="s.stepId" class="wf-result">
              <p class="preview-hint">第 {{ i + 1 }} 步 · {{ wfStepPrompt(f, s.stepId) }}</p>
              <pre class="preview" :data-wf-step-result="i">{{ s.text || s.error }}</pre>
            </div>
            <p v-if="wfLast(f)!.error" class="err" data-wf-run-error>{{ wfLast(f)!.error }}</p>
          </div>
        </li>
      </ul>
    </div>

    <div class="user">
      <span class="name">本地模式</span>
      <span class="hint">数据在这台机器上</span>
    </div>
  </aside>
</template>

<style scoped>
.rail {
  width: 224px;
  flex: 0 0 224px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}
.modes {
  display: flex;
  gap: 4px;
}
.modes button {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-2);
}
.modes button[data-active='true'] {
  background: var(--bg-card-soft);
  border-color: var(--border-soft);
  color: var(--text-1);
  font-weight: 600;
}
.sessions {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.sessions-head {
  display: flex;
  align-items: center;
}
.label {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
}
.new {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-2);
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: var(--radius-sm);
}
.new:hover {
  background: var(--bg-card-soft);
  color: var(--text-1);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.list li {
  display: flex;
  align-items: stretch;
  gap: 2px;
}
.item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
}
.item[data-active='true'] {
  background: var(--bg-card-soft);
  border-color: var(--border-soft);
}
.item .t {
  width: 100%;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item .m {
  font-size: 11px;
  color: var(--text-3);
}
.del {
  border: none;
  background: transparent;
  color: var(--text-3);
  display: grid;
  place-items: center;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  opacity: 0;
}
.list li:hover .del,
.del[data-confirm='true'] {
  opacity: 1;
}
.del:hover {
  color: var(--c-red);
}
.del[data-confirm='true'] {
  color: var(--c-red);
  background: var(--bg-card-soft);
}
.err,
.empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
}
.err {
  color: var(--c-red);
}
/* PR-F1 资料：与会话同一套行样式，只是清单自己滚动、预览就挂在行下面 */
.docs {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 34vh;
  min-height: 0;
}
.doc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.doc-line {
  display: flex;
  align-items: stretch;
  gap: 2px;
}
.doc-line .item[data-open='true'] {
  background: var(--bg-card-soft);
  border-color: var(--border-soft);
}
.doc-line:hover .del,
.doc-line .del[data-confirm='true'] {
  opacity: 1;
}
.file-input {
  display: none;
}
.preview-wrap {
  padding: 2px 4px 6px;
}
.preview-hint {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--text-3);
}
.preview {
  margin: 0;
  max-height: 180px;
  overflow: auto;
  padding: 6px 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-card-soft);
  color: var(--text-2);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}
/* PR-F3 技能：与定时同一套内联表单样式，只是多一个单行名字输入 */
.skill-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 8px 6px;
}
.skill-name,
.skill-text {
  padding: 4px 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-1);
  font-size: 12px;
  line-height: 1.5;
  font-family: inherit;
}
.skill-text {
  resize: none;
}
/* PR-F2 定时：建任务的内联小表单 + 停用行的视觉降档 */
.cron-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 8px 6px;
}
.cron-time {
  width: 120px;
  padding: 4px 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-1);
  font-size: 12px;
}
.cron-prompt {
  resize: none;
  padding: 6px 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-1);
  font-size: 12px;
  line-height: 1.5;
  font-family: inherit;
}
.cron-provider {
  padding: 4px 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-1);
  font-size: 12px;
}
.cron-actions {
  display: flex;
  gap: 6px;
}
.cron-submit {
  padding: 5px var(--space-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.cron-submit:disabled {
  opacity: 0.5;
  cursor: default;
}
.cron-cancel {
  padding: 5px var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.doc-line.off .item {
  opacity: 0.55;
}
/* PR-F3 工作流：多步表单（一步一行 + 删那一步）+ 逐步结果 */
.wf-name {
  width: 100%;
}
.wf-step {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.wf-step .cron-prompt {
  flex: 1;
  min-width: 0;
}
.wf-step-del {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  padding: 5px 3px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-3);
  cursor: pointer;
}
.wf-step-del:hover {
  color: var(--c-red);
  background: var(--bg-card-soft);
}
.wf-add-step {
  align-self: flex-start;
  padding: 4px var(--space-2);
  border: 1px dashed var(--border-soft);
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.wf-result {
  margin-bottom: 6px;
}
.user {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-soft);
}
.name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}
.hint {
  font-size: 11px;
  color: var(--text-3);
}
</style>
