import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DictService, Dictionary } from './dict'

const FILE = join(process.cwd(), 'resources', 'dict', 'ecdict-lite.json.gz')

describe('打包的词典', () => {
  let dict: Dictionary

  beforeAll(async () => {
    dict = await Dictionary.load(FILE)
  }, 30_000)

  it('加载后词条数与生成时一致', () => {
    expect(dict.size).toBeGreaterThan(600_000)
  })

  it('查询：音标、分组义项、考试标签、牛津核心词', () => {
    const e = dict.lookup('Ability')!
    expect(e.word).toBe('ability')
    expect(e.phonetic).toBe("ә'biliti")
    expect(e.groups[0].pos).toBe('n.')
    expect(e.groups[0].senses.map((s) => s.text)).toEqual(['能力', '才干'])
    expect(e.tags).toEqual(['中考', '高考', '四级', '考研', '托福', '雅思'])
    expect(e.oxford).toBe(true)
  })

  it('屈折形式：went 是 go 的过去式', () => {
    expect(dict.lookup('went')?.lemma).toEqual({ word: 'go', forms: ['过去式'] })
    expect(dict.lookup('abilities')?.lemma).toEqual({ word: 'ability', forms: ['复数'] })
  })

  it('查不到的词返回 null；大小写完全一致的词条优先', () => {
    expect(dict.lookup('qzxv-not-a-word')).toBeNull()
    expect(dict.lookup('  ')).toBeNull()
    expect(dict.findRow('Polish')?.[0]).toBe('Polish')
    expect(dict.findRow('POLISH')?.[0]).toMatch(/^polish$/i)
  })

  it('单次查询不超过 50ms', () => {
    const words = ['ability', 'went', 'abandon', 'zebra', 'take off', 'qqqq', 'Apple', 'hood']
    for (const w of words) {
      const t = performance.now()
      dict.lookup(w)
      expect(performance.now() - t).toBeLessThan(50)
    }
  })
})

describe('DictService', () => {
  it('加载完成前返回 loading，失败后返回 unavailable', async () => {
    const svc = new DictService()
    expect(svc.lookup('ability')).toEqual({ status: 'loading' })
    await expect(svc.load(join(process.cwd(), 'no-such-dict.gz'))).rejects.toThrow()
    expect(svc.lookup('ability')).toEqual({ status: 'unavailable' })
  })
})
