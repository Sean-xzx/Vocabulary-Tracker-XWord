import { describe, expect, it } from 'vitest'
import {
  buildWordIndex,
  classifyWord,
  findWordInText,
  lemmaFor,
  normalizeWord,
  tokenize,
  type LemmaOf
} from './tokenize'

/** 模拟词典给出的原形（exchange 的 0: 字段） */
const LEMMAS: Record<string, string> = {
  went: 'go',
  gone: 'go',
  goes: 'go',
  go: 'go',
  mice: 'mouse',
  studies: 'study',
  studied: 'study',
  darcy: 'darcy',
  "it's": "it's"
}
const lemmaOf: LemmaOf = (w) => LEMMAS[w]

describe('分词', () => {
  it("撇号词（it's、don't、O’Brien）和连字符词（well-known）各算一个词；数字和标点不算", () => {
    const text = 'It’s a well-known fact, don’t you think? O’Brien said: 1990s, 42 -- ok.'
    expect(tokenize(text).map((t) => t.text)).toEqual([
      'It’s',
      'a',
      'well-known',
      'fact',
      'don’t',
      'you',
      'think',
      'O’Brien',
      'said',
      'ok'
    ])
    const t = tokenize('say "hello"')[1]
    expect([t.start, t.end]).toEqual([5, 10])
  })

  it('大小写和弯撇号统一后再匹配', () => {
    expect(normalizeWord('Don’t')).toBe("don't")
  })
})

describe('原形匹配', () => {
  const index = buildWordIndex(
    [
      { id: 'w-go', text: 'go' },
      { id: 'w-study', text: 'Studied' },
      { id: 'w-mouse', text: 'mouse' }
    ],
    ['darcy'],
    lemmaOf
  )

  it('单词本里的词和它的变形都能认出来（went → go，studies → Studied 的原形 study）', () => {
    expect(classifyWord('went', index, lemmaOf)).toEqual({ wordId: 'w-go', known: false })
    expect(classifyWord('Goes', index, lemmaOf)).toEqual({ wordId: 'w-go', known: false })
    expect(classifyWord('studies', index, lemmaOf)).toEqual({ wordId: 'w-study', known: false })
    expect(classifyWord('mice', index, lemmaOf)).toEqual({ wordId: 'w-mouse', known: false })
    expect(classifyWord('table', index, lemmaOf)).toEqual({ wordId: null, known: false })
  })

  it("熟词过滤：熟词和它的变形（所有格 Darcy's）不显示任何标记", () => {
    expect(classifyWord('Darcy', index, lemmaOf)).toEqual({ wordId: null, known: true })
    expect(classifyWord('Darcy’s', index, lemmaOf)).toEqual({ wordId: null, known: true })
    const withKnownGo = buildWordIndex([{ id: 'w-go', text: 'go' }], ['go'], lemmaOf)
    expect(classifyWord('went', withKnownGo, lemmaOf)).toEqual({ wordId: null, known: true })
  })

  it('收词、标熟词用原形', () => {
    expect(lemmaFor('Went', lemmaOf)).toBe('go')
    expect(lemmaFor('Darcy’s', lemmaOf)).toBe('darcy')
    expect(lemmaFor('Zyzzyva', lemmaOf)).toBe('zyzzyva')
  })

  it('在出处的句子里找到这个词（原样或变形）', () => {
    const s = 'Then she went home, and the mice were gone.'
    const went = findWordInText(s, 'go', lemmaOf)
    expect(went && s.slice(went.start, went.end)).toBe('went')
    const mice = findWordInText(s, 'mouse', lemmaOf)
    expect(mice && s.slice(mice.start, mice.end)).toBe('mice')
    expect(findWordInText(s, 'table', lemmaOf)).toBeNull()
  })
})
