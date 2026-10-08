/**
 * 把一个块切成渲染用的片段：边界来自行内格式、单词本标记、高亮。
 * 点词不靠片段（用 caretPositionFromPoint 找到点中的字再扩展成单词），所以只有需要标记的单词才单独成片，DOM 更轻。
 * 单词本里的词、今天到期的词加上标记；熟词不加任何标记（由 classify 决定）。
 */
import type { HighlightColor } from '@shared/api'
import type { Block, Inline } from '@shared/domain/book'
import { tokenize } from '@shared/domain/tokenize'

export type MarkKind = 'meet' | 'due'

export interface Piece {
  text: string
  start: number
  run: Inline
  mark: MarkKind | null
  highlight: { id: string; color: HighlightColor; pending: boolean } | null
}

export interface BlockHighlight {
  id: string
  color: HighlightColor
  start: number
  end: number
  /** 刚建好、荧光笔正在划出：先不显示底色 */
  pending?: boolean
}

export function buildPieces(
  block: Block,
  classify: ((word: string) => MarkKind | null) | null,
  highlights: readonly BlockHighlight[] = []
): Piece[] {
  let text = ''
  const runs: { start: number; end: number; run: Inline }[] = []
  for (const r of block.c) {
    runs.push({ start: text.length, end: text.length + r.t.length, run: r })
    text += r.t
  }
  if (text === '') return []
  const cuts = new Set<number>([0, text.length])
  for (const r of runs) cuts.add(r.start)
  const marked: { start: number; end: number; mark: MarkKind }[] = []
  if (classify) {
    const seen = new Map<string, MarkKind | null>()
    for (const t of tokenize(text)) {
      if (!seen.has(t.text)) seen.set(t.text, classify(t.text))
      const mark = seen.get(t.text)
      if (!mark) continue
      marked.push({ start: t.start, end: t.end, mark })
      cuts.add(t.start)
      cuts.add(t.end)
    }
  }
  for (const h of highlights) {
    cuts.add(Math.max(0, Math.min(text.length, h.start)))
    cuts.add(Math.max(0, Math.min(text.length, h.end)))
  }
  const points = [...cuts].sort((a, b) => a - b)
  const pieces: Piece[] = []
  let ri = 0
  let mi = 0
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k]
    const b = points[k + 1]
    if (a === b) continue
    while (ri < runs.length - 1 && runs[ri].end <= a) ri++
    while (mi < marked.length && marked[mi].end <= a) mi++
    const m = marked[mi] && marked[mi].start <= a && a < marked[mi].end ? marked[mi] : null
    const hl = highlights.find((h) => h.start <= a && a < h.end) ?? null
    pieces.push({
      text: text.slice(a, b),
      start: a,
      run: runs[ri].run,
      mark: m?.mark ?? null,
      highlight: hl ? { id: hl.id, color: hl.color, pending: !!hl.pending } : null
    })
  }
  return pieces
}
