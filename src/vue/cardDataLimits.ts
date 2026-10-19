/**
 * `cardData` 全族的数值边界与夹取助手。
 *
 * 从 cardData.ts 拆出（2026-10-20，#124）。存在的理由就一句话：这些上限**两层共用** ——
 * 清洗层（`sanitizeCardData`）用它们挡坏数据，存储层的写入动作（`addTodo` /
 * `setPickWeight` / `addLedger`……）用它们夹用户输入。一个上限两处各写一份，
 * 迟早不一致，而不一致之后没人知道哪份对。
 *
 * 只收两层共用的；清洗层独有的（`MAX_TEXT` / `textOf` / `uniqueId`）留在
 * `cardDataSanitize.ts`，存储层独有的（`KEY`）留在 `cardData.ts`。
 */

import { LEDGER_CATEGORIES } from '@levango7/engine'

/** 一个几百 MB 的坏文件不该把首屏冻住；单条文本也截断 */
export const MAX_ITEMS = 200

/** 生日卡最多认这么多条：再多就该用别的工具管人，而不是一张工作台卡片 */
export const MAX_BIRTHDAYS = 100

/** 抽签名单同理；权重夹在 0–99（不是 0–∞）：99 已经是"几乎必中"，再大没有意义 */
export const MAX_PICKS = 60
export const MAX_PICK_WEIGHT = 99

/** 记账：一个月的条目量级。超了说明这是账本软件，不是工作台卡片 */
export const MAX_LEDGER_ROWS = 2000

/** 分类截短；不在候选表里的一律回「其他」，免得汇总里冒出一堆只出现一次的类 */
export const MAX_CATEGORY = 12

/**
 * 计时器累计量上限（约 7 天）。一个"累计 3 年的秒表"多半是脏数据，不该原样落盘。
 * 两层共用：清洗层夹读入值，存储层的 `timerPause` 夹累计值。
 */
export const MAX_TIMER_MS = 599 * 60_000 * 7

/** 权重必须是 0–99 的整数；`undefined`（没写）= 等概率 1，坏值也回 1 而不是 0（0 意味着"永远抽不到"） */
export function clampWeight(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1
  return Math.min(MAX_PICK_WEIGHT, Math.max(0, Math.round(v)))
}

/**
 * 分类必须在候选表里，不在就回「其他」。
 * 自由文本分类会让"按类汇总"退化成一堆只出现一次的类，而那张卡回答的是"钱去哪了"。
 */
export function knownCategory(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().slice(0, MAX_CATEGORY) : ''
  return (LEDGER_CATEGORIES as readonly string[]).includes(s) ? s : '其他'
}
