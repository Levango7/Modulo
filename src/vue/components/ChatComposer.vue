<script setup lang="ts">
/**
 * composer（F-15 P0 §1.3）：控件行 / 输入框 / `@` 候选 / 发送那几颗按钮 / 提示条。
 *
 * **纯展示 + 转发**：状态全在 `ChatDock`（发送、流式、`@` 候选、附件读取都在那儿），
 * 这里只有两个 DOM 句柄 ref（隐藏的 file input 与 textarea）—— 后者的 focus / 插字符
 * 由父组件通过 `defineExpose` 调，否则父组件只能靠 querySelector 把 DOM 结构再写一遍。
 *
 * 为什么要拆：这一块与"流式 / 发送 / 提议执行"没有任何耦合，拆出来之后改 composer
 * 不再需要动那一整套状态机。`data-chat-*` 属性一个都不能改名：E2E 全压在上面。
 */
import { computed, ref } from 'vue'
import { ATTACH_CHARS_MAX, ATTACH_MAX_FILES, THINKING_LEVELS, type CardChoice } from '../aiChat'

const props = defineProps<{
  draft: string
  picker: CardChoice[]
  pickerIndex: number
  busy: boolean
  /** 正在流式的会话 id（有值时「停止」才出现） */
  streaming: string | null
  thinking: string
  providerModel: string
  usage: { cards: number; used: number; max: number; over: boolean }
  /** 没有引用时的权限行（`permNote` 的返回值，无卡无资料时是 null） */
  permLine: string | null
  filesNote: string | null
  canSummarize: boolean
  notice: string | null
}>()
const emit = defineEmits<{
  (e: 'update:draft', v: string): void
  (e: 'update:thinking', v: string): void
  (e: 'input', ev: Event): void
  (e: 'keydown', ev: KeyboardEvent): void
  (e: 'pick', c: CardChoice): void
  (e: 'hover', n: number): void
  (e: 'files-picked', ev: Event): void
  (e: 'send'): void
  (e: 'stop'): void
  (e: 'summarize'): void
  (e: 'open-settings'): void
}>()

const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
/** 文件选择框的过滤提示。只是提示 —— 收不收由父组件的 `attachFile` 判（扩展名能骗人） */
const FILE_ACCEPT =
  '.txt,.md,.markdown,.json,.csv,.tsv,.log,.yml,.yaml,.toml,.ini,.xml,.html,.css,.js,.ts,.vue,.py,.rs,.go,.java,.sh'

const thinkingHint = computed(() => THINKING_LEVELS.find((l) => l.id === props.thinking)?.hint ?? '')
const canSend = computed(() => !props.busy && props.draft.trim().length > 0)
const showingPicker = computed(() => props.picker.length > 0)

function pickFiles(): void {
  fileEl.value?.click()
}

/**
 * 给父组件的三个句柄：焦点 / 读光标 / 改光标。
 * 换成一个"父组件自己 querySelector"的写法，等于把 DOM 结构写死两次。
 */
defineExpose({
  focus: () => inputEl.value?.focus(),
  blur: () => inputEl.value?.blur(),
  caret: () => inputEl.value?.selectionStart ?? props.draft.length,
  setCaret: (n: number) => {
    inputEl.value?.focus()
    inputEl.value?.setSelectionRange(n, n)
  },
})
</script>

<template>
  <div class="composer-wrap">
    <div class="controls" data-chat-controls>
      <span class="ctl model" data-chat-model :title="`当前模型服务：${providerModel}`">
        {{ providerModel }}
      </span>
      <label class="ctl think" :title="`思考等级：${thinkingHint}`">
        思考
        <select
          :value="thinking"
          data-chat-thinking
          aria-label="思考等级"
          @change="emit('update:thinking', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="l in THINKING_LEVELS" :key="l.id" :value="l.id">{{ l.label }}</option>
        </select>
      </label>
      <span v-if="usage.cards" class="ctl ctx" :class="{ over: usage.over }" data-chat-ctx>
        上下文 {{ usage.used }}/{{ usage.max }}
      </span>
      <span v-if="permLine" class="ctl perm" data-chat-perm>{{ permLine }}</span>
      <span v-if="filesNote" class="ctl file-note" data-chat-files-note>{{ filesNote }}</span>
      <button
        class="ctl add"
        data-chat-attach
        :title="`带文本文件进来：最多 ${ATTACH_MAX_FILES} 个、单个 ${ATTACH_CHARS_MAX} 字`"
        @click="pickFiles"
      >
        ＋ 文件
      </button>
      <input
        ref="fileEl"
        type="file"
        multiple
        class="file-input"
        data-chat-file
        :accept="FILE_ACCEPT"
        @change="emit('files-picked', $event)"
      />
    </div>

    <div class="composer">
      <ul v-if="showingPicker" class="picker" data-chat-picker>
        <li v-for="(c, i) in picker" :key="c.id">
          <button
            class="pick"
            :data-pick="c.id"
            :data-active="i === pickerIndex ? '1' : '0'"
            @click="emit('pick', c)"
            @pointerenter="emit('hover', i)"
          >
            {{ c.label }}
          </button>
        </li>
      </ul>
      <textarea
        ref="inputEl"
        :value="draft"
        data-chat-input
        rows="2"
        placeholder="问点什么…（Enter 发送，Shift+Enter 换行，@ 引用卡片）"
        @input="emit('update:draft', ($event.target as HTMLTextAreaElement).value); emit('input', $event)"
        @keydown="emit('keydown', $event)"
      />
      <button v-if="busy && streaming" class="send stop" data-chat-stop @click="emit('stop')">停止</button>
      <template v-else>
        <button
          class="send secondary"
          data-chat-summarize
          :disabled="busy || !canSummarize"
          title="把引用的卡片 / 这段文字总结成 3~5 句（不保存）"
          @click="emit('summarize')"
        >
          {{ busy ? '摘要中…' : '摘要' }}
        </button>
        <button class="send" data-chat-send :disabled="!canSend" @click="emit('send')">发送</button>
      </template>
    </div>

    <p v-if="notice" class="notice" data-chat-notice>
      {{ notice }}
      <button class="link" data-chat-goto-settings @click="emit('open-settings')">打开设置</button>
    </p>
  </div>
</template>

<style scoped>
.composer-wrap {
  flex: none;
}
.controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 0 var(--space-3);
}
.ctl {
  font-size: 11px;
  color: var(--text-3);
  padding: 2px 7px;
  border-radius: var(--radius-pill, 999px);
  background: color-mix(in srgb, var(--border-soft) 18%, transparent);
  white-space: nowrap;
}
.ctl.think,
.ctl.add {
  border: 0;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
}
.ctl.think {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.ctl.think select {
  border: 0;
  padding: 0 1px;
  background: none;
  color: var(--accent);
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  outline: none;
}
.ctl.think:hover,
.ctl.add:hover {
  color: var(--text-2);
}
.ctl.over {
  color: var(--c-red);
  font-weight: 600;
}
.file-input {
  display: none;
}
.composer {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-3);
}
.composer textarea {
  flex: 1;
  resize: none;
  padding: 6px var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-1);
  font-size: 13px;
  line-height: 1.5;
  font-family: inherit;
}
.send {
  padding: 6px var(--space-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.send:disabled {
  opacity: 0.5;
  cursor: default;
}
.send.stop {
  background: none;
  color: var(--c-red);
  border-color: color-mix(in srgb, var(--c-red) 50%, transparent);
}
/* 摘要是次要动作 —— 比「发送」轻一档，减少误点（误点 = 白花一次调用） */
.send.secondary {
  background: none;
  color: var(--text-2);
  border-color: var(--border-soft);
}
.picker {
  position: absolute;
  left: var(--space-3);
  bottom: calc(100% + 2px);
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  min-width: 220px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: var(--panel-bg, var(--bg-1, #fff));
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
  z-index: 2;
}
.pick {
  display: block;
  width: 100%;
  padding: 4px var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-1);
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}
.pick[data-active='1'] {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.notice {
  margin: 0;
  padding: 0 var(--space-3) var(--space-2);
  font-size: 12px;
  color: var(--c-amber);
}
button.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}
</style>
