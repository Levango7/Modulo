<script setup lang="ts">
/**
 * 快捷链接：点一下**复制**链接。
 *
 * ## 为什么不"点了就打开"
 *
 * 真要在桌面壳里打开外部链接，需要 `tauri-plugin-opener` —— 那是这个项目至今唯一
 * 没引入的新依赖，而且它把"链接去哪"交给外部应用决定（本地文件、未知协议的行为不可预期）。
 * 权衡之后这一版只做复制：不需要新依赖、行为完全可预期、网页版与桌面版表现一致。
 *
 * 代价是多一步 Ctrl+V。所以每个条目都写明"点了会复制什么"，
 * 而不是给一个看起来像链接、点下去没反应的文字。
 */
import { computed, inject, ref } from 'vue'
import { groupByHost, normalizeHref } from '@levango7/engine/links'
import { Check, Copy, Link2, Plus, Trash2 } from 'lucide-vue-next'
import type { CardDataApi } from '../../vue/cardData'

const props = defineProps<{ variant: string }>()
const cards = inject<CardDataApi>('cardData')!

const adding = ref(false)
const draftLabel = ref('')
const draftHref = ref('')
/** 刚复制过的那一条（用来给一次确认反馈）；存 id 而不是标签，标签可能重复 */
const justCopied = ref<string | null>(null)

const links = computed(() => cards.state.links)
const groups = computed(() => groupByHost(links.value))
const draftOk = computed(() => normalizeHref(draftHref.value) !== null)

function save(): void {
  if (!draftOk.value) return
  cards.addLink(draftLabel.value, draftHref.value)
  draftLabel.value = ''
  draftHref.value = ''
  adding.value = false
}

async function copy(href: string, id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(href)
    justCopied.value = id
    window.setTimeout(() => {
      if (justCopied.value === id) justCopied.value = null
    }, 1200)
  } catch {
    // 剪贴板不可用（无权限 / 非安全上下文）时**不假装成功**：
    // 卡上把链接原文显示出来，让用户自己选。
    justCopied.value = null
  }
}
</script>

<template>
  <div class="card links" :data-v="variant">
    <div class="card-body">
      <template v-if="adding">
        <input v-model="draftHref" class="in" placeholder="链接（如 github.com）" aria-label="链接" @keydown.enter.prevent="save()" />
        <input v-model="draftLabel" class="in" maxlength="24" placeholder="名字（可空，取主机名）" aria-label="名字" @keydown.enter.prevent="save()" />
        <div class="acts">
          <button class="primary" :disabled="!draftOk" @click="save()">加入</button>
          <button @click="adding = false">取消</button>
        </div>
      </template>

      <template v-else-if="links.length">
        <div class="top">
          <span class="label">快捷链接 · {{ links.length }} 条</span>
          <button class="add" title="加一条" aria-label="加一条链接" @click="adding = true"><Plus :size="12" /></button>
        </div>

        <ul class="list">
          <template v-for="g in groups" :key="g.host">
            <li v-if="variant === 'panel' && groups.length > 1" class="ghost">{{ g.host }}</li>
            <li v-for="l in g.links" :key="l.id">
              <button class="lk" :title="`复制 ${l.href}`" :aria-label="`复制链接 ${l.label}`" @click="copy(l.href, l.id)">
                <Check v-if="justCopied === l.id" :size="11" class="ok" />
                <Copy v-else :size="11" />
                <span class="nm">{{ l.label }}</span>
              </button>
              <button v-if="variant === 'panel'" class="del" :aria-label="`删除 ${l.label}`" @click="cards.removeLink(l.id)"><Trash2 :size="10" /></button>
            </li>
          </template>
        </ul>
        <p class="cap">点一下复制，不直接打开（桌面壳要新依赖，且链接去哪不可控）</p>
      </template>

      <template v-else>
        <div class="top">
          <Link2 class="ico" :size="15" />
          <button class="add" title="加一条" aria-label="加一条链接" @click="adding = true"><Plus :size="12" /></button>
        </div>
        <p class="hint">加入常用链接，点一下复制</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.links .card-body {
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
.ghost {
  font-size: clamp(11px, 1.8cqw, 12px);
  color: var(--text-3);
  padding-block-start: 2px;
}
.lk {
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
  cursor: pointer;
  text-align: start;
}
.lk:hover,
.lk:focus-visible {
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
  padding: 2px 4px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
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