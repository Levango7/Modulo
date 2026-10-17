<script setup lang="ts">
/**
 * 窗口预览卡：实时看某个窗口的画面。
 *
 * **仅桌面壳**（Rust `win_list` / `win_preview_start` / `win_preview_stop`，WGC 捕获）；
 * 网页版如实说不可用，不摆一个假预览框。
 *
 * 帧怎么来的：Rust 侧每帧 `Channel<InvokeResponseBody>` 发一段 JPEG 的 `Raw` 字节
 * （`src-tauri/src/capture/preview.rs` 的 `on_frame_arrived`），这里收到字节 → 建 Blob →
 * `URL.createObjectURL` 喂给 `<img>`。**每帧都要 revoke 上一帧**，理由见 `onFrame`。
 *
 * 三态降级都在界面里说清：已最小化（不能预览）/ 受保护内容（只能拿黑帧）/
 * 会话被停止（`win_preview_stopped`，人话映射在 `winPreview.ts`）。
 * 窗口列表子区域在 `src/vue/components/WinWindowList.vue`（守 450 行纪律）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Monitor, MonitorPlay, ShieldAlert, Square } from 'lucide-vue-next'
import { isDesktop } from '../../vue/useShell'
import WinWindowList from '../../vue/components/WinWindowList.vue'
import {
  FPS_DEFAULT,
  FPS_TIERS,
  WIDTH_DEFAULT,
  WIDTH_TIERS,
  canPreview,
  formatFrameSize,
  sniffImageMime,
  stopReasonText,
  toFrameBytes,
  truncateTitle,
  windowFlagHint,
  type FpsTier,
  type WinInfo,
  type WidthTier,
} from '../../vue/winPreview'

const props = defineProps<{ variant: string; moduleId?: string; chromeless?: boolean }>()

const windows = ref<WinInfo[]>([])
const listLoading = ref(false)
const listError = ref('')
const hwnd = ref<number | null>(null)
const fps = ref<FpsTier>(FPS_DEFAULT)
const maxWidth = ref<WidthTier>(WIDTH_DEFAULT)
const session = ref<string | null>(null)
const frameUrl = ref<string | null>(null)
const frameDim = ref('')
const status = ref('')
const frameError = ref('')
let unlisten: (() => void) | null = null
/** listen() 是异步的：注册在挂载与卸载之间落地时，组件可能已经没了 —— 此时立刻摘掉，别漏监听 */
let disposed = false

const previewing = computed(() => session.value !== null)
const selectedWin = computed(() => windows.value.find((w) => w.hwnd === hwnd.value) ?? null)

function releaseFrame(): void {
  if (frameUrl.value) {
    URL.revokeObjectURL(frameUrl.value)
    frameUrl.value = null
  }
  frameDim.value = ''
}

/**
 * 一到帧就把上一帧的 objectURL 撤掉。**这是硬要求**：10fps 跑一分钟就是 600 个
 * objectURL，blob 被 URL 引用着不会被 GC，不撤的话预览越久内存越涨，直到页面崩。
 * 撤的是**上一帧**（此刻已显示满一个帧间隔，浏览器早已解码完成），不是刚建好的这一帧，
 * 所以不会出现"图还没画完就被撤掉"。
 */
function onFrame(payload: unknown): void {
  const bytes = toFrameBytes(payload)
  if (!bytes) return
  const url = URL.createObjectURL(new Blob([bytes], { type: sniffImageMime(bytes) }))
  const prev = frameUrl.value
  frameUrl.value = url
  if (prev) URL.revokeObjectURL(prev)
}

function onFrameLoad(e: Event): void {
  const img = e.target as HTMLImageElement
  frameDim.value = formatFrameSize(img.naturalWidth, img.naturalHeight)
}

function onFrameError(): void {
  // 只报一次：一条通道坏掉会每帧都报，否则这一格会被刷屏
  if (!frameError.value) frameError.value = '帧解码失败（已跳过坏帧）'
}

/** 停预览：先摘 session 再撤帧，最后才通知后端 —— 事件回来时 session 已对不上，天然防重入 */
async function stopPreview(reason = ''): Promise<void> {
  const s = session.value
  session.value = null
  releaseFrame()
  if (reason) status.value = reason
  if (!s) return
  try {
    await invoke('win_preview_stop', { session: s })
  } catch {
    /* 会话可能已自行结束（窗口关了/通道断了），stop 报"已结束"是正常竞态，不必打扰用户 */
  }
}

async function startPreview(): Promise<void> {
  if (!isDesktop || hwnd.value === null) return
  const win = selectedWin.value
  if (win && !canPreview(win)) {
    status.value = windowFlagHint('minimized')
    return
  }
  await stopPreview()
  frameError.value = ''
  status.value = ''
  const channel = new Channel<ArrayBuffer>()
  channel.onmessage = (m) => onFrame(m)
  try {
    // 参数名走 camelCase（Tauri 映射到 Rust 的 snake_case：maxWidth→max_width、onFrame→on_frame）
    session.value = await invoke<string>('win_preview_start', {
      hwnd: hwnd.value,
      fps: fps.value,
      maxWidth: maxWidth.value,
      onFrame: channel,
    })
    status.value = '预览中'
  } catch (e) {
    session.value = null
    status.value = String(e)
  }
}

function selectWindow(w: WinInfo): void {
  if (!canPreview(w)) {
    status.value = windowFlagHint('minimized')
    return
  }
  if (hwnd.value === w.hwnd) return
  hwnd.value = w.hwnd
  void startPreview()
}

/** 切档位要重启预览 —— 帧率/尺寸是起会话时定死的，改不了运行中的会话 */
function setFps(v: FpsTier): void {
  if (fps.value === v) return
  fps.value = v
  if (session.value) void startPreview()
}

function setMaxWidth(v: WidthTier): void {
  if (maxWidth.value === v) return
  maxWidth.value = v
  if (session.value) void startPreview()
}

async function refreshList(): Promise<void> {
  if (!isDesktop) return
  listLoading.value = true
  listError.value = ''
  try {
    windows.value = await invoke<WinInfo[]>('win_list')
    // 选中的窗口可能已经不在了：留着会对着一个不复存在的会话干等
    if (hwnd.value !== null && !windows.value.some((w) => w.hwnd === hwnd.value)) {
      hwnd.value = null
      void stopPreview('选中的窗口已从列表消失，预览已停止')
    }
  } catch (e) {
    listError.value = String(e)
  } finally {
    listLoading.value = false
  }
}

onMounted(() => {
  if (!isDesktop) return
  void refreshList()
  void listen<{ session: string; reason: string }>('win_preview_stopped', (e) => {
    // 自己发起的 stop 已把 session 置空，这里只接"后端自行结束"（窗口关了/出错）
    if (session.value === null || e.payload.session !== session.value) return
    session.value = null
    releaseFrame()
    status.value = stopReasonText(e.payload.reason)
  })
    .then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })
    .catch(() => {
      /* 事件注册失败不影响预览本身：帧走的是 Channel，不是事件 */
    })
})

onBeforeUnmount(() => {
  disposed = true
  unlisten?.()
  // 卸载必停会话并撤帧：不停的话 Rust 会继续抓帧往一条没人收的通道上发，白烧显卡；
  // 不撤帧的话最后一个 objectURL 会一直挂着
  void stopPreview()
})
</script>

<template>
  <div class="card winview" :data-v="variant">
    <div v-if="!props.chromeless && variant !== 'mini'" class="card-head">
      <Monitor :size="14" />
      <span>窗口预览</span>
    </div>

    <div class="card-body">
      <p v-if="!isDesktop" class="hint">窗口预览仅桌面壳可用（网页版读不到本机的窗口画面）。</p>

      <template v-else>
        <div class="stage">
          <img
            v-if="frameUrl"
            class="frame"
            :src="frameUrl"
            alt="被预览窗口的实时画面"
            @load="onFrameLoad"
            @error="onFrameError"
          />
          <span v-else class="blank">
            <MonitorPlay :size="20" />
            <span class="bt">{{ status || '从下面选一个窗口开始预览' }}</span>
          </span>
        </div>

        <p v-if="selectedWin?.isProtected && previewing" class="hint warn">
          <ShieldAlert :size="12" /> 该窗口受系统保护，画面会是黑帧（Windows 的限制）
        </p>
        <p v-if="frameError" class="hint">{{ frameError }}</p>

        <div v-if="previewing" class="meta">
          <span class="stat">{{ fps }} fps</span>
          <span class="stat">上限 {{ maxWidth }}px</span>
          <span v-if="frameDim" class="stat">{{ frameDim }}</span>
          <button class="stop" @click="stopPreview(stopReasonText('user'))">
            <Square :size="12" /> 停止预览
          </button>
        </div>

        <!-- mini：只留预览 + 切窗口 -->
        <div v-if="variant === 'mini'" class="chips">
          <button
            v-for="w in windows"
            :key="w.hwnd"
            class="chip"
            :data-on="w.hwnd === hwnd"
            :disabled="!canPreview(w)"
            :title="`${w.title} — ${w.process || '未知进程'}`"
            @click="selectWindow(w)"
          >
            {{ truncateTitle(w.title, 14) }}
          </button>
        </div>

        <template v-else>
          <div class="tiers">
            <span class="tl">帧率</span>
            <button
              v-for="t in FPS_TIERS"
              :key="`f${t}`"
              class="tb"
              :data-on="fps === t"
              :aria-pressed="fps === t"
              @click="setFps(t)"
            >
              {{ t }}
            </button>
            <span class="tl">宽度</span>
            <button
              v-for="t in WIDTH_TIERS"
              :key="`w${t}`"
              class="tb"
              :data-on="maxWidth === t"
              :aria-pressed="maxWidth === t"
              @click="setMaxWidth(t)"
            >
              {{ t }}
            </button>
          </div>

          <WinWindowList
            :items="windows"
            :selected="hwnd"
            :loading="listLoading"
            :error="listError"
            @select="selectWindow"
            @refresh="refreshList"
          />
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.winview .card-body {
  display: flex;
  flex-direction: column;
  gap: clamp(4px, 1.4cqw, 10px);
  padding: clamp(8px, 2.2cqw, 18px);
  overflow: auto;
}
.stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-block-size: clamp(56px, 20cqh, 200px);
  background: color-mix(in srgb, var(--border-strong) 30%, transparent);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.frame {
  display: block;
  max-inline-size: 100%;
  max-block-size: 100%;
  object-fit: contain;
}
.blank {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-3);
}
.bt {
  font-size: clamp(11px, 2.2cqw, 12px);
  line-height: 1.5;
}
.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.stat {
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.stop,
.chip,
.tb {
  display: inline-flex;
  align-items: center;
}
.stop {
  gap: 3px;
  margin-inline-start: auto;
  font-size: clamp(11px, 2.1cqw, 12px);
  padding: 1px 8px;
}
.tiers {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 3px;
}
.tl {
  font-size: clamp(11px, 2cqw, 11px);
  color: var(--text-3);
}
.tb {
  justify-content: center;
  min-inline-size: 26px;
  font-size: clamp(11px, 2cqw, 11px);
  padding: 1px 5px;
  color: var(--text-3);
  border: 1px solid var(--border-soft);
  font-variant-numeric: tabular-nums;
}
.tb[data-on='true'] {
  color: var(--brand-600);
  border-color: var(--brand-500);
  background: color-mix(in srgb, var(--brand-500) 10%, transparent);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  max-block-size: 34cqh;
  overflow: auto;
}
.chip {
  font-size: clamp(11px, 2cqw, 11px);
  padding: 1px 6px;
  color: var(--text-3);
  border: 1px solid var(--border-soft);
  white-space: nowrap;
}
.chip[data-on='true'] {
  color: var(--brand-600);
  border-color: var(--brand-500);
  background: color-mix(in srgb, var(--brand-500) 10%, transparent);
}
.chip:disabled {
  opacity: 0.45;
  cursor: default;
}
.hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
.hint.warn {
  color: var(--text-2);
}
</style>
