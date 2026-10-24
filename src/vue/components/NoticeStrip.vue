<script setup lang="ts">
/**
 * 应用内三条提示横幅（2026-10-24，App.vue 拆分 Cut C1）。
 *
 * 从 `src/App.vue` 主区顶部整块搬来 —— 三条横幅共用一个"横条"形状（图标 + 占满中间的
 * 文案 + 靠右的按钮），但**内容、role、颜色、按钮语义各不相同**（红条是 `alert` 且带一条
 * 救命入口；另两条是 `status` 的可关闭提示）。所以这里是"三条一起住进一个文件"，
 * 不是"合成一条可变体"：合成一条就得把三种形状的差异压进 props，反而更绕。
 *
 * 组件**零状态**（与 `AppToolbar.vue` 同款）：只读 App 传进来的三份数据，关闭动作一律
 * emit 回去由 App 改自己的 ref —— 状态留在一处，组件就能被单独看懂。
 *
 * 硬约束：**DOM 逐字不变** —— E2E 的 `storage-error` / `reminder-strip` 选择器、
 * `role=alert` / `role=status` 全压在这上面，class 名与 aria 一个字母都不能动。
 */
import { BellRing, History, TriangleAlert } from 'lucide-vue-next'
import type { Reminder } from '../reminders'

defineProps<{
  /** 存储层错误文案（null = 没错误，整条红条不出现） */
  storageError: string | null
  /** 启动迁移的说明（P0-⑤），空数组不显示 */
  migrationNotes: string[]
  /** 到点的提醒（P0-④ 阶段 1），空数组不显示 */
  reminderNotes: Reminder[]
}>()

const emit = defineEmits<{
  'dismiss-migration': []
  'dismiss-reminder': []
  'export-backup': []
}>()
</script>

<template>
  <p v-if="storageError" class="storage-error" role="alert">
    <TriangleAlert :size="14" /> <span class="txt">{{ storageError }}</span>
    <!-- 失败时的救命入口：当前状态只在内存里，先下载一份完整备份再谈别的。
         判据用「只在内存里」这句 —— 桌面壳与网页版的写失败文案都带它，读失败没有。
         网页版此前连这条红条都不会出现（见 fileStorage.webStorage 的注释）。 -->
    <button v-if="storageError.includes('只在内存里')" class="rescue" @click="emit('export-backup')">
      立刻下载备份
    </button>
  </p>
  <!-- 数据迁移提示（P0-⑤）：迁移过就写回并留了现场，这里如实说一句 -->
  <p v-if="migrationNotes.length" class="reminder-strip" role="status">
    <History :size="14" />
    <span class="txt">
      <template v-for="(n, i) in migrationNotes" :key="i">
        <span v-if="i" class="dot" aria-hidden="true">·</span>{{ n }}
      </template>
    </span>
    <button class="dismiss" @click="emit('dismiss-migration')">知道了</button>
  </p>
  <!-- 提醒横幅（P0-④ 阶段 1）：今天的事实到了，就在这里说一声。阶段 2 接系统通知后，
       这条仍保留 —— 窗口开着时应用内提示比系统通知更不打扰。 -->
  <p v-if="reminderNotes.length" class="reminder-strip" role="status">
    <BellRing :size="14" />
    <span class="txt">
      <template v-for="(r, i) in reminderNotes" :key="r.key">
        <span v-if="i" class="dot" aria-hidden="true">·</span>
        <b>{{ r.title }}</b> {{ r.body }}
      </template>
    </span>
    <button class="dismiss" @click="emit('dismiss-reminder')">知道了</button>
  </p>
</template>

<style scoped>
.storage-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid color-mix(in oklab, var(--c-red) 45%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--c-red) 10%, var(--bg-card));
  color: var(--text-1);
  font-size: 12px;
}
/* 错误文案可以很长，让它占满中间、按钮靠右不被挤走 */
.storage-error .txt {
  flex: 1;
  min-width: 0;
}
.storage-error .rescue {
  flex: none;
  height: 24px;
  padding: 0 var(--space-3);
  border: 1px solid var(--c-red);
  border-radius: var(--radius-pill);
  background: var(--bg-card);
  color: var(--c-red);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.storage-error .rescue:hover {
  background: color-mix(in oklab, var(--c-red) 12%, var(--bg-card));
}
.reminder-strip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid color-mix(in oklab, var(--brand-500) 40%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--brand-500) 8%, var(--bg-card));
  color: var(--text-1);
  font-size: 12px;
}
/* 文案可能有好几条，让它占满中间、按钮靠右不被挤走（与上面那条红条同一形状） */
.reminder-strip .txt {
  flex: 1;
  min-width: 0;
}
.reminder-strip .dot {
  margin: 0 4px;
  color: var(--text-3);
}
.reminder-strip .dismiss {
  flex: none;
  height: 24px;
  padding: 0 var(--space-3);
  border: 1px solid color-mix(in oklab, var(--brand-500) 45%, transparent);
  border-radius: var(--radius-pill);
  background: var(--bg-card);
  color: var(--text-1);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.reminder-strip .dismiss:hover {
  background: color-mix(in oklab, var(--brand-500) 10%, var(--bg-card));
}
</style>
