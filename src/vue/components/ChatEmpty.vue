<script setup lang="ts">
/**
 * 空态（F-15 P0 §1.4）：一段新对话还没说话时，给三条**已实现**的能力做引子。
 *
 * 两条纪律：
 * 1. **点一下只填进输入框，不发送** —— 发出去就花钱、就把话替用户说了；
 *    引子的作用是「让他不用从空白开始打字」，不是替他开口。
 * 2. 三条文案各自对应一个真的能跑的动作（`context.read` / `todo.add` / `memory.add`，
 *    白名单见 `aiActions.ts`）。**不许写还没做的功能**（工具开关就是被这条挡在 P0 之外的）。
 */
import { MessageSquarePlus } from 'lucide-vue-next'

const emit = defineEmits<{ (e: 'pick', text: string): void }>()

/**
 * 三条引子。`act` 是同一条话在协议层会触发的动作 —— 写在界面上是为了让用户
 * 一眼看到"它到底会干什么"，而不是一句漂亮的营销话。
 */
const IDEAS: readonly { text: string; act: string; hint: string }[] = [
  {
    text: '看看我的版面，今天该干什么',
    act: 'context.read',
    hint: '它会把版面读一遍再回答（只读，不动任何卡）',
  },
  {
    text: '把这段会议记录整理成待办',
    act: 'todo.add',
    hint: '整理完会先给一份提议，你点头才真的写进待办卡',
  },
  {
    text: '记住：我偏好四象限',
    act: 'memory.add',
    hint: '记进「AI 记忆」，之后每条对话都会带上它',
  },
]
</script>

<template>
  <div class="empty" data-chat-empty>
    <p class="lead">说点什么。它读得到版面、也写得了卡 —— 但每次动手都要先问你一句。</p>
    <ul class="ideas">
      <li v-for="i in IDEAS" :key="i.act">
        <button class="idea" type="button" :data-idea="i.act" :title="i.hint" @click="emit('pick', i.text)">
          <MessageSquarePlus :size="13" class="ico" />
          <span class="txt">{{ i.text }}</span>
          <span class="act">{{ i.act }}</span>
        </button>
        <p class="hint">{{ i.hint }}</p>
      </li>
    </ul>
    <p class="tail">也可以直接打 <code>@</code> 引用某张卡 / 某份资料，答案会带上它的内容。</p>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 520px;
  /* `auto` 两侧 + 上下：空态在对话区里居中（这是全屏唯一允许居中的时刻），
     有消息时这块根本不渲染，所以不会影响正常对话的顶对齐 */
  margin: auto;
  padding: var(--space-4) 0;
}
.lead,
.tail {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2);
}
.tail {
  font-size: 12px;
  color: var(--text-3);
}
code {
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--border-soft) 40%, transparent);
}
.ideas {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.idea {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-1);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--dur-micro) var(--ease-out),
    transform var(--dur-micro) var(--ease-out);
}
.idea:hover {
  border-color: var(--accent);
}
.idea:active {
  transform: scale(0.99);
}
.ico {
  flex: none;
  color: var(--text-3);
}
.txt {
  flex: 1;
  min-width: 0;
}
/* 动作名是**协议层**的事实，不是装饰：用等宽、降一档的色，别跟正文抢 */
.act {
  flex: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--text-3);
}
.hint {
  margin: 2px 0 0 var(--space-4);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-3);
}
@media (prefers-reduced-motion: reduce) {
  .idea {
    transition: none;
  }
  .idea:active {
    transform: none;
  }
}
</style>
