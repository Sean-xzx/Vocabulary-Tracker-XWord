/**
 * 调度核心：根据 learned_on 与检查记录推导下一个节点，并计算一次评分 / 撤销需要写入的变化。
 * 全部是纯函数，“今天”一律由调用方传入。
 */
import { addDays, diffDays, isSameOrBefore, type DateStr } from './dates'

export const STAGES = [0, 1, 2, 6, 14, 30] as const
export const STAGE_LABELS = ['第1遍', '1天', '2天', '6天', '14天', '30天'] as const
export const STAGE_COUNT = STAGES.length
export const LAST_STAGE = STAGE_COUNT - 1

export type WordStatus = 'new' | 'learning' | 'mastered' | 'lapsed'
export type CheckResult = 'ok' | 'fail' | 'missed'
export type Grade = 1 | 2 | 3 | 4

export const GRADE_LABELS: Record<Grade, string> = { 1: '忘了', 2: '模糊', 3: '记得', 4: '很熟' }

/** 自动标记难词的阈值：某次评分让 lapses 达到这个值或以上。 */
export const STAR_LAPSES = 2

/** checks 表的一行（网格里的一格）。stage 是 STAGES 的下标 0–5。 */
export interface CheckRecord {
  stage: number
  result: CheckResult
  grade: Grade | null
  doneOn: DateStr
}

/** 单词中与调度相关的字段。 */
export interface WordSchedState {
  status: WordStatus
  learnedOn: DateStr | null
  lapses: number
  starred: boolean
}

export interface Schedule {
  /** 现在（或下一次）要考的节点；已经 mastered / lapsed 时为 null。 */
  nextStage: number | null
  /** nextStage 的到期日；新词为今天。 */
  dueOn: DateStr | null
  isDue: boolean
  isOverdue: boolean
  /** 逾期天数，未逾期为 0。 */
  overdueDays: number
  /** 早于 nextStage、已逾期但未完成的节点：评分时会记为 missed。 */
  missedStages: number[]
}

export function isGrade(value: unknown): value is Grade {
  return value === 1 || value === 2 || value === 3 || value === 4
}

export function stageDueOn(learnedOn: DateStr, stage: number): DateStr {
  return addDays(learnedOn, STAGES[stage])
}

const NOT_SCHEDULED: Schedule = {
  nextStage: null,
  dueOn: null,
  isDue: false,
  isOverdue: false,
  overdueDays: 0,
  missedStages: []
}

export function getSchedule(word: WordSchedState, checks: CheckRecord[], today: DateStr): Schedule {
  if (word.status === 'mastered' || word.status === 'lapsed') return NOT_SCHEDULED
  if (word.status === 'new' || word.learnedOn === null) {
    return {
      nextStage: 0,
      dueOn: today,
      isDue: true,
      isOverdue: false,
      overdueDays: 0,
      missedStages: []
    }
  }

  const learnedOn = word.learnedOn
  const done = new Set(checks.map((c) => c.stage))
  const undone: number[] = []
  for (let s = 0; s < STAGE_COUNT; s++) if (!done.has(s)) undone.push(s)
  if (undone.length === 0) return NOT_SCHEDULED

  // 从最早的未完成节点开始，找出所有已到期的节点；只考其中最近到期的那一个，其余视为“漏”。
  const dueUndone = undone.filter((s) => isSameOrBefore(stageDueOn(learnedOn, s), today))
  if (dueUndone.length === 0) {
    const first = undone[0]
    return {
      nextStage: first,
      dueOn: stageDueOn(learnedOn, first),
      isDue: false,
      isOverdue: false,
      overdueDays: 0,
      missedStages: []
    }
  }

  const target = dueUndone[dueUndone.length - 1]
  const dueOn = stageDueOn(learnedOn, target)
  const overdueDays = Math.max(0, diffDays(dueOn, today))
  return {
    nextStage: target,
    dueOn,
    isDue: true,
    isOverdue: overdueDays > 0,
    overdueDays,
    missedStages: dueUndone.slice(0, -1)
  }
}

/** 一次（本轮第一次作答的）评分需要写入的全部变化。 */
export interface GradeOutcome {
  stage: number
  grade: Grade
  result: 'ok' | 'fail'
  /** 需要插入 checks 的记录：先是 missed，最后是本次评分的那一格。 */
  checks: CheckRecord[]
  /** 评分后的单词调度字段。 */
  word: WordSchedState
}

export function gradeWord(
  word: WordSchedState,
  checks: CheckRecord[],
  today: DateStr,
  grade: Grade
): GradeOutcome {
  const schedule = getSchedule(word, checks, today)
  if (schedule.nextStage === null || !schedule.isDue) {
    throw new Error('这个词今天没有到期的节点')
  }
  const stage = schedule.nextStage
  const result: 'ok' | 'fail' = grade === 1 ? 'fail' : 'ok'
  const learnedOn = word.learnedOn ?? today

  const written: CheckRecord[] = schedule.missedStages.map((s) => ({
    stage: s,
    result: 'missed',
    grade: null,
    doneOn: today
  }))
  written.push({ stage, result, grade, doneOn: today })

  const lapses = result === 'fail' ? word.lapses + 1 : word.lapses
  // 只有 lapses 增加时才可能自动标记；用户手动取消后，不会因为别的原因被重新标上。
  const starred = lapses > word.lapses && lapses >= STAR_LAPSES ? true : word.starred

  let status: WordStatus = 'learning'
  if (stage === LAST_STAGE) status = result === 'ok' ? 'mastered' : 'lapsed'

  return { stage, grade, result, checks: written, word: { status, learnedOn, lapses, starred } }
}

/** 评分前的状态快照，用来撤销。 */
export interface GradeSnapshot {
  word: WordSchedState
  checks: CheckRecord[]
}

export interface UndoPlan {
  /** 恢复成评分前的调度字段。 */
  word: WordSchedState
  /** 需要从 checks 删除的节点（本次评分写入的所有格子，包括 missed）。 */
  deleteStages: number[]
  /** 需要重新插入的旧记录（正常情况下为空，防御性保留）。 */
  restoreChecks: CheckRecord[]
}

export function planUndo(before: GradeSnapshot, outcome: GradeOutcome): UndoPlan {
  const deleteStages = outcome.checks.map((c) => c.stage)
  return {
    word: { ...before.word },
    deleteStages,
    restoreChecks: before.checks
      .filter((c) => deleteStages.includes(c.stage))
      .map((c) => ({ ...c }))
  }
}

function sortChecks(checks: CheckRecord[]): CheckRecord[] {
  return [...checks].sort((a, b) => a.stage - b.stage)
}

/** 把评分结果套用到内存状态上（与 repository 写库的效果一致）。 */
export function applyOutcome(state: GradeSnapshot, outcome: GradeOutcome): GradeSnapshot {
  const replaced = new Set(outcome.checks.map((c) => c.stage))
  return {
    word: { ...outcome.word },
    checks: sortChecks([...state.checks.filter((c) => !replaced.has(c.stage)), ...outcome.checks])
  }
}

/** 把撤销计划套用到内存状态上。 */
export function applyUndo(state: GradeSnapshot, plan: UndoPlan): GradeSnapshot {
  const removed = new Set(plan.deleteStages)
  return {
    word: { ...plan.word },
    checks: sortChecks([
      ...state.checks.filter((c) => !removed.has(c.stage)),
      ...plan.restoreChecks
    ])
  }
}
