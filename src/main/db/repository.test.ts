import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { queueFromSnapshot } from '../../shared/snapshot'
import { addDays } from '../../shared/domain/dates'
import { answerCard, currentCard, isSessionFinished, startSession } from '../../shared/domain/queue'
import type { Grade } from '../../shared/domain/scheduler'
import { backupDaily } from './backup'
import { SqlDb } from './connection'
import { LATEST_VERSION, migrate } from './migrations'
import { Repository, type Clock } from './repository'
import { SAMPLE_EXPECTED_QUEUE, fillSampleData } from './sample'

const TMP = join(process.cwd(), '.test-tmp', 'vitest')

class FakeClock implements Clock {
  constructor(public date: Date) {}
  now(): Date {
    return new Date(this.date)
  }
  /** 固定用上海时区（没有夏令时），测试结果与运行测试的电脑无关 */
  timeZone(): string {
    return 'Asia/Shanghai'
  }
  /** 前进 n 天（上海没有夏令时，一天固定 24 小时，时刻不变） */
  advance(days: number): void {
    this.date = new Date(this.date.getTime() + days * 24 * 60 * 60 * 1000)
  }
}

async function setup(): Promise<{ db: SqlDb; repo: Repository; clock: FakeClock }> {
  const db = await SqlDb.open(null)
  migrate(db, undefined, { timeZone: 'Asia/Shanghai' })
  const clock = new FakeClock(new Date('2024-06-10T12:00:00+08:00'))
  return { db, repo: new Repository(db, clock), clock }
}

/** 所有表的完整内容，用来断言“完全恢复”。 */
function dump(db: SqlDb): unknown {
  return {
    pages: db.all('SELECT * FROM pages ORDER BY id'),
    words: db.all('SELECT * FROM words ORDER BY id'),
    checks: db.all('SELECT * FROM checks ORDER BY word_id, stage'),
    review_log: db.all('SELECT * FROM review_log ORDER BY id'),
    settings: db.all('SELECT * FROM settings ORDER BY key')
  }
}

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('迁移', () => {
  it('从 0 迁移到最新版本，重复执行不会出错', async () => {
    const db = await SqlDb.open(null)
    expect(db.userVersion).toBe(0)
    expect(migrate(db)).toBe(0)
    expect(db.userVersion).toBe(LATEST_VERSION)
    expect(migrate(db)).toBe(LATEST_VERSION)
    const tables = db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
    expect(tables.map((t) => t.name)).toEqual([
      'books',
      'checks',
      'highlights',
      'known_words',
      'pages',
      'reading_log',
      'review_log',
      'settings',
      'translations',
      'word_sources',
      'words'
    ])
  })
})

describe('录入', () => {
  let ctx: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    ctx = await setup()
  })

  it('从空库开始连续录入 30 个词，自动翻到第 2 页', () => {
    const pagesSeen: number[] = []
    for (let i = 0; i < 30; i++) {
      const res = ctx.repo.addWords([{ text: `word${i}`, meaning: `词义${i}` }])
      pagesSeen.push(...res.newPageNumbers)
    }
    expect(pagesSeen).toEqual([1, 2])
    const snap = ctx.repo.getSnapshot()
    const [p1, p2] = snap.pages
    expect(snap.words.filter((w) => w.pageId === p1.id)).toHaveLength(27)
    expect(snap.words.filter((w) => w.pageId === p2.id)).toHaveLength(3)
    expect(snap.words.every((w) => w.status === 'new' && w.learnedOn === null)).toBe(true)
  })

  it('批量录入一次跨页', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ text: `w${i}`, meaning: '' }))
    const res = ctx.repo.addWords(items)
    expect(res.newPageNumbers).toEqual([1, 2])
    expect(res.words.at(-1)?.rowNo).toBe(3)
  })

  it('软删除的词不占行数；可以恢复', () => {
    const res = ctx.repo.addWords(
      Array.from({ length: 27 }, (_, i) => ({ text: `w${i}`, meaning: '' }))
    )
    ctx.repo.deleteWord(res.words[0].id)
    const next = ctx.repo.addWords([{ text: 'extra', meaning: '' }])
    expect(next.newPageNumbers).toEqual([])
    expect(next.words[0].rowNo).toBe(28)
    expect(ctx.repo.getSnapshot().words).toHaveLength(27)
    ctx.repo.restoreWord(res.words[0].id)
    expect(ctx.repo.getSnapshot().words).toHaveLength(28)
  })

  it('第二天录入：新建一页', () => {
    ctx.repo.addWords([{ text: 'a', meaning: '' }])
    ctx.clock.advance(1)
    expect(ctx.repo.addWords([{ text: 'b', meaning: '' }]).newPageNumbers).toEqual([2])
  })

  it('词义开头的词性会拆到 pos；编辑与难词标记', () => {
    const [w] = ctx.repo.addWords([{ text: ' abandon ', meaning: 'vt. 放弃' }]).words
    expect(w).toMatchObject({ text: 'abandon', pos: 'vt.', meaning: '放弃' })
    ctx.repo.updateWord(w.id, { meaning: '抛弃', example: 'e.g.' })
    ctx.repo.setStarred(w.id, true)
    const after = ctx.repo.getSnapshot().words[0]
    expect(after).toMatchObject({ meaning: '抛弃', example: 'e.g.', starred: true })
    expect(() => ctx.repo.updateWord(w.id, { text: '  ' })).toThrow()
  })
})

describe('示例数据', () => {
  it('今日队列数量与手算结果一致：12 + 8 + 3 个复习词 + 5 个新词 = 28', async () => {
    const { repo } = await setup()
    repo.replaceAllData((db) => fillSampleData(db, repo.today()))
    const snap = repo.getSnapshot()
    expect(snap.pages.map((p) => p.number)).toEqual([1, 2, 3, 4])
    expect(snap.words).toHaveLength(28)
    const q = queueFromSnapshot(snap)
    expect(q.reviewCount).toBe(SAMPLE_EXPECTED_QUEUE.review)
    expect(q.overdueCount).toBe(SAMPLE_EXPECTED_QUEUE.overdue)
    expect(q.newCount).toBe(SAMPLE_EXPECTED_QUEUE.new)
    expect(q.items).toHaveLength(SAMPLE_EXPECTED_QUEUE.total)
    // 同一天再算一次：稳定
    expect(queueFromSnapshot(repo.getSnapshot())).toEqual(q)
    // 难词：accommodate 两次答错，被自动标记
    expect(snap.words.find((w) => w.text === 'accommodate')).toMatchObject({
      lapses: 2,
      starred: true
    })
  })
})

describe('评分与撤销', () => {
  it('网格评分符合规则；撤销后数据库完全恢复（含 missed 记录与 review_log）', async () => {
    const { db, repo } = await setup()
    repo.replaceAllData((d) => fillSampleData(d, repo.today()))
    const target = repo.getSnapshot().words.find((w) => w.text === 'allocate')!
    const before = dump(db)

    const res = repo.gradeWord(target.id, 1)
    expect(res).toMatchObject({ stage: 3, result: 'fail', missedStages: [2] })
    const snap = repo.getSnapshot()
    const w = snap.words.find((x) => x.id === target.id)!
    expect(w.lapses).toBe(target.lapses + 1)
    expect(
      snap.checks.filter((c) => c.wordId === target.id).map((c) => [c.stage, c.result, c.grade])
    ).toEqual([
      [0, 'ok', 3],
      [1, 'ok', 3],
      [2, 'missed', null],
      [3, 'fail', 1]
    ])
    expect(db.all('SELECT * FROM review_log WHERE id = ?', [res.logId])).toHaveLength(1)

    repo.undoGrade(res.logId)
    expect(dump(db)).toEqual(before)
    expect(() => repo.undoGrade(res.logId)).toThrow()
  })

  it('新词第1遍：写入 learned_on；撤销后回到 new', async () => {
    const { db, repo } = await setup()
    const [w] = repo.addWords([{ text: 'apple', meaning: '苹果' }]).words
    const before = dump(db)
    const res = repo.gradeWord(w.id, 4)
    expect(repo.getSnapshot().words[0]).toMatchObject({
      status: 'learning',
      learnedOn: '2024-06-10'
    })
    expect(res.stage).toBe(0)
    repo.undoGrade(res.logId)
    expect(dump(db)).toEqual(before)
  })

  it('同一天不能对同一节点重复计分', async () => {
    const { repo } = await setup()
    const [w] = repo.addWords([{ text: 'apple', meaning: '' }]).words
    repo.gradeWord(w.id, 3)
    expect(() => repo.gradeWord(w.id, 3)).toThrow()
  })

  it('本轮重现只写 review_log，不改 checks 和 lapses；撤销时连同之后的重现记录一起删除', async () => {
    const { db, repo } = await setup()
    const [w] = repo.addWords([{ text: 'apple', meaning: '' }]).words
    const before = dump(db)
    const first = repo.gradeWord(w.id, 1)
    const afterFirst = {
      checks: db.all('SELECT * FROM checks'),
      words: db.all('SELECT * FROM words')
    }
    const r1 = repo.logRetry(w.id, first.stage, 1)
    const r2 = repo.logRetry(w.id, first.stage, 3)
    expect({
      checks: db.all('SELECT * FROM checks'),
      words: db.all('SELECT * FROM words')
    }).toEqual(afterFirst)
    expect(db.all('SELECT is_retry FROM review_log ORDER BY is_retry')).toEqual([
      { is_retry: 0 },
      { is_retry: 1 },
      { is_retry: 1 }
    ])
    repo.undoGrade(first.logId, [r1, r2])
    expect(dump(db)).toEqual(before)
  })

  it('用示例数据走完一轮复习：重现不改写网格，结束后队列归零', async () => {
    const { db, repo } = await setup()
    repo.replaceAllData((d) => fillSampleData(d, repo.today()))
    const q = queueFromSnapshot(repo.getSnapshot())
    let session = startSession(q.items.map((i) => i.wordId))
    const stageOf = new Map<string, number>()
    const pattern: Grade[] = [1, 2, 3, 4]
    let n = 0
    while (!isSessionFinished(session)) {
      const card = currentCard(session)!
      if (!card.isRetry) {
        const g = pattern[n++ % pattern.length]
        const res = repo.gradeWord(card.wordId, g)
        stageOf.set(card.wordId, res.stage)
        session = answerCard(session, g, res.logId)
      } else {
        const checksBefore = db.all('SELECT * FROM checks')
        const logId = repo.logRetry(card.wordId, stageOf.get(card.wordId)!, 3)
        expect(db.all('SELECT * FROM checks')).toEqual(checksBefore)
        session = answerCard(session, 3, logId)
      }
    }
    expect(queueFromSnapshot(repo.getSnapshot()).items).toHaveLength(0)
    const firstAnswers = session.answers.filter((a) => !a.isRetry)
    expect(firstAnswers).toHaveLength(28)
    // 网格结果与第一次作答一致
    const snap = repo.getSnapshot()
    for (const a of firstAnswers) {
      const stage = stageOf.get(a.wordId)!
      const cell = snap.checks.find((c) => c.wordId === a.wordId && c.stage === stage)!
      expect(cell.grade).toBe(a.grade)
      expect(cell.result).toBe(a.grade === 1 ? 'fail' : 'ok')
    }
  })

  it('跨过午夜后按新的一天计算', async () => {
    const { repo, clock } = await setup()
    const [w] = repo.addWords([{ text: 'apple', meaning: '' }]).words
    repo.gradeWord(w.id, 3)
    expect(queueFromSnapshot(repo.getSnapshot()).items).toHaveLength(0)
    clock.date = new Date('2024-06-11T00:00:01+08:00')
    const snap = repo.getSnapshot()
    expect(snap.today).toBe(addDays('2024-06-10', 1))
    expect(queueFromSnapshot(snap).items).toHaveLength(1)
  })
})

describe('设置', () => {
  it('默认值与校验', async () => {
    const { repo } = await setup()
    expect(repo.getSettings()).toEqual({ theme: 'system', dailyNewLimit: 20 })
    expect(repo.setTheme('dark').theme).toBe('dark')
    expect(repo.setDailyNewLimit(5).dailyNewLimit).toBe(5)
    expect(() => repo.setDailyNewLimit(4)).toThrow()
    expect(() => repo.setDailyNewLimit(101)).toThrow()
    expect(() => repo.setDailyNewLimit(10.5)).toThrow()
    expect(() => repo.setTheme('blue' as never)).toThrow()
  })
})

describe('落盘与备份', () => {
  it('事务提交后写回磁盘（先写 .tmp 再替换），重新打开数据仍在', async () => {
    mkdirSync(TMP, { recursive: true })
    const file = join(TMP, 'persist.db')
    rmSync(file, { force: true })
    const db = await SqlDb.open(file)
    migrate(db)
    new Repository(db).addWords([{ text: 'apple', meaning: '苹果' }])
    expect(existsSync(file)).toBe(true)
    expect(existsSync(`${file}.tmp`)).toBe(false)
    db.close()

    const reopened = await SqlDb.open(file)
    expect(reopened.userVersion).toBe(LATEST_VERSION)
    expect(new Repository(reopened).getSnapshot().words[0].text).toBe('apple')
    reopened.close()
  })

  it('失败的事务会回滚，不落盘', async () => {
    const { db, repo } = await setup()
    repo.addWords([{ text: 'a', meaning: '' }])
    const before = dump(db)
    expect(() =>
      db.transaction(() => {
        db.run("UPDATE words SET text = 'changed'")
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(dump(db)).toEqual(before)
  })

  it('每天备份一次，只保留最近 7 份', () => {
    const dir = join(TMP, 'backups')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    const dbFile = join(TMP, 'b.db')
    writeFileSync(dbFile, 'x')
    for (let i = 0; i < 10; i++) {
      expect(backupDaily(dbFile, dir, addDays('2024-06-01', i))).not.toBeNull()
    }
    expect(backupDaily(dbFile, dir, '2024-06-10')).toBeNull()
    const files = readdirSync(dir).sort()
    expect(files).toHaveLength(7)
    expect(files[0]).toBe('xword-2024-06-04.db')
    expect(files[6]).toBe('xword-2024-06-10.db')
  })
})

describe('v0.2 迁移：v0.1 数据库升级到最新版本', () => {
  it('所有单词、检查记录、复习日志、设置完整无损，新增的 phonetic 为空串', async () => {
    const bytes = readFileSync(join(process.cwd(), 'src/main/db/fixtures/v0.1-sample.db'))
    const db = await SqlDb.fromBytes(bytes)
    expect(db.userVersion).toBe(1)
    const before = dump(db) as Record<string, Record<string, unknown>[]>
    expect(before.words.length).toBeGreaterThan(20)
    expect(before.review_log.length).toBeGreaterThan(20)
    expect(before.settings.length).toBe(2)

    expect(migrate(db, undefined, { timeZone: 'Asia/Shanghai' })).toBe(1)
    expect(db.userVersion).toBe(LATEST_VERSION)
    const after = dump(db) as Record<string, Record<string, unknown>[]>
    expect(after.pages).toEqual(before.pages)
    expect(after.checks).toEqual(before.checks)
    expect(after.review_log).toEqual(before.review_log)
    expect(after.settings).toEqual(before.settings)
    expect(after.words.map(({ phonetic, ...rest }) => (expect(phonetic).toBe(''), rest))).toEqual(
      before.words
    )

    const repo = new Repository(db)
    const snap = repo.getSnapshot()
    expect(snap.words.length + snap.deletedWords.length).toBe(before.words.length)
    expect(snap.deletedWords.length).toBe(1)
    expect(snap.settings).toEqual({ theme: 'dark', dailyNewLimit: 15 })
  })
})

describe('v0.2 词库：音标、回收站、复习记录', () => {
  it('录入时保存音标与词典给出的词性；不给 pos 时多组全文保持原样', async () => {
    const { repo } = await setup()
    const [a, b] = repo.addWords([
      { text: 'ability', meaning: 'n. 能力；才干', pos: 'n.', phonetic: "ә'biliti" },
      { text: 'able', meaning: 'adj. 能干的  n. 能手' }
    ]).words
    expect([a.pos, a.meaning, a.phonetic]).toEqual(['n.', 'n. 能力；才干', "ә'biliti"])
    expect([b.pos, b.meaning, b.phonetic]).toEqual(['adj./n.', 'adj. 能干的  n. 能手', ''])
    repo.updateWord(a.id, { phonetic: 'x' })
    expect(repo.getSnapshot().words[0].phonetic).toBe('x')
  })

  it('彻底删除只对回收站里的词有效，并连同 checks、review_log 一起删除', async () => {
    const { db, repo } = await setup()
    const [a, b, c] = repo.addWords([
      { text: 'a', meaning: '' },
      { text: 'b', meaning: '' },
      { text: 'c', meaning: '' }
    ]).words
    const log = repo.gradeWord(a.id, 3)
    repo.logRetry(a.id, 0, 2)
    expect(repo.getReviewLog(a.id).map((r) => r.isRetry)).toEqual([true, false])
    expect(() => repo.purgeWord(a.id)).toThrow()

    repo.deleteWord(a.id)
    expect(repo.getSnapshot().deletedWords.map((w) => w.id)).toEqual([a.id])
    repo.purgeWord(a.id)
    expect(db.all('SELECT * FROM words WHERE id = ?', [a.id])).toEqual([])
    expect(db.all('SELECT * FROM checks WHERE word_id = ?', [a.id])).toEqual([])
    expect(db.all('SELECT * FROM review_log WHERE word_id = ?', [a.id])).toEqual([])
    expect(() => repo.undoGrade(log.logId)).toThrow('无法撤销')

    repo.deleteWord(b.id)
    repo.deleteWord(c.id)
    expect(repo.emptyTrash()).toBe(2)
    expect(repo.emptyTrash()).toBe(0)
    const snap = repo.getSnapshot()
    expect(snap.words).toEqual([])
    expect(snap.deletedWords).toEqual([])
  })
})
