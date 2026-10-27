import { describe, expect, it } from 'vitest'
import {
  clampStep,
  createOnboarding,
  EMPTY_ONBOARDING,
  finishState,
  isLastStep,
  ONBOARDING_KEY,
  ONBOARDING_STEPS,
  parseOnboarding,
  replayState,
  serializeOnboarding,
  showOnboarding,
  stepAt,
} from '../../src/vue/onboarding'

/**
 * 首启引导（F-10）。这一层的钉子集中在两处**会让人被反复打扰或再也回不去**的地方：
 * ① 什么时候该弹（`showOnboarding`）；② 跳过/走完之后盘上到底写了什么。
 */

const mem = () => {
  const map = new Map<string, string>()
  return {
    get: (k: string) => map.get(k) ?? null,
    set: (k: string, v: string) => void map.set(k, v),
    map,
  }
}

/** set 会抛的存储：写盘失败不能让应用崩（最坏是下次再弹一次） */
const broken = () => {
  const base = mem()
  return { ...base, set: () => { throw new Error('磁盘满了') } }
}

describe('三步本身', () => {
  it('三步、顺序固定、段落文案非空', () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual(['layout', 'look', 'ready'])
    for (const s of ONBOARDING_STEPS) {
      expect(s.title.trim()).not.toBe('')
      expect(s.hint.trim()).not.toBe('')
    }
  })

  it('越界的索引夹回合法范围（坏索引不许把向导画成空白）', () => {
    expect(clampStep(-3)).toBe(0)
    expect(clampStep(99)).toBe(ONBOARDING_STEPS.length - 1)
    expect(clampStep(1.7)).toBe(1)
    // 算不出来的（NaN / ±Infinity）回第一步：无从夹取就从头上再来，
    // 而算得出但越界的（-3 / 99）夹到两端 —— 两种坏值处理不同，是因为语义不同
    expect(clampStep(Number.NaN)).toBe(0)
    expect(clampStep(Number.POSITIVE_INFINITY)).toBe(0)
    expect(stepAt(99).id).toBe('ready')
    expect(stepAt(-1).id).toBe('layout')
  })

  it('最后一步只有一个', () => {
    expect(isLastStep(0)).toBe(false)
    expect(isLastStep(1)).toBe(false)
    expect(isLastStep(2)).toBe(true)
    expect(isLastStep(99), '越界也按"最后一步"算，否则「开始用」永远不出现').toBe(true)
  })
})

describe('盘上的状态不可信', () => {
  it('没存过 / 坏 JSON / 数组 / 不是对象 ⇒ 全默认（当没看过）', () => {
    for (const raw of [null, '', '{', '[]', 'null', '"done"', '42']) {
      expect(parseOnboarding(raw)).toEqual(EMPTY_ONBOARDING)
    }
  })

  it('`done` 只认严格 true：字符串 "true" / 1 / 有值 都当作没看过', () => {
    for (const bad of ['"true"', '1', '{}', '[]', '"yes"']) {
      expect(parseOnboarding(`{"done":${bad}}`).done).toBe(false)
    }
    expect(parseOnboarding('{"done":true}').done).toBe(true)
    expect(parseOnboarding('{"done":true,"skipped":true}').skipped).toBe(true)
  })

  it('时刻只认正数：0 / 负数 / 字符串 ⇒ null', () => {
    expect(parseOnboarding('{"done":true,"at":0}').at).toBeNull()
    expect(parseOnboarding('{"done":true,"at":-5}').at).toBeNull()
    expect(parseOnboarding('{"done":true,"at":"1761600000000"}').at).toBeNull()
    expect(parseOnboarding('{"done":true,"at":1761600000000}').at).toBe(1761600000000)
  })

  it('写出去再读回来是等价的（同一套字段，不多不少）', () => {
    const s = { done: true, skipped: true, at: 1761600000000 }
    expect(parseOnboarding(serializeOnboarding(s))).toEqual(s)
    expect(parseOnboarding(serializeOnboarding(EMPTY_ONBOARDING))).toEqual(EMPTY_ONBOARDING)
  })
})

describe('该不该弹', () => {
  it('只有「没看过 + 真首启」才弹（四组合逐一钉）', () => {
    expect(showOnboarding({ done: false, firstRun: true })).toBe(true)
    expect(showOnboarding({ done: false, firstRun: false })).toBe(false)
    expect(showOnboarding({ done: true, firstRun: true })).toBe(false)
    expect(showOnboarding({ done: true, firstRun: false })).toBe(false)
  })
})

describe('了结与回放', () => {
  it('走完与跳过都置 done，差别只在 skipped', () => {
    expect(finishState({ skipped: false, now: 1000 })).toEqual({ done: true, skipped: false, at: 1000 })
    expect(finishState({ skipped: true, now: 1000 })).toEqual({ done: true, skipped: true, at: 1000 })
  })

  it('坏时钟不写进盘（宁可记 null，也别记一个 1970 的假时刻）', () => {
    expect(finishState({ skipped: false, now: 0 }).at).toBeNull()
    expect(finishState({ skipped: false, now: Number.NaN }).at).toBeNull()
  })

  it('回放只把 done 放回去，skipped 保留（它记录的是上一次怎么了结的）', () => {
    expect(replayState({ done: true, skipped: true, at: 5 })).toEqual({ done: false, skipped: true, at: 5 })
  })
})

describe('胶水：读一次、写回去', () => {
  it('真首启且没看过 ⇒ 显示；了结后落盘且不再显示', () => {
    const storage = mem()
    const ob = createOnboarding(storage, { firstRun: () => true, now: () => 2000 })
    expect(ob.visible.value).toBe(true)
    ob.finish({ skipped: false })
    expect(ob.visible.value).toBe(false)
    expect(parseOnboarding(storage.get(ONBOARDING_KEY))).toEqual({ done: true, skipped: false, at: 2000 })
    // 同一份盘再开一次：不弹
    expect(createOnboarding(storage, { firstRun: () => true }).visible.value).toBe(false)
  })

  it('跳过也置 done —— 否则每次启动都弹，引导就成 nag', () => {
    const storage = mem()
    const ob = createOnboarding(storage, { firstRun: () => true, now: () => 3000 })
    ob.finish({ skipped: true })
    expect(parseOnboarding(storage.get(ONBOARDING_KEY))).toEqual({ done: true, skipped: true, at: 3000 })
    expect(createOnboarding(storage, { firstRun: () => true }).visible.value).toBe(false)
  })

  it('不是真首启（版面非空的老用户）⇒ 一次都不弹', () => {
    const ob = createOnboarding(mem(), { firstRun: () => false })
    expect(ob.visible.value).toBe(false)
  })

  it('回放：立刻再显示，并把 done 落成 false（重启后仍按 firstRun 判）', () => {
    const storage = mem()
    const ob = createOnboarding(storage, { firstRun: () => true, now: () => 4000 })
    ob.finish({ skipped: true })
    ob.replay()
    expect(ob.visible.value).toBe(true)
    expect(parseOnboarding(storage.get(ONBOARDING_KEY))).toEqual({ done: false, skipped: true, at: 4000 })
  })

  it('写盘失败不崩：内存状态照旧前进（点了"跳过"不该再看一遍这一轮）', () => {
    const ob = createOnboarding(broken(), { firstRun: () => true, now: () => 5000 })
    expect(ob.visible.value).toBe(true)
    expect(() => ob.finish({ skipped: true })).not.toThrow()
    expect(ob.visible.value).toBe(false)
    expect(ob.state().done).toBe(true)
  })

  it('不注入时钟时用 Date.now（默认参数的兜底也得是真的，别记一个假时刻）', () => {
    const storage = mem()
    const before = Date.now()
    const ob = createOnboarding(storage, { firstRun: () => true })
    ob.finish({ skipped: false })
    const saved = parseOnboarding(storage.get(ONBOARDING_KEY))
    expect(saved.at).not.toBeNull()
    expect(saved.at as number).toBeGreaterThanOrEqual(before)
    expect(saved.at as number).toBeLessThanOrEqual(Date.now())
  })
})
