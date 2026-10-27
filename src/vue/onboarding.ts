/**
 * 首启向导的**纯判定层**（F-10，2026-10-28）。
 *
 * 为什么单独成文件：这段要能被断言（本仓受测层的纳入判据，见 `vitest.config.ts` 文件头）。
 * 三件事在这里定死，组件只负责画：
 *   ① **三步是什么**（顺序就是数组顺序，不许在模板里再写一遍）；
 *   ② **什么时候该弹**（`showOnboarding`）—— 这条最容易写错，见下面那条口径；
 *   ③ **状态怎么落盘、坏数据怎么办**（`parseOnboarding` / `serializeOnboarding`）。
 *
 * 触发口径（为什么老用户升级上来不会被打扰）：
 *   `show = !done && firstRun`，而 `firstRun` 是 store 里的派生量「版面为空且没挑过模板」。
 *   升级上来的用户版面非空 ⇒ 永远看不到引导；只有真首启（或手动清空版面）才会遇到。
 *
 * 「跳过」与「走完」**都写 `done: true`** —— 否则每次启动都弹，引导就变成 nag。
 * 两者的差别只记在 `skipped`：它不是判据，是给文案和将来统计用的。
 */
import { ref } from 'vue'
import type { StorageAdapter } from './store'

export const ONBOARDING_KEY = 'modulo.onboarding.v1'

export interface OnboardingState {
  /** 这次首启的引导是否已经了结（走完或跳过都算） */
  done: boolean
  /** 了结的方式：跳过 = true。只用于文案，不参与判定 */
  skipped: boolean
  /** 了结的时刻；没记录的旧数据是 null */
  at: number | null
}

export const EMPTY_ONBOARDING: OnboardingState = { done: false, skipped: false, at: null }

export interface OnboardingStep {
  id: 'layout' | 'look' | 'ready'
  title: string
  /** 这一步在做"决定"还是"知道"——决定那两步才即时生效 */
  hint: string
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  { id: 'layout', title: '先挑一张版面', hint: '点一张就换过去（可以 Ctrl+Z 退回）；不想挑就「先不选」，不影响使用' },
  { id: 'look', title: '选个顺眼的外观', hint: '皮肤与明暗会立刻生效，之后随时能在「设置 → 外观」里改' },
  { id: 'ready', title: '可以开始了', hint: '三条你可能不知道的事在下面' },
]

/** 第几步（越界一律夹回合法范围：坏的索引不许把向导画成空白） */
export function clampStep(index: number): number {
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.trunc(index), 0), ONBOARDING_STEPS.length - 1)
}

export function stepAt(index: number): OnboardingStep {
  return ONBOARDING_STEPS[clampStep(index)]
}

export function isLastStep(index: number): boolean {
  return clampStep(index) === ONBOARDING_STEPS.length - 1
}

/** 盘上不可信：坏 JSON / 缺字段 / 类型不对一律回默认，不整份报废（与备份索引同一条纪律） */
export function parseOnboarding(raw: string | null): OnboardingState {
  if (!raw) return { ...EMPTY_ONBOARDING }
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return { ...EMPTY_ONBOARDING }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return { ...EMPTY_ONBOARDING }
  const o = obj as Record<string, unknown>
  const at = o.at
  return {
    // 只认**严格 true**：`"true"` / 1 / 有值都当作没看过，宁可多弹一次也不要把人挡在门外
    done: o.done === true,
    skipped: o.skipped === true,
    at: typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null,
  }
}

export function serializeOnboarding(s: OnboardingState): string {
  return JSON.stringify({ done: s.done, skipped: s.skipped, at: s.at })
}

/** 了结这次引导：走完与跳过都置 `done`，差别只在 `skipped` */
export function finishState(input: { skipped: boolean; now: number }): OnboardingState {
  return { done: true, skipped: input.skipped, at: Number.isFinite(input.now) && input.now > 0 ? input.now : null }
}

/** 回放：保留 `skipped`（它记录的是上一次怎么了结的），只把 `done` 放回去 */
export function replayState(s: OnboardingState): OnboardingState {
  return { ...s, done: false }
}

/** 这一轮要不要弹。两个条件缺一不可 —— 见文件头那条口径 */
export function showOnboarding(input: { done: boolean; firstRun: boolean }): boolean {
  return !input.done && input.firstRun
}

export interface OnboardingApi {
  /** 向导此刻是否显示（ref：组件要跟着它显隐） */
  visible: ReturnType<typeof ref<boolean>>
  finish: (opts: { skipped: boolean }) => void
  /** 「关于」里的「重新播放首启引导」 */
  replay: () => void
  state: () => OnboardingState
}

/**
 * 胶水：读一次、写回去。
 *
 * 写盘失败**不让应用崩**（一次引导没记下来，最坏结果是下次再弹一次），
 * 但内存里的状态照旧前进 —— 否则用户点了「跳过」还得再看一遍这一轮。
 */
export function createOnboarding(
  storage: StorageAdapter,
  opts: { firstRun: () => boolean; now?: () => number },
): OnboardingApi {
  const now = opts.now ?? (() => Date.now())
  let state = parseOnboarding(storage.get(ONBOARDING_KEY))
  const visible = ref(showOnboarding({ done: state.done, firstRun: opts.firstRun() }))

  const persist = (): void => {
    try {
      storage.set(ONBOARDING_KEY, serializeOnboarding(state))
    } catch {
      /* 记不下来就下次再弹一次，别为这个把应用弄崩 */
    }
  }

  return {
    visible,
    state: () => state,
    finish({ skipped }) {
      state = finishState({ skipped, now: now() })
      visible.value = false
      persist()
    },
    replay() {
      state = replayState(state)
      visible.value = true
      persist()
    },
  }
}
