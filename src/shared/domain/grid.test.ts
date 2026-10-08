import { describe, expect, it } from 'vitest'
import { cellStates, headerDates } from './grid'
import type { CheckRecord, WordSchedState } from './scheduler'

const TODAY = '2024-06-10'

function learning(learnedOn: string, lapses = 0): WordSchedState {
  return { status: 'learning', learnedOn, lapses, starred: false }
}

describe('网格格子状态', () => {
  it('ok / 淡 ok / fail / missed', () => {
    const checks: CheckRecord[] = [
      { stage: 0, result: 'ok', grade: 3, doneOn: '2024-06-01' },
      { stage: 1, result: 'ok', grade: 2, doneOn: '2024-06-02' },
      { stage: 2, result: 'fail', grade: 1, doneOn: '2024-06-03' },
      { stage: 3, result: 'missed', grade: null, doneOn: '2024-06-09' }
    ]
    const cells = cellStates(learning('2024-06-01', 1), checks, '2024-06-09', false)
    expect(cells[0]).toMatchObject({ kind: 'ok', faint: false })
    expect(cells[1]).toMatchObject({ kind: 'ok', faint: true })
    expect(cells[2]).toMatchObject({ kind: 'fail' })
    expect(cells[3]).toMatchObject({ kind: 'missed', derived: false })
    // 14天节点 6-15 还没到：浅色日期
    expect(cells[4]).toEqual({ kind: 'next', dueOn: '2024-06-15' })
    expect(cells[5]).toEqual({ kind: 'empty' })
  })

  it('今天到期 / 拖欠 / 推导出的漏', () => {
    const checks: CheckRecord[] = [
      { stage: 0, result: 'ok', grade: 3, doneOn: '2024-05-31' },
      { stage: 1, result: 'ok', grade: 3, doneOn: '2024-06-01' }
    ]
    const dueToday = cellStates(learning('2024-05-31'), checks, '2024-06-06', false)
    expect(dueToday[2]).toEqual({ kind: 'missed', derived: true })
    expect(dueToday[3]).toEqual({ kind: 'due', overdue: false, dueOn: '2024-06-06' })

    const overdue = cellStates(learning('2024-05-31'), checks, TODAY, false)
    expect(overdue[3]).toEqual({ kind: 'due', overdue: true, dueOn: '2024-06-06' })
    expect(overdue[4]).toEqual({ kind: 'empty' })
  })

  it('新词：第1遍显示待学；在今日队列时带高亮', () => {
    const w: WordSchedState = { status: 'new', learnedOn: null, lapses: 0, starred: false }
    expect(cellStates(w, [], TODAY, true)[0]).toEqual({ kind: 'pending', due: true })
    expect(cellStates(w, [], TODAY, false)[0]).toEqual({ kind: 'pending', due: false })
    expect(
      cellStates(w, [], TODAY, true)
        .slice(1)
        .every((c) => c.kind === 'empty')
    ).toBe(true)
  })

  it('mastered / lapsed 之后没有下一个节点', () => {
    const checks: CheckRecord[] = [0, 1, 2, 3, 4, 5].map((stage) => ({
      stage,
      result: stage === 5 ? 'fail' : 'ok',
      grade: stage === 5 ? 1 : 3,
      doneOn: TODAY
    }))
    const cells = cellStates(
      { status: 'lapsed', learnedOn: '2024-05-01', lapses: 1, starred: false },
      checks,
      TODAY,
      false
    )
    expect(cells.map((c) => c.kind)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'fail'])
  })
})

describe('表头日期', () => {
  it('本页已学的词 learned_on 都相同：显示各节点日期', () => {
    expect(
      headerDates([{ learnedOn: '2024-06-01' }, { learnedOn: '2024-06-01' }, { learnedOn: null }])
    ).toEqual(['2024-06-01', '2024-06-02', '2024-06-03', '2024-06-07', '2024-06-15', '2024-07-01'])
  })

  it('learned_on 不同或没有已学的词：不显示日期', () => {
    expect(headerDates([{ learnedOn: '2024-06-01' }, { learnedOn: '2024-06-02' }])).toBeNull()
    expect(headerDates([{ learnedOn: null }])).toBeNull()
    expect(headerDates([])).toBeNull()
  })
})
