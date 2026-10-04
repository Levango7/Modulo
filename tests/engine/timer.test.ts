import { describe, expect, it } from 'vitest'
import {
  advanceInterval,
  breathComplete,
  breathCycleSeconds,
  breathPatternById,
  breathTotalMs,
  breathView,
  BREATH_PATTERNS,
  currentPhase,
  elapsedMs,
  formatClock,
  formatDurationShort,
  formatRemainingText,
  IDLE,
  INTERVAL_INIT,
  INTERVAL_PRESETS,
  intervalPresetById,
  intervalRound,
  intervalView,
  isFinished,
  minutesToMs,
  pauseRun,
  phaseMinutes,
  progress,
  remainingMs,
  resetRun,
  startRun,
} from '../../packages/engine/src/timer'

const MIN = 60_000

describe('RunState：一个状态形状，四种卡都是它的投影', () => {
  const t0 = 1_000_000

  it('未启动 → 0', () => {
    expect(elapsedMs(IDLE, t0)).toBe(0)
  })

  it('启动后按时间戳算差，**不是每秒累加**', () => {
    // 后台标签页被节流时，累加计数器会少记一大截；时间戳不会
    const s = startRun(IDLE, t0)
    expect(elapsedMs(s, t0)).toBe(0)
    expect(elapsedMs(s, t0 + 90 * 1000)).toBe(90_000)
  })

  it('暂停把差值冻结进 accumulatedMs，并停止累计', () => {
    let s = startRun(IDLE, t0)
    s = pauseRun(s, t0 + 30_000)
    expect(s.running).toBe(false)
    expect(s.startedAt).toBeNull()
    expect(elapsedMs(s, t0 + 999_000)).toBe(30_000)
  })

  it('暂停后继续跑，累计接上而不是从零开始', () => {
    let s = startRun(IDLE, t0)
    s = pauseRun(s, t0 + 30_000)
    s = startRun(s, t0 + 60_000)
    expect(elapsedMs(s, t0 + 75_000)).toBe(45_000)
  })

  it('重复 start 是幂等的（连点两下不会重置时间）', () => {
    const s = startRun(IDLE, t0)
    const again = startRun(s, t0 + 10_000)
    expect(again).toBe(s)
    expect(elapsedMs(again, t0 + 20_000)).toBe(20_000)
  })

  it('重复 pause 是幂等的', () => {
    const s = pauseRun(IDLE, t0)
    expect(s).toBe(IDLE)
  })

  it('时钟被往回拨 / 累加值是脏的 → 夹到 0，不显示负秒', () => {
    const s = { running: true, startedAt: t0, accumulatedMs: 5_000 }
    expect(elapsedMs(s, t0 - 60_000)).toBe(5_000)
    expect(elapsedMs({ running: false, startedAt: null, accumulatedMs: -999 }, t0)).toBe(0)
    expect(elapsedMs({ running: false, startedAt: null, accumulatedMs: Number.NaN }, t0)).toBe(0)
  })

  it('复位归零', () => {
    const s = startRun(IDLE, t0)
    expect(resetRun(s)).toEqual(IDLE)
  })
})

describe('倒计时：到点是 0，不是负数', () => {
  const t0 = 1_000_000
  const dur = 25 * MIN

  it('剩余 = 时长 − 已跑', () => {
    const s = startRun(IDLE, t0)
    expect(remainingMs(s, dur, t0 + 5 * MIN)).toBe(20 * MIN)
  })

  it('到点 → 剩余 0，且 isFinished 为 true', () => {
    const s = startRun(IDLE, t0)
    expect(remainingMs(s, dur, t0 + 30 * MIN)).toBe(0)
    expect(isFinished(s, dur, t0 + 25 * MIN)).toBe(true)
  })

  it('**恰好到点也算到点**（用 >= 而不是 >，否则时长 0 时永远不到点）', () => {
    expect(isFinished(startRun(IDLE, t0), 0, t0)).toBe(true)
    expect(isFinished(startRun(IDLE, t0), 5 * MIN, t0 + 5 * MIN)).toBe(true)
  })

  it('进度 0–1；时长 0 → 1（"没有时长"不是一条 0% 的进度条）', () => {
    const s = startRun(IDLE, t0)
    expect(progress(IDLE, dur, t0)).toBe(0)
    expect(progress(s, dur, t0 + 25 * MIN)).toBe(1)
    expect(progress(IDLE, 0, t0)).toBe(1)
  })

  it('时长夹到 0–599 分：一张卡不该显示"还有 600 分钟"', () => {
    expect(minutesToMs(0)).toBe(0)
    expect(minutesToMs(-5)).toBe(0)
    expect(minutesToMs(25.4)).toBe(25 * MIN)
    expect(minutesToMs(9999)).toBe(599 * MIN)
    expect(minutesToMs(Number.NaN)).toBe(0)
  })
})

describe('格式', () => {
  it('不足一小时不带小时位', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(9 * MIN + 58 * 1000)).toBe('09:58')
    expect(formatClock(59 * MIN)).toBe('59:00')
  })

  it('过一小时自动带上小时位', () => {
    expect(formatClock(61 * MIN + 1_000)).toBe('01:01:01')
    expect(formatClock(59 * MIN, true)).toBe('00:59:00')
  })

  it('紧凑形态', () => {
    expect(formatDurationShort(45_000)).toBe('45s')
    expect(formatDurationShort(5 * MIN)).toBe('5m')
    expect(formatDurationShort(65 * MIN)).toBe('1h 05m')
    expect(formatDurationShort(120 * MIN)).toBe('2h')
  })

  it('剩余文案在 60 秒以下跟秒走 —— 否则一整分钟不更新', () => {
    expect(formatRemainingText(5 * MIN)).toBe('还有 5 分')
    expect(formatRemainingText(40_000)).toBe('还有 40 秒')
    // 30.2 秒要说 31 秒（ceil），不是 30
    expect(formatRemainingText(30_200)).toBe('还有 31 秒')
    expect(formatRemainingText(0)).toBe('还有 0 秒')
  })

  it('负数与坏输入都给 0，不出现 "-00:03" 或 "NaN"', () => {
    expect(formatClock(-5_000)).toBe('00:00')
    expect(formatClock(Number.NaN)).toBe('00:00')
    expect(formatDurationShort(-1)).toBe('0s')
  })
})

describe('间歇计时：番茄 25/5 是预设，不是一张卡', () => {
  const pomodoro = intervalPresetById('pomodoro')
  const t0 = 1_000_000

  it('预设表里确实有"番茄 25/5"，且默认就是它', () => {
    expect(pomodoro).toMatchObject({ label: '番茄 25/5', focusMin: 25, breakMin: 5, longEvery: 4, longBreakMin: 15 })
    expect(INTERVAL_PRESETS.length).toBeGreaterThan(1)
  })

  it('认不出的预设 id → 落回番茄，不崩', () => {
    expect(intervalPresetById('nope').id).toBe('pomodoro')
  })

  it('相位顺序：专注 → 休息 → 专注 → 休息 → 专注 → 休息 → 专注 → **长休**', () => {
    const kinds = Array.from({ length: 8 }, (_, i) => currentPhase({ completedFocus: 0, phaseIndex: i }, pomodoro))
    expect(kinds).toEqual(['focus', 'break', 'focus', 'break', 'focus', 'break', 'focus', 'longBreak'])
  })

  it('只在专注段累加完成数', () => {
    let s = INTERVAL_INIT
    for (let i = 0; i < 8; i += 1) s = advanceInterval(s, pomodoro)
    expect(s.completedFocus).toBe(4)
    expect(s.phaseIndex).toBe(8)
  })

  it('各相位的时长', () => {
    expect(phaseMinutes('focus', pomodoro)).toBe(25)
    expect(phaseMinutes('break', pomodoro)).toBe(5)
    expect(phaseMinutes('longBreak', pomodoro)).toBe(15)
  })

  it('轮次是"已完成 / 每几次长休"', () => {
    expect(intervalRound(INTERVAL_INIT, pomodoro)).toEqual({ done: 0, target: 4 })
    expect(intervalRound({ completedFocus: 4, phaseIndex: 8 }, pomodoro)).toEqual({ done: 4, target: 4 })
  })

  it('到点自动切段，且**归零、不累计** —— 否则"专注 25 分钟"会显示 50 分钟', () => {
    const run = startRun(IDLE, t0)
    const v = intervalView(run, INTERVAL_INIT, pomodoro, t0 + 26 * MIN)
    expect(v.phase).toBe('break')
    expect(v.state.phaseIndex).toBe(1)
    expect(v.elapsed).toBe(0)
    expect(v.durationMs).toBe(5 * MIN)
  })

  it('一次跨过多段只推进一步（后台回来不一口气播完 7 段提示）', () => {
    // 一次跳 3 小时：按番茄算已经过了好几轮
    const v = intervalView(startRun(IDLE, t0), INTERVAL_INIT, pomodoro, t0 + 180 * MIN)
    expect(v.state.phaseIndex).toBe(1)
    expect(v.elapsed).toBe(0)
  })

  it('没到点时相位不变，进度照常给', () => {
    const v = intervalView(startRun(IDLE, t0), INTERVAL_INIT, pomodoro, t0 + 10 * MIN)
    expect(v.phase).toBe('focus')
    expect(v.finished).toBe(false)
    expect(v.elapsed).toBe(10 * MIN)
    expect(v.durationMs).toBe(25 * MIN)
  })

  it('elapsed 不会超过本段时长（卡上不显示"超了"）', () => {
    const v = intervalView(startRun(IDLE, t0), INTERVAL_INIT, pomodoro, t0 + 26 * MIN)
    expect(v.elapsed).toBeLessThanOrEqual(v.durationMs)
  })

  it('换个预设，长休的位置跟着变（50/10 是三段一长休）', () => {
    const p = intervalPresetById('fifty-ten')
    const kinds = Array.from({ length: 6 }, (_, i) => currentPhase({ completedFocus: 0, phaseIndex: i }, p))
    expect(kinds).toEqual(['focus', 'break', 'focus', 'break', 'focus', 'longBreak'])
  })
})

describe('呼吸计时：状态由时间戳给出，后台被节流也不会走错拍', () => {
  const box = breathPatternById('box')
  const t0 = 1_000_000

  it('方箱 = 4-4-4-4，一轮 16 秒 × 4 轮', () => {
    expect(box).toMatchObject({ id: 'box', rounds: 4 })
    expect(breathCycleSeconds(box)).toBe(16)
    expect(breathTotalMs(box)).toBe(16_000 * 4)
  })

  it('认不出的 id → 落回方箱', () => {
    expect(breathPatternById('nope').id).toBe('box')
  })

  it('四拍按顺序推进', () => {
    const run = startRun(IDLE, t0)
    expect(breathView(run, box, t0).kind).toBe('inhale')
    expect(breathView(run, box, t0 + 4_000).kind).toBe('hold')
    expect(breathView(run, box, t0 + 8_000).kind).toBe('exhale')
    expect(breathView(run, box, t0 + 12_000).kind).toBe('rest')
  })

  it('一秒一拍，进度 0–1 驱动那个圆', () => {
    const run = startRun(IDLE, t0)
    const a = breathView(run, box, t0)
    const b = breathView(run, box, t0 + 2_000)
    expect(a.second).toBe(0)
    expect(b.second).toBe(2)
    expect(b.ratio).toBeCloseTo(0.5, 5)
    expect(breathView(run, box, t0 + 3_999).second).toBe(3)
  })

  it('一轮结束后回到第一拍，但轮数 +1', () => {
    const run = startRun(IDLE, t0)
    const v = breathView(run, box, t0 + 16_000)
    expect(v.kind).toBe('inhale')
    expect(v.round).toBe(2)
  })

  it('跑满全部轮次后轮数封顶（不越界），且能判断"做完了"', () => {
    const run = startRun(IDLE, t0)
    const v = breathView(run, box, t0 + breathTotalMs(box) + 30_000)
    expect(v.round).toBe(box.rounds)
    expect(breathComplete(run, box, t0 + breathTotalMs(box) - 1)).toBe(false)
    expect(breathComplete(run, box, t0 + breathTotalMs(box))).toBe(true)
  })

  it('助眠 4-7-8 只有三拍，一轮 19 秒', () => {
    const p = BREATH_PATTERNS.find((x) => x.id === 'relax-478')!
    expect(breathCycleSeconds(p)).toBe(19)
    const run = startRun(IDLE, t0)
    expect(breathView(run, p, t0 + 11_000).kind).toBe('exhale')
  })

  it('没启动 → 停在第一拍的第 0 秒，不自己走', () => {
    const v = breathView(IDLE, box, t0 + 999_000)
    expect(v.second).toBe(0)
    expect(v.ratio).toBe(0)
  })
})