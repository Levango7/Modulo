/**
 * 「技能」的共享状态（PR-F3）：左栏列它、聊天里 `@` 它 —— 两处必须同一份。
 *
 * 与 `useKnowledge` 逐字同一手法：薄薄一层 API 管落盘与响应式，判定全在 `skills.ts`
 * 的纯函数里（那半不开浏览器也能断言）。落盘走 `StorageAdapter` —— 与资料、定时任务、
 * 卡片数据同一条闸门，测试给内存实现、桌面/网页各走各的真实实现。
 * 不自造状态层：这一格没有定时调度、没有执行通道，就是一份清单。
 */
import { ref, type Ref } from 'vue'
import type { StorageAdapter } from './store'
import {
  addSkills,
  SKILL_DOC_KEY,
  parseSkills,
  removeSkill,
  serializeSkills,
  type Skill,
  type PickedSkill,
} from './skills'

export interface SkillsApi {
  skills: Ref<Skill[]>
  /** 存入并落盘；**拒收理由逐条回给调用方**（界面负责说出来） */
  add(picked: readonly PickedSkill[]): string[]
  remove(id: string): void
  clearAll(): void
}

export function createSkills(storage: StorageAdapter): SkillsApi {
  // 盘上的技能不可信：解析与逐条清洗都在 parseSkills 里（坏条目丢弃，不整份报废）
  const skills = ref<Skill[]>(parseSkills(storage.get(SKILL_DOC_KEY)))
  const save = (): void => storage.set(SKILL_DOC_KEY, serializeSkills(skills.value))
  return {
    skills,
    add(picked) {
      const before = skills.value.length
      const r = addSkills(skills.value, picked, Date.now())
      skills.value = r.skills
      // 有实际入库才落盘（一次全是拒收的导入不必空写一遍）
      if (skills.value.length !== before) save()
      return r.rejected
    },
    remove(id) {
      skills.value = removeSkill(skills.value, id)
      save()
    },
    clearAll() {
      skills.value = []
      save()
    },
  }
}
