<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as E from '@levango7/engine'
import { Lock, LockOpen, Shuffle, X, LayoutGrid, Trash2, GripVertical, Plus, Rows3 } from 'lucide-vue-next'
import type { LayoutStore } from '../store'
import { useCanvasDrag } from '../useCanvasDrag'
import RowBand from './RowBand.vue'
import CardCatalogMenu from './CardCatalogMenu.vue'
import { useCellFocus } from '../useCellFocus'
import { cellIntent, globalIntent, isEditableTarget, shouldPrevent } from '../keyboard'
import { preloadCard } from '../cardComponents'
import type { CommandBus } from '../commandBus'

const store = inject<LayoutStore>('store')!
const commandBus = inject<CommandBus>('commandBus')!
const reg = store.reg

const emit = defineEmits<{
  (e: 'selectionChange', ids: string[]): void
  (e: 'focusChange', id: string | null): void
}>()

/**
 * 「全部卡片」下拉（2026-10-12 从顶栏搬进来）：模块库只列**还没放置**的卡，
 * 但卡片到 49 张后，库里的卡挨个看也不如按分组翻一遍目录来得快 ——
 * 这正是原「添加卡片」菜单的用途，只是入口按用户口径（"添加卡片应该是布局编辑里面
 * 才有的选项"）收进编辑器。菜单有 max-height 且 aside 是滚动容器，会把它裁掉 ——
 * 所以定位用 fixed + 按钮的矩形现算（随 open 一次性写入）。菜单本体是
 * `CardCatalogMenu.vue`（与将来可能的其他调用方共用一套外观）。
 */
const addOpen = ref(false)
const addBtnEl = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const missingCount = computed(() => reg.filter((m) => !store.placedIds.value.has(m.id)).length)
async function toggleAddMenu(): Promise<void> {
  if (addOpen.value) {
    addOpen.value = false
    return
  }
  addOpen.value = true
  await nextTick()
  const r = addBtnEl.value?.getBoundingClientRect()
  if (r) {
    menuStyle.value = {
      position: 'fixed',
      left: `${Math.round(r.left)}px`,
      top: `${Math.round(r.bottom + 6)}px`,
      zIndex: 'var(--z-menu)',
    }
  }
}
/** 点菜单空白处/外部就关：菜单可能被裁出 aside，用文档级监听 */
function onDocPointerDown(e: PointerEvent): void {
  if (!addOpen.value) return
  const t = e.target as Node
  if (addBtnEl.value?.contains(t)) return
  const menuEl = document.getElementById('editor-add-menu')
  if (menuEl?.contains(t)) return
  addOpen.value = false
}
/** 从目录里加一张：落位交给引擎的 findFreeSpot（与库里拖入同一条路径） */
function addFromCatalog(id: string): void {
  addOpen.value = false
  store.add(id, 0, 0)
}

/**
 * 行轨高度来自 `useProjection().rowPx` —— **与浏览态是同一个数**。
 *
 * 这里写过 `minmax(0, 1fr)`（画布把可用高摊给轨），后果是编辑态的行轨变成
 * "画布高 ÷ 行数"的函数：1408×1440 下实测 **93.94px**，而浏览态是 `rowPx = 127px`，
 * 同一份版面在两态之间缩放约 1.35 倍；又因为轨数下限是 12 而内容只用 6 行，
 * 画布 1329px 里有 **686px 是空的**。两态不一致的根因就是这个 —— 单位不是同一个。
 */
const props = defineProps<{ rowPx: number }>()

const gridEl = ref<HTMLElement | null>(null)
const sel = ref<Set<string>>(new Set())
const selCount = computed(() => sel.value.size)

const items = computed(() => store.doc.value.items)

/** 指针状态机在 `useCanvasDrag.ts`（见那里的注释：四条互相 interference 的语义为什么值得单列一个文件） */
const { drag, ghost, rowCount, toggleSelect, startMove, startNew, startResize, onCanvasPointerDown, variantOf } = useCanvasDrag({
  store,
  gridEl,
  sel,
  rowPx: computed(() => props.rowPx),
})

/**
 * 卡面点按 = 只选中，**不起拖**（2026-10-10 抓手区重做）。
 *
 * 旧版拖拽可以从卡面任何位置发起，于是触摸端需要"长按 250ms 才进拖拽"防误触 ——
 * 代价是按住等一会儿才动的反直觉手感。现在拖拽入口收窄到**标题带**（模板侧
 * `@pointerdown="startMove"`），卡面彻底退出拖拽状态机：点按就是点按，
 * 划动交还给滚动（卡面 `touch-action: pan-y`），原生交互（勾选/输入）也不再被
 * `begin()` 的 `preventDefault` 打扰。
 */
function onBodyDown(p: E.Placement, e: PointerEvent) {
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    toggleSelect(p.id)
    return
  }
  if (!sel.value.has(p.id)) sel.value = new Set([p.id])
}

/* ---- 行容器（单层分组）：行头渲染 + 整组拖动 + 成组动作 ---- */

const bands = computed(() => E.rowsBands(store.doc.value))

/** 选中的卡里**还能成组的**（不在任何行里）——批量条按钮据此启停与取材 */
const groupableIds = computed(() => [...sel.value].filter((id) => items.value.some((p) => p.id === id && !p.row)))

function groupSelected(): void {
  if (!groupableIds.value.length) return
  store.groupIntoRow(groupableIds.value)
  clearSel()
}

/**
 * 行头拖动 = 整组移动：先把成员全部选入，再交给**既有拖拽状态机**的 group 模式 ——
 * 实时预览、ghost 标签、让位规则（含"含锁定项整组不动"）全部复用，不新造一套。
 */
function startRowDrag(band: E.RowView, e: PointerEvent): void {
  const members = band.members.map((id) => items.value.find((p) => p.id === id)).filter((p): p is E.Placement => !!p)
  if (!members.length) return
  sel.value = new Set(band.members)
  startMove(members[0], e)
}

const titleOf = (p: E.Placement) => p.title ?? E.findModule(reg, p.id)?.title ?? p.id
const variantName = (p: E.Placement) => variantOf(p)?.name ?? ''
const hasVariants = (id: string) => (E.findModule(reg, id)?.variants.length ?? 0) > 1
const isSelected = (id: string) => sel.value.has(id)

function badge(p: E.Placement) {
  const v = variantOf(p)
  return v ? E.fitState({ w: p.w, h: p.h }, v) : { level: 'ideal' as const, label: '' }
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  document.removeEventListener('pointerdown', onDocPointerDown)
})
onMounted(() => {
  /** 挂 window 而不是容器：拖拽时 pointerdown 被 preventDefault，焦点可能仍留在 body 上，
   *  容器级监听会收不到键盘事件（实测 Ctrl+Z 失效） */
  window.addEventListener('keydown', onGlobalKey)
  document.addEventListener('pointerdown', onDocPointerDown)
})

function cellStyle(p: E.Placement) {
  return { gridColumn: `${p.x + 1} / span ${p.w}`, gridRow: `${p.y + 1} / span ${p.h}` }
}

/* ---- 焦点跟随：删除/移动后焦点不能丢进 body，聚焦的格子要滚进视口 ---- */
const { setCellRef, focusNearest } = useCellFocus()

function clearSel() {
  sel.value = new Set()
}

/**
 * 键盘编排。**判定全在 `keyboard.ts`（纯函数，可单测）**，这里只负责执行意图。
 * 拆开的理由：这段语义（Shift 改尺寸、Alt 只动当前格、mergeKey 折叠历史）是本项目
 * 对 x-hub 声称的差异点之一 —— 它原先埋在 727 行组件里，一条断言都没有。
 */
function runIntent(intent: ReturnType<typeof cellIntent> | ReturnType<typeof globalIntent>) {
  if (!intent) return
  switch (intent.kind) {
    case 'clearSelection':
      clearSel()
      break
    case 'selectAll':
      sel.value = new Set(items.value.map((p) => p.id))
      break
    case 'deleteSelection': {
      const anchor = items.value.find((q) => q.id === [...sel.value][0])
      const rest = items.value.filter((q) => !sel.value.has(q.id))
      store.removeMany([...sel.value])
      clearSel()
      if (anchor) focusNearest(rest, anchor)
      break
    }
    case 'moveMany':
      store.moveMany(intent.ids, intent.dx, intent.dy, intent.mergeKey)
      break
    case 'resize':
      store.resize(intent.id, intent.w, intent.h, intent.mergeKey)
      break
    case 'move':
      store.move(intent.id, intent.x, intent.y, intent.mergeKey)
      break
    case 'toggleSelect':
      toggleSelect(intent.id)
      break
    /** 以下三条走**命令总线**（2026-10-13 批 2）：键盘与命令面板从同一条命令表出发，
     *  可用性校验与实现都是同一份 —— 面板里做得到的事，键盘必然按得到，反过来也一样。 */
    case 'cycleVariant':
      commandBus.dispatch('card.cycleVariant', { cardId: intent.id })
      break
    case 'toggleLock':
      commandBus.dispatch('card.toggleLock', { cardId: intent.id })
      break
    case 'remove': {
      const p = items.value.find((q) => q.id === intent.id)
      if (!p) break
      const rest = items.value.filter((q) => q.id !== p.id)
      commandBus.dispatch('card.remove', { cardId: p.id })
      focusNearest(rest, p)
      break
    }
  }
}

function onGlobalKey(e: KeyboardEvent) {
  /** 输入框里把 Ctrl+Z / Ctrl+A / Backspace 交还给原生文本编辑，别抢 */
  if (isEditableTarget(e.target)) return
  const intent = globalIntent(e, { items: items.value, selCount: selCount.value })
  if (!intent) return
  if (shouldPrevent(intent)) e.preventDefault()
  runIntent(intent)
}

/** 焦点在某个格子上时的键盘编排 */
function onCellKeydown(p: E.Placement, e: KeyboardEvent) {
  if (isEditableTarget(e.target)) return
  const intent = cellIntent(e, p, [...sel.value])
  if (!intent) return
  if (shouldPrevent(intent)) e.preventDefault()
  runIntent(intent)
}

function removeSelected() {
  store.removeMany([...sel.value])
  clearSel()
}

/** 焦点卡变化广播（Delete / Enter / L 这类单格命令的目标；见 commands.ts 的 targetCard 注释） */
function onCellFocus(id: string): void {
  emit('focusChange', id)
}

/** 选中集变化向上广播（App 的 command context 用它决定"当前目标卡"） */
watch(
  sel,
  (v) => emit('selectionChange', [...v]),
  { deep: true },
)

/** 命令面板「跳到某张卡」用：选中它并把它闪一下（在画布里找得到，而不是"滚过去了但不知道在哪"） */
const flashId = ref<string | null>(null)
let flashTimer = 0
function revealCard(id: string): void {
  sel.value = new Set([id])
  flashId.value = id
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => (flashId.value = null), 1600)
}
onBeforeUnmount(() => window.clearTimeout(flashTimer))

/**
 * 给 App 的 Esc 编排用：编辑器里"有东西可退"（选中/批量条/添加下拉）时由这里吞掉，
 * 返回 true 表示已消费 —— 否则 App 会把它当成"取消这次编辑"（有改动还会弹确认）。
 */
function escapePressed(): boolean {
  if (addOpen.value) {
    addOpen.value = false
    return true
  }
  if (sel.value.size) {
    clearSel()
    return true
  }
  return false
}
defineExpose({ escapePressed, revealCard })
</script>

<template>
  <div class="editor">
    <aside class="lib">
      <h3>
        <LayoutGrid :size="14" /> 模块库
        <CardCatalogMenu v-if="addOpen" :menu-id="'editor-add-menu'" :style="menuStyle" @pick="addFromCatalog" />
        <button
          ref="addBtnEl"
          class="add-cat"
          :disabled="!missingCount"
          :title="missingCount ? '还没放置的卡片都在这里（与库里拖入同一条落位路径）' : '所有卡片都已在版面上'"
          aria-haspopup="menu"
          :aria-expanded="addOpen"
          @click="toggleAddMenu"
        >
          <Plus :size="12" /> 全部卡片
        </button>
      </h3>
      <p v-if="!store.available.value.length" class="muted small">全部模块都已放置</p>
      <div v-for="m in store.available.value" :key="m.id" class="lib-item" @pointerenter="preloadCard(m.id)">
        <div class="lib-title" @pointerdown="startNew(m.id, m.defaultVariant, $event)">{{ m.title }}</div>
        <div class="lib-variants">
          <button
            v-for="v in m.variants"
            :key="v.id"
            class="chip"
            :data-active="v.id === m.defaultVariant"
            @pointerdown="startNew(m.id, v.id, $event)"
          >
            {{ v.name }} {{ v.idealW }}×{{ v.idealH }}
          </button>
        </div>
      </div>
    </aside>

    <section class="stage">
      <div
        ref="gridEl"
        class="canvas"
        :style="{ gridTemplateRows: `repeat(${rowCount}, ${rowPx}px)` }"
        @pointerdown="onCanvasPointerDown"
      >
        <!-- 行容器：围合框先画（cells 在 DOM 之后、天然盖在上面），行头占它自己那一行 -->
        <template v-for="band in bands" :key="band.row.id">
          <div
            class="rowframe"
            :data-collapsed="!!band.row.collapsed"
            :style="{ gridColumn: '1 / span 12', gridRow: `${band.row.y + 1} / span ${band.h}` }"
          />
          <div class="rowslot" :style="{ gridColumn: '1 / span 12', gridRow: `${band.row.y + 1}` }">
            <RowBand
              :title="band.row.title"
              :count="band.members.length"
              :collapsed="!!band.row.collapsed"
              :auto="band.row.auto ?? E.DEFAULT_AUTO"
              @drag="startRowDrag(band, $event)"
              @reflow="(p2: number, rh: number) => store.reflowRow(band.row.id, { per: p2, rowH: rh })"
              @toggle="store.toggleRow(band.row.id)"
              @ungroup="store.ungroupRow(band.row.id)"
              @rename="(t: string) => store.renameRow(band.row.id, t)"
            />
          </div>
        </template>
        <div
          v-for="p in items"
          :key="p.id"
          class="cell"
          :data-module="p.id"
          :ref="(el: unknown) => setCellRef(p.id, el)"
          :class="{ locked: p.locked, selected: isSelected(p.id), flash: flashId === p.id }"
          :style="cellStyle(p)"
          tabindex="0"
          role="group"
          @focus="onCellFocus(p.id)"
          :aria-label="`${titleOf(p)}，${p.w} 乘 ${p.h} 格。拖动标题带移动，方向键移动，Shift 加方向键缩放，空格切换选入，回车切换形态，Delete 移回模块库`"
          @keydown="onCellKeydown(p, $event)"
        >
          <!-- 标题带 = 拖拽抓手（Grafana 式：拖标题栏移动面板）。intent 靠区域区分：
               拖这里 = 移动；点卡面 = 选中；卡面划动 = 交还滚动 -->
          <div
            class="tag"
            :class="{ locked: p.locked }"
            :title="p.locked ? '已锁定' : '拖动移动卡片'"
            @pointerdown="startMove(p, $event)"
          >
            <GripVertical :size="11" class="grip-ico" />
            <span class="tag-name">{{ titleOf(p) }}</span>
            <span v-if="hasVariants(p.id)" class="tag-var">{{ variantName(p) }}</span>
          </div>
          <div class="body" @pointerdown="onBodyDown(p, $event)"><slot :item="p" /></div>
          <div class="ctrl">
            <button v-if="hasVariants(p.id)" class="cbtn" title="切换形态 (Enter)" @pointerdown.stop="store.cycleVariant(p.id)">
              <Shuffle :size="13" />
            </button>
            <button
              class="cbtn"
              :data-active="p.locked"
              :title="p.locked ? '已锁定，按 L 解锁' : '锁定 (L)'"
              @pointerdown.stop="store.toggleLock(p.id)"
            >
              <Lock v-if="p.locked" :size="13" /><LockOpen v-else :size="13" />
            </button>
            <button class="cbtn" title="移回模块库 (Delete)" @pointerdown.stop="store.remove(p.id)">
              <X :size="13" />
            </button>
          </div>
          <span class="badge" :data-level="badge(p).level">{{ badge(p).label }}</span>
          <span class="size">{{ p.w }}×{{ p.h }}</span>
          <span v-if="!p.locked" class="grip" title="拖拽调整尺寸" @pointerdown="startResize(p, $event)" />
        </div>

        <div
          v-if="drag?.preview"
          class="preview"
          :class="{ bad: drag.bad }"
          :style="{
            gridColumn: `${drag.preview.x + 1} / span ${drag.preview.w}`,
            gridRow: `${drag.preview.y + 1} / span ${drag.preview.h}`,
          }"
        />
        <div
          v-for="(g, i) in drag?.groupPreview ?? []"
          :key="`g${i}`"
          class="preview group"
          :style="{ gridColumn: `${g.x + 1} / span ${g.w}`, gridRow: `${g.y + 1} / span ${g.h}` }"
        />
        <div
          v-if="drag?.marquee"
          class="marquee"
          :style="{
            gridColumn: `${drag.marquee.x + 1} / span ${drag.marquee.w}`,
            gridRow: `${drag.marquee.y + 1} / span ${drag.marquee.h}`,
          }"
        />
        <p v-if="!items.length" class="empty muted">从左侧点住一个模块拖进来</p>
      </div>

      <div class="foot">
        <p class="hint">
          拖动标题带移动 · 方向键移动 · Shift+方向键缩放 · 空格选入 · Enter 切形态 · Delete 移回库 · L 锁定 · Shift+点选/空白框选 · Ctrl+A 全选 · Esc 取消
        </p>
        <div v-if="selCount > 1" class="batch">
          <span>已选 {{ selCount }} 个</span>
          <button :disabled="!groupableIds.length" title="把选中且未归行的卡合成一行（行头插在它们上方）" @click="groupSelected()"><Rows3 :size="13" /> 成组为行</button>
          <button @click="store.toggleLockMany([...sel])">锁定/解锁</button>
          <button @click="removeSelected()"><Trash2 :size="13" /> 批量移回库</button>
          <button @click="clearSel()">取消选择</button>
        </div>
      </div>
    </section>

    <!-- 幽灵块的位置**只走 transform**。这段原来写的是 `left/top`，而 `left/top` 是
         布局属性 —— 指针每动一次就改一次，等于每帧 InvalidateLayout → PrePaint →
         Layerize → Paint 整条管线走一遍。transform 只影响合成，不碰布局。

         实测（1440×900，26 张卡，60 次 pointermove，Chrome trace 计数）：

           阶段         left/top      transform
           Layout        62 次          6 次     ← 只在跨格时才算，与指针无关
           Paint        178 次         65 次     ← 65 ≈ 1 次/帧，已是"每帧脏一次"的地板
           管线总耗时   170.7ms       121.6ms

         数字是确定性的（连跑三轮计数完全一致），所以这条能当回归基线用。
         注意 `left/top: 0` 不能省：不写的话 fixed 元素退回"静态位置"，transform
         就从那个位置起算，幽灵块会跑偏。 -->
    <div v-if="drag?.started && drag.label" class="ghost" :style="{ transform: `translate(${ghost.x + 10}px, ${ghost.y + 12}px)` }">
      {{ drag.label }}
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: var(--space-4);
  height: 100%;
  min-height: 0;
}
.lib {
  overflow: auto;
  padding-right: var(--space-2);
}
.lib h3 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
  margin: 0 0 var(--space-3);
}
/* 「全部卡片」目录入口：贴 h3 右侧的小按钮。字号跟 h3 同档（11px 下限守 E2E） */
.add-cat {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 var(--space-2);
  font-size: 11px;
  letter-spacing: 0.02em;
  text-transform: none;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--bg-card);
  color: var(--text-2);
  cursor: pointer;
}
.add-cat:hover:not(:disabled) {
  color: var(--text-1);
  border-color: var(--brand-500);
}
.add-cat:disabled {
  opacity: 0.5;
  cursor: default;
}
.lib-item {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  padding: var(--space-3);
  margin-bottom: var(--space-3);
  /* pan-y：竖直滑动交给浏览器滚列表；抓手（.lib-title / .chip）各自 touch-action: none，
     划在那上面 = 拖卡片进画布，不交还滚动 —— 与画布侧的标题带同一套区域语义 */
  touch-action: pan-y;
  transition: box-shadow var(--dur-micro) var(--ease-out), transform var(--dur-micro) var(--ease-out);
}
.lib-item:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}
.lib-title {
  font-weight: 600;
  margin-bottom: var(--space-2);
  cursor: grab;
  touch-action: none;
}
.lib-variants {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.chip {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  cursor: grab;
  touch-action: none;
}
.small {
  font-size: 12px;
}
.stage {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  /* 行轨是固定 px（与浏览态同一个 rowPx），版面比画布高时不再靠"压扁行"塞进来 ——
     由这一层承接滚动。浏览态是同一条规矩（`App.vue` 的 `.stage` 也是 `overflow-y: auto`）。 */
  overflow-y: auto;
}
.canvas {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 16px;
  /* `1 0 auto` 而不是 `1`：基准取内容高（版面高），有富余就长到填满、没富余也不缩。
     原来写 `flex: 1`（= `1 1 0%`），基准为 0、可缩 —— 那是配合 `1fr` 行轨写的
     （轨会自己摊平）。轨固定之后必须禁掉收缩，否则版面高的文档会被压出画布盒子。 */
  flex: 1 0 auto;
  min-height: 320px;
  /* 轨是定值，盒子更高时余下的空间留在下方（不摊进轨里），既是留白也是落点 */
  align-content: start;
  padding: var(--space-3);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-xl);
  background-image: radial-gradient(var(--border-strong) 1px, transparent 1px);
  background-size: 14px 14px;
  position: relative;
  touch-action: pan-y;
}
.cell {
  position: relative;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius-lg);
  background: var(--frost-surface);
  border: 1px solid var(--border-soft);
  box-shadow: var(--frost-edge), var(--shadow-card);
  display: flex;
  container-type: size;
  /* 卡面不再起拖（抓手在标题带），所以没有 grab；锁定也体现在标题带 cursor 上 */
  touch-action: pan-y;
  transition: box-shadow var(--dur-micro) var(--ease-out);
}
.cell:hover {
  box-shadow: var(--frost-edge), var(--shadow-hover);
}
.cell.flash {
  box-shadow: 0 0 0 2px var(--brand-glow);
}
.cell.selected {
  outline: 2px solid var(--brand-500);
  outline-offset: -2px;
}
.cell.locked {
  cursor: default;
  outline: 2px dashed var(--brand-glow);
  outline-offset: -2px;
}
.cell:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus), var(--shadow-card);
}
/* 标签占独立的一条头部带，不压在卡片自身表头上（x-hub 编辑器那处叠字的根因）。
   **2026-10-10 起它就是拖拽抓手**（Grafana 式"拖标题栏"）：pointer-events 打开、
   touch-action: none（触屏在这条带上的划动是拖拽，不交还滚动）、cursor: grab。
   高度 24px 是触摸目标下限（原 20px 太窄）。 */
.tag {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 24px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 11px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--bg-card-soft);
  color: var(--text-2);
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.tag.locked {
  cursor: default;
}
.grip-ico {
  flex: none;
  color: var(--text-4);
}
.tag:hover .grip-ico {
  color: var(--text-2);
}
.tag-name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tag-var {
  margin-left: auto;
  color: var(--text-3);
  white-space: nowrap;
}
.body {
  flex: 1;
  min-width: 0;
  padding-top: 24px;
}
.body :deep(.card) {
  height: 100%;
  background: transparent;
  border: none;
  box-shadow: none;
}
/* 悬停操作条（2026-10-10 质感化）：胶囊底 + 描边 + 投影，浮在卡片内容之上 ——
   以前三枚裸钮直接压在内容上，看久了像"叠字"。top 让位于 24px 标题带。 */
.ctrl {
  position: absolute;
  top: 28px;
  right: 6px;
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-pill);
  background: var(--bg-card-solid);
  border: 1px solid var(--border-soft);
  box-shadow: var(--shadow-hover);
  opacity: 0;
  transition: opacity var(--dur-micro) var(--ease-out);
  z-index: 2;
}
.cell:hover .ctrl,
.cell:focus .ctrl,
.cell.selected .ctrl {
  opacity: 1;
}
.cbtn {
  display: grid;
  place-items: center;
  padding: 2px 5px;
  border-radius: var(--radius-sm);
  position: relative;
}
/* 视觉尺寸只有 13×18px，低于 24px 最小可点区，手指几乎点不中。
   不改 padding（会把标签条撑变形），用伪元素把热区撑到 28×28 —— 命中区变大，视觉没变。 */
.cbtn::after {
  content: '';
  position: absolute;
  inset: -5px -8px;
  min-width: 28px;
  min-height: 28px;
}
.badge {
  position: absolute;
  bottom: 3px;
  left: 4px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--bg-card-soft);
  color: var(--text-3);
  pointer-events: none;
}
.badge[data-level='below'] {
  color: var(--c-red);
}
.badge[data-level='ideal'] {
  color: var(--c-green);
}
.size {
  position: absolute;
  bottom: 3px;
  right: 16px;
  font-size: 10px;
  color: var(--text-3);
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}
.grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, var(--brand-glow) 50%);
  border-radius: 0 0 var(--radius-lg) 0;
}
.rowframe {
  pointer-events: none;
  border: 1px dashed color-mix(in srgb, var(--brand-500) 38%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--brand-500) 4%, transparent);
}
.rowframe[data-collapsed='true'] {
  background: transparent;
}
.rowslot {
  min-width: 0;
  padding: 3px 0;
}
.preview {
  pointer-events: none;
  border: 2px dashed var(--brand-500);
  border-radius: var(--radius-lg);
  background: var(--brand-50);
  opacity: 0.55;
}
.preview.group {
  border-style: solid;
  border-color: var(--brand-glow);
}
.preview.bad {
  border-color: var(--c-red);
  background: color-mix(in oklab, var(--c-red) 18%, transparent);
}
.marquee {
  pointer-events: none;
  border: 1px solid var(--brand-500);
  background: var(--brand-glow);
  border-radius: var(--radius-sm);
}
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
}
.foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  /* 版面比画布高时由 .stage 承接滚动（见 .stage 的注释），而这一行是**操作提示**：
     钉在滚动视口底部，别让它跟着内容滚出视野（2026-10-10 走查轮）。
     背景用与整页同一套 --app-bg、且以视口定位（fixed）—— 盖住滚上来的内容时不现接缝。 */
  position: sticky;
  bottom: 0;
  z-index: 1;
  padding-block: var(--space-1);
  background: var(--app-bg);
  background-attachment: fixed;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}
.batch {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--brand-50);
}
.batch button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.ghost {
  position: fixed;
  /* 定位只走 transform（见模板处注释与实测数字）。left/top 必须显式归零 ——
     不写会退回静态位置。 */
  left: 0;
  top: 0;
  z-index: var(--z-overlay);
  /* 保证走合成路径。headless（软件合成）下量到与不加这条持平，所以它不是为了
     眼前这几个数字 —— 真实 GPU 合成里这条才是"只合成、不重绘"的保证。 */
  will-change: transform;
  pointer-events: none;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  padding: 2px 10px;
  font-size: 12px;
  box-shadow: var(--shadow-hover);
}
/* 双列（库 + 画布）的前提是画布放得下 12 个逻辑列。
   220px 的库在 ~992 以下会把画布挤到每列只剩 ~40px —— 编辑时拖不准也点不中
   （实测 740 宽时画布只有 468px）。所以对齐应用的语义断点（992 = 引擎 960 容器
   对应的视口，顶栏同步降档也用它）：以下改上下堆叠、画布拿满整宽，库收成一条限高滚动带。 */
@media (max-width: 992px) {
  .editor {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .lib {
    max-height: 196px;
  }
}
</style>
