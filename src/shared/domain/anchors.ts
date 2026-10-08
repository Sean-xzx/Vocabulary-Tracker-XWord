/**
 * 旧锚点 → 新锚点。书按新解析器重新解析后，“章节 + 块 + 偏移”里的块下标、章节划分都可能变了（拆章、合并首字母、
 * 新增图片块……），但原文没变。所以按原文定位：取旧锚点前后各一小段文字（只留字母和数字、统一小写），
 * 在新的全书文字里找到它，换算成新的锚点。同一段文字出现多次时，取在全书中的相对位置最接近的那一处。
 * 找不到的返回 null，由调用方落到章首并计数。
 */
import { blockText, type Chapter } from './book'

export interface Anchor {
  chapter: number
  block: number
  offset: number
}

const CONTEXT = 40
const MIN_KEY = 8

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch)
}

function norm(s: string): string {
  let out = ''
  for (const ch of s) if (isWordChar(ch)) out += ch.toLowerCase()
  return out
}

/** 一本书的“只留字母数字”的全文，以及每个字符在原书里的位置 */
class BookText {
  text = ''
  chapter: number[] = []
  block: number[] = []
  offset: number[] = []
  /** 每一章在 text 里的起点 */
  chapterStart: number[] = []

  constructor(chapters: Chapter[]) {
    const parts: string[] = []
    chapters.forEach((c, ci) => {
      this.chapterStart.push(this.chapter.length)
      c.blocks.forEach((b, bi) => {
        const t = blockText(b)
        let i = 0
        for (const ch of t) {
          if (isWordChar(ch)) {
            const low = ch.toLowerCase()
            parts.push(low)
            for (let k = 0; k < low.length; k++) {
              this.chapter.push(ci)
              this.block.push(bi)
              this.offset.push(i)
            }
          }
          i += ch.length
        }
      })
    })
    this.text = parts.join('')
  }

  get length(): number {
    return this.text.length
  }
}

export class AnchorMapper {
  private readonly from: BookText
  private readonly to: BookText
  /** 旧书每一块在旧全文里的起点（估计相对位置用） */
  private readonly oldBlockStart = new Map<string, number>()

  constructor(
    private readonly oldChapters: Chapter[],
    private readonly newChapters: Chapter[]
  ) {
    this.from = new BookText(oldChapters)
    this.to = new BookText(newChapters)
    for (let i = this.from.length - 1; i >= 0; i--)
      this.oldBlockStart.set(`${this.from.chapter[i]}:${this.from.block[i]}`, i)
  }

  /** 新文字里第 i 个字符的位置；i 等于某块最后一个字符之后时落在块尾 */
  private at(i: number, after: boolean): Anchor {
    const t = this.to
    if (t.length === 0) return { chapter: 0, block: 0, offset: 0 }
    if (after) {
      const k = Math.max(0, Math.min(i - 1, t.length - 1))
      return { chapter: t.chapter[k], block: t.block[k], offset: t.offset[k] + 1 }
    }
    const k = Math.max(0, Math.min(i, t.length - 1))
    return { chapter: t.chapter[k], block: t.block[k], offset: t.offset[k] }
  }

  /** key 在新全文里、最接近相对位置 ratio 的出现位置 */
  private search(key: string, ratio: number): number {
    const text = this.to.text
    let best = -1
    let bestDist = Infinity
    let from = 0
    for (let n = 0; n < 200; n++) {
      const i = text.indexOf(key, from)
      if (i < 0) break
      const dist = Math.abs(i / Math.max(1, text.length) - ratio)
      if (dist < bestDist) {
        best = i
        bestDist = dist
      }
      from = i + 1
    }
    return best
  }

  map(pos: Anchor): Anchor | null {
    const chapter = this.oldChapters[pos.chapter]
    if (!chapter || chapter.blocks.length === 0) return null
    // 没有文字的块（分隔线、图片）：用后面第一个有文字的块的开头
    let bi = Math.max(0, Math.min(pos.block, chapter.blocks.length - 1))
    let offset = pos.offset
    while (bi < chapter.blocks.length && norm(blockText(chapter.blocks[bi])) === '') {
      bi++
      offset = 0
    }
    if (bi >= chapter.blocks.length) return null
    const t = blockText(chapter.blocks[bi])
    const clamped = Math.max(0, Math.min(offset, t.length))
    const before = norm(t.slice(0, clamped)).slice(-CONTEXT)
    const after = norm(t.slice(clamped)).slice(0, CONTEXT)
    const start = this.oldBlockStart.get(`${pos.chapter}:${bi}`) ?? 0
    const ratio = (start + before.length) / Math.max(1, this.from.length)
    const tries: { key: string; shift: number }[] = [
      { key: before + after, shift: before.length },
      { key: after, shift: 0 },
      { key: before, shift: before.length }
    ]
    // 锚点和最近的字母数字之间的标点、空白（换算后照原样补上）
    let a = clamped
    while (a > 0 && !isWordChar(t[a - 1])) a--
    const gapBefore = t.slice(a, clamped)
    let z = clamped
    while (z < t.length && !isWordChar(t[z])) z++
    const gapAfter = t.slice(clamped, z)
    for (const { key, shift } of tries) {
      if (key === '' || key.length < Math.min(MIN_KEY, before.length + after.length)) continue
      const i = this.search(key, ratio)
      if (i < 0) continue
      if (shift > 0) {
        // 以前面的文字为准：落在它最后一个字符之后，再补上中间的标点
        const r = this.at(i + shift, true)
        const nt = this.textOf(r)
        return nt.slice(r.offset, r.offset + gapBefore.length) === gapBefore
          ? { ...r, offset: r.offset + gapBefore.length }
          : r
      }
      const r = this.at(i, false)
      const nt = this.textOf(r)
      return r.offset >= gapAfter.length &&
        nt.slice(r.offset - gapAfter.length, r.offset) === gapAfter
        ? { ...r, offset: r.offset - gapAfter.length }
        : r
    }
    return null
  }

  private textOf(a: Anchor): string {
    const b = this.newChapters[a.chapter]?.blocks[a.block]
    return b ? blockText(b) : ''
  }
}
