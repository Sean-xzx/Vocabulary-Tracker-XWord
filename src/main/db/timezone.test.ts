/**
 * 日期跟随电脑的本地时区：在四种系统时区下，都按各自的本地日期分日（23:59 / 00:00、跨月、跨年、闰日、夏令时切换日）；
 * 渲染进程报告的时区优先于主进程启动时的系统时区；
 * 以及迁移 3（北京时间校正，保持原样）与迁移 4（按本地时区重算）。
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { nowIso, today } from '../../shared/domain/dates'
import { getSchedule } from '../../shared/domain/scheduler'
import { checksByWord, queueFromSnapshot } from '../../shared/snapshot'
import { backupDaily } from './backup'
import { SqlDb } from './connection'
import { LATEST_VERSION, migrate } from './migrations'
import { fixTimeZone } from './migrations/003_timezone'
import { toLocalTime } from './migrations/004_local_time'
import { Repository, type Clock } from './repository'

const ZONES = ['Asia/Shanghai', 'UTC', 'America/Los_Angeles', 'Europe/London']
const TMP = join(process.cwd(), '.test-tmp', 'vitest-tz')

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

async function withTz<T>(tz: string, fn: () => Promise<T> | T): Promise<T> {
  const old = process.env.TZ
  process.env.TZ = tz
  try {
    return await fn()
  } finally {
    if (old === undefined) delete process.env.TZ
    else process.env.TZ = old
  }
}

/** 本地墙上时间（“2024-02-29T23:59”）→ 真实时刻：用 nowIso 读出偏移，两次逼近（夏令时切换附近也成立）。 */
function localInstant(wall: string, tz: string): Date {
  const [d, t] = wall.split('T')
  const [y, m, day] = d.split('-').map(Number)
  const [hh, mi, ss = 0] = t.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, day, hh, mi, ss)
  let instant = guess
  for (let i = 0; i < 2; i++) {
    const off = /([+-])(\d\d):(\d\d)$/.exec(nowIso(new Date(instant), tz))!
    const minutes = (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3]))
    instant = guess - minutes * 60_000
  }
  return new Date(instant)
}

class LocalClock implements Clock {
  instant: Date
  constructor(wall: string) {
    this.instant = localInstant(wall, process.env.TZ!)
  }
  set(wall: string): void {
    this.instant = localInstant(wall, process.env.TZ!)
  }
  now(): Date {
    return new Date(this.instant)
  }
}

/** 本地 23:59 与 00:00 前后，以及跨月、跨年、闰日 */
const WALLS = [
  '2024-02-29T23:59', // 闰日 23:59
  '2024-03-01T00:00', // 跨月
  '2024-12-31T23:59',
  '2025-01-01T00:00', // 跨年
  '2024-03-31T00:30', // 伦敦夏令时开始的那天（01:00 → 02:00）
  '2024-03-31T23:59',
  '2024-03-10T23:59', // 洛杉矶夏令时开始的那天
  '2024-11-03T00:00', // 洛杉矶夏令时结束的那天
  '2024-11-03T23:59',
  '2024-10-27T23:59' // 伦敦夏令时结束的那天
]

async function scenario(): Promise<unknown> {
  const tz = process.env.TZ!
  const days = WALLS.map((w) => today(localInstant(w, tz)))

  const clock = new LocalClock('2024-02-29T23:59')
  mkdirSync(TMP, { recursive: true })
  const dbFile = join(TMP, `tz-${tz.replace('/', '-')}.db`)
  rmSync(dbFile, { force: true })
  const db = await SqlDb.open(dbFile)
  migrate(db)
  const repo = new Repository(db, clock)
  const [a, b, c] = repo.addWords([
    { text: 'a', meaning: '' },
    { text: 'b', meaning: '' },
    { text: 'c', meaning: '' }
  ]).words
  repo.gradeWord(a.id, 3)
  repo.gradeWord(b.id, 3)
  const beforeMidnight = repo.getSnapshot()
  const queueBefore = queueFromSnapshot(beforeMidnight)
  const stampDay = beforeMidnight.words[0].createdAt.slice(0, 16)

  clock.set('2024-03-01T00:00') // 跨过本地午夜
  const afterMidnight = repo.getSnapshot()
  const queueAfter = queueFromSnapshot(afterMidnight)
  const wordA = afterMidnight.words.find((w) => w.id === a.id)!
  const checksA = checksByWord(afterMidnight.checks).get(a.id) ?? []
  const dueAfter = getSchedule(wordA, checksA, afterMidnight.today)
  // 新词写进今天（3 月 1 日）新开的一页
  repo.addWords([{ text: 'd', meaning: '' }])
  const pagesAfter = repo.getSnapshot().pages.map((p) => p.startedOn)

  clock.set('2024-03-03T00:30') // 1天节点（3-01）已逾期，2天节点（3-02）拖欠 1 天
  const later = repo.getSnapshot()
  const lateSchedule = getSchedule(wordA, checksA, later.today)

  const backup = backupDaily(dbFile, join(TMP, `backups-${basename(dbFile)}`), repo.today())

  return {
    days,
    stampDay,
    pageStartedOn: beforeMidnight.pages[0].startedOn,
    learnedOn: beforeMidnight.words.map((w) => w.learnedOn),
    doneOn: beforeMidnight.checks.map((x) => x.doneOn),
    todayBefore: beforeMidnight.today,
    todayAfter: afterMidnight.today,
    timeZone: afterMidnight.timeZone === tz,
    learnedTodayBefore: queueBefore.learnedTodayCount,
    learnedTodayAfter: queueAfter.learnedTodayCount,
    newInQueueAfter: queueAfter.newCount,
    dueAfter: [dueAfter.nextStage, dueAfter.dueOn, dueAfter.isDue, dueAfter.isOverdue],
    pagesAfter,
    late: [
      lateSchedule.nextStage,
      lateSchedule.isOverdue,
      lateSchedule.overdueDays,
      lateSchedule.missedStages
    ],
    backup: backup ? basename(backup) : null,
    untouched: c.learnedOn
  }
}

describe('日期跟随系统本地时区', () => {
  it('切换 process.env.TZ 确实改变了系统时区', async () => {
    const offsets = await Promise.all(
      ZONES.map((tz) => withTz(tz, () => new Date('2024-01-15T00:00:00Z').getTimezoneOffset()))
    )
    expect(offsets).toEqual([-480, 0, 480, 0])
  })

  it('四种系统时区下都按各自的本地日期分日：今天、到期 / 拖欠、跨午夜、新页、备份文件名、新词上限计数', async () => {
    for (const tz of ZONES) {
      const result = await withTz(tz, scenario)
      expect(result, tz).toEqual({
        days: [
          '2024-02-29',
          '2024-03-01',
          '2024-12-31',
          '2025-01-01',
          '2024-03-31',
          '2024-03-31',
          '2024-03-10',
          '2024-11-03',
          '2024-11-03',
          '2024-10-27'
        ],
        stampDay: '2024-02-29T23:59',
        pageStartedOn: '2024-02-29',
        learnedOn: ['2024-02-29', '2024-02-29', null],
        doneOn: ['2024-02-29', '2024-02-29'],
        todayBefore: '2024-02-29',
        todayAfter: '2024-03-01',
        timeZone: true,
        learnedTodayBefore: 2,
        learnedTodayAfter: 0,
        newInQueueAfter: 1,
        dueAfter: [1, '2024-03-01', true, false],
        pagesAfter: ['2024-02-29', '2024-03-01'],
        late: [2, true, 1, [1]],
        backup: 'xword-2024-03-03.db',
        untouched: null
      })
    }
  })

  it('时刻带本地偏移：夏令时前后偏移随之变化', () => {
    expect(nowIso(new Date('2024-03-31T00:30:00Z'), 'Europe/London')).toBe(
      '2024-03-31T00:30:00.000+00:00'
    )
    expect(nowIso(new Date('2024-03-31T01:30:00Z'), 'Europe/London')).toBe(
      '2024-03-31T02:30:00.000+01:00'
    )
    expect(nowIso(new Date('2024-11-03T09:30:00Z'), 'America/Los_Angeles')).toBe(
      '2024-11-03T01:30:00.000-08:00'
    )
    expect(nowIso(new Date('2024-01-01T00:00:00Z'), 'Asia/Kolkata')).toBe(
      '2024-01-01T05:30:00.000+05:30'
    )
  })

  it('渲染进程报告的时区优先：主进程系统时区是上海，时区设为洛杉矶时按洛杉矶分日', async () => {
    await withTz('Asia/Shanghai', async () => {
      const db = await SqlDb.open(null)
      migrate(db)
      let zone = 'Asia/Shanghai'
      const instant = new Date('2024-06-10T07:30:00+08:00') // 上海 6 月 10 日早上 = 洛杉矶 6 月 9 日下午
      const repo = new Repository(db, { now: () => instant, timeZone: () => zone })
      expect(repo.today()).toBe('2024-06-10')
      zone = 'America/Los_Angeles'
      expect(repo.today()).toBe('2024-06-09')
      expect(repo.getSnapshot().timeZone).toBe('America/Los_Angeles')
      const [w] = repo.addWords([{ text: 'x', meaning: '' }]).words
      expect(w.createdAt).toBe('2024-06-09T16:30:00.000-07:00')
    })
  })
})

function dump(db: SqlDb): Record<string, unknown[]> {
  return {
    pages: db.all('SELECT * FROM pages ORDER BY id'),
    words: db.all('SELECT * FROM words ORDER BY id'),
    checks: db.all('SELECT * FROM checks ORDER BY word_id, stage'),
    review_log: db.all('SELECT * FROM review_log ORDER BY id'),
    settings: db.all('SELECT * FROM settings ORDER BY key')
  }
}

const fixture = (name: string): Promise<SqlDb> =>
  SqlDb.fromBytes(readFileSync(join(process.cwd(), 'src/main/db/fixtures', name)))

const checksOf = (db: SqlDb, text: string): string[] =>
  db
    .all<{ stage: number; result: string; done_on: string }>(
      'SELECT c.stage, c.result, c.done_on FROM checks c JOIN words w ON w.id = c.word_id WHERE w.text = ? ORDER BY c.stage',
      [text]
    )
    .map((c) => `${c.stage}:${c.result}:${c.done_on}`)
const learnedOf = (db: SqlDb, text: string): string | null =>
  db.get<{ learned_on: string | null }>('SELECT learned_on FROM words WHERE text = ?', [text])!
    .learned_on
const startedOf = (db: SqlDb): string[] =>
  db
    .all<{ started_on: string }>('SELECT started_on FROM pages ORDER BY number')
    .map((p) => p.started_on)

describe('迁移 3（北京时间校正，已发布，保持原样）与迁移 4（按本地时区重算）', () => {
  it('洛杉矶时区下生成的旧库，本地时区是上海：迁移 3 校正 8 条，迁移 4 零改动', async () => {
    const db = await fixture('v0.2-tz-los-angeles.db')
    expect(db.userVersion).toBe(2)
    const before = dump(db)
    const logs: string[] = []
    migrate(db, (m) => logs.push(m), { timeZone: 'Asia/Shanghai' })
    expect(db.userVersion).toBe(LATEST_VERSION)
    expect(logs.slice(0, 2)).toEqual([
      '迁移到版本 3：时区校正（北京时间）：改动了 8 条记录',
      '迁移到版本 4：日期改为本地时间（Asia/Shanghai）：改动了 0 条记录'
    ])
    expect(startedOf(db)).toEqual(['2026-09-20', '2026-09-21'])
    // “漏”没有自己的复习记录，保持原值
    expect(checksOf(db, 'bravo')).toEqual([
      '0:ok:2026-09-20',
      '1:missed:2026-09-21',
      '2:ok:2026-09-22'
    ])
    expect(learnedOf(db, 'bravo')).toBe('2026-09-20')
    // 重现记录（is_retry = 1）不参与换算
    expect(checksOf(db, 'alpha')).toEqual(['0:ok:2026-09-21', '1:ok:2026-09-22'])
    expect(learnedOf(db, 'alpha')).toBe('2026-09-21')
    expect(checksOf(db, 'charlie')).toEqual(['0:ok:2026-09-21'])
    // 没有复习记录的检查格保持原值
    expect(checksOf(db, 'echo')).toEqual(['0:ok:2026-09-20'])
    expect(learnedOf(db, 'delta')).toBeNull()

    const after = dump(db)
    expect(after.review_log).toEqual(before.review_log)
    // 可以重复执行，结果不变
    expect(fixTimeZone(db)).toBe(0)
    expect(toLocalTime(db, 'Asia/Shanghai')).toBe(0)
    expect(dump(db)).toEqual(after)
  })

  it('同一个旧库，本地时区是洛杉矶：迁移 4 按洛杉矶的本地日期换算回来，重复执行零改动', async () => {
    const db = await fixture('v0.2-tz-los-angeles.db')
    const before = dump(db)
    const logs: string[] = []
    migrate(db, (m) => logs.push(m), { timeZone: 'America/Los_Angeles' })
    expect(logs[1]).toBe('迁移到版本 4：日期改为本地时间（America/Los_Angeles）：改动了 8 条记录')
    // 这份库本来就是在洛杉矶按本地日期写入的：换算后回到原值
    expect(dump(db).checks).toEqual(before.checks)
    expect(dump(db).words).toEqual(before.words)
    expect(dump(db).pages).toEqual(before.pages)
    const after = dump(db)
    expect(toLocalTime(db, 'America/Los_Angeles')).toBe(0)
    expect(dump(db)).toEqual(after)
  })

  it('上海时区下生成的旧库，本地时区是上海：两次迁移都零改动', async () => {
    const db = await fixture('v0.2-tz-shanghai.db')
    const before = dump(db)
    const logs: string[] = []
    migrate(db, (m) => logs.push(m), { timeZone: 'Asia/Shanghai' })
    expect(logs.slice(0, 2)).toEqual([
      '迁移到版本 3：时区校正（北京时间）：改动了 0 条记录',
      '迁移到版本 4：日期改为本地时间（Asia/Shanghai）：改动了 0 条记录'
    ])
    expect(dump(db)).toEqual(before)
  })
})
