import { describe, expect, it } from 'vitest'
import { displayTitle, joinLines, sentenceOf, wordAt } from './words'

describe('wordAt', () => {
  it('点在单词中间得到整个单词', () => {
    const text = 'The effective habit.'
    expect(wordAt(text, 6)).toEqual({ word: 'effective', start: 4, end: 13 })
    expect(wordAt(text, 3)).toBeNull()
  })

  it('行尾连字符断开的单词合并成一个词（点前半或后半都一样）', () => {
    const text = 'be effec-\ntive people'
    expect(wordAt(text, 4)?.word).toBe('effective')
    expect(wordAt(text, 11)?.word).toBe('effective')
    expect(wordAt(text, 8)?.word).toBe('effective')
    const hit = wordAt(text, 11)!
    expect(text.slice(hit.start, hit.end)).toBe('effec-\ntive')
  })

  it('普通连字符词不拆开，句中连字符后跟空格不合并', () => {
    expect(wordAt('a well-known fact', 4)?.word).toBe('well-known')
    expect(wordAt('pre- and post-war', 1)?.word).toBe('pre')
  })
})

describe('sentenceOf', () => {
  it('PDF 按阅读顺序拼接跨行的句子，并去掉行尾连字符', () => {
    const text = 'First one. Being effec-\ntive is a\nhabit. Next.'
    expect(sentenceOf(text, 20, true)).toBe('Being effective is a habit.')
    expect(joinLines('a-\nb').text).toBe('ab')
  })

  it('EPUB 的块内取句不变', () => {
    expect(sentenceOf('One. Two three. Four.', 7)).toBe('Two three.')
  })
})

describe('displayTitle', () => {
  it('去掉冒号后的副标题，全小写转成标题格式', () => {
    expect(
      displayTitle('The seven habits of highly effective people : restoring the character ethic')
    ).toBe('The Seven Habits of Highly Effective People')
    expect(displayTitle('Pride and Prejudice')).toBe('Pride and Prejudice')
    expect(displayTitle('moby dick: or, the whale')).toBe('Moby Dick')
  })
})
