import type { Component } from 'vue'
import ClockCard from '../app/cards/ClockCard.vue'
import StickyCard from '../app/cards/StickyCard.vue'
import TodoCard from '../app/cards/TodoCard.vue'
import NotesCard from '../app/cards/NotesCard.vue'
import WeatherCard from '../app/cards/WeatherCard.vue'
import CalendarCard from '../app/cards/CalendarCard.vue'
import ProgressCard from '../app/cards/ProgressCard.vue'
import WorldClockCard from '../app/cards/WorldClockCard.vue'
import CountdownCard from '../app/cards/CountdownCard.vue'
import DateToolsCard from '../app/cards/DateToolsCard.vue'
import ElapsedCard from '../app/cards/ElapsedCard.vue'
import HabitCard from '../app/cards/HabitCard.vue'
import CalculatorCard from '../app/cards/CalculatorCard.vue'
import UnitCard from '../app/cards/UnitCard.vue'
import ColorCard from '../app/cards/ColorCard.vue'
import TextStatCard from '../app/cards/TextStatCard.vue'
import RandomCard from '../app/cards/RandomCard.vue'
import BaseCard from '../app/cards/BaseCard.vue'
import FxCard from '../app/cards/FxCard.vue'
import AirCard from '../app/cards/AirCard.vue'
import RepoCard from '../app/cards/RepoCard.vue'
import HnCard from '../app/cards/HnCard.vue'
import MoonCard from '../app/cards/MoonCard.vue'

/**
 * 模块 id → 渲染组件。单独一个文件是因为 `cardRegistry.ts` 只放尺寸契约、必须能被
 * node 环境的单测直接 import（vitest 默认环境没装 vue 插件，碰 .vue 就解析不了），
 * 而这张表偏偏要 import 十八个 .vue。
 */
export const CARD_COMPONENTS: Record<string, Component> = {
  clock: ClockCard,
  sticky: StickyCard,
  todo: TodoCard,
  notes: NotesCard,
  recent: NotesCard,
  weather: WeatherCard,
  calendar: CalendarCard,
  progress: ProgressCard,
  worldclock: WorldClockCard,
  countdown: CountdownCard,
  dtools: DateToolsCard,
  elapsed: ElapsedCard,
  habit: HabitCard,
  calc: CalculatorCard,
  unitconv: UnitCard,
  colorconv: ColorCard,
  textstat: TextStatCard,
  randomnum: RandomCard,
  baseconv: BaseCard,
  fx: FxCard,
  air: AirCard,
  repo: RepoCard,
  hn: HnCard,
  moon: MoonCard,
}
