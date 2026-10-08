/**
 * PDF 的原版页面模式（纯逻辑部分）。页面用 pdf.js 渲染成 canvas，上面盖一层透明的文字层（和 pdf.js 的 TextLayer 一样）；
 * 查词、选句、高亮、翻译都在文字层上做。锚点是“页码（chapter 字段）+ 0 + 页内文字偏移”。
 * - 页内文字：按文字层的顺序拼接每一项，行尾（hasEOL）加换行——点词时行尾连字符据此合并（effec-⏎tive → effective）；
 * - 扫描版：前 10 页里有 8 页以上几乎没有可提取的文字（页数不足 10 页时按 80% 算）；
 * - 书签（outline）展开成目录项。
 */

export const SCANNED_MESSAGE = '这是扫描版 PDF（页面是图片），无法选中文字，暂不支持'

/** pdf.js getTextContent() 的一项（只用到文字和行尾标记） */
export interface PdfTextItem {
  str?: string
  hasEOL?: boolean
}

/** 一页的文字；starts[i] 是第 i 个文字项（有 str 的项，与文字层的 span 一一对应）在整页文字里的起点 */
export function pageText(items: readonly PdfTextItem[]): { text: string; starts: number[] } {
  let text = ''
  const starts: number[] = []
  for (const item of items) {
    if (item.str === undefined) continue
    starts.push(text.length)
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  return { text, starts }
}

/** 页内偏移 → 第几个文字项、项内偏移（落在换行上时算作上一项的末尾） */
export function locateInPage(
  starts: readonly number[],
  lengths: readonly number[],
  offset: number
): { item: number; offset: number } {
  if (starts.length === 0) return { item: -1, offset: 0 }
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return { item: lo, offset: Math.max(0, Math.min(lengths[lo], offset - starts[lo])) }
}

/** 一页几乎没有可提取的文字：字母、数字少于这个数 */
const EMPTY_PAGE_CHARS = 16
const SAMPLE_PAGES = 10

/** 前几页的文字 → 是不是扫描版（页面是图片） */
export function isScannedPdf(texts: readonly string[]): boolean {
  const sample = texts.slice(0, SAMPLE_PAGES)
  if (sample.length === 0) return true
  const empty = sample.filter(
    (t) => (t.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < EMPTY_PAGE_CHARS
  ).length
  return sample.length >= SAMPLE_PAGES ? empty >= 8 : empty / sample.length >= 0.8
}

export interface OutlineNode {
  title: string
  /** 书签指向的页（从 0 开始）；解析不出来为 null */
  page: number | null
  items: OutlineNode[]
}

/** 书签树 → 目录项（指不到页的书签跳过，它的子项照常保留） */
export function flattenOutline(
  nodes: readonly OutlineNode[],
  depth = 0
): { title: string; chapter: number; block: number; depth: number; group: 'body' }[] {
  const out: { title: string; chapter: number; block: number; depth: number; group: 'body' }[] = []
  for (const n of nodes) {
    const title = n.title.replace(/\s+/g, ' ').trim()
    if (n.page !== null && title)
      out.push({ title, chapter: n.page, block: 0, depth: Math.min(depth, 5), group: 'body' })
    out.push(...flattenOutline(n.items, depth + 1))
  }
  return out
}
