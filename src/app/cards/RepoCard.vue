<script setup lang="ts">
/**
 * GitHub 仓库动态（api.github.com，**已在 CSP 白名单**里，免 key）：星级 / 未决 issue / 最后推送 / 语言。
 * 仓库名是**偏好**（自己的 key，默认本项目）—— 换了名字 `freshKey` 会让缓存立刻失效重查。
 */
import { computed, inject, onMounted, ref } from 'vue'
import { parseRepo, repoApiUrl, repoPageUrl } from '@levango7/engine/ghrepo'
import { RefreshCw } from 'lucide-vue-next'
import { isDesktop } from '../../vue/useShell'
import { useRemote } from '../../vue/useRemote'
import type { StorageAdapter } from '../../vue/store'

const props = defineProps<{ variant: string }>()
const storage = inject<StorageAdapter>('storage') ?? { get: () => null, set: () => {} }
const KEY = 'modulo.repo.v1'

function readRepo(): string {
  try {
    const raw = JSON.parse(storage.get(KEY) ?? '') as { repo?: unknown }
    if (typeof raw?.repo === 'string' && raw.repo.trim()) return raw.repo.trim()
  } catch {
    /* 坏缓存当默认 */
  }
  return 'Levango7/Modulo'
}

const repo = ref(readRepo())
const editing = ref(false)
const draft = ref('')

const remote = useRemote(storage, {
  key: 'modulo.repo-snapshot.v1',
  url: () => repoApiUrl(repo.value),
  parse: parseRepo,
  ttlMs: 30 * 60 * 1000,
  freshKey: () => repo.value,
})
onMounted(() => remote.ensureFresh())

const pushed = computed(() => {
  const at = remote.snapshot.value?.pushedAt
  if (!at) return ''
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ' 更新'
})
const pageUrl = computed(() => repoPageUrl(repo.value))

function openEdit(): void {
  draft.value = repo.value
  editing.value = true
}
function save(): void {
  const t = draft.value.trim()
  if (t) {
    repo.value = t
    storage.set(KEY, JSON.stringify({ repo: t }))
  }
  editing.value = false
  remote.refresh()
}
</script>

<template>
  <div class="card repo" :data-v="variant">
    <div class="card-body">
      <div class="head">
        <span class="name">{{ remote.snapshot.value?.fullName ?? repo }}</span>
        <button class="edit" title="换一个仓库" aria-label="编辑仓库" @click="openEdit()">换</button>
        <button class="refresh" :class="{ spinning: remote.status.value === 'loading' }" title="立刻刷新" aria-label="刷新仓库动态" @click="remote.refresh()">
          <RefreshCw :size="13" />
        </button>
      </div>
      <template v-if="editing">
        <input v-model="draft" class="in" placeholder="owner/repo" spellcheck="false" aria-label="仓库名" @keydown.enter="save()" />
        <button class="save" @click="save()">保存并刷新</button>
      </template>
      <template v-else-if="remote.snapshot.value">
        <div class="row">
          <span class="k">★</span><span class="v">{{ remote.snapshot.value.stars }}</span>
          <span class="k">未决</span><span class="v">{{ remote.snapshot.value.issues }}</span>
        </div>
        <div class="row">
          <span class="k">最后推送</span><span class="v">{{ pushed || '—' }}</span>
        </div>
        <p v-if="remote.snapshot.value.description" class="desc">{{ remote.snapshot.value.description }}</p>
        <p class="cap">
          {{ remote.snapshot.value.language || '—' }}
          <template v-if="isDesktop"> · 桌面壳里点不开外链：{{ pageUrl }}</template>
          <a v-else :href="pageUrl ?? '#'" target="_blank" rel="noreferrer">在 GitHub 打开</a>
          <template v-if="remote.status.value === 'error'"> · 上次没取到（{{ remote.message.value }}）</template>
        </p>
      </template>
      <p v-else-if="remote.status.value === 'loading'" class="hint">正在取仓库动态…</p>
      <p v-else class="hint">取不到（{{ remote.message.value }}）—— 仓库名写成 owner/repo 再试</p>
    </div>
  </div>
</template>

<style scoped>
.repo .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(3px, 1cqw, 8px);
  padding: clamp(8px, 2.2cqw, 18px);
}
.head {
  display: flex;
  align-items: center;
  gap: clamp(3px, 1cqw, 8px);
  min-width: 0;
}
.name {
  flex: 1;
  min-width: 0;
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-1);
  font-family: ui-monospace, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.edit,
.refresh {
  display: inline-flex;
  padding: 1px 4px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  font-size: clamp(11px, 2.2cqw, 12px);
}
.edit:hover,
.refresh:hover {
  color: var(--text-1);
}
.refresh.spinning {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.row {
  display: flex;
  align-items: baseline;
  gap: clamp(4px, 1.6cqw, 10px);
  font-size: clamp(11px, 2.6cqw, 13px);
}
.k {
  color: var(--text-3);
}
.v {
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}
.desc {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-2);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.cap {
  margin: 0;
  font-size: clamp(11px, 2.1cqw, 11px);
  color: var(--text-3);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.cap a {
  color: var(--brand-600);
}
.in {
  width: 100%;
  min-width: 0;
  font-size: clamp(11px, 2.6cqw, 13px);
  padding: 2px 4px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-family: ui-monospace, monospace;
}
.save {
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-size: clamp(11px, 2.4cqw, 12px);
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  line-height: 1.6;
}
</style>
