/**
 * 词库（用户自己录入的单词）：列表条目的派生、筛选、搜索、排序。纯函数，渲染进程和测试共用。
 */
import { compareDates, type DateStr } from './dates'
import { getSchedule, type CheckRecord, type WordSchedState, type WordStatus } from './scheduler'

export type LibraryFilter =
  'all' | 'due' | 'overdue' | 'starred' | 'new' | 'learning' | 'mastered' | 'lapsed' | 'trash'

export const LIBRARY_FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'due', label: '今日到期' },
  { id: 'overdue', label: '拖欠' },
  { id: 'starred', label: '难词' },
  { id: 'new', label: '新词' },
  { id: 'learning', label: '学习中' },
  { id: 'mastered', label: '已掌握' },
  { id: 'lapsed', label: '需要重学' },
  { id: 'trash', label: '回收站' }
]

export type LibrarySort = 'entry' | 'alpha' | 'due' | 'lapses'

export const LIBRARY_SORTS: { id: LibrarySort; label: string }[] = [
  { id: 'entry', label: '录入顺序' },
  { id: 'alpha', label: '字母' },
  { id: 'due', label: '下次复习日期' },
  { id: 'lapses', label: '错误次数' }
]

export const STATUS_LABELS: Record<WordStatus, string> = {
  new: '新词',
  learning: '学习中',
  mastered: '已掌握',
  lapsed: '需要重学'
}

export interface LibraryWordInput extends WordSchedState {
  id: string
  text: string
  meaning: string
  pos: string
  pageNumber: number
  rowNo: number
  checks: CheckRecord[]
  deleted: boolean
}

export interface LibraryItem {
  id: string
  text: string
  status: WordStatus
  starred: boolean
  lapses: number
  pageNumber: number
  deleted: boolean
  /** 录入顺序（页码、行号）里的位置 */
  order: number
  /** 下一个复习节点的日期；新词、已掌握、需要重学为 null */
  dueOn: DateStr | null
  /** 今天到期（含拖欠）的复习词 */
  isDue: boolean
  isOverdue: boolean
  /** 搜索用：单词 + 词性 + 词义，小写 */
  haystack: string
}

export function toLibraryItems(words: LibraryWordInput[], today: DateStr): LibraryItem[] {
  return [...words]
    .sort((a, b) => a.pageNumber - b.pageNumber || a.rowNo - b.rowNo)
    .map((w, order) => {
      const s = w.status === 'learning' ? getSchedule(w, w.checks, today) : null
      return {
        id: w.id,
        text: w.text,
        status: w.status,
        starred: w.starred,
        lapses: w.lapses,
        pageNumber: w.pageNumber,
        deleted: w.deleted,
        order,
        dueOn: s?.dueOn ?? null,
        isDue: s?.isDue ?? false,
        isOverdue: s?.isOverdue ?? false,
        haystack: `${w.text}\n${w.pos} ${w.meaning}`.toLowerCase()
      }
    })
}

export function matchesFilter(item: LibraryItem, filter: LibraryFilter): boolean {
  if (filter === 'trash') return item.deleted
  if (item.deleted) return false
  switch (filter) {
    case 'all':
      return true
    case 'due':
      return item.isDue
    case 'overdue':
      return item.isOverdue
    case 'starred':
      return item.starred
    default:
      return item.status === filter
  }
}

export function filterCounts(items: LibraryItem[]): Record<LibraryFilter, number> {
  const counts = Object.fromEntries(LIBRARY_FILTERS.map((f) => [f.id, 0])) as Record<
    LibraryFilter,
    number
  >
  for (const item of items) {
    for (const f of LIBRARY_FILTERS) if (matchesFilter(item, f.id)) counts[f.id]++
  }
  return counts
}

/** 同时匹配单词和词义，不区分大小写；空白分隔的多个词都要出现。 */
export function matchesQuery(item: LibraryItem, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return terms.every((t) => item.haystack.includes(t))
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export function sortItems(items: LibraryItem[], sort: LibrarySort): LibraryItem[] {
  const out = [...items]
  switch (sort) {
    case 'entry':
      return out.sort((a, b) => a.order - b.order)
    case 'alpha':
      return out.sort((a, b) => collator.compare(a.text, b.text) || a.order - b.order)
    case 'due':
      // 没有下次复习日期的排最后
      return out.sort((a, b) => {
        if (a.dueOn === b.dueOn) return a.order - b.order
        if (a.dueOn === null) return 1
        if (b.dueOn === null) return -1
        return compareDates(a.dueOn, b.dueOn) || a.order - b.order
      })
    case 'lapses':
      return out.sort((a, b) => b.lapses - a.lapses || a.order - b.order)
  }
}

export function queryItems(
  items: LibraryItem[],
  filter: LibraryFilter,
  query: string,
  sort: LibrarySort
): LibraryItem[] {
  const q = query.trim()
  return sortItems(
    items.filter((i) => matchesFilter(i, filter) && (q === '' || matchesQuery(i, q))),
    sort
  )
}
