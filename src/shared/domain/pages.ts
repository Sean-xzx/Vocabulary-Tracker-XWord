/**
 * 单词页：每页 27 行；新词写进“今天创建、而且还没写满”的那一页，没有就新建一页。
 */
import type { DateStr } from './dates'

export const PAGE_SIZE = 27

export interface PageFill {
  number: number
  startedOn: DateStr
  /** 没有被软删除的词数。 */
  activeCount: number
  /** 本页已用过的最大 row_no（包括软删除的词），新词接在后面，保证排序稳定。 */
  maxRowNo: number
}

export interface Placement {
  pageNumber: number
  rowNo: number
}

export interface PlacementPlan {
  placements: Placement[]
  /** 需要新建的页（按页码升序）。 */
  newPages: { number: number; startedOn: DateStr }[]
}

export function planPlacements(pages: PageFill[], today: DateStr, count: number): PlacementPlan {
  const state = new Map<number, PageFill>(pages.map((p) => [p.number, { ...p }]))
  let maxNumber = pages.reduce((m, p) => Math.max(m, p.number), 0)
  const newPages: PlacementPlan['newPages'] = []
  const placements: Placement[] = []

  const findOpenToday = (): PageFill | undefined =>
    [...state.values()]
      .filter((p) => p.startedOn === today && p.activeCount < PAGE_SIZE)
      .sort((a, b) => a.number - b.number)[0]

  for (let i = 0; i < count; i++) {
    let page = findOpenToday()
    if (!page) {
      maxNumber += 1
      page = { number: maxNumber, startedOn: today, activeCount: 0, maxRowNo: 0 }
      state.set(page.number, page)
      newPages.push({ number: page.number, startedOn: today })
    }
    page.activeCount += 1
    page.maxRowNo += 1
    placements.push({ pageNumber: page.number, rowNo: page.maxRowNo })
  }

  return { placements, newPages }
}
