/**
 * 「智囊笔」（第三十九笔）：定时任务请求的**只读版面简报**。
 *
 * 为什么需要：`useCron` 弹 `ai_chat` 时此前只带一句 prompt —— 模型看不见版面上的
 * 卡、待办、倒数日、习惯，问它「汇总我今天的待办」只能凭空编。本层把版面折成
 * 一段**预算封顶**的简报，作为 system 块随定时任务请求注入。
 *
 * 三条纪律：
 * 1. **只读**：简报只描述现状；system 块末尾钉死「无人值守只读边界」——不输出
 *    `@@act` 动作行、不改卡、写动作留给用户在场时自己确认。cron 请求不带 tools
 *    清单（工具面只在对话坞里存在），模型就算想动手也没有通道。
 * 2. **不猜**：简报只含调用方给出的卡与摘要；空版面有明确的一句话，不假装有内容。
 * 3. **逐字兼容**：未注入简报时调用方不带 system 消息 —— 旧行为（单条 user）逐字不变。
 */

export const CRON_BRIEF_MAX = 2000
export const BRIEF_LINE_MAX = 80

export interface BriefCard {
  /** 人话标题（与坞里 chip 的 label 同口径：单实例 = 卡名，多实例 = 「卡名（n）」） */
  title: string
  /** 该卡此刻的摘要正文（空串 = 只有标题，不硬塞「无内容」） */
  excerpt: string
}

/** 码点截断（与 knowledge.ts 的 cutPoints 同口径：中文与 emoji 各算一个字） */
const cutAt = (s: string, max: number): { text: string; cut: boolean } => {
  const chars = Array.from(s)
  return chars.length <= max ? { text: s, cut: false } : { text: chars.slice(0, max).join(''), cut: true }
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * 版面清单 → 简报。每卡一行（`- 标题：摘要`），单行摘要按码点截 `BRIEF_LINE_MAX`；
 * 整份按 `max` 封顶，超出的卡**明说还有几张**，不静默丢。
 */
export function briefFromCards(cards: readonly BriefCard[], max: number = CRON_BRIEF_MAX): string {
  const lines: string[] = []
  let used = 0
  let shown = 0
  for (const c of cards) {
    const title = oneLine(c.title) || '（未命名）'
    const body = oneLine(c.excerpt)
    const line = body ? `- ${title}：${cutAt(body, BRIEF_LINE_MAX).text}` : `- ${title}`
    const cost = Array.from(line).length + 1
    if (used + cost > max) break
    lines.push(line)
    used += cost
    shown++
  }
  const rest = cards.length - shown
  if (rest > 0) lines.push(`（还有 ${rest} 张没有列出）`)
  return lines.join('\n')
}

/** 定时任务的 system 块：简报 + 只读边界（与对话坞的写动作面分开）。brief 为空 = 版面为空。 */
export function cronSystemBlock(brief: string): string {
  const body = brief.trim()
  return [
    '以下是用户版面此刻的实况摘要（应用自动注入；只作参考，不要编造摘要之外的内容）：',
    '',
    body || '（版面为空）',
    '',
    '【定时任务只读边界】这是一次无人值守的定时触发：你只输出一份可直接阅读的报告文本。',
    '不要修改版面，不要新增 / 勾选 / 删除任何卡片或记录，不要输出 @@act 动作行。',
    '需要改动的话，在报告里写明建议，留给用户在场时自己确认。',
  ].join('\n')
}
