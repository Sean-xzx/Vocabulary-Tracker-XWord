import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import {
  STAGES,
  STAGE_LABELS,
  applyOutcome,
  applyUndo,
  getSchedule,
  gradeWord,
  planUndo,
  stageDueOn,
  type CheckRecord,
  type Grade,
  type GradeSnapshot
} from './scheduler'

const NEW: GradeSnapshot = {
  word: { status: 'new', learnedOn: null, lapses: 0, starred: false },
  checks: []
}

/** 在指定日期给当前到期节点评分，返回新状态。 */
function grade(state: GradeSnapshot, day: string, g: Grade): GradeSnapshot {
  return applyOutcome(state, gradeWord(state.word, state.checks, day, g))
}

/** 从 learnedOn 起，按时完成 stage 0..upTo（含），每次评 g。 */
function learnedThrough(learnedOn: string, upTo: number, g: Grade = 3): GradeSnapshot {
  let s = grade(NEW, learnedOn, g)
  for (let i = 1; i <= upTo; i++) s = grade(s, addDays(learnedOn, STAGES[i]), g)
  return s
}

describe('复习节点', () => {
  it('STAGES 与标签', () => {
    expect(STAGES).toEqual([0, 1, 2, 6, 14, 30])
    expect(STAGE_LABELS).toEqual(['第1遍', '1天', '2天', '6天', '14天', '30天'])
  })

  it('到期日 = learned_on + STAGES[i]', () => {
    expect(stageDueOn('2024-01-10', 0)).toBe('2024-01-10')
    expect(stageDueOn('2024-01-10', 3)).toBe('2024-01-16')
    expect(stageDueOn('2024-01-10', 5)).toBe('2024-02-09')
  })
})

describe('单词状态与起算日', () => {
  it('new：learned_on 为 NULL，第1遍当天就可以学', () => {
    const s = getSchedule(NEW.word, [], '2024-05-01')
    expect(s).toMatchObject({ nextStage: 0, dueOn: '2024-05-01', isDue: true, isOverdue: false })
  })

  it('完成第1遍写入 learned_on 和 stage 0 记录，状态变为 learning', () => {
    const out = gradeWord(NEW.word, [], '2024-05-01', 3)
    expect(out.stage).toBe(0)
    expect(out.word).toEqual({
      status: 'learning',
      learnedOn: '2024-05-01',
      lapses: 0,
      starred: false
    })
    expect(out.checks).toEqual([{ stage: 0, result: 'ok', grade: 3, doneOn: '2024-05-01' }])
  })

  it('第1遍也按四档记录：忘了记 fail 且 lapses + 1', () => {
    const out = gradeWord(NEW.word, [], '2024-05-01', 1)
    expect(out.checks[0]).toMatchObject({ stage: 0, result: 'fail', grade: 1 })
    expect(out.word.lapses).toBe(1)
    expect(out.word.status).toBe('learning')
  })

  it('起算点始终是 learned_on，而不是上一次复习的日期', () => {
    // 1天节点拖到第 2 天才复习（这时 1天节点仍然是最近到期的），6天节点仍然按 learned_on + 6
    let s = grade(NEW, '2024-05-01', 3)
    s = grade(s, '2024-05-02', 3) // 1天
    // 2天节点在 5-03 到期，用户 5-05 才复习
    s = grade(s, '2024-05-05', 3)
    const next = getSchedule(s.word, s.checks, '2024-05-05')
    expect(next).toMatchObject({ nextStage: 3, dueOn: '2024-05-07', isDue: false })
  })

  it('不论 ok 还是 fail，都进入下一个节点', () => {
    let s = grade(NEW, '2024-05-01', 3)
    s = grade(s, '2024-05-02', 1)
    expect(getSchedule(s.word, s.checks, '2024-05-02')).toMatchObject({
      nextStage: 2,
      dueOn: '2024-05-03'
    })
  })

  it('未到期时评分会报错', () => {
    const s = grade(NEW, '2024-05-01', 3)
    expect(() => gradeWord(s.word, s.checks, '2024-05-01', 3)).toThrow()
  })
})

describe('到期、拖欠、漏', () => {
  it('到期当天：isDue 且不拖欠', () => {
    const s = learnedThrough('2024-05-01', 0)
    expect(getSchedule(s.word, s.checks, '2024-05-02')).toMatchObject({
      nextStage: 1,
      isDue: true,
      isOverdue: false,
      overdueDays: 0,
      missedStages: []
    })
  })

  it('到期日 < 今天：拖欠', () => {
    const s = learnedThrough('2024-05-01', 0)
    expect(getSchedule(s.word, s.checks, '2024-05-02').isOverdue).toBe(false)
    // 5-03 时 1天节点和 2天节点都到期了：考 2天（当天到期，不拖欠），1天记为漏
    expect(getSchedule(s.word, s.checks, '2024-05-03')).toMatchObject({
      nextStage: 2,
      isOverdue: false,
      missedStages: [1]
    })
    // 5-04：只考 2天，拖欠 1 天
    expect(getSchedule(s.word, s.checks, '2024-05-04')).toMatchObject({
      nextStage: 2,
      isOverdue: true,
      overdueDays: 1,
      missedStages: [1]
    })
  })

  it('连续 10 天没打开应用：只考最近到期的节点，更早的逾期节点记为漏', () => {
    const learned = '2024-05-01'
    const s = learnedThrough(learned, 1) // 第1遍 + 1天
    const openedOn = addDays(learned, 10)
    const sch = getSchedule(s.word, s.checks, openedOn)
    // 2天（5-03）和 6天（5-07）都逾期；只考 6天，2天为漏；14天（5-15）未到
    expect(sch).toMatchObject({
      nextStage: 3,
      dueOn: '2024-05-07',
      isDue: true,
      isOverdue: true,
      overdueDays: 4,
      missedStages: [2]
    })

    // 评分之前，“漏”只是推导出来的，不写入
    expect(s.checks.map((c) => c.stage)).toEqual([0, 1])

    // 评分时才写入 missed（grade 为 NULL）
    const out = gradeWord(s.word, s.checks, openedOn, 3)
    expect(out.checks).toEqual([
      { stage: 2, result: 'missed', grade: null, doneOn: openedOn },
      { stage: 3, result: 'ok', grade: 3, doneOn: openedOn }
    ])
    const after = applyOutcome(s, out)
    expect(getSchedule(after.word, after.checks, openedOn)).toMatchObject({
      nextStage: 4,
      dueOn: '2024-05-15',
      isDue: false
    })
  })

  it('跨月末、跨年、闰年的到期日', () => {
    const a = learnedThrough('2024-01-31', 0)
    expect(getSchedule(a.word, a.checks, '2024-01-31').dueOn).toBe('2024-02-01')

    const b = learnedThrough('2024-12-20', 3)
    expect(getSchedule(b.word, b.checks, '2024-12-20').dueOn).toBe('2025-01-03') // 14天

    const c = learnedThrough('2024-02-28', 1)
    expect(getSchedule(c.word, c.checks, '2024-02-29')).toMatchObject({
      nextStage: 2,
      dueOn: '2024-03-01'
    })

    const d = learnedThrough('2024-02-29', 4)
    expect(getSchedule(d.word, d.checks, '2024-03-14').dueOn).toBe('2024-03-30') // 30天
  })

  it('同一天多次打开：推导结果稳定；评过之后当天不会重复计分', () => {
    const s = learnedThrough('2024-05-01', 0)
    const day = '2024-05-02'
    const first = getSchedule(s.word, s.checks, day)
    expect(getSchedule(s.word, s.checks, day)).toEqual(first)
    const after = grade(s, day, 3)
    expect(getSchedule(after.word, after.checks, day).isDue).toBe(false)
    expect(() => gradeWord(after.word, after.checks, day, 3)).toThrow()
    expect(after.word.lapses).toBe(0)
  })
})

describe('评分', () => {
  it('忘了：fail，lapses + 1', () => {
    const s = learnedThrough('2024-05-01', 0)
    const out = gradeWord(s.word, s.checks, '2024-05-02', 1)
    expect(out.result).toBe('fail')
    expect(out.checks.at(-1)).toMatchObject({ stage: 1, result: 'fail', grade: 1 })
    expect(out.word.lapses).toBe(1)
  })

  it('模糊：记 ok，grade = 2（界面显示淡色勾）', () => {
    const s = learnedThrough('2024-05-01', 0)
    const out = gradeWord(s.word, s.checks, '2024-05-02', 2)
    expect(out.checks.at(-1)).toMatchObject({ result: 'ok', grade: 2 })
    expect(out.word.lapses).toBe(0)
  })

  it('记得、很熟：记 ok', () => {
    const s = learnedThrough('2024-05-01', 0)
    for (const g of [3, 4] as const) {
      const out = gradeWord(s.word, s.checks, '2024-05-02', g)
      expect(out.checks.at(-1)).toMatchObject({ result: 'ok', grade: g })
    }
  })
})

describe('30天节点', () => {
  it('评为 ok：mastered，之后不再排期', () => {
    const s = learnedThrough('2024-05-01', 4)
    const out = gradeWord(s.word, s.checks, '2024-05-31', 3)
    expect(out.stage).toBe(5)
    expect(out.word.status).toBe('mastered')
    const after = applyOutcome(s, out)
    expect(getSchedule(after.word, after.checks, '2024-07-01')).toMatchObject({
      nextStage: null,
      isDue: false
    })
  })

  it('30天节点答错：lapsed，lapses + 1，之后不再排期', () => {
    const s = learnedThrough('2024-05-01', 4)
    const out = gradeWord(s.word, s.checks, '2024-05-31', 1)
    expect(out.result).toBe('fail')
    expect(out.word.status).toBe('lapsed')
    expect(out.word.lapses).toBe(1)
    const after = applyOutcome(s, out)
    expect(getSchedule(after.word, after.checks, '2024-06-30').nextStage).toBeNull()
  })

  it('其他节点评完仍是 learning', () => {
    const s = learnedThrough('2024-05-01', 3)
    expect(s.word.status).toBe('learning')
  })
})

describe('难词', () => {
  it('lapses 达到 2 时自动标记', () => {
    let s = grade(NEW, '2024-05-01', 1)
    expect(s.word).toMatchObject({ lapses: 1, starred: false })
    s = grade(s, '2024-05-02', 1)
    expect(s.word).toMatchObject({ lapses: 2, starred: true })
  })

  it('手动取消后，只有 lapses 再次增加才会重新标记', () => {
    let s = grade(NEW, '2024-05-01', 1)
    s = grade(s, '2024-05-02', 1)
    s = { ...s, word: { ...s.word, starred: false } } // 用户手动取消
    s = grade(s, '2024-05-03', 3) // lapses 没增加
    expect(s.word.starred).toBe(false)
    s = grade(s, '2024-05-07', 1) // lapses 增加到 3
    expect(s.word).toMatchObject({ lapses: 3, starred: true })
  })

  it('已经标记的词答对不会被取消', () => {
    let s = grade(NEW, '2024-05-01', 1)
    s = grade(s, '2024-05-02', 1)
    s = grade(s, '2024-05-03', 4)
    expect(s.word.starred).toBe(true)
  })
})

describe('撤销', () => {
  const cases: { name: string; state: GradeSnapshot; day: string; g: Grade }[] = [
    { name: '新词的第1遍', state: NEW, day: '2024-05-01', g: 3 },
    {
      name: '忘了（lapses、starred 变化）',
      state: grade(NEW, '2024-05-01', 1),
      day: '2024-05-02',
      g: 1
    },
    { name: '带 missed 的评分', state: learnedThrough('2024-05-01', 1), day: '2024-05-11', g: 2 },
    { name: '30天节点答错', state: learnedThrough('2024-05-01', 4), day: '2024-05-31', g: 1 },
    { name: '30天节点通过', state: learnedThrough('2024-05-01', 4), day: '2024-06-02', g: 4 }
  ]

  for (const c of cases) {
    it(`撤销一次评分后，状态完全恢复：${c.name}`, () => {
      const before: GradeSnapshot = structuredClone(c.state)
      const out = gradeWord(before.word, before.checks, c.day, c.g)
      const after = applyOutcome(before, out)
      expect(after).not.toEqual(before)
      const plan = planUndo(before, out)
      expect(plan.deleteStages).toEqual(out.checks.map((x: CheckRecord) => x.stage))
      expect(applyUndo(after, plan)).toEqual(before)
      // 撤销后可以重新评分，结果和第一次一样
      expect(gradeWord(before.word, before.checks, c.day, c.g)).toEqual(out)
    })
  }
})
