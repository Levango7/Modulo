<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, Gift, X } from 'lucide-vue-next'
import { ACCENTS, MODES, SKINS } from '../appearance'
import { isCancelEscape, toChord } from '../chord'
import { useFocusTrap } from '../useFocusTrap'
import { dataDir as fetchDataDir } from '../fileStorage'
import { isDesktop, type ShortcutKind, type ShellApi } from '../useShell'
import { resolveGroup, visibleGroups, type SettingsGroupId } from '../settingsNav'
import { parseOnboarding, ONBOARDING_KEY } from '../onboarding'
import type { OnboardingApi } from '../onboarding'
import type { StorageAdapter } from '../store'
import BackupSection from './BackupSection.vue'
import SyncSection from './SyncSection.vue'
import SchemesSection from './SchemesSection.vue'
import AiLabSection from './AiLabSection.vue'
import VersionSection from './VersionSection.vue'
import type { AppearanceApi } from '../useAppearance'
import type { RemindersApi } from '../useReminders'

defineEmits<{ (e: 'close'): void; (e: 'open-templates'): void }>()
const appearance = inject<AppearanceApi>('appearance')!
const a = appearance.state
const shell = inject<ShellApi>('shell')!
const reminders = inject<RemindersApi>('reminders')!
const onboarding = inject<OnboardingApi>('onboarding')!
const storage = inject<StorageAdapter>('storage')!
const panelEl = ref<HTMLElement | null>(null)
useFocusTrap(panelEl)

/**
 * 分组（F-10 六组，F-12 加「实验室」后桌面七组）。**导航本身不落盘**：设置页停在哪一组不值得一个存储键，
 * 也不该被带进备份 —— 每次打开回第一组是"可预期"的那一边。
 */
const groups = visibleGroups(isDesktop)
const active = ref<SettingsGroupId>(resolveGroup(null, isDesktop).id)
const activeHint = computed(() => groups.find((g) => g.id === active.value)?.hint ?? '')

/**
 * 「关于」里那句状态：这台机器上的引导看过没有。
 * 直接读盘而不是读 `onboarding.state()` —— 回放后再进设置页要看到最新的那一份。
 */
const onboardingState = computed(() => parseOnboarding(storage.get(ONBOARDING_KEY)))

const setRemindersOn = (e: Event) => reminders.setSettings({ enabled: (e.target as HTMLInputElement).checked })
const setSystemNotifications = (e: Event) => reminders.setSettings({ systemNotifications: (e.target as HTMLInputElement).checked })
const setReminderTime = (key: 'quietStart' | 'quietEnd' | 'habitAfter') => (e: Event) =>
  reminders.setSettings({ [key]: (e.target as HTMLInputElement).value })

const dataDir = ref<string | null>(null)
onMounted(async () => {
  if (isDesktop) dataDir.value = await fetchDataDir()
})

function onHideChange(e: Event) {
  shell.setHideOnClose((e.target as HTMLInputElement).checked)
}

/**
 * 改键录制：点「改键」→ 按下目标组合键 → 交给 Rust 注册。
 * 用 document 捕获阶段监听并 stopPropagation，否则录的时候 Ctrl+Z、Esc 这些
 * 应用自身的快捷键会先被执行一遍（Esc 还会把设置面板关掉）。
 */
const recording = ref<string | null>(null)

function recordKey(e: KeyboardEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (isCancelEscape(e)) {
    stopRecord()
    return
  }
  const kind = recording.value
  const chord = kind ? toChord(e) : null
  if (!kind || !chord) return
  stopRecord()
  void shell.setShortcut(kind as ShortcutKind, chord)
}

function startRecord(kind: string) {
  if (recording.value === kind) {
    stopRecord()
    return
  }
  recording.value = kind
  document.addEventListener('keydown', recordKey, true)
}
function stopRecord() {
  recording.value = null
  document.removeEventListener('keydown', recordKey, true)
}
onBeforeUnmount(stopRecord)
</script>

<template>
  <div class="scrim" @click.self="$emit('close')">
    <div ref="panelEl" class="panel" role="dialog" aria-modal="true" aria-label="设置" tabindex="-1">
      <header class="head">
        <h2>设置</h2>
        <button class="x" title="关闭 (Esc)" @click="$emit('close')"><X :size="16" /></button>
      </header>

      <div class="body">
        <!--
          分组导航。窄屏时它变成一条可以横向滚动的标签条，**不折叠成下拉** ——
          下拉会把"设置一共分几组"这个事实藏起来，而那正是这轮改版要解决的问题之一。
        -->
        <nav class="nav" aria-label="设置分组">
          <button
            v-for="g in groups"
            :key="g.id"
            class="nav-item"
            :data-active="active === g.id"
            :data-group="g.id"
            :aria-current="active === g.id ? 'page' : undefined"
            :title="g.hint"
            @click="active = g.id"
          >
            {{ g.title }}
          </button>
        </nav>

        <div class="group">
          <p class="group-hint">{{ activeHint }}</p>

          <template v-if="active === 'appearance'">
            <section>
              <h3>视觉方向</h3>
              <div class="skins">
                <button
                  v-for="s in SKINS"
                  :key="s.id"
                  class="skin"
                  :data-skin-option="s.id"
                  :data-active="a.skin === s.id"
                  @click="appearance.set({ skin: s.id })"
                >
                  <span class="dot" :data-s="s.id" />
                  <span class="name">{{ s.label }}</span>
                  <span class="desc">{{ s.desc }}</span>
                  <Check v-if="a.skin === s.id" :size="14" class="tick" />
                </button>
              </div>
            </section>

            <section>
              <h3>明暗</h3>
              <div class="seg">
                <button v-for="m in MODES" :key="m.id" :data-active="a.mode === m.id" @click="appearance.set({ mode: m.id })">
                  {{ m.label }}
                </button>
              </div>
            </section>

            <section>
              <h3>强调色</h3>
              <div class="accents">
                <button
                  v-for="c in ACCENTS"
                  :key="c.id"
                  class="swatch"
                  :title="c.label"
                  :data-active="a.accent === c.id"
                  :data-auto="c.value === 'auto'"
                  :style="c.value === 'auto' ? undefined : { background: c.value }"
                  @click="appearance.set({ accent: c.value })"
                >
                  <Check v-if="a.accent === c.id" :size="12" />
                </button>
              </div>
              <p class="hint">「跟随皮肤」= 每套方向用它自己的强调色；选具体颜色则会覆盖皮肤默认值。</p>
            </section>
          </template>

          <template v-else-if="active === 'layout'">
            <section>
              <h3>版面模板</h3>
              <p class="hint">挑一张就换成那个排法；换错了按 Ctrl+Z 退回。</p>
              <div class="row">
                <button class="wide" data-open-templates @click="$emit('open-templates')">
                  <Gift :size="14" /> <span>挑一种排法…</span>
                </button>
              </div>
            </section>
            <SchemesSection />
          </template>

          <template v-else-if="active === 'data'">
            <BackupSection />
            <SyncSection />
            <section v-if="dataDir">
              <h3>数据目录</h3>
              <p class="hint">
                版面、方案册、卡片内容和这些设置都各自是一个 JSON 文件，放在
                <code>{{ dataDir }}</code>
                ，整个目录拷走就是备份。也可以在上面的备份节导出一个 JSON 自己收着。
              </p>
            </section>
          </template>

          <template v-else-if="active === 'reminders'">
            <section>
              <h3>提醒</h3>
              <label class="switch">
                <input type="checkbox" :checked="reminders.state.settings.enabled" @change="setRemindersOn" />
                <span>昨天之前记下的事到"今天"了，就提醒我（倒数日 / 生日 / 习惯）</span>
              </label>
              <label v-if="isDesktop" class="switch">
                <input
                  type="checkbox"
                  :checked="reminders.state.settings.systemNotifications"
                  @change="setSystemNotifications"
                />
                <span>同时发系统通知（窗口不在前台也能看到；开发态图标显示为 PowerShell，装成安装包后才是 Modulo）</span>
              </label>
              <div class="times">
                <label>
                  <span>静默从</span>
                  <input type="time" :value="reminders.state.settings.quietStart" @change="setReminderTime('quietStart')" />
                </label>
                <label>
                  <span>到</span>
                  <input type="time" :value="reminders.state.settings.quietEnd" @change="setReminderTime('quietEnd')" />
                </label>
                <label>
                  <span>习惯提醒从</span>
                  <input type="time" :value="reminders.state.settings.habitAfter" @change="setReminderTime('habitAfter')" />
                </label>
              </div>
              <p class="hint">
                静默默认关闭（起止相同即视为关）。开着时：时段内不弹，结束后同一天内补弹 ——
                但如果静默跨过了午夜，那一天的事就不补了。这些设置只存本机，不进备份。
                待办没有截止日期字段，所以不做"到期提醒"（不编不存在的东西）。
              </p>
            </section>
          </template>

          <template v-else-if="active === 'desktop' && isDesktop">
            <section>
              <h3>托盘</h3>
              <label class="switch">
                <input type="checkbox" :checked="shell.hideOnClose.value" @change="onHideChange" />
                <span>点关闭时收进托盘，而不是直接退出</span>
              </label>
            </section>

            <section>
              <h3>全局快捷键</h3>
              <ul v-if="shell.shortcuts.value.length" class="keys">
                <li v-for="k in shell.shortcuts.value" :key="k.kind">
                  <kbd>{{ k.keys }}</kbd>
                  <span>{{ k.label }}</span>
                  <em v-if="!k.registered" class="warn">注册失败，多半被别的程序占用了</em>
                  <button
                    class="rec"
                    :class="{ live: recording === k.kind }"
                    :aria-pressed="recording === k.kind"
                    @click="startRecord(k.kind)"
                  >
                    {{ recording === k.kind ? '按下组合键…' : '改键' }}
                  </button>
                </li>
              </ul>
              <p v-if="recording" class="hint recording" role="status" aria-live="polite">
                正在录制「{{ shell.shortcuts.value.find((s) => s.kind === recording)?.label }}」：按 Esc 取消。
                必须带 Ctrl / Alt / Shift / Win 中的一个或多个。
              </p>
              <p v-else class="hint">快捷键是系统级的，窗口不在前台也能用。注册失败只影响那一条，其余功能照常。</p>
              <p v-if="shell.shortcutError.value" class="error" role="alert">{{ shell.shortcutError.value }}</p>
            </section>
          </template>

          <template v-else-if="active === 'lab' && isDesktop">
            <AiLabSection />
          </template>

          <template v-else-if="active === 'about'">
            <section>
              <h3>首启引导</h3>
              <p class="hint">
                <template v-if="onboardingState.done">
                  这台机器<template v-if="onboardingState.skipped">跳过过</template><template v-else>走过</template>一次引导<template
                    v-if="onboardingState.at"
                  >（{{ new Date(onboardingState.at).toLocaleString() }}）</template>。想再看一遍可以重播 —— 它不会改你的版面，选版面那一步点了才生效。
                </template>
                <template v-else>还没走过引导。下次以空版面启动时会自动打开。</template>
              </p>
              <div class="row">
                <button data-replay-onboarding @click="onboarding.replay()">重新播放首启引导</button>
              </div>
            </section>
            <VersionSection />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--scrim);
  display: grid;
  place-items: center;
  padding: var(--space-4);
}
.panel {
  /* F-10：560 → 760 —— 左侧多了 148px 的分组栏，内容区仍是旧的可用宽度 */
  width: min(760px, 100%);
  /* 与 TemplatePicker 同档（86vh / 760）：640 的旧上限会让「版本 / 检查更新」
     在大屏上也躲到滚动之下 —— 实测 1440×900 时内容高 925px、可视只有 640px。 */
  max-height: min(86vh, 760px);
  background: var(--bg-card-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-hover);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
}
.head h2 {
  margin: 0;
  font-size: 16px;
}
.x {
  margin-left: auto;
  border: none;
  background: transparent;
  display: grid;
  place-items: center;
}
.body {
  display: grid;
  grid-template-columns: 148px 1fr;
  gap: var(--space-4);
  min-height: 0;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-self: start;
}
.nav-item {
  position: relative;
  text-align: left;
  padding: 7px var(--space-2) 7px var(--space-3);
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.nav-item:hover {
  background: var(--bg-card-soft);
  color: var(--text-1);
}
.nav-item[data-active='true'] {
  background: var(--bg-card-soft);
  color: var(--text-1);
  font-weight: 600;
}
/* 当前组左侧那根 2px 竖条：靠 background 的色差分辨不够，位置要给一个形状 */
.nav-item[data-active='true']::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 2px;
  background: var(--accent);
}
.group {
  overflow: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-right: var(--space-1);
}
.group-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}
section h3 {
  margin: 0 0 var(--space-3);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
}
.skins {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-2);
}
.skin {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px var(--space-2);
  text-align: left;
  padding: var(--space-3);
}
.skin .name {
  font-weight: 600;
}
.skin .desc {
  grid-column: 2;
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.4;
}
.skin .dot {
  grid-row: span 2;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
}
.dot[data-s='ink'] {
  background: linear-gradient(135deg, #fff 50%, #c93c16 50%);
}
.dot[data-s='aurora'] {
  background: linear-gradient(135deg, #eceff6, #ffb8d0);
}
.dot[data-s='candy'] {
  background: linear-gradient(135deg, #ffd9a0, #ff5c8a);
}
.tick {
  position: absolute;
  top: 6px;
  right: 6px;
  color: var(--brand-500);
}
/* 选中态是品牌色实底，说明文字与勾必须跟着翻白，否则蓝底蓝字看不见 */
.skin[data-active='true'] .name,
.skin[data-active='true'] .desc,
.skin[data-active='true'] .tick {
  color: #fff;
}
.skin[data-active='true'] .desc {
  opacity: 0.82;
}
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--bg-card-soft);
  border: 1px solid var(--border-soft);
}
.accents {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.swatch {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--border-strong);
}
.swatch svg {
  /* 底色就是用户选的强调色，浅色板上白勾没有描边会看不见 */
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.55));
}
.swatch[data-auto='true'] {
  background: conic-gradient(#f43f5e, #f59e0b, #22c55e, #3b82f6, #8b5cf6, #f43f5e);
}
.swatch[data-active='true'] {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
.hint {
  margin: var(--space-3) 0 0;
  font-size: 12px;
  color: var(--text-3);
}
.hint code {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 11px;
  word-break: break-all;
  color: var(--text-2);
}
.switch {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
}
.times {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-2);
  font-size: 12px;
}
.times label {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-2);
}
.times input {
  height: 26px;
  padding: 0 var(--space-1);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-1);
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.keys {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 12px;
}
.keys li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.keys kbd {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  background: var(--bg-card-soft);
  white-space: nowrap;
}
.keys .warn {
  margin-left: auto;
  font-style: normal;
  color: var(--c-amber);
}
.keys .rec {
  flex: none;
  font-size: 11px;
  padding: 1px 8px;
}
.keys .rec.live {
  border-color: var(--accent);
  color: var(--accent);
}
.recording {
  color: var(--accent);
}
.error {
  margin: var(--space-2) 0 0;
  font-size: 12px;
  color: var(--c-red);
}
.row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.row input {
  flex: 1;
  min-width: 0;
}
.row.wrap {
  flex-wrap: wrap;
}
.notices {
  margin: var(--space-3) 0 0;
  padding-left: 1.2em;
  font-size: 12px;
  color: var(--c-amber);
}
/* 手机宽度下三张皮肤卡平铺会挤成两条窄列、说明文字反复换行 —— 收成单列 */
@media (max-width: 480px) {
  .skins {
    grid-template-columns: 1fr;
  }
}
/* 窄屏：左栏转成顶部横向标签条（见文件头那条理由：不折叠成下拉） */
@media (max-width: 640px) {
  .body {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .nav {
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .nav-item[data-active='true']::before {
    left: 8px;
    right: 8px;
    top: auto;
    bottom: 0;
    width: auto;
    height: 2px;
  }
}
</style>
