import { describe, expect, it } from 'vitest'
import {
  PageIndex,
  globalPage,
  locatePage,
  nextScreen,
  pageGeometry,
  prevScreen,
  visiblePages
} from './pagination'

/** 模拟排版：按“每页能放多少字”把块依次排进页面，得到每页第一个字的位置 */
function simulate(blocks: number[], perPage: number): PageIndex {
  const starts: { block: number; offset: number }[] = [{ block: 0, offset: 0 }]
  let room = perPage
  blocks.forEach((len, block) => {
    let offset = 0
    while (len - offset > room) {
      offset += room
      starts.push({ block, offset })
      room = perPage
    }
    room -= len - offset
  })
  return new PageIndex(3, starts)
}

/** 字号、窗口尺寸、单双页 → 每页字数（字越大、页越小，每页字越少） */
function capacity(fontSize: number, winW: number, winH: number, double: boolean): number {
  const g = pageGeometry(winW, winH, double, 'medium')
  const perLine = Math.floor(g.contentW / (fontSize * 0.5))
  const lines = Math.floor(g.contentH / (fontSize * 1.6))
  return perLine * lines
}

const BLOCKS = Array.from({ length: 120 }, (_, i) => 40 + ((i * 37) % 900))

describe('PageIndex', () => {
  it('锚点 与 页码往返稳定', () => {
    const idx = simulate(BLOCKS, 1200)
    for (let p = 0; p < idx.count; p++) expect(idx.pageOf(idx.startOf(p))).toBe(p)
  })

  it('改字号、窗口尺寸、单双页后，锚点所在文字仍在显示的那一页上', () => {
    const anchor = { chapter: 3, block: 57, offset: 311 }
    const layouts = [
      [16, 1280, 800, true],
      [19, 1280, 800, true],
      [24, 1280, 800, true],
      [19, 900, 700, false],
      [22, 1600, 1000, true],
      [19, 1280, 800, false]
    ] as const
    for (const [font, w, h, dbl] of layouts) {
      const idx = simulate(BLOCKS, capacity(font, w, h, dbl))
      const page = idx.pageOf(anchor)
      const start = idx.startOf(page)
      const next = page + 1 < idx.count ? idx.startOf(page + 1) : null
      // 这一页从 start 开始，到下一页开头之前结束；锚点在中间
      expect(
        start.block < anchor.block ||
          (start.block === anchor.block && start.offset <= anchor.offset)
      ).toBe(true)
      if (next)
        expect(
          next.block > anchor.block || (next.block === anchor.block && next.offset > anchor.offset)
        ).toBe(true)
      // 反复切换排版，锚点不变（不会越改越偏）
      expect(idx.pageOf(idx.startOf(page))).toBe(page)
    }
  })
})

describe('单页 / 双页翻页', () => {
  it('双页：章首单独在右页，末页落在左页时右侧空白', () => {
    expect(visiblePages(0, 5, true)).toEqual([-1, 0])
    expect(visiblePages(1, 5, true)).toEqual([1, 2])
    expect(visiblePages(2, 5, true)).toEqual([1, 2])
    expect(visiblePages(3, 4, true)).toEqual([3, -1])
    expect(visiblePages(3, 5, false)).toEqual([3])
  })

  it('跨章翻页与全书页码', () => {
    const counts = [3, 4, 2]
    expect(nextScreen({ chapter: 0, page: 0 }, counts, true)).toEqual({ chapter: 0, page: 1 })
    expect(nextScreen({ chapter: 0, page: 1 }, counts, true)).toEqual({ chapter: 1, page: 0 })
    expect(prevScreen({ chapter: 1, page: 0 }, counts, true)).toEqual({ chapter: 0, page: 2 })
    expect(nextScreen({ chapter: 2, page: 1 }, counts, false)).toBeNull()
    expect(globalPage(counts, { chapter: 1, page: 2 })).toBe(6)
    expect(globalPage([3, null, 2], { chapter: 2, page: 0 })).toBeNull()
    expect(locatePage(counts, 6)).toEqual({ chapter: 1, page: 2 })
    expect(locatePage(counts, 99)).toEqual({ chapter: 2, page: 1 })
  })

  it('书页尺寸：高 = 可用高度 − 48，宽 = 高 × 0.68，不超过可用宽度', () => {
    const g = pageGeometry(1280, 712, true, 'medium')
    expect(g.pageH).toBe(664)
    expect(g.pageW).toBe(Math.floor(664 * 0.68))
    expect(g.contentW).toBe(g.pageW - 112)
    const narrow = pageGeometry(400, 712, false, 'wide')
    expect(narrow.pageW).toBe(352)
  })
})
