/**
 * 原生卡「扫描 cards 目录」的落袋层（2026-10-28）。
 *
 * ## 为什么单独成文件
 *
 * 组件层在本仓**没有可断言的测试设施**（无 @vue/test-utils / jsdom）—— 同
 * `moduleFilter.ts` / `floatList.ts` / `instanceData.ts` 的分工理由：「逐份过导入校验、
 * 给一句人话摘要」是纯判定，留在组件里就只剩 E2E 一层兜底，而 E2E 跑不了桌面态
 * （扫描按钮按 `isDesktop` 显隐，桌面态要在页面里注 Tauri 桩，与本仓安全钩的
 * 动态执行禁令冲突）—— 提炼出来才能在 vitest 里钉住三个出口。
 *
 * ## 判据
 *
 * 扫描来的每一份都走与「粘 JSON 导入」**同一条** `addExtCard`：不因为是从硬盘目录
 * 来的就放宽校验（permissions 声明、HTML 上限、id 重复都照查）。被拒的**不静默**，
 * 连目录名带拒因一起留下 —— 「扫了但没装上」不能是一句糊涂账。
 * 空目录也要有人话：别让用户对着一个没反应的按钮猜。
 */
import type { CardDataApi } from './cardData'

/** 扫描结果的一条：目录名 + `card.json` 原文（形状与 Rust `extcards.rs` 的 `ScannedPack` 逐字段一致） */
export interface ScannedPack {
  dir: string
  json: string
}

export interface ScanOutcome {
  total: number
  installed: number
  /** 每条 = `目录名：引擎拒因` */
  skips: string[]
}

/**
 * 把扫描结果逐份喂进导入校验。`cards` 只要 `addExtCard` 这一个方法 ——
 * 用最小依赖面，单测才好记账式替身。
 */
export function importScanned(
  packs: readonly ScannedPack[],
  cards: Pick<CardDataApi, 'addExtCard'>,
): ScanOutcome {
  const skips: string[] = []
  let installed = 0
  for (const p of packs) {
    const err = cards.addExtCard(p.json)
    if (err === null) installed++
    else skips.push(`${p.dir}：${err}`)
  }
  return { total: packs.length, installed, skips }
}

/** 摘要：总数 / 新装 / 跳过三件事一句话；空目录单走一句引导。 */
export function scanSummaryText(outcome: ScanOutcome): string {
  if (outcome.total === 0) {
    return 'cards 目录里没有卡包 —— 把卡包文件夹（内含 card.json）放进去再扫'
  }
  return (
    `扫描到 ${outcome.total} 个：新装 ${outcome.installed} 个` +
    (outcome.skips.length ? `，跳过 ${outcome.skips.length} 个` : '')
  )
}
