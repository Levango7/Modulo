<script setup lang="ts">
/**
 * 命令速查：点一下**复制命令** —— 与快捷链接（LinksCard）同一套承诺：
 * 只复制、不执行。真要执行得用户自己粘到终端里按回车，
 * "卡片替你按回车"的快捷方式是把危险操作伪装成方便。
 *
 * 数据清洗在引擎 `commands.ts`（与 links.ts 同分层），这里只管交互；
 * 命令允许多行（管道/脚本贴进来是常态），列表里单行省略、悬停看全文。
 */
import { computed, inject, ref } from 'vue'
import { Check, Copy, Plus, Terminal, Trash2 } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const adding = ref(false)
const draftLabel = ref('')
const draftCmd = ref('')
/** 刚复制过的那一条（给一次确认反馈）；存 id 而不是名字，名字可能重复 */
const justCopied = ref<string | null>(null)

const commands = computed(() => cards.state.commands)
const draftOk = computed(() => draftCmd.value.trim().length > 0)

function save(): void {
  if (!draftOk.value) return
  cards.addCommand(draftLabel.value, draftCmd.value)
  draftLabel.value = ''
  draftCmd.value = ''
  adding.value = false
}

async function copy(cmd: string, id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(cmd)
    justCopied.value = id
    window.setTimeout(() => {
      if (justCopied.value === id) justCopied.value = null
    }, 1200)
  } catch {
    // 剪贴板不可用（无权限 / 非安全上下文）时**不假装成功**：
    // 卡上把命令原文显示出来（title 常驻全文），让用户自己选。
    justCopied.value = null
  }
}
</script>

<template>
  <div class="card cmds" :data-v="variant">
    <div class="card-body">
      <template v-if="adding">
        <textarea
          v-model="draftCmd"
          class="in"
          rows="3"
          maxlength="240"
          placeholder="命令（可多行，如管道）"
          aria-label="命令"
          @keydown.enter.exact.prevent="save()"
        />
        <input v-model="draftLabel" class="in" maxlength="24" placeholder="名字（可空，取命令首行）" aria-label="名字" @keydown.enter.prevent="save()" />
        <div class="acts">
          <button class="primary" :disabled="!draftOk" @click="save()">加入</button>
          <button @click="adding = false">取消</button>
        </div>
      </template>

      <template v-else-if="commands.length">
        <div class="top">
          <span class="label">命令速查 · {{ commands.length }} 条</span>
          <button class="add" title="加一条" aria-label="加一条命令" @click="adding = true"><Plus :size="12" /></button>
        </div>

        <ul class="list">
          <li v-for="c in commands" :key="c.id">
            <button class="ck" :title="c.cmd" :aria-label="`复制命令 ${c.label}`" @click="copy(c.cmd, c.id)">
              <Check v-if="justCopied === c.id" :size="11" class="ok" />
              <Copy v-else :size="11" />
              <span class="nm">{{ c.label }}</span>
            </button>
            <button v-if="variant === 'list'" class="del" :aria-label="`删除 ${c.label}`" @click="cards.removeCommand(c.id)"><Trash2 :size="10" /></button>
          </li>
        </ul>
        <p class="cap">点一下复制命令（不执行 —— 执行请粘到终端）</p>
      </template>

      <template v-else>
        <div class="top">
          <Terminal class="ico" :size="15" />
          <button class="add" title="加一条" aria-label="加一条命令" @click="adding = true"><Plus :size="12" /></button>
        </div>
        <p class="hint">存几条常用命令，点一下复制</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cmds .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.add {
  display: inline-flex;
  padding: 1px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.add:hover,
.add:focus-visible {
  color: var(--text-1);
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-block-size: 40cqh;
  overflow: auto;
}
.list li {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.ck {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 3px;
  background: transparent;
  border: none;
  color: var(--text-2);
  font-size: clamp(11px, 2.4cqw, 12px);
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  cursor: pointer;
  text-align: start;
}
.ck:hover,
.ck:focus-visible {
  color: var(--text-1);
  background: color-mix(in srgb, var(--brand-500) 8%, transparent);
}
.nm {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ok {
  color: var(--mod, var(--brand-500));
}
.del {
  flex: 0 0 auto;
  display: inline-flex;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.del:hover,
.del:focus-visible {
  color: var(--text-1);
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
  line-height: 1.4;
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
}
.ico {
  color: var(--mod, var(--brand-500));
}
.in {
  width: 100%;
  min-width: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  padding: 2px 4px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  resize: vertical;
}
.acts {
  display: flex;
  gap: var(--space-2);
}
.acts button {
  font-size: clamp(11px, 2.4cqw, 12px);
  padding: 1px 8px;
}
.acts .primary {
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 500;
}
.acts .primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
