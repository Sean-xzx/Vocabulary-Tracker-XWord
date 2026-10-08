import { describe, expect, it } from 'vitest'
import { PAGE_SIZE, planPlacements } from './pages'

const TODAY = '2024-06-10'

describe('单词页', () => {
  it('每页 27 行', () => {
    expect(PAGE_SIZE).toBe(27)
  })

  it('空库：新建第 1 页', () => {
    const plan = planPlacements([], TODAY, 2)
    expect(plan.newPages).toEqual([{ number: 1, startedOn: TODAY }])
    expect(plan.placements).toEqual([
      { pageNumber: 1, rowNo: 1 },
      { pageNumber: 1, rowNo: 2 }
    ])
  })

  it('写进今天创建、而且还没写满的那一页', () => {
    const plan = planPlacements(
      [{ number: 1, startedOn: TODAY, activeCount: 5, maxRowNo: 5 }],
      TODAY,
      1
    )
    expect(plan.newPages).toEqual([])
    expect(plan.placements).toEqual([{ pageNumber: 1, rowNo: 6 }])
  })

  it('最新一页不是今天创建的：新建一页（即使它没写满）', () => {
    const plan = planPlacements(
      [{ number: 3, startedOn: '2024-06-09', activeCount: 4, maxRowNo: 4 }],
      TODAY,
      1
    )
    expect(plan.newPages).toEqual([{ number: 4, startedOn: TODAY }])
    expect(plan.placements).toEqual([{ pageNumber: 4, rowNo: 1 }])
  })

  it('一页刚好写满 27 个词后，新词进入下一页', () => {
    const plan = planPlacements(
      [{ number: 1, startedOn: TODAY, activeCount: 26, maxRowNo: 26 }],
      TODAY,
      3
    )
    expect(plan.placements).toEqual([
      { pageNumber: 1, rowNo: 27 },
      { pageNumber: 2, rowNo: 1 },
      { pageNumber: 2, rowNo: 2 }
    ])
    expect(plan.newPages).toEqual([{ number: 2, startedOn: TODAY }])
  })

  it('从空库连续录入 30 个词：第 1 页 27 个，第 2 页 3 个', () => {
    const plan = planPlacements([], TODAY, 30)
    expect(plan.placements.filter((p) => p.pageNumber === 1)).toHaveLength(27)
    expect(plan.placements.filter((p) => p.pageNumber === 2)).toHaveLength(3)
    expect(plan.newPages.map((p) => p.number)).toEqual([1, 2])
  })

  it('软删除的词不占行数，但 row_no 继续递增以保持顺序', () => {
    // 写过 27 行，其中 2 个被软删除：还剩 2 个空位
    const plan = planPlacements(
      [{ number: 1, startedOn: TODAY, activeCount: 25, maxRowNo: 27 }],
      TODAY,
      3
    )
    expect(plan.placements).toEqual([
      { pageNumber: 1, rowNo: 28 },
      { pageNumber: 1, rowNo: 29 },
      { pageNumber: 2, rowNo: 1 }
    ])
  })

  it('今天有多页未写满时，先填页码小的', () => {
    const plan = planPlacements(
      [
        { number: 1, startedOn: TODAY, activeCount: 26, maxRowNo: 27 },
        { number: 2, startedOn: TODAY, activeCount: 3, maxRowNo: 3 }
      ],
      TODAY,
      1
    )
    expect(plan.placements).toEqual([{ pageNumber: 1, rowNo: 28 }])
  })
})
