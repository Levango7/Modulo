<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import { Check, GripVertical, X } from 'lucide-vue-next'
import { ACCENTS, MODES, SKINS } from '../appearance'
import { useFocusTrap } from '../useFocusTrap'
import { dataDir as fetchDataDir } from '../fileStorage'
import { isDesktop, type ShellApi } from '../useShell'
import type { AppearanceApi } from '../useAppearance'
import type { SchemesApi } from '../useSchemes'
import type { Scheme } from '../../engine'

defineEmits<{ (e: 'close'): void }>()
const appearance = inject<AppearanceApi>('appearance')!
const a = appearance.state
const schemes = inject<SchemesApi>('schemes')!
const shell = inject<ShellApi>('shell')!
const panelEl = ref<HTMLElement | null>(null)
useFocusTrap(panelEl)

const dataDir = ref<string | null>(null)
onMounted(async () => {
  if (isDesktop) dataDir.value = await fetchDataDir()
})

const draftName = ref('')
const editing = ref<string | null>(null)
const editingName = ref('')

function save() {
  schemes.saveAs(draftName.value)
  draftName.value = ''
}
function newBlank() {
  schemes.createBlank(draftName.value)
  draftName.value = ''
}
const dragId = ref<string | null>(null)
function onDragStart(id: string) {
  dragId.value = id
}
function onDrop(index: number) {
  if (dragId.value) schemes.move(dragId.value, index)
  dragId.value = null
}
function startRename(s: Scheme) {
  editing.value = s.id
  editingName.value = s.name
}
function commitRename() {
  if (editing.value) schemes.rename(editing.value, editingName.value)
  editing.value = null
}
function when(ts: number): string {
  if (!ts) return '未知时间'
  return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function onHideChange(e: Event) {
  shell.setHideOnClose((e.target as HTMLInputElement).checked)
}
</script>

<template>
  <div class="scrim" @click.self="$emit('close')">
    <div ref="panelEl" class="panel" role="dialog" aria-modal="true" aria-label="设置" tabindex="-1">
      <header class="head">
        <h2>外观</h2>
        <button class="x" title="关闭 (Esc)" @click="$emit('close')"><X :size="16" /></button>
      </header>

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

      <section v-if="isDesktop">
        <h3>桌面</h3>
        <label class="switch">
          <input type="checkbox" :checked="shell.hideOnClose.value" @change="onHideChange" />
          <span>点关闭时收进托盘，而不是直接退出</span>
        </label>
        <ul v-if="shell.shortcuts.value.length" class="keys">
          <li v-for="k in shell.shortcuts.value" :key="k.keys">
            <kbd>{{ k.keys }}</kbd>
            <span>{{ k.label }}</span>
            <em v-if="!k.registered" class="warn">注册失败，多半被别的程序占用了</em>
          </li>
        </ul>
        <p class="hint">快捷键是系统级的，窗口不在前台也能用。注册失败只影响那一条，其余功能照常。</p>
        <p v-if="dataDir" class="hint">
          版面、方案册、卡片内容和这些设置都各自是一个 JSON 文件，放在
          <code>{{ dataDir }}</code>
          ，整个目录拷走就是备份。
        </p>
      </section>

      <section>
        <h3>版面方案</h3>
        <div class="row wrap">
          <input v-model="draftName" placeholder="方案名称" maxlength="32" @keydown.enter="save" />
          <button @click="save">另存为</button>
          <button :disabled="!schemes.active.value" @click="schemes.overwrite()">覆盖当前</button>
          <button @click="newBlank">新建空白</button>
        </div>
        <ul class="schemes">
          <li
            v-for="(s, i) in schemes.book.value.schemes"
            :key="s.id"
            :data-active="s.id === schemes.book.value.activeId"
            draggable="true"
            tabindex="0"
            @dragstart="onDragStart(s.id)"
            @dragover.prevent
            @drop="onDrop(i)"
            @keydown.alt.up="schemes.move(s.id, i - 1)"
            @keydown.alt.down="schemes.move(s.id, i + 1)"
          >
            <GripVertical :size="13" class="grip" title="拖动排序，或 Alt+↑/↓" />
            <template v-if="editing === s.id">
              <input v-model="editingName" maxlength="32" @keydown.enter="commitRename" @keydown.esc="editing = null" />
              <button @click="commitRename">存</button>
            </template>
            <strong v-else>{{ s.name }}</strong>
            <span class="muted meta">{{ when(s.updatedAt) }} · {{ s.doc.items.length }} 个模块</span>
            <span class="ops">
              <button v-if="s.id !== schemes.book.value.activeId" @click="schemes.activate(s.id)">应用</button>
              <button @click="startRename(s)">改名</button>
              <button @click="schemes.remove(s.id)">删除</button>
            </span>
          </li>
        </ul>
        <p v-if="!schemes.book.value.schemes.length" class="muted hint">还没有保存过方案：把版面排好后，在上面起个名字点「另存为」。</p>
        <p v-else class="muted hint">拖动左边的把手可以排序，键盘用 Alt+↑/↓。「新建空白」会存一条零模块的方案并切过去；当前版面没丢，Ctrl+Z 能退回来。</p>
      </section>

      <section>
        <h3>导入导出</h3>
        <div class="row wrap">
          <button @click="schemes.exportCurrent()">导出当前布局</button>
          <button @click="schemes.importCurrent()">导入布局</button>
          <button @click="schemes.exportAll()">导出全部方案</button>
          <button @click="schemes.importBook()">导入方案（合并）</button>
        </div>
        <ul v-if="schemes.notices.value.length" class="notices">
          <li v-for="(n, i) in schemes.notices.value" :key="i">{{ n }}</li>
        </ul>
        <p class="hint">导入会先做校验：未知模块被剔除、尺寸钳到形态最小值、重叠自动让位，坏数据回退空布局并在这里说明。</p>
      </section>
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
  width: min(560px, 100%);
  max-height: min(80vh, 640px);
  overflow: auto;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-hover);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
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
.schemes {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.schemes li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-card-soft);
}
.schemes .grip {
  flex: none;
  color: var(--text-4);
  cursor: grab;
}
.schemes li:hover .grip {
  color: var(--text-2);
}
.schemes li:focus-visible {
  outline: 2px solid var(--brand-500);
  outline-offset: 1px;
}
.schemes li[data-active='true'] {
  border-color: var(--brand-500);
}
.schemes strong {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
}
.meta {
  font-size: 11px;
  margin-right: auto;
  white-space: nowrap;
}
.ops {
  display: flex;
  gap: var(--space-1);
}
.ops button {
  font-size: 12px;
  padding: 2px 8px;
}
.notices {
  margin: var(--space-3) 0 0;
  padding-left: 1.2em;
  font-size: 12px;
  color: var(--c-amber);
}
</style>
