/**
 * 书页分页的纯逻辑。页码只根据当前排版临时算出来，存下来的永远是锚点（章节 + 块 + 字符偏移；PDF 是页 + 文字层偏移）。
 * - PageIndex：一章排好版后，每一页“第一个字”的锚点（由 DOM 扫描得出）→ 锚点所在页、某页开头的锚点；
 * - 双页：每章从右页开始（第一页单独在右侧，和纸质书一样），左边留空白页；最后一页落在左边时右边留空白；
 * - 全书页码 = 前面各章页数之和 + 本章页序（空白页不编号）；
 * - 书页尺寸：高 = 可用高度 − 上下各 24px，宽 = 高 × 0.68，不超过可用宽度（双页时一半）。
 */

export interface Anchor {
  chapter: number
  block: number
  offset: number
}

export function compareAnchor(a: Anchor, b: Anchor): number {
  return a.chapter - b.chapter || a.block - b.block || a.offset - b.offset
}

/** 一章的分页结果：starts[i] 是第 i 页第一个字的位置（块 + 偏移），按先后排列 */
export class PageIndex {
  constructor(
    readonly chapter: number,
    readonly starts: readonly { block: number; offset: number }[]
  ) {}

  get count(): number {
    return Math.max(1, this.starts.length)
  }

  /** 锚点所在的页：最后一个“开头 ≤ 锚点”的页 */
  pageOf(a: { block: number; offset: number }): number {
    let lo = 0
    let hi = this.starts.length - 1
    let found = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const s = this.starts[mid]
      if (s.block < a.block || (s.block === a.block && s.offset <= a.offset)) {
        found = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return found
  }

  /** 某页开头的锚点 */
  startOf(page: number): Anchor {
    const s = this.starts[Math.max(0, Math.min(page, this.starts.length - 1))] ?? {
      block: 0,
      offset: 0
    }
    return { chapter: this.chapter, ...s }
  }
}

// ---------------------------------------------------------------- 单页 / 双页

/** 双页时可见的两个页序（-1 = 空白页）；单页时只有一个 */
export function visiblePages(page: number, count: number, double: boolean): number[] {
  if (!double) return [page]
  if (page <= 0) return [-1, 0]
  const left = page % 2 === 1 ? page : page - 1
  return [left, left + 1 < count ? left + 1 : -1]
}

/** 这一屏第一个真实页（双页时章首那一屏是右页） */
export function firstVisible(page: number, count: number, double: boolean): number {
  return visiblePages(page, count, double).find((p) => p >= 0) ?? 0
}

/** 这一屏最后一个真实页 */
export function lastVisible(page: number, count: number, double: boolean): number {
  const v = visiblePages(page, count, double).filter((p) => p >= 0)
  return v[v.length - 1] ?? 0
}

export interface PagePos {
  chapter: number
  page: number
}

/** 下一屏；本章读完进入下一章第一页；全书最后一屏返回 null */
export function nextScreen(
  pos: PagePos,
  counts: readonly (number | null)[],
  double: boolean
): PagePos | null {
  const count = counts[pos.chapter] ?? 1
  const last = lastVisible(pos.page, count, double)
  if (last + 1 < count) return { chapter: pos.chapter, page: last + 1 }
  if (pos.chapter + 1 < counts.length) return { chapter: pos.chapter + 1, page: 0 }
  return null
}

/** 上一屏；本章第一屏回到上一章的最后一屏（需要知道上一章的页数，未知时按 1 页） */
export function prevScreen(
  pos: PagePos,
  counts: readonly (number | null)[],
  double: boolean
): PagePos | null {
  const count = counts[pos.chapter] ?? 1
  const first = firstVisible(pos.page, count, double)
  if (first > 0) return { chapter: pos.chapter, page: first - 1 }
  if (pos.chapter > 0) {
    const prev = counts[pos.chapter - 1] ?? 1
    return { chapter: pos.chapter - 1, page: prev - 1 }
  }
  return null
}

/** 全书页码（从 1 开始）；前面有章节还没排版时返回 null */
export function globalPage(counts: readonly (number | null)[], pos: PagePos): number | null {
  let n = 0
  for (let i = 0; i < pos.chapter; i++) {
    const c = counts[i]
    if (c === null || c === undefined) return null
    n += c
  }
  return n + pos.page + 1
}

export function totalPages(counts: readonly (number | null)[]): number | null {
  let n = 0
  for (const c of counts) {
    if (c === null || c === undefined) return null
    n += c
  }
  return n
}

/** 全书第 n 页（从 1 开始）在哪一章第几页；需要的章节页数未知时返回 null */
export function locatePage(counts: readonly (number | null)[], n: number): PagePos | null {
  let rest = Math.max(1, Math.floor(n))
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i]
    if (c === null || c === undefined) return null
    if (rest <= c) return { chapter: i, page: rest - 1 }
    rest -= c
  }
  const last = counts.length - 1
  return last >= 0 ? { chapter: last, page: (counts[last] ?? 1) - 1 } : null
}

// ---------------------------------------------------------------- 书页尺寸

export type MarginSize = 'narrow' | 'medium' | 'wide'

/** 页面内边距（左右 / 上下，px）：窄 40/48、中 56/64、宽 72/80 */
export const PAGE_MARGINS: Record<MarginSize, { x: number; y: number }> = {
  narrow: { x: 40, y: 48 },
  medium: { x: 56, y: 64 },
  wide: { x: 72, y: 80 }
}

export const PAGE_ASPECT = 0.68
export const PAGE_OUTER_GAP = 24
/** 窗口宽度达到这个值时默认双页 */
export const DOUBLE_MIN_WIDTH = 1100

export interface PageGeometry {
  pageW: number
  pageH: number
  padX: number
  padY: number
  contentW: number
  contentH: number
  /** 相邻两页正文之间的距离（= 一页宽），多栏排版的列距是 2 × padX */
  stride: number
  double: boolean
}

export function pageGeometry(
  availW: number,
  availH: number,
  double: boolean,
  margin: MarginSize
): PageGeometry {
  const { x, y } = PAGE_MARGINS[margin]
  const pageH = Math.max(320, Math.floor(availH - 2 * PAGE_OUTER_GAP))
  const maxW = Math.floor((availW - 2 * PAGE_OUTER_GAP) / (double ? 2 : 1))
  const pageW = Math.max(280, Math.min(Math.floor(pageH * PAGE_ASPECT), maxW))
  const padX = Math.min(x, Math.floor(pageW / 6))
  return {
    pageW,
    pageH,
    padX,
    padY: y,
    contentW: pageW - 2 * padX,
    contentH: pageH - 2 * y,
    stride: pageW,
    double
  }
}

/** 多栏排版里，某个矩形（相对章节容器原点的 x）落在第几页 */
export function columnOf(x: number, stride: number): number {
  return Math.max(0, Math.floor((x + 1) / stride))
}
