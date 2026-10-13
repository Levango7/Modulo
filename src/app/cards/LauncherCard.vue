<script setup lang="ts">
/**
 * 速达（2026-10-13 批 4）：常用程序 / 网页 / 文件收成"点一下就开"的收藏。
 *
 * 三条决定（与引擎 `launcher.ts` 的边界配套）：
 * 1. **目标形状在输入端就判**：只收 http(s) 链接与绝对路径 —— 裸命令名会被拒
 *    （否则这张卡就成了"执行任意命令"的入口）。引擎判一次、Rust 再判一次。
 * 2. **网页版只列不打开**：没有系统调用能力，按钮写明这一点（同 sysmon/probe 的降级纪律）。
 * 3. **UAC 由系统弹**：桌面壳走 `ShellExecuteW`（等价双击），需要管理员权限的目标
 *    会弹系统提权框 —— 我们**不代劳静默提权**（那会让一个被改过的收藏项拿到管理员会话）。
 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { kindOf } from '@levango7/engine/launcher'
import { ExternalLink, FolderOpen, Globe, Plus, Trash2, X } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'
import { isDesktop } from '../../vue/useShell'

const props = defineProps<{ variant: string; chromeless?: boolean }>()
const cards = inject<CardDataApi>('cardData')!

const adding = ref(false)
const draftLabel = ref('')
const draftTarget = ref('')
const addError = ref('')
/** 刚点过的那条（视觉回执）：launch 是异步的，没回执用户不知道点没点中 */
const flashId = ref('')
let flashTimer = 0
/** 失败提示（如"找不到这个文件"）—— 显示在卡片底部，不弹窗 */
const notice = ref('')

const items = computed(() => cards.state.launch)
const isList = computed(() => props.variant === 'list')

function iconOf(kind: string) {
  return kind === 'url' ? Globe : FolderOpen
}

async function launch(id: string): Promise<void> {
  const item = items.value.find((x) => x.id === id)
  if (!item) return
  flashId.value = id
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => (flashId.value = ''), 900)
  notice.value = ''
  if (!isDesktop) {
    notice.value = '网页版不能打开本机程序 —— 在桌面壳里可用'
    return
  }
  try {
    const err = await invoke<string | null>('launch_target', { target: item.target })
    if (err) notice.value = err
  } catch (e) {
    notice.value = String(e)
  }
}

function submitAdd(): void {
  addError.value = ''
  const kind = kindOf(draftTarget.value)
  if (!kind) {
    addError.value = '只收 http(s) 链接或绝对路径（如 C:\\Program Files\\…\\app.exe）—— 不接受的“命令名”'
    return
  }
  const ok = cards.addLaunch(draftLabel.value, draftTarget.value)
  if (!ok) {
    addError.value = '这条没能收下（目标形状不合规，或名单已满）'
    return
  }
  adding.value = false
  draftLabel.value = ''
  draftTarget.value = ''
}

onMounted(() => {
  // 首次用时给一句用法提示，别让空卡只有"添加"按钮（学自 probe 卡）
})
onBeforeUnmount(() => window.clearTimeout(flashTimer))
</script>

<template>
  <div class="lcard">
    <div class="lbody" :class="{ list: isList }">
      <p v-if="!items.length && !adding" class="lhint">
        把常用程序 / 网页收进来：点下面的「添加」，粘贴路径或链接。
      </p>
      <button
        v-for="it in items"
        :key="it.id"
        class="litem"
        :class="{ flash: flashId === it.id }"
        :title="it.target"
        @click="launch(it.id)"
      >
        <component :is="iconOf(it.kind)" :size="14" class="lico" />
        <span class="llabel">{{ it.label }}</span>
        <span class="ldel" title="从速达移除" @click.stop="cards.removeLaunch(it.id)"><Trash2 :size="10" /></span>
      </button>

      <div v-if="adding" class="ladd">
        <input v-model="draftTarget" class="linput" placeholder="C:\…\app.exe 或 https://…" aria-label="目标路径或链接" @keydown.enter="submitAdd" />
        <input v-model="draftLabel" class="linput small" placeholder="显示名（可空）" aria-label="显示名" @keydown.enter="submitAdd" />
        <button class="lok" @click="submitAdd">加</button>
        <button class="lcancel" title="取消" @click="adding = false"><X :size="11" /></button>
      </div>
      <p v-if="addError" class="lerr">{{ addError }}</p>
    </div>
    <footer class="lfoot">
      <p v-if="notice" class="lerr">{{ notice }}</p>
      <button v-else class="laddbtn" @click="adding = true"><Plus :size="12" /> 添加</button>
      <span v-if="!isDesktop" class="lweb"><ExternalLink :size="10" /> 网页版只列不打开</span>
    </footer>
  </div>
</template>

<style scoped>
.lcard {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.lbody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: var(--space-1);
  align-content: start;
}
.lbody.list {
  grid-template-columns: 1fr;
}
.litem {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: var(--space-2) 4px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-card-soft);
  color: var(--text-1);
  cursor: pointer;
  font-size: 11px;
  text-align: center;
  transition: transform var(--dur-micro) var(--ease-out), box-shadow var(--dur-micro) var(--ease-out);
}
.lbody.list .litem {
  flex-direction: row;
  justify-content: flex-start;
  text-align: left;
  padding: 3px var(--space-2);
  gap: var(--space-2);
}
.litem:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}
.litem.flash {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 2px var(--brand-glow);
}
.lico {
  color: var(--mod, var(--brand-500));
  flex: none;
}
.llabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.ldel {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  border-radius: var(--radius-sm);
  color: var(--text-4);
  opacity: 0;
}
.litem:hover .ldel {
  opacity: 1;
}
.ldel:hover {
  color: var(--c-red);
  background: var(--bg-card);
}
.lhint {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
}
.ladd {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 3px;
}
.linput {
  flex: 2;
  min-width: 0;
  font-size: 11px;
  padding: 2px var(--space-1);
  background: var(--input-bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
}
.linput.small {
  flex: 1;
}
.lok,
.lcancel {
  flex: none;
  border: 1px solid var(--border-soft);
  background: var(--bg-card-soft);
  color: var(--text-2);
  border-radius: var(--radius-sm);
  font-size: 11px;
  padding: 1px 6px;
  cursor: pointer;
}
.lcancel:hover {
  color: var(--c-red);
}
.lerr {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 10px;
  color: var(--c-red);
  overflow: hidden;
}
.lfoot {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-top: 2px;
  border-top: 1px solid var(--border-soft);
}
.laddbtn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.laddbtn:hover {
  color: var(--text-1);
}
.lweb {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-4);
}
</style>
