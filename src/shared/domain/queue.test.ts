import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import {
  answerCard,
  buildTodayQueue,
  currentCard,
  estimateMinutes,
  firstAnsweredCount,
  firstTargetCount,
  isSessionFinished,
  skipCard,
  startSession,
  undoLastFirstAnswer,
  type QueueWord,
  type SessionState
} from './queue'
import { applyOutcome, gradeWord, type CheckRecord, type Grade } from './scheduler'

const TODAY = '2024-06-10'

let seq = 0
function word(partial: Partial<QueueWord> = {}): QueueWord {
  seq++
  return {
    id: `w${seq}`,
    pageNumber: 1,
    rowNo: seq,
    status: 'new',
    learnedOn: null,
    lapses: 0,
    starred: false,
    checks: [],
    ...partial
  }
}

/** learnedOn 那天学的，已完成 stage 0..upTo。 */
function learned(learnedOn: string, upTo: number, partial: Partial<QueueWord> = {}): QueueWord {
  const checks: CheckRecord[] = []
  const offsets = [0, 1, 2, 6, 14, 30]
  for (let s = 0; s <= upTo; s++) {
    checks.push({ stage: s, result: 'ok', grade: 3, doneOn: addDays(learnedOn, offsets[s]) })
  }
  return word({ status: 'learning', learnedOn, checks, ...partial })
}

describe('今日队列', () => {
  it('先放到期的复习词，再放新词', () => {
    const n = word({ pageNumber: 1 })
    const r = learned(addDays(TODAY, -1), 0, { pageNumber: 2 })
    const q = buildTodayQueue([n, r], TODAY, 20)
    expect(q.items.map((i) => [i.wordId, i.kind])).toEqual([
      [r.id, 'review'],
      [n.id, 'new']
    ])
  })

  it('复习词排序：逾期天数降序 → starred 优先 → lapses 降序 → 页码、行号升序', () => {
    const overdue3 = learned(addDays(TODAY, -5), 0) // 1天节点：逾期 4 天… 实际考 2天节点，逾期 3 天
    const onTimeA = learned(addDays(TODAY, -1), 0, { pageNumber: 3, rowNo: 1 })
    const onTimeB = learned(addDays(TODAY, -1), 0, { pageNumber: 2, rowNo: 5 })
    const starred = learned(addDays(TODAY, -1), 0, { starred: true, pageNumber: 9 })
    const lapsed2 = learned(addDays(TODAY, -1), 0, { lapses: 2, pageNumber: 8 })
    const lapsed1 = learned(addDays(TODAY, -1), 0, { lapses: 1, pageNumber: 7 })
    const q = buildTodayQueue([onTimeA, lapsed1, onTimeB, starred, overdue3, lapsed2], TODAY, 20)
    expect(q.items.map((i) => i.wordId)).toEqual([
      overdue3.id,
      starred.id,
      lapsed2.id,
      lapsed1.id,
      onTimeB.id,
      onTimeA.id
    ])
    expect(q.items[0]).toMatchObject({ stage: 2, overdueDays: 3, missedStages: [1] })
    expect(q.overdueCount).toBe(1)
  })

  it('新词按页码、行号升序', () => {
    const a = word({ pageNumber: 2, rowNo: 1 })
    const b = word({ pageNumber: 1, rowNo: 9 })
    const c = word({ pageNumber: 1, rowNo: 2 })
    expect(buildTodayQueue([a, b, c], TODAY, 20).items.map((i) => i.wordId)).toEqual([
      c.id,
      b.id,
      a.id
    ])
  })

  it('未到期、mastered、lapsed 的词不进队列', () => {
    const notYet = learned(TODAY, 0)
    const mastered = word({ status: 'mastered', learnedOn: addDays(TODAY, -40) })
    const lapsed = word({ status: 'lapsed', learnedOn: addDays(TODAY, -40) })
    expect(buildTodayQueue([notYet, mastered, lapsed], TODAY, 20).items).toEqual([])
  })

  it('每日新词上限：今天已学的 + 队列中的新词 ≤ 上限，超出的顺延', () => {
    const learnedToday = [learned(TODAY, 0), learned(TODAY, 0)]
    const fresh = Array.from({ length: 6 }, (_, i) => word({ pageNumber: 5, rowNo: i + 1 }))
    const q = buildTodayQueue([...learnedToday, ...fresh], TODAY, 5)
    expect(q.learnedTodayCount).toBe(2)
    expect(q.newCount).toBe(3)
    expect(q.deferredNewCount).toBe(3)
    expect(q.items.map((i) => i.wordId)).toEqual(fresh.slice(0, 3).map((w) => w.id))
  })

  it('超出上限的新词留到第二天，并且从真正学习的那天起算', () => {
    const fresh = Array.from({ length: 4 }, (_, i) => word({ rowNo: i + 1 }))
    const day1 = buildTodayQueue(fresh, TODAY, 3)
    expect(day1.newCount).toBe(3)
    const deferred = fresh[3]
    expect(day1.items.some((i) => i.wordId === deferred.id)).toBe(false)

    // 第一天学完 3 个
    const afterDay1 = fresh.map((w) => {
      if (w === deferred) return w
      const out = gradeWord(w, w.checks, TODAY, 3)
      const s = applyOutcome({ word: w, checks: w.checks }, out)
      return { ...w, ...s.word, checks: s.checks }
    })
    // 当天再打开：上限已满，顺延的词不出现
    expect(buildTodayQueue(afterDay1, TODAY, 3).items.filter((i) => i.kind === 'new')).toEqual([])

    // 第二天：顺延的词进入队列（新词），其余 3 个到 1天节点
    const day2 = addDays(TODAY, 1)
    const q2 = buildTodayQueue(afterDay1, day2, 3)
    expect(q2.items.find((i) => i.wordId === deferred.id)).toMatchObject({ kind: 'new', stage: 0 })

    // 第二天才学：learned_on = 第二天，1天节点在第三天
    const out = gradeWord(deferred, [], day2, 3)
    expect(out.word.learnedOn).toBe(day2)
    const s = applyOutcome({ word: deferred, checks: [] }, out)
    const later = { ...deferred, ...s.word, checks: s.checks }
    const q3 = buildTodayQueue([later], addDays(TODAY, 2), 3)
    expect(q3.items[0]).toMatchObject({
      wordId: deferred.id,
      kind: 'review',
      stage: 1,
      overdueDays: 0
    })
  })

  it('同一天多次打开：队列结果稳定', () => {
    const words = [learned(addDays(TODAY, -6), 2), learned(addDays(TODAY, -1), 0), word(), word()]
    const a = buildTodayQueue(words, TODAY, 20)
    const b = buildTodayQueue(words, TODAY, 20)
    expect(b).toEqual(a)
  })

  it('同一天多次打开：已经评过的词不再出现，不会重复计分', () => {
    const w = learned(addDays(TODAY, -1), 0)
    const q1 = buildTodayQueue([w], TODAY, 20)
    expect(q1.items).toHaveLength(1)
    const out = gradeWord(w, w.checks, TODAY, 1)
    const s = applyOutcome({ word: w, checks: w.checks }, out)
    const after = { ...w, ...s.word, checks: s.checks }
    expect(buildTodayQueue([after], TODAY, 20).items).toEqual([])
    expect(after.lapses).toBe(1)
  })

  it('连续 10 天没打开：每个词只进队列一次，考最近到期的节点', () => {
    const w = learned(addDays(TODAY, -10), 1)
    const q = buildTodayQueue([w], TODAY, 20)
    expect(q.items).toHaveLength(1)
    expect(q.items[0]).toMatchObject({ stage: 3, overdueDays: 4, missedStages: [2] })
  })
})

describe('预计用时', () => {
  it('每个词 8 秒，取整到分钟，有词时至少 1 分钟', () => {
    expect(estimateMinutes(0)).toBe(0)
    expect(estimateMinutes(1)).toBe(1)
    expect(estimateMinutes(28)).toBe(4) // 224 秒 ≈ 3.7 分钟
    expect(estimateMinutes(30)).toBe(4)
    expect(estimateMinutes(100)).toBe(13)
  })
})

describe('本轮重现', () => {
  function run(state: SessionState, grades: Grade[]): SessionState {
    let s = state
    let n = 0
    for (const g of grades) s = answerCard(s, g, `log${n++}`)
    return s
  }

  it('记得 / 很熟：不重现', () => {
    const s = run(startSession(['a', 'b']), [3, 4])
    expect(isSessionFinished(s)).toBe(true)
    expect(s.cards).toHaveLength(2)
  })

  it('忘了：排到本轮末尾重现', () => {
    let s = startSession(['a', 'b'])
    s = answerCard(s, 1, 'l1')
    expect(s.cards.map((c) => [c.wordId, c.isRetry])).toEqual([
      ['a', false],
      ['b', false],
      ['a', true]
    ])
    s = answerCard(s, 3, 'l2')
    expect(currentCard(s)).toMatchObject({ wordId: 'a', isRetry: true })
    s = answerCard(s, 3, 'l3')
    expect(isSessionFinished(s)).toBe(true)
  })

  it('模糊：排到末尾再出现一次，重现时评 ≥ 2 即结束', () => {
    let s = run(startSession(['a']), [2])
    expect(currentCard(s)).toMatchObject({ wordId: 'a', isRetry: true })
    s = answerCard(s, 2, 'r')
    expect(isSessionFinished(s)).toBe(true)
  })

  it('本轮连续答错三次：一直重现，直到评分 ≥ 2', () => {
    let s = run(startSession(['a', 'b']), [1, 3]) // a 第一次作答忘了
    s = answerCard(s, 1, 'r1') // 重现 1：忘了
    s = answerCard(s, 1, 'r2') // 重现 2：忘了
    expect(currentCard(s)).toMatchObject({ wordId: 'a', isRetry: true })
    s = answerCard(s, 2, 'r3') // 重现 3：模糊，结束
    expect(isSessionFinished(s)).toBe(true)
    expect(s.answers.filter((a) => a.wordId === 'a').map((a) => [a.grade, a.isRetry])).toEqual([
      [1, false],
      [1, true],
      [1, true],
      [2, true]
    ])
    // 进度只算第一次作答
    expect(firstAnsweredCount(s)).toBe(2)
  })

  it('先评模糊，重现时又答错：继续重现', () => {
    let s = run(startSession(['a']), [2])
    s = answerCard(s, 1, 'r1')
    expect(currentCard(s)).toMatchObject({ wordId: 'a', isRetry: true })
    s = answerCard(s, 3, 'r2')
    expect(isSessionFinished(s)).toBe(true)
    // 只有第一次作答不是重现：重现不会改写网格（由 isRetry 区分写库方式）
    expect(s.answers.map((a) => a.isRetry)).toEqual([false, true, true])
  })

  it('跳过：这个词本轮不再出现（包括它的重现），进度分母相应减少', () => {
    let s = startSession(['a', 'b', 'c'])
    s = skipCard(s)
    expect(currentCard(s)?.wordId).toBe('b')
    expect(firstTargetCount(s)).toBe(2)
    s = answerCard(s, 1, 'l1') // b 忘了，要重现
    s = answerCard(s, 3, 'l2') // c
    expect(currentCard(s)).toMatchObject({ wordId: 'b', isRetry: true })
    s = skipCard(s) // 跳过 b 的重现
    expect(isSessionFinished(s)).toBe(true)
    expect(firstTargetCount(s)).toBe(2) // b 已经作答过，仍计入
  })

  it('撤销上一次第一次作答：回到那张卡片，并带出之后的重现作答', () => {
    const history: SessionState[] = []
    let s = startSession(['a', 'b'])
    const step = (g: Grade, id: string): void => {
      history.push(s)
      s = answerCard(s, g, id)
    }
    step(1, 'a1') // a 忘了
    step(3, 'b1') // b 记得
    step(1, 'a2') // a 重现：忘了
    const u = undoLastFirstAnswer(history, s)
    expect(u).not.toBeNull()
    expect(u!.first).toMatchObject({ wordId: 'b', logId: 'b1', isRetry: false })
    expect(u!.laterRetries.map((a) => a.logId)).toEqual(['a2'])
    expect(currentCard(u!.state)).toMatchObject({ wordId: 'b', isRetry: false })
    expect(u!.history).toHaveLength(1)

    // 再撤销一次：回到 a
    const u2 = undoLastFirstAnswer(u!.history, u!.state)
    expect(u2!.first.logId).toBe('a1')
    expect(u2!.state).toEqual(startSession(['a', 'b']))
    expect(undoLastFirstAnswer(u2!.history, u2!.state)).toBeNull()
  })
})
