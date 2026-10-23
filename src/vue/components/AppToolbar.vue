<script setup lang="ts">
/**
 * 顶栏（App.vue 拆分 ③ 抽出，⑤ 收尾）。
 *
 * **纯展示 + 转发**：这一块 100 行模板里没有任何自己的状态，读的都是 App 的 ref、
 * 写的都通过 emit 回 App。抽它的理由是 App.vue 的第三个关注点（顶栏装配）——
 * 连同它的 scoped 样式一起搬，App 才能从 913 行继续往下瘦。
 *
 * DOM **逐字不变**是本步的硬约束：E2E 全压在这上面（`排布`下拉按文本点 menuitem、
 * 编辑事务「保存」按包含匹配、`add-wrap` / `tx-scrim` 等 class 与 role）。
 * 所以模板里的 class、role、aria-*、title 文案一个字母都没动，
 * 只把 `view = 'workbench'` 这类直接赋值换成 emit。
 *
 * 排布下拉的外部点击关闭（原来在 App.vue 的 onDocMousedown 里拿 arrangeWrap ref 做
 * contains 判断）改为在 App 侧用 `closest('.add-wrap')` —— ref 搬不过来，而
 * closest 从 target 自身开始匹配，与 contains 语义一致，渲染输出不变。
 *
 * **⑤（2026-10-23）已清掉「整理」那枚 menuitem 上的死表达式**
 * `:disabled="!store.canUndo.value && false"`：它恒为 false，「整理」从来就是恒可用的。
 * 只删绑定（连同只为它而存在的 `storeCanUndo` prop），**没有改成 `!canUndo`** ——
 * 那会把「整理」从恒可用变成"没历史就点不动"，是行为变更而不是清理。
 * 渲染上没有任何变化：Vue 对 `:disabled="false"` 本来就不输出属性，
 * 删掉绑定与保留恒假的绑定，产出的是同一份 HTML。
 */
import { LayoutGrid, LayoutTemplate, Redo2, Settings, SlidersHorizontal, Undo2, Wand2, Check, ChevronDown, X } from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'
import type { ArrangeAction } from '../arrangeActions'

const props = defineProps<{
  view: 'workbench' | 'edit'
  stageW: number
  cols: number
  mode: 'canvas' | 'stack'
  editDirty: boolean
  editChangeCount: number
  canUndoAny: boolean
  canRedoAny: boolean
  arrangeOpen: boolean
  /** 版面上有没有行（「行重排」的可用态） */
  hasRows: boolean
  /** 「回工作台可用」提示文案（App 的常量，顶栏只是展示） */
  onlyWorkbench: string
}>()

const emit = defineEmits<{
  (e: 'select-view', v: 'workbench' | 'edit'): void
  (e: 'enter-edit'): void
  (e: 'cancel-edit'): void
  (e: 'save-edit'): void
  (e: 'undo'): void
  (e: 'redo'): void
  (e: 'arrange', action: ArrangeAction): void
  (e: 'update:arrangeOpen', v: boolean): void
  (e: 'open-templates'): void
  (e: 'open-settings'): void
}>()
</script>

<template>
    <header class="bar">
      <span class="brand"><BrandMark :size="20" /><span class="brand-name">Modulo</span></span>
      <nav class="seg">
        <button :data-active="view === 'workbench'" title="看版面、做点微调（增删改在「布局编辑」）" @click="view === 'edit' ? emit('cancel-edit') : emit('select-view', 'workbench')">
          <LayoutGrid :size="14" /> 工作台
        </button>
        <button :data-active="view === 'edit'" title="增删改卡片：改完「保存」生效，或「取消」全部还原" @click="emit('enter-edit')">
          <SlidersHorizontal :size="14" /> 布局编辑
        </button>
      </nav>
      <div class="tools">
        <span class="pill muted metric">{{ stageW }}px · {{ cols }} 列 · {{ mode === 'canvas' ? '画布' : '堆叠' }}</span>
        <span class="sep" aria-hidden="true"></span>
        <!-- 编辑事务（2026-10-12）：编辑态给「取消 / 保存」；改动数只在真正改过时才出现 -->
        <span v-if="view === 'edit'" class="grp edit-tx" role="group" aria-label="编辑事务">
          <button class="wide" title="全部还原到进编辑器之前（有改动会先问一句；Esc 同效）" @click="emit('cancel-edit')">
            <X :size="14" /> <span class="label">取消</span>
          </button>
          <button class="wide primary" :title="editDirty ? '确认这次编辑' : '没有改动'" @click="emit('save-edit')">
            <Check :size="14" /> <span class="label">保存</span>
            <span v-if="editDirty" class="tx-count">{{ editChangeCount }}</span>
          </button>
          <span class="sep" aria-hidden="true"></span>
        </span>
        <span class="grp" role="group" aria-label="历史">
          <button class="icon" :disabled="!canUndoAny" title="撤销上一步 (Ctrl+Z)" @click="emit('undo')">
            <Undo2 :size="14" />
          </button>
          <button class="icon" :disabled="!canRedoAny" title="重做 (Ctrl+Shift+Z)" @click="emit('redo')">
            <Redo2 :size="14" />
          </button>
        </span>
        <span class="sep" aria-hidden="true"></span>
        <!-- 「整理/紧凑/收紧/撑满」四个动作语义高度重叠，平铺时只能靠 title 区分 ——
             这是顶栏最乱的一处。收进下拉后每项都有一整行说明，反而比四个按钮更分得清。 -->
        <span class="add-wrap">
          <button
            class="wide"
            aria-haspopup="menu"
            :aria-expanded="arrangeOpen"
            title="重排版面"
            @click="emit('update:arrangeOpen', !arrangeOpen)"
          >
            <Wand2 :size="14" /> <span class="label">排布</span>
            <ChevronDown :size="12" class="caret" :class="{ up: arrangeOpen }" />
          </button>
          <div v-if="arrangeOpen" class="add-menu arrange-menu" role="menu" aria-label="重排版面">
            <button
              role="menuitem"
              title="聚拢空洞（可撤销）"
              @click="emit('arrange', 'tidy')"
            >
              <span class="t">整理</span>
              <span class="v">把散开的卡片聚拢，填掉空洞</span>
            </button>
            <button
              role="menuitem"
              :disabled="view !== 'workbench'"
              :title="view === 'workbench' ? '收紧 + 整理，一步铺紧（可分步撤销）' : onlyWorkbench"
              @click="emit('arrange', 'compact')"
            >
              <span class="t">紧凑</span>
              <span class="v">收紧 + 整理，一步铺紧{{ view === 'workbench' ? '' : '（仅工作台）' }}</span>
            </button>
            <button
              role="menuitem"
              :disabled="view !== 'workbench'"
              :title="view === 'workbench' ? '按内容收紧卡片高度（可撤销）' : onlyWorkbench"
              @click="emit('arrange', 'fit')"
            >
              <span class="t">收紧</span>
              <span class="v">按内容收紧每张卡的高度{{ view === 'workbench' ? '' : '（仅工作台）' }}</span>
            </button>
            <button role="menuitem" title="按原比例把每行铺满（可撤销）" @click="emit('arrange', 'spread')">
              <span class="t">撑满</span>
              <span class="v">按原比例把每行铺满，不留右侧空档</span>
            </button>
            <button
              role="menuitem"
              :disabled="!hasRows"
              :title="hasRows ? '各行按自己存的参数重排一遍（可撤销）' : '版面上还没有行'"
              @click="emit('arrange', 'reflow')"
            >
              <span class="t">行重排</span>
              <span class="v">各行按存的参数自动重排{{ hasRows ? '' : '（还没有行）' }}</span>
            </button>
          </div>
        </span>
        <span class="sep" aria-hidden="true"></span>
        <span class="grp" role="group" aria-label="版面与设置">
          <button class="wide" title="挑一种排法：点一张卡片就换成那个版面（可 Ctrl+Z 退回）" @click="emit('open-templates')">
            <LayoutTemplate :size="14" /> <span class="label">版面模板</span>
          </button>
          <button class="wide" title="外观设置" @click="emit('open-settings')"><Settings :size="14" /> <span class="label">外观</span></button>
        </span>
      </div>
    </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 700;
  letter-spacing: 0.04em;
  font-size: 15px;
}
.seg,
.tools {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.seg {
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--bg-card-soft);
  border: 1px solid var(--border-soft);
}
.seg button,
.tools button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  border-radius: var(--radius-pill);
  padding: var(--space-1) var(--space-3);
  font-size: 13px;
}
.seg button[data-active='true'] {
  background: var(--brand-500);
  color: #fff;
  box-shadow: var(--shadow-card);
}
.tools {
  margin-left: auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  row-gap: var(--space-1);
}
.tools button {
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
}
.tools button.wide {
  padding: var(--space-1) var(--space-3);
}
.tools button:disabled {
  opacity: 0.4;
  cursor: default;
}
/* 顶栏元素统一 28px 高。改之前是三种：撤销/重做 24（纯图标没文字撑）、
   视图切换 28、工具按钮 30 —— 同一行里三个高度，是"乱"最直接的来源。
   用固定 height 而不是 min-height：内容（13px 文字 × 1.55 行高 + 上下 padding + 边框）
   本来就有 30px，min-height 压不住。
   排除 [role='menuitem']：下拉菜单项也在 .bar 里，但它们是两行文字，28px 会把行挤在一起。 */
.bar button:not([role='menuitem']) {
  height: 28px;
  padding-block: 0;
}
/* 纯图标按钮补成 28×28 正方形，否则比带文字的矮一截 */
.tools button.icon {
  width: 28px;
  padding: 0;
  justify-content: center;
}
/* 主 CTA 用"描边 + 淡底"而不是实心：实心是 .seg 选中态的专属语言（tokens.css），
   两个都实心就分不清"当前在哪"和"主要动作"了 */
.tools button.primary {
  background: var(--brand-50);
  border-color: var(--brand-500);
  color: var(--brand-600);
  font-weight: 600;
}
.tools button.primary:hover {
  background: color-mix(in oklab, var(--brand-500) 18%, var(--bg-card));
}
.tools button.primary:disabled {
  background: var(--bg-card);
  border-color: var(--border-strong);
  color: var(--text-3);
  font-weight: 400;
}
.caret {
  transition: transform var(--dur-micro) var(--ease-out);
}
.caret.up {
  transform: rotate(180deg);
}
/* 编辑事务（2026-10-12）：改动计数徽标（取消确认框留在 App.vue 主区） */
.tx-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--brand-500);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
/* 排布下拉比添加菜单宽一点：四项说明文字都比卡片名长 */
.arrange-menu {
  min-width: 248px;
}
.arrange-menu [role='menuitem']:disabled {
  opacity: 0.45;
  cursor: default;
}
.arrange-menu [role='menuitem']:disabled:hover {
  background: transparent;
}
/* ---- 窄屏降级 ----
   断点不是随手挑的，是对齐引擎 `packages/engine/src/breakpoints.ts` 的容器断点：
     引擎容器 1200 / 960 / 720 / 480 → 12 / 8 / 6 / 4 列
   容器宽 = 视口 − shell 内边距（16×2 = 32px），所以换算到视口是：
     992（容器 960，12→8 列）、752（容器 720，8→6 列）、512（容器 480，6→4 列）
   顶栏跟着同一套走，卡片降档和顶栏收起才会发生在同一刻，而不是各降各的。
   这套值也和业界对齐：Ant Design 官方断点是 480/576/768/992/1200/1600，
   Semi Design 栅格是 <576/≥575/≥768/≥992/≥1200，两家在 768 与 992 上完全重合，
   而 992 恰好就是引擎 960 容器对应的视口。 */
@media (max-width: 992px) {
  .tools button .label {
    display: none;
  }
  .tools button.wide {
    padding: var(--space-1) var(--space-2);
  }
}
/* 更窄时连「排布」也收成图标，并让出状态条 ——
   它是"当前多少列"这类信息，不是操作，没资格在窄屏占掉一整行 */
@media (max-width: 752px) {
  .tools .pill {
    display: none;
  }
  .tools .label,
  .arrange-label {
    display: none;
  }
  .tools .sep {
    display: none;
  }
  /* 品牌名在最窄处也让位，logo 图标保留（BrandMark 本身是 svg，不在 .brand-name 里） */
  .brand .brand-name {
    display: none;
  }
}
/* 簇与簇之间用发丝线分开，而不是靠加大间距 —— 间距再大也分不出「这几枚是同一件事」 */
.sep {
  width: 1px;
  align-self: stretch;
  min-height: 20px;
  margin: 0 var(--space-1);
  background: var(--border-soft);
}
.grp {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.add-wrap {
  position: relative;
  display: inline-flex;
}
.add-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: var(--z-menu);
  min-width: 208px;
  max-width: 260px;
  padding: var(--space-1);
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* 菜单是压在任意内容上的浮层：卡片档半透明（亮彩皮肤 86%）会直接透字 ——
     用户实拍：待办清单从「整理/紧凑」菜单里透出来。换「实底」令牌 + 背景模糊，
     实测菜单空白列亮度波动 5 级 → 0 级、大块深色内容残留从 31 级降到 17 级。 */
  background: var(--bg-card-solid);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-hover);
  /* 卡片从 10 张长到 41 张后菜单有 36 项：不限高就是 2264px，撑破 900px 视口，
     底部十几项要顶掉页面才够得着。限高 + 自身滚动，菜单才是一个菜单而不是一堵墙。 */
  max-height: min(70vh, 520px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.add-menu .gh {
  font-size: 10px;
  color: var(--text-4);
  padding: var(--space-1) var(--space-2) 0;
  /* 分组头吸顶：滚到第二组时仍能看见「现在在哪一组」，这是长列表唯一的方位锚点 */
  position: sticky;
  top: calc(var(--space-1) * -1);
  z-index: 1;
  background: var(--bg-card-solid);
  margin: 0 calc(var(--space-1) * -1);
  padding: var(--space-2) var(--space-3) var(--space-1);
  /* 与菜单表面同档：不然滚动时吸顶头比菜单自己还透，滑过去的项会在标题下透出来 */
  backdrop-filter: blur(12px);
}
.add-menu [role='menuitem'] {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  color: inherit;
}
.add-menu [role='menuitem']:hover,
.add-menu [role='menuitem']:focus-visible {
  background: var(--bg-card-soft);
}
/* 菜单项按下要有实感：tokens.css 的 button:active 只缩 0.96，
   菜单是连续列表，缩放会让相邻项跳动，这里改成背景加深，更贴合「点中了」的直觉 */
.add-menu [role='menuitem']:active {
  background: var(--brand-50);
  transform: none;
}
.add-menu .t {
  font-size: 13px;
  color: var(--text-1);
}
.add-menu .v {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-3);
}
.pill {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: var(--bg-card-soft);
  border: 1px solid var(--border-soft);
}
.metric {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
