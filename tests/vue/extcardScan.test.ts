/**
 * 扫描落袋层（`src/vue/extcardScan.ts`）：三个出口 —— 全装 / 部分跳过 / 空目录 ——
 * 都在这里钉。组件那半（按钮、invoke、disabled 态）由 E2E 兜底；扫描的 Rust 侧
 * （`scan_cards_dir`）由 cargo 单测兜底 —— 两层各管各的，本文件只管落袋循环。
 */
import { describe, expect, it } from 'vitest'
import { importScanned, scanSummaryText, type ScannedPack } from '../../src/vue/extcardScan'

/**
 * 记账式替身：拒因按「json 原文」查表摆 —— 不引真 cardData，单测只关心循环本身；
 * 校验逻辑的真测在 `tests/engine/extcard.test.ts` 与 `tests/vue/cardData*.test.ts`。
 */
function recordingCards(verdicts: Record<string, string | null>) {
  const installed: string[] = []
  return {
    installed,
    addExtCard: (json: string): string | null => {
      const r = verdicts[json] ?? null
      if (r === null) installed.push(json)
      return r
    },
  }
}

const pack = (dir: string): ScannedPack => ({ dir, json: `{"id":"${dir}"}` })

describe('importScanned：逐份过与粘贴导入同一条校验', () => {
  it('全装：total / installed 对得上，不留跳过', () => {
    const cards = recordingCards({})
    const out = importScanned([pack('a'), pack('b')], cards)
    expect(out).toEqual({ total: 2, installed: 2, skips: [] })
    expect(cards.installed).toHaveLength(2)
  })

  it('拒因连目录名一起留下 —— 「扫了但没装上」不是糊涂账', () => {
    const a = pack('a')
    const b = pack('b')
    const cards = recordingCards({ [b.json]: 'permissions 含未知权限 "storage"' })
    const out = importScanned([a, b], cards)
    expect(out.installed).toBe(1)
    expect(out.skips).toEqual(['b：permissions 含未知权限 "storage"'])
  })

  it('空结果：摘要走「没有卡包」那句引导，不是空字符串', () => {
    const cards = recordingCards({})
    const out = importScanned([], cards)
    expect(out).toEqual({ total: 0, installed: 0, skips: [] })
    expect(scanSummaryText(out)).toBe('cards 目录里没有卡包 —— 把卡包文件夹（内含 card.json）放进去再扫')
  })
})

describe('scanSummaryText：总数 / 新装 / 跳过三件事一句话', () => {
  it('全装时不该出现「跳过」', () => {
    expect(scanSummaryText({ total: 3, installed: 3, skips: [] })).toBe('扫描到 3 个：新装 3 个')
  })

  it('有跳过要并进同一句', () => {
    expect(scanSummaryText({ total: 3, installed: 1, skips: ['x：理由'] })).toBe(
      '扫描到 3 个：新装 1 个，跳过 1 个',
    )
  })
})
