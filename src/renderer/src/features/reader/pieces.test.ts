import { describe, expect, it } from 'vitest'
import { rangeInBlock } from '@shared/domain/book'
import { buildPieces } from './pieces'

const block = {
  k: 'p' as const,
  c: [{ t: 'He went ' }, { t: 'home', i: 1 as const }, { t: ", didn't he? 1990s" }]
}

describe('正文片段', () => {
  it('只有单词本里的词和到期的词单独成片并加标记；行内格式保留', () => {
    const pieces = buildPieces(block, (w) => (w === 'went' ? 'meet' : w === 'home' ? 'due' : null))
    expect(pieces.map((p) => [p.text, p.mark, !!p.run.i])).toEqual([
      ['He ', null, false],
      ['went', 'meet', false],
      [' ', null, false],
      ['home', 'due', true],
      [", didn't he? 1990s", null, false]
    ])
  })

  it('高亮切开片段', () => {
    const pieces = buildPieces(block, null, [{ id: 'h', color: 'green', start: 5, end: 10 }])
    expect(pieces.filter((p) => p.highlight).map((p) => p.text)).toEqual(['nt ', 'ho'])
    expect(pieces.find((p) => p.text === 'me')?.highlight).toBeNull()
  })

  it('改字号后高亮锚点保持稳定：锚点是“章节 + 块 + 偏移”，落在每一块里的范围只取决于文字', () => {
    const start = { chapter: 2, block: 3, offset: 5 }
    const end = { chapter: 2, block: 5, offset: 4 }
    const lengths = [10, 20, 30, 40, 50, 60]
    const ranges = (): unknown => lengths.map((len, b) => rangeInBlock(start, end, 2, b, len))
    const before = ranges()
    expect(ranges()).toEqual(before)
    expect(before).toEqual([null, null, null, [5, 40], [0, 50], [0, 4]])
    expect(rangeInBlock(start, end, 1, 3, 40)).toBeNull()
    expect(rangeInBlock(start, end, 2, 6, 70)).toBeNull()
  })
})
