<script setup lang="ts">
/**
 * 每日一图：把 Bing 每日壁纸搬进面板。
 *
 * **取数不经前端 fetch。** Bing 的 `HPImageArchive.aspx` 不返回
 * `Access-Control-Allow-Origin`，WebView2 的前端 `fetch` 必然被 CORS 拦；
 * 改由桌面侧的 `invoke('bing_daily')` 取回 JSON（见 `src-tauri/src/web.rs`），
 * 这里只负责渲染。
 *
 * `<img>` 的加载本身不受 CORS 约束，所以拿到地址后直接渲染即可 ——
 * CSP 只需在 `img-src` 放行 bing 一个域名，`connect-src` 刻意不放行：
 * 取数面已经不在前端了，多开一个源只是多一个可被打的靶子。
 *
 * 三套语境各记一次：
 * - 桌面壳：真实取数，显示今日壁纸 + 版权文案
 * - 网页版（vite dev / E2E 的 Chrome）：没有 `__TAURI_INTERNALS__`，明说不可用，
 *   **绝不拿占位图假装有图**
 * - 取数失败：把原因显示出来。"取不到"和"今天没图"是两回事，界面必须分得清。
 */
import { onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from '../../vue/useShell'
import { Image, RefreshCw } from 'lucide-vue-next'

const props = defineProps<{ variant: string }>()

interface DailyBing {
  url: string
  copyright: string
  startDate: string
}

type State = 'idle' | 'loading' | 'ok' | 'not-desktop' | 'error'

const state = ref<State>('idle')
const data = ref<DailyBing | null>(null)
const err = ref('')

async function load(): Promise<void> {
  if (!isDesktop) {
    state.value = 'not-desktop'
    return
  }
  state.value = 'loading'
  err.value = ''
  try {
    data.value = await invoke<DailyBing>('bing_daily')
    state.value = 'ok'
  } catch (e: unknown) {
    err.value = e instanceof Error ? e.message : String(e)
    state.value = 'error'
  }
}

onMounted(load)

function onImgError(): void {
  state.value = 'error'
  err.value = '图片链接打不开（可能是网络被拦，或 Bing 换了壁纸地址）'
}
</script>

<template>
  <div class="card dailyimg" :data-v="variant">
    <div class="card-body">
      <div class="top">
        <span class="label">每日一图</span>
        <button
          v-if="isDesktop"
          class="edit"
          title="重新获取"
          aria-label="重新获取每日一图"
          :disabled="state === 'loading'"
          @click="load"
        >
          <RefreshCw :size="11" />
        </button>
      </div>

      <div v-if="state === 'ok' && data" class="frame">
        <img class="img" :src="data.url" alt="每日壁纸" referrerpolicy="no-referrer" @error="onImgError" />
      </div>

      <div v-else-if="state === 'loading'" class="center">
        <span class="hint">取数中…</span>
      </div>

      <div v-else-if="state === 'not-desktop'" class="center">
        <p class="hint"><Image :size="12" /> 每日一图只在桌面壳里可用（网页版没有后端取数）</p>
      </div>

      <div v-else-if="state === 'error'" class="center">
        <p class="hint error">取数失败：{{ err }}</p>
      </div>

      <p v-if="state === 'ok' && data?.copyright" class="cap">{{ data.copyright }}</p>
    </div>
  </div>
</template>

<style scoped>
.dailyimg .card-body {
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
  min-width: 0;
}
.label {
  font-size: clamp(11px, 2.6cqw, 13px);
  color: var(--text-2);
}
.edit {
  display: inline-flex;
  padding: 1px;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}
.edit:disabled {
  opacity: 0.4;
  cursor: default;
}
.edit:hover,
.edit:focus-visible {
  color: var(--text-1);
}
.frame {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.img {
  display: block;
  inline-size: 100%;
  block-size: clamp(64px, 18cqh, 180px);
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
}
.center {
  display: flex;
  align-items: center;
  min-block-size: 48px;
}
.hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: clamp(11px, 2.4cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
.hint.error {
  color: var(--text-2);
}
.cap {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.4;
}
</style>