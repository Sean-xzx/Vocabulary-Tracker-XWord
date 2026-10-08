/**
 * 今日队列与“本轮”（复习会话）。本轮只存在于内存中。
 */
import type { DateStr } from './dates'
import { getSchedule, type CheckRecord, type Grade, type WordSchedState } from './scheduler'

export const DEFAULT_DAILY_NEW_LIMIT = 20
export const MIN_DAILY_NEW_LIMIT = 5
export const MAX_DAILY_NEW_LIMIT = 100

export interface QueueWord extends WordSchedState {
  id: string
  pageNumber: number
  rowNo: number
  checks: CheckRecord[]
}

export interface QueueItem {
  wordId: string
  kind: 'review' | 'new'
  stage: number
  dueOn: DateStr
  overdueDays: number
  missedStages: number[]
}

export interface TodayQueue {
  items: QueueItem[]
  reviewCount: number
  newCount: number
  overdueCount: number
  /** 因为每日上限而顺延到之后的新词数。 */
  deferredNewCount: number
  /** 今天已经完成第1遍的词数。 */
  learnedTodayCount: number
}

function byPosition(a: QueueWord, b: QueueWord): number {
  return a.pageNumber - b.pageNumber || a.rowNo - b.rowNo
}

export function buildTodayQueue(
  words: QueueWord[],
  today: DateStr,
  dailyNewLimit: number
): TodayQueue {
  const reviews: { word: QueueWord; item: QueueItem }[] = []
  const fresh: QueueWord[] = []
  let learnedTodayCount = 0

  for (const word of words) {
    if (word.learnedOn === today) learnedTodayCount++
    if (word.status === 'new') {
      fresh.push(word)
      continue
    }
    const schedule = getSchedule(word, word.checks, today)
    if (schedule.nextStage === null || !schedule.isDue || schedule.dueOn === null) continue
    reviews.push({
      word,
      item: {
        wordId: word.id,
        kind: 'review',
        stage: schedule.nextStage,
        dueOn: schedule.dueOn,
        overdueDays: schedule.overdueDays,
        missedStages: schedule.missedStages
      }
    })
  }

  reviews.sort(
    (a, b) =>
      b.item.overdueDays - a.item.overdueDays ||
      Number(b.word.starred) - Number(a.word.starred) ||
      b.word.lapses - a.word.lapses ||
      byPosition(a.word, b.word)
  )

  fresh.sort(byPosition)
  const newSlots = Math.max(0, dailyNewLimit - learnedTodayCount)
  const admitted = fresh.slice(0, newSlots)

  const items: QueueItem[] = [
    ...reviews.map((r) => r.item),
    ...admitted.map<QueueItem>((w) => ({
      wordId: w.id,
      kind: 'new',
      stage: 0,
      dueOn: today,
      overdueDays: 0,
      missedStages: []
    }))
  ]

  return {
    items,
    reviewCount: reviews.length,
    newCount: admitted.length,
    overdueCount: reviews.filter((r) => r.item.overdueDays > 0).length,
    deferredNewCount: fresh.length - admitted.length,
    learnedTodayCount
  }
}

export const SECONDS_PER_WORD = 8

/** 预计用时：每个词按 8 秒估算，四舍五入到分钟；有词时至少 1 分钟。 */
export function estimateMinutes(count: number): number {
  if (count <= 0) return 0
  return Math.max(1, Math.round((count * SECONDS_PER_WORD) / 60))
}

// ---------------------------------------------------------------------------
// 本轮（复习会话）

export interface SessionCard {
  /** 在本轮中唯一，用作 React key。 */
  key: number
  wordId: string
  isRetry: boolean
}

export interface SessionAnswer {
  wordId: string
  grade: Grade
  isRetry: boolean
  /** 对应的 review_log id，撤销时用。 */
  logId: string
}

export interface SessionState {
  cards: SessionCard[]
  index: number
  firstTotal: number
  answers: SessionAnswer[]
  skipped: string[]
  nextKey: number
}

export function startSession(wordIds: string[]): SessionState {
  return {
    cards: wordIds.map((wordId, i) => ({ key: i, wordId, isRetry: false })),
    index: 0,
    firstTotal: wordIds.length,
    answers: [],
    skipped: [],
    nextKey: wordIds.length
  }
}

export function currentCard(state: SessionState): SessionCard | null {
  return state.cards[state.index] ?? null
}

export function isSessionFinished(state: SessionState): boolean {
  return state.index >= state.cards.length
}

/** 第一次作答：评 1 或 2 需要重现；重现时：评 1 继续重现，≥ 2 结束。 */
export function needsRetry(grade: Grade, isRetry: boolean): boolean {
  return isRetry ? grade === 1 : grade <= 2
}

export function answerCard(state: SessionState, grade: Grade, logId: string): SessionState {
  const card = currentCard(state)
  if (!card) throw new Error('本轮已经结束')
  const cards = [...state.cards]
  let nextKey = state.nextKey
  if (needsRetry(grade, card.isRetry)) {
    cards.push({ key: nextKey++, wordId: card.wordId, isRetry: true })
  }
  return {
    ...state,
    cards,
    index: state.index + 1,
    nextKey,
    answers: [...state.answers, { wordId: card.wordId, grade, isRetry: card.isRetry, logId }]
  }
}

/** 跳过当前卡片所在的词：本轮不再出现（包括它尚未出现的重现）。 */
export function skipCard(state: SessionState): SessionState {
  const card = currentCard(state)
  if (!card) return state
  const before = state.cards.slice(0, state.index)
  const after = state.cards.slice(state.index).filter((c) => c.wordId !== card.wordId)
  return {
    ...state,
    cards: [...before, ...after],
    skipped: state.skipped.includes(card.wordId) ? state.skipped : [...state.skipped, card.wordId]
  }
}

export function firstAnsweredCount(state: SessionState): number {
  return state.answers.filter((a) => !a.isRetry).length
}

/**
 * 进度的分母：第一次作答的总数，去掉在第一次作答前就被跳过的词。
 */
export function firstTargetCount(state: SessionState): number {
  const answeredFirst = new Set(state.answers.filter((a) => !a.isRetry).map((a) => a.wordId))
  const skippedBeforeAnswer = state.skipped.filter((id) => !answeredFirst.has(id)).length
  return state.firstTotal - skippedBeforeAnswer
}

export interface SessionUndo {
  /** 回退后的本轮状态（回到那张卡片）。 */
  state: SessionState
  /** 回退后仍然有效的历史。 */
  history: SessionState[]
  /** 被撤销的第一次作答。 */
  first: SessionAnswer
  /** 在它之后发生的重现作答（它们的 review_log 也要删掉）。 */
  laterRetries: SessionAnswer[]
}

/**
 * 撤销上一次“第一次作答”。history 是每次作答 / 跳过之前的状态，按时间顺序排列。
 */
export function undoLastFirstAnswer(
  history: SessionState[],
  current: SessionState
): SessionUndo | null {
  let p = -1
  for (let i = current.answers.length - 1; i >= 0; i--) {
    if (!current.answers[i].isRetry) {
      p = i
      break
    }
  }
  if (p < 0) return null
  // 找到“即将作出第 p 个回答”时的状态：answers 长度为 p，且是最晚的那一个。
  let h = -1
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].answers.length === p) {
      h = i
      break
    }
  }
  if (h < 0) return null
  return {
    state: history[h],
    history: history.slice(0, h),
    first: current.answers[p],
    laterRetries: current.answers.slice(p + 1)
  }
}
