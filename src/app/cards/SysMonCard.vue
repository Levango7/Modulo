<script setup lang="ts">
/**
 * 系统监控：CPU / 内存 / 磁盘 / 网速。**仅桌面壳**（Rust `sys_stats`，sysinfo 采集）；
 * 网页版如实显示「仅桌面壳可用」—— 与网页监控同一套诚实降级，不摆一个假仪表盘。
 *
 * 网速是**前端差分**：Rust 只回累计收发字节，相邻两次采样除以间隔（引擎 `netRate`，
 * 纯函数可单测）—— Rust 侧少一份"上次采样时刻"的状态。CPU 首次采样恒为 0
 * （占用率要两次采样才有意义），界面显示「采样中」而不是 0% 冒充。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { barFrac, formatSize, netRate, pickDisk, type DiskLike } from '@levango7/engine/sysmon'
import { Cpu, HardDrive, MemoryStick, ArrowDownUp } from 'lucide-vue-next'
import { isDesktop } from '../../vue/useShell'

const props = defineProps<{ variant: string }>()

interface SysStats {
  cpuPercent: number
  memUsed: number
  memTotal: number
  disks: DiskLike[]
  netRxTotal: number
  netTxTotal: number
}

const POLL_MS = 2000
const stats = ref<SysStats | null>(null)
const prev = ref<{ rx: number; tx: number; at: number } | null>(null)
const rate = ref({ rx: 0, tx: 0 })
let timer: number | null = null

async function poll(): Promise<void> {
  try {
    const s = await invoke<SysStats>('sys_stats')
    const now = Date.now()
    if (prev.value) {
      rate.value = {
        rx: netRate(prev.value.rx, s.netRxTotal, now - prev.value.at),
        tx: netRate(prev.value.tx, s.netTxTotal, now - prev.value.at),
      }
    }
    prev.value = { rx: s.netRxTotal, tx: s.netTxTotal, at: now }
    stats.value = s
  } catch {
    stats.value = null
  }
}

/** 首次采样（CPU 恒 0）到第二次采样之间，CPU 显示「采样中」 */
const cpuReady = computed(() => (prev.value?.at ?? 0) > 0)
const mem = computed(() => {
  const s = stats.value
  if (!s || s.memTotal <= 0) return null
  return { frac: barFrac(s.memUsed, s.memTotal), used: formatSize(s.memUsed), total: formatSize(s.memTotal) }
})
const disk = computed(() => {
  const d = stats.value ? pickDisk(stats.value.disks) : null
  if (!d) return null
  return { mount: d.mount, frac: barFrac(d.used, d.total), used: formatSize(d.used), total: formatSize(d.total) }
})

onMounted(() => {
  if (!isDesktop) return
  void poll()
  timer = window.setInterval(() => void poll(), POLL_MS)
})
onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
})
</script>

<template>
  <div class="card sysmon" :data-v="variant">
    <div class="card-body">
      <template v-if="!isDesktop">
        <p class="hint">系统监控仅在桌面壳可用（网页读不到本机 CPU / 内存）。</p>
      </template>

      <template v-else-if="stats">
        <div class="row" title="CPU">
          <Cpu :size="12" class="ico" />
          <div class="meter">
            <i :style="{ width: `${barFrac(stats.cpuPercent, 100) * 100}%` }" />
          </div>
          <span class="val">
            <template v-if="cpuReady">{{ Math.round(stats.cpuPercent) }}%</template>
            <template v-else>采样中</template>
          </span>
        </div>
        <div class="row" title="内存">
          <MemoryStick :size="12" class="ico" />
          <div class="meter">
            <i v-if="mem" :style="{ width: `${mem.frac * 100}%` }" />
          </div>
          <span class="val">{{ mem ? `${mem.used} / ${mem.total}` : '—' }}</span>
        </div>
        <div v-if="variant !== 'mini'" class="row" :title="disk?.mount ?? '磁盘'">
          <HardDrive :size="12" class="ico" />
          <div class="meter">
            <i v-if="disk" :style="{ width: `${disk.frac * 100}%` }" />
          </div>
          <span class="val">{{ disk ? `${disk.used} / ${disk.total}` : '—' }}</span>
        </div>
        <div v-if="variant !== 'mini'" class="row" title="网速（下 / 上）">
          <ArrowDownUp :size="12" class="ico" />
          <span class="val wide">{{ formatSize(rate.rx) }}/s ↓ · {{ formatSize(rate.tx) }}/s ↑</span>
        </div>
      </template>

      <template v-else>
        <p class="hint">正在读系统指标…</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sysmon .card-body {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(4px, 1.6cqw, 10px);
  padding: clamp(8px, 2.2cqw, 16px);
}
.row {
  display: flex;
  align-items: center;
  gap: clamp(4px, 1.2cqw, 8px);
  min-width: 0;
}
.ico {
  flex: none;
  color: var(--mod, var(--brand-500));
}
.meter {
  flex: 1 1 auto;
  min-width: 0;
  height: clamp(5px, 1.8cqh, 9px);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--border-strong) 45%, transparent);
  overflow: hidden;
}
.meter i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--mod, var(--brand-500));
  transition: width var(--dur-micro) var(--ease-out);
}
.val {
  flex: none;
  font-size: clamp(11px, 2.2cqw, 12px);
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
  max-width: 55%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.val.wide {
  max-width: none;
  flex: 1 1 auto;
  text-align: end;
}
.hint {
  margin: 0;
  font-size: clamp(11px, 2.2cqw, 12px);
  color: var(--text-3);
  line-height: 1.5;
}
</style>
