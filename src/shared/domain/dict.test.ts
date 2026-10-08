import { describe, expect, it } from 'vitest'
import {
  composeMeaning,
  describeLemma,
  firstGroupMeaning,
  flatSenses,
  parseLemma,
  parseTranslation,
  splitSenses,
  tagLabels,
  toDictEntry
} from './dict'

describe('parseTranslation', () => {
  it('多词性：按行分组，组内按中英文逗号、分号拆开，a. / ad. 统一成 adj. / adv.', () => {
    const groups = parseTranslation('n. 能力，才干; 本领\na. 有能力的；能干的\nad. 能干地')
    expect(groups.map((g) => g.pos)).toEqual(['n.', 'adj.', 'adv.'])
    expect(groups[0].senses.map((s) => s.text)).toEqual(['能力', '才干', '本领'])
    expect(groups[1].senses.map((s) => s.text)).toEqual(['有能力的', '能干的'])
    expect(groups.map((g) => g.index)).toEqual([0, 1, 2])
  })

  it('领域标记：整组的 [经] 与义项前的 [计] 都保留；[网络] 组排到最后', () => {
    const groups = parseTranslation(
      'n. 应用, [计] 应用程序\n[网络] 申请；应用\n[经] 申请书, 应用\nvt. 运用'
    )
    expect(groups.map((g) => [g.pos, g.domain])).toEqual([
      ['n.', ''],
      ['', '经'],
      ['vt.', ''],
      ['', '网络']
    ])
    expect(groups[0].senses).toEqual([
      { text: '应用', domain: '' },
      { text: '应用程序', domain: '计' }
    ])
    expect(groups[3].index).toBe(1)
  })

  it('只有一个义项、没有词性', () => {
    const groups = parseTranslation('go的过去式')
    expect(groups).toEqual([
      { index: 0, pos: '', domain: '', senses: [{ text: 'go的过去式', domain: '' }] }
    ])
  })

  it('括号里的逗号不拆；vt.&vi. 这类组合词性保留', () => {
    expect(splitSenses('使(马, 鹰等)戴头罩, 覆盖')).toEqual(['使(马, 鹰等)戴头罩', '覆盖'])
    expect(parseTranslation('vt.&vi. 放弃')[0].pos).toBe('vt.&vi.')
  })

  it('CSV 里字面的 \\n 也当作换行', () => {
    expect(parseTranslation('n. 能力\\n[经] 能力').length).toBe(2)
  })
})

describe('parseLemma / describeLemma', () => {
  it('went → go 的过去式', () => {
    const lemma = parseLemma('went', '0:go/1:p')
    expect(lemma).toEqual({ word: 'go', forms: ['过去式'] })
    expect(describeLemma('went', lemma!)).toBe('went 是 go 的过去式')
  })

  it('一个词是多种变化：过去式和过去分词', () => {
    expect(parseLemma('gave', '0:give/1:p')?.forms).toEqual(['过去式'])
    expect(parseLemma('abandoned', '0:abandon/1:pd')?.forms).toEqual(['过去式', '过去分词'])
  })

  it('原形本身、没有 exchange 时返回 null', () => {
    expect(parseLemma('go', 'i:going/p:went/d:gone/3:goes')).toBeNull()
    expect(parseLemma('ability', '')).toBeNull()
  })
})

describe('tagLabels / toDictEntry', () => {
  it('考试标签按固定顺序转成中文', () => {
    expect(tagLabels('ielts cet4 zk gre')).toEqual(['中考', '四级', '雅思', 'GRE'])
  })

  it('整行数据转成词条', () => {
    const e = toDictEntry([
      'ability',
      "ә'biliti",
      'n. 能力, 才干\n[经] 能力, 才能',
      'cet4 ky',
      1,
      4,
      's:abilities'
    ])
    expect(e.word).toBe('ability')
    expect(e.oxford).toBe(true)
    expect(e.tags).toEqual(['四级', '考研'])
    expect(e.lemma).toBeNull()
    expect(flatSenses(e.groups).map((s) => s.key)).toEqual(['0:0', '0:1', '1:0', '1:1'])
  })
})

describe('composeMeaning', () => {
  const groups = parseTranslation('n. 能力, 才能, 本领\n[网络] 能力值\nadj. 有能力的\n[计] 能力')

  it('同组用“；”，组间两个空格，按词典原顺序；pos 用“/”连接', () => {
    const r = composeMeaning(groups, new Set(['2:0', '0:0', '0:1']))
    expect(r).toEqual({ meaning: 'n. 能力；才能  adj. 有能力的', pos: 'n./adj.' })
  })

  it('领域组以 [领域] 开头，不计入 pos；[网络] 组按原位置排', () => {
    const r = composeMeaning(groups, new Set(['3:0', '1:0', '0:2']))
    expect(r).toEqual({ meaning: 'n. 本领  [网络] 能力值  [计] 能力', pos: 'n.' })
  })

  it('什么都没选时为空', () => {
    expect(composeMeaning(groups, new Set())).toEqual({ meaning: '', pos: '' })
  })

  it('批量录入取第一组的全部义项', () => {
    const e = toDictEntry(['x', '', '[网络] 甲\nn. 乙, 丙', '', 0, 0, ''])
    expect(firstGroupMeaning(e)).toEqual({ meaning: 'n. 乙；丙', pos: 'n.' })
  })
})
