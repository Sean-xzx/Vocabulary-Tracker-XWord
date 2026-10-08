/**
 * 阅读器与单词本打通：收词（写进今天的页、重复只追加出处、例句自动填入）、出处、熟词、高亮、阅读时长与连续打卡。
 */
import { describe, expect, it } from 'vitest'
import type { CollectRequest } from '../../shared/api'
import { SqlDb } from './connection'
import { migrate } from './migrations'
import { Repository, type Clock } from './repository'

class FakeClock implements Clock {
  constructor(public iso: string) {}
  now(): Date {
    return new Date(this.iso)
  }
  timeZone(): string {
    return 'Asia/Shanghai'
  }
}

async function setup(): Promise<{ db: SqlDb; repo: Repository; clock: FakeClock; bookId: string }> {
  const db = await SqlDb.open(null)
  migrate(db, undefined, { timeZone: 'Asia/Shanghai' })
  const clock = new FakeClock('2026-09-24T09:00:00+08:00')
  const repo = new Repository(db, clock)
  const bookId = '11111111-2222-4333-8444-555555555555'
  repo.addBook({
    id: bookId,
    title: 'Test',
    author: 'A',
    source: 'import',
    sourceId: '',
    fileHash: 'h',
    format: 'epub',
    parseVersion: 2
  })
  return { db, repo, clock, bookId }
}

const source = (
  bookId: string,
  sentence = 'She went home.',
  offset = 4
): CollectRequest['source'] => ({
  bookId,
  chapter: 2,
  block: 7,
  offset,
  sentence
})

describe('收词与出处', () => {
  it('新词：按手动录入的规则写进今天的页（新词状态），带出处，例句为空时填入句子', async () => {
    const { repo, bookId } = await setup()
    repo.addWords([{ text: 'apple', meaning: '苹果' }])
    const res = repo.collectWord({
      word: { text: 'go', meaning: 'v. 去；走', pos: 'v.', phonetic: 'gəʊ' },
      source: source(bookId)
    })
    expect(res).toMatchObject({ pageNumber: 1, created: true })
    const snap = repo.getSnapshot()
    const go = snap.words.find((w) => w.id === res.wordId)!
    expect(go).toMatchObject({
      text: 'go',
      meaning: 'v. 去；走',
      pos: 'v.',
      phonetic: 'gəʊ',
      status: 'new',
      learnedOn: null,
      example: 'She went home.',
      rowNo: 2
    })
    expect(snap.sources).toEqual([
      expect.objectContaining({
        wordId: res.wordId,
        bookId,
        chapter: 2,
        block: 7,
        offset: 4,
        sentence: 'She went home.'
      })
    ])
  })

  it('这个词已经在单词本里（不区分大小写）：不新增单词，只追加一条出处；已有例句不覆盖', async () => {
    const { repo, bookId, clock } = await setup()
    const first = repo.collectWord({ word: { text: 'go', meaning: '' }, source: source(bookId) })
    clock.iso = '2026-09-25T09:00:00+08:00'
    const again = repo.collectWord({
      word: { text: 'Go', meaning: '' },
      source: source(bookId, 'Let us go now.', 7)
    })
    expect(again).toEqual({ wordId: first.wordId, pageNumber: 1, created: false })
    const snap = repo.getSnapshot()
    expect(snap.words).toHaveLength(1)
    expect(snap.words[0].example).toBe('She went home.')
    // 新的在前
    expect(snap.sources.map((s) => s.sentence)).toEqual(['Let us go now.', 'She went home.'])
  })

  it('已删除的词不算“已经在单词本里”；彻底删除时出处一起删除', async () => {
    const { db, repo, bookId } = await setup()
    const a = repo.collectWord({ word: { text: 'cat', meaning: '' }, source: source(bookId) })
    repo.deleteWord(a.wordId)
    expect(repo.getSnapshot().sources).toEqual([])
    const b = repo.collectWord({ word: { text: 'cat', meaning: '' }, source: source(bookId) })
    expect(b.created).toBe(true)
    repo.purgeWord(a.wordId)
    expect(db.all('SELECT * FROM word_sources WHERE word_id = ?', [a.wordId])).toEqual([])
  })

  it('书不存在时拒绝', async () => {
    const { repo } = await setup()
    expect(() =>
      repo.collectWord({
        word: { text: 'x', meaning: '' },
        source: source('99999999-2222-4333-8444-555555555555')
      })
    ).toThrow('找不到这本书')
  })
})

describe('熟词', () => {
  it('按原形小写保存，重复添加不出错，可以撤销', async () => {
    const { repo } = await setup()
    repo.addKnown('Go')
    repo.addKnown('go')
    repo.addKnown('the')
    expect(repo.getSnapshot().known.sort()).toEqual(['go', 'the'])
    repo.removeKnown('GO')
    expect(repo.getSnapshot().known).toEqual(['the'])
  })
})

describe('高亮与笔记', () => {
  it('新建、改颜色和笔记、软删除后可以恢复；全部高亮不含已移除的书', async () => {
    const { repo, bookId } = await setup()
    const h = repo.addHighlight({
      bookId,
      start: { chapter: 1, block: 2, offset: 3 },
      end: { chapter: 1, block: 4, offset: 5 },
      text: 'a long passage',
      color: 'yellow'
    })
    expect(h).toMatchObject({
      color: 'yellow',
      note: '',
      start: { chapter: 1, block: 2, offset: 3 }
    })
    repo.updateHighlight(h.id, { color: 'green', note: '想一想' })
    expect(repo.listHighlights(bookId)[0]).toMatchObject({ color: 'green', note: '想一想' })
    repo.deleteHighlight(h.id)
    expect(repo.listHighlights(bookId)).toEqual([])
    repo.restoreHighlight(h.id)
    expect(repo.listHighlights(null)).toHaveLength(1)
    repo.deleteBook(bookId)
    expect(repo.listHighlights(null)).toEqual([])
  })
})

describe('阅读时长与连续打卡', () => {
  it('按本地日期累加；当天满 5 分钟算打卡；第一次作答也算，重现不算', async () => {
    const { repo, bookId, clock } = await setup()
    clock.iso = '2026-09-22T21:00:00+08:00'
    repo.logReading(bookId, 200)
    repo.logReading(bookId, 100)
    clock.iso = '2026-09-23T23:59:00+08:00'
    const [w] = repo.addWords([{ text: 'a', meaning: '' }]).words
    repo.gradeWord(w.id, 3)
    clock.iso = '2026-09-24T08:00:00+08:00'
    repo.logRetry(w.id, 0, 3)
    expect(repo.readingDays()).toEqual([{ date: '2026-09-22', seconds: 300 }])
    // 24 日只有重现，不算；从 23 日往回数：23（作答）、22（阅读 300 秒）
    expect(repo.getSnapshot().streak).toBe(2)
  })

  it('阅读位置与进度', async () => {
    const { repo, bookId } = await setup()
    repo.saveBookPosition(bookId, { chapter: 3, block: 10, offset: 42 }, 0.25)
    expect(repo.getBook(bookId)).toMatchObject({
      position: { chapter: 3, block: 10, offset: 42 },
      progress: 0.25
    })
  })
})
