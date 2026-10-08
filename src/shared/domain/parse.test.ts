import { describe, expect, it } from 'vitest'
import {
  meaningInputText,
  meaningParts,
  normalizeWord,
  parseBatch,
  parseLine,
  splitMeaningInput,
  splitPos
} from './parse'

describe('批量录入解析', () => {
  it('有 Tab 的按 Tab 分成单词和词义', () => {
    expect(parseLine('abandon\tvt. 放弃；抛弃')).toEqual({
      text: 'abandon',
      pos: 'vt.',
      meaning: '放弃；抛弃'
    })
    expect(parseLine('give up\t放弃')).toEqual({ text: 'give up', pos: '', meaning: '放弃' })
  })

  it('没有 Tab 的，以第一个中文字符为界', () => {
    expect(parseLine('ability 能力')).toEqual({ text: 'ability', pos: '', meaning: '能力' })
    expect(parseLine('apple苹果')).toEqual({ text: 'apple', pos: '', meaning: '苹果' })
    expect(parseLine('take in 吸收；欺骗')).toEqual({
      text: 'take in',
      pos: '',
      meaning: '吸收；欺骗'
    })
  })

  it('没有 Tab 的，以第一个词性标记为界', () => {
    expect(parseLine('absorb v. 吸收')).toEqual({ text: 'absorb', pos: 'v.', meaning: '吸收' })
    expect(parseLine('abstract adj. abstract; n. summary')).toEqual({
      text: 'abstract',
      pos: 'adj.',
      meaning: 'abstract; n. summary'
    })
    expect(parseLine('run vi. 跑')).toEqual({ text: 'run', pos: 'vi.', meaning: '跑' })
  })

  it('两者都没有的，整行作为单词', () => {
    expect(parseLine('accelerate')).toEqual({ text: 'accelerate', pos: '', meaning: '' })
    expect(parseLine('  a.m.  ')).toEqual({ text: 'a.m.', pos: '', meaning: '' })
  })

  it('空行被忽略，Windows 换行也能处理', () => {
    expect(parseBatch('apple 苹果\r\n\r\n  \nbanana\tn. 香蕉\n')).toEqual([
      { text: 'apple', pos: '', meaning: '苹果' },
      { text: 'banana', pos: 'n.', meaning: '香蕉' }
    ])
  })

  it('splitPos 拆出开头的词性', () => {
    expect(splitPos('n./v. 访问')).toEqual({ pos: 'n./v.', meaning: '访问' })
    expect(splitPos('放弃')).toEqual({ pos: '', meaning: '放弃' })
  })

  it('查重规范化：不区分大小写，忽略多余空白', () => {
    expect(normalizeWord('  Give   Up ')).toBe('give up')
    expect(normalizeWord('APPLE')).toBe(normalizeWord('apple'))
  })
})

describe('带词性全文的词义', () => {
  it('显示：词义以词性开头时按组拆开，不重复显示 pos', () => {
    expect(meaningParts('n./adj.', 'n. 能力；才能  adj. 有能力的')).toEqual([
      { label: 'n.', text: '能力；才能' },
      { label: 'adj.', text: '有能力的' }
    ])
    expect(meaningParts('n.', 'n. 能力  [经] 才能')).toEqual([
      { label: 'n.', text: '能力' },
      { label: '[经]', text: '才能' }
    ])
    expect(meaningParts('vt.', '放弃')).toEqual([{ label: 'vt.', text: '放弃' }])
    expect(meaningParts('', '')).toEqual([])
  })

  it('编辑框：旧格式拼上 pos，新格式原样', () => {
    expect(meaningInputText('vt.', '放弃')).toBe('vt. 放弃')
    expect(meaningInputText('n./adj.', 'n. 能力  adj. 有能力的')).toBe('n. 能力  adj. 有能力的')
  })

  it('保存：多组保持全文、pos 用“/”连接；单组沿用拆分', () => {
    expect(splitMeaningInput('n. 能力；才能  adj. 有能力的  [经] 才干')).toEqual({
      pos: 'n./adj.',
      meaning: 'n. 能力；才能  adj. 有能力的  [经] 才干'
    })
    expect(splitMeaningInput('vt. 放弃  ')).toEqual({ pos: 'vt.', meaning: '放弃' })
    expect(splitMeaningInput('苹果  梨')).toEqual({ pos: '', meaning: '苹果  梨' })
  })
})
