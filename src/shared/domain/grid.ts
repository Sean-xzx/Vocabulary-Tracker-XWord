/**
 * 网格：每个检查格应该显示成什么样子，以及表头是否显示日期。
 */
import type { DateStr } from './dates'
import {
  STAGE_COUNT,
  getSchedule,
  stageDueOn,
  type CheckRecord,
  type Grade,
  type WordSchedState
} from './scheduler'

export type CellState =
  | { kind: 'ok'; faint: boolean; grade: Grade | null; doneOn: DateStr }
  | { kind: 'fail'; doneOn: DateStr }
  /** derived：尚未写入 checks，只是调度函数推导出的“漏”。 */
  | { kind: 'missed'; derived: boolean }
  | { kind: 'due'; overdue: boolean; dueOn: DateStr }
  /** 新词的第1遍格子：显示“待学”；due 表示在今日队列里。 */
  | { kind: 'pending'; due: boolean }
  | { kind: 'next'; dueOn: DateStr }
  | { kind: 'empty' }

export function cellStates(
  word: WordSchedState,
  checks: CheckRecord[],
  today: DateStr,
  newWordQueued: boolean
): CellState[] {
  const cells: CellState[] = Array.from({ length: STAGE_COUNT }, () => ({ kind: 'empty' }))

  for (const c of checks) {
    if (c.stage < 0 || c.stage >= STAGE_COUNT) continue
    if (c.result === 'ok')
      cells[c.stage] = { kind: 'ok', faint: c.grade === 2, grade: c.grade, doneOn: c.doneOn }
    else if (c.result === 'fail') cells[c.stage] = { kind: 'fail', doneOn: c.doneOn }
    else cells[c.stage] = { kind: 'missed', derived: false }
  }

  if (word.status === 'new') {
    cells[0] = { kind: 'pending', due: newWordQueued }
    return cells
  }

  const schedule = getSchedule(word, checks, today)
  for (const s of schedule.missedStages) cells[s] = { kind: 'missed', derived: true }
  if (schedule.nextStage !== null && schedule.dueOn !== null) {
    cells[schedule.nextStage] = schedule.isDue
      ? { kind: 'due', overdue: schedule.isOverdue, dueOn: schedule.dueOn }
      : { kind: 'next', dueOn: schedule.dueOn }
  }
  return cells
}

/** 本页所有已学的词 learned_on 相同时，返回各节点日期；否则返回 null。 */
export function headerDates(words: Pick<WordSchedState, 'learnedOn'>[]): DateStr[] | null {
  const learned = words.map((w) => w.learnedOn).filter((d): d is DateStr => d !== null)
  if (learned.length === 0) return null
  const first = learned[0]
  if (!learned.every((d) => d === first)) return null
  return Array.from({ length: STAGE_COUNT }, (_, s) => stageDueOn(first, s))
}
