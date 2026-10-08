/**
 * 从数据快照派生界面需要的结构（纯函数，渲染进程和测试共用）。
 */
import type { Page, Snapshot, Word, WordCheck } from './api'
import type { DateStr } from './domain/dates'
import { buildTodayQueue, type QueueWord, type TodayQueue } from './domain/queue'
import type { CheckRecord } from './domain/scheduler'

export function checksByWord(checks: WordCheck[]): Map<string, CheckRecord[]> {
  const map = new Map<string, CheckRecord[]>()
  for (const { wordId, ...c } of checks) {
    const list = map.get(wordId)
    if (list) list.push(c)
    else map.set(wordId, [c])
  }
  return map
}

export function pageById(pages: Page[]): Map<string, Page> {
  return new Map(pages.map((p) => [p.id, p]))
}

export function toQueueWords(snapshot: Pick<Snapshot, 'pages' | 'words' | 'checks'>): QueueWord[] {
  const pages = pageById(snapshot.pages)
  const checks = checksByWord(snapshot.checks)
  return snapshot.words.map((w: Word) => ({
    id: w.id,
    pageNumber: pages.get(w.pageId)?.number ?? 0,
    rowNo: w.rowNo,
    status: w.status,
    learnedOn: w.learnedOn,
    lapses: w.lapses,
    starred: w.starred,
    checks: checks.get(w.id) ?? []
  }))
}

export function queueFromSnapshot(snapshot: Snapshot, day: DateStr = snapshot.today): TodayQueue {
  return buildTodayQueue(toQueueWords(snapshot), day, snapshot.settings.dailyNewLimit)
}
