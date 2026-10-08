/**
 * 多栏排版的 DOM 测量：
 * - countColumns：一章排了几栏（= 几页）；
 * - scanPages：每一页第一个字的“块 + 偏移”（块跨页时在块内二分查找第一个落在下一页的字）；
 * - blockColumn：某个块从第几页开始（目录页码用）；
 * - caretAt：屏幕坐标 → 文字位置（caretPositionFromPoint，旧接口兜底）。
 * 所有 x 都相对多栏容器自己的左边（容器被 translate 平移时一起平移，结果不受影响）。
 */
import { PageIndex, columnOf } from '@shared/domain/pagination'
import { blockIndexOf, domPointAt } from './domText'

export function countColumns(flow: HTMLElement, stride: number, gap: number): number {
  return Math.max(1, Math.round((flow.scrollWidth + gap) / stride))
}

function visibleRects(el: Element): DOMRect[] {
  return Array.from(el.getClientRects()).filter((r) => r.width > 0 || r.height > 0)
}

/** 块内第 offset 个字所在的列；空白字符没有矩形时返回 null */
function charColumn(el: HTMLElement, offset: number, base: number, stride: number): number | null {
  const a = domPointAt(el, offset)
  const b = domPointAt(el, offset + 1)
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  const rect = Array.from(range.getClientRects()).find((r) => r.width > 0)
  return rect ? columnOf(rect.left - base, stride) : null
}

/** 块里第一个落在第 page 页（或之后）的字 */
function firstOffsetOn(el: HTMLElement, page: number, base: number, stride: number): number {
  const len = el.textContent?.length ?? 0
  let lo = 0
  let hi = len
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    // 空白没有矩形：往后找最近的有矩形的字
    let col: number | null = null
    for (let k = mid; k < Math.min(len, mid + 8) && col === null; k++)
      col = charColumn(el, k, base, stride)
    if (col !== null && col >= page) hi = mid
    else lo = mid + 1
  }
  return Math.min(lo, len)
}

export function scanPages(
  flow: HTMLElement,
  chapter: number,
  stride: number,
  gap: number
): PageIndex {
  const base = flow.getBoundingClientRect().left
  const starts: { block: number; offset: number }[] = [{ block: 0, offset: 0 }]
  let page = 0
  for (const el of flow.querySelectorAll<HTMLElement>('[data-b]')) {
    const rects = visibleRects(el)
    if (rects.length === 0) continue
    const b = blockIndexOf(el)
    const first = columnOf(rects[0].left - base, stride)
    const last = rects.reduce((m, r) => Math.max(m, columnOf(r.left - base, stride)), first)
    while (page < first) {
      page++
      starts.push({ block: b, offset: 0 })
    }
    while (page < last) {
      page++
      starts.push({ block: b, offset: firstOffsetOn(el, page, base, stride) })
    }
  }
  const count = Math.max(countColumns(flow, stride, gap), starts.length)
  // 末尾的空白页（比如最后一个块是分页符）：开头记成全章最后一个位置
  while (starts.length < count) starts.push({ ...starts[starts.length - 1] })
  return new PageIndex(chapter, starts)
}

/** 块从第几页开始；块不在这一章里返回 null */
export function blockColumn(flow: HTMLElement, block: number, stride: number): number | null {
  const el = flow.querySelector(`[data-b="${block}"]`)
  if (!el) return null
  const rect = visibleRects(el)[0]
  if (!rect) return null
  return columnOf(rect.left - flow.getBoundingClientRect().left, stride)
}

export interface Caret {
  node: Node
  offset: number
}

export function caretAt(x: number, y: number): Caret | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : null
  }
  const r = document.caretRangeFromPoint(x, y)
  return r ? { node: r.startContainer, offset: r.startOffset } : null
}

/** 点 (x, y) 是否落在 Range 的某个矩形里（留 2px 余量） */
export function rangeContains(range: Range, x: number, y: number): DOMRect | null {
  for (const r of range.getClientRects()) {
    if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return r
  }
  return null
}
