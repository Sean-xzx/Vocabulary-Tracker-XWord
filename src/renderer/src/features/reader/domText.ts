/**
 * 正文 DOM 与“块 + 字符偏移”之间的换算。每个块是一个带 data-b（块下标）的元素，里面只有文字和包着文字的 span，
 * 所以“块内偏移”= 块里在这个位置之前的文字长度。与字号、行高、版心宽度无关。
 */

export function blockElementOf(node: Node | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  return el?.closest<HTMLElement>('[data-b]') ?? null
}

export function blockIndexOf(el: HTMLElement): number {
  return Number(el.dataset.b)
}

/** DOM 里的一个位置（容器 + 偏移，和 Range 的端点一样）→ 块内字符偏移 */
export function offsetInBlock(blockEl: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(blockEl)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return range.toString().length
}

/** 块内字符偏移 → DOM 位置（文字节点 + 偏移）；超出时落在块尾 */
export function domPointAt(blockEl: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT)
  let rest = offset
  let last: Text | null = null
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (rest <= n.data.length) return { node: n, offset: rest }
    rest -= n.data.length
    last = n
  }
  return last ? { node: last, offset: last.data.length } : { node: blockEl, offset: 0 }
}

/** 块内 [start, end) 这段文字的 Range */
export function rangeInBlockEl(blockEl: HTMLElement, start: number, end: number): Range {
  const a = domPointAt(blockEl, start)
  const b = domPointAt(blockEl, end)
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  return range
}

export interface DomPosition {
  block: number
  offset: number
}

/** Range 的一个端点 → 块 + 偏移；端点不在任何块里时返回 null */
export function positionOf(node: Node, offset: number): DomPosition | null {
  const el = blockElementOf(node)
  if (!el) return null
  return { block: blockIndexOf(el), offset: offsetInBlock(el, node, offset) }
}
