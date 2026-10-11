/**
 * 命令速查：一份「名字 + 命令」名单，点一下复制命令。
 *
 * 与 `links.ts` 同一套分层：清洗规则（去空白、截长、去重、排序、id 唯一）在引擎侧
 * 纯函数里（可单测、变异可守），`cardData` 只做接线。与 links 的差别只有两点：
 * 命令**允许多行**（管道/脚本贴进来是常态），且没有协议白名单 ——
 * 命令本来就是任意文本，不存在"危险协议"一说（复制不等于执行）。
 */

export interface CommandEntry {
  id: string
  label: string
  /** 命令原文；允许多行，截长到 MAX_CMD_TEXT */
  cmd: string
}

export const MAX_COMMANDS = 80
export const MAX_CMD_LABEL = 24
export const MAX_CMD_TEXT = 240

/** 命令正文：去首尾空白、截长。空串拒收（null）—— 名单里不存"空命令" */
export function normalizeCommand(input: string): string | null {
  const s = input.trim().slice(0, MAX_CMD_TEXT)
  return s || null
}

/** 名字：去空白、截短；空名用命令**首行**兜底 —— 一眼能认出是哪条 */
export function normalizeCmdLabel(input: string, cmd: string): string {
  const s = input.trim().slice(0, MAX_CMD_LABEL)
  if (s) return s
  return cmd.split('\n')[0].trim().slice(0, MAX_CMD_LABEL) || cmd.slice(0, MAX_CMD_LABEL)
}

/** 清洗整份名单：丢坏的、去重（同名同命令）、按名字排、砍到上限；id 保证唯一 */
export function sanitizeCommands(list: Readonly<{ id?: unknown; label?: unknown; cmd?: unknown }[]>): CommandEntry[] {
  const seen = new Set<string>()
  const out: CommandEntry[] = []
  for (let i = 0; i < list.length && out.length < MAX_COMMANDS; i += 1) {
    const raw = list[i]
    const cmd = typeof raw?.cmd === 'string' ? normalizeCommand(raw.cmd) : null
    if (!cmd) continue
    const label = normalizeCmdLabel(typeof raw?.label === 'string' ? raw.label : '', cmd)
    const key = `${label} ${cmd}`
    if (seen.has(key)) continue
    seen.add(key)
    let id = typeof raw?.id === 'string' && raw.id ? raw.id : `c${i}`
    while (out.some((x) => x.id === id)) id = `${id}-${out.length}`
    out.push({ id, label, cmd })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
}
