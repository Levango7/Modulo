/**
 * 首次打开（或数据损坏回退）时的示例内容。
 *
 * 从 cardData.ts 拆出（2026-10-20，#124）。保持**函数**而不是常量：示例笔记的
 * `at: Date.now()` 要在每次 `createCardData()` 调用时求值，与拆分前语义一致。
 * 示例内容只给「待办 / 速记」这两张默认在版面上的卡；倒数日 / 正计时 / 习惯给人留空。
 */
import type { CardData } from './cardDataTypes'

export function createFallbackCardData(): CardData {
  return   {
    sticky: '',
    todos: [
      { id: 't1', text: '写下今天最重要的三件事', done: true },
      { id: 't2', text: '回一封拖了三天的邮件', done: false },
      { id: 't3', text: '把周报草稿发出去', done: false },
    ],
    notes: [{ id: 'n1', title: '先扔进来的念头', body: '开会时冒出来的一句话，不整理也没关系，回头再收。', at: Date.now() }],
    // 示例内容只给"待办/速记"这两张默认在版面上的卡；倒数日/正计时/习惯给人留空
    countdown: { label: '', date: '' },
    elapsed: { label: '', date: '' },
    habit: { name: '', days: [] },
    birthdays: [],
    pickList: [],
    ledger: { symbol: '¥', entries: [] },
    // 示例会议：三个跨时区城市 + 一个体面的本地时间。第一次打开就有东西看，
    // 而"全空的会议卡"演示不出这张卡到底解决什么问题
    meeting: { cityIds: ['shanghai', 'london', 'new-york'], at: '20:00', minutes: 60, title: '' },
    // 四个计时器都给空档：钟停在起点、显示「开始」，
    // 而不是替用户预设一个"已经在跑"的计时 —— 一个自己会走的钟是最容易让人怀疑的界面
    timers: {
      stopwatch: { accumulatedMs: 0, startedAt: null },
      countdown: { minutes: 25, accumulatedMs: 0, startedAt: null },
      interval: { presetId: 'pomodoro', completedFocus: 0, phaseIndex: 0, accumulatedMs: 0, startedAt: null },
      breath: { patternId: 'box', accumulatedMs: 0, startedAt: null },
    },
    links: [],
    commands: [],
    matrix: [],
    probes: [],
    stocks: [],
    feeds: [],
  watch: [],
  endpoints: [],
  launch: [],
  htmlCards: [],
  extCards: [],
  extState: {},
    fixed: { base: '', rate: '', symbol: '¥' },
    duty: { roster: [], anchor: '' },
  }
}
