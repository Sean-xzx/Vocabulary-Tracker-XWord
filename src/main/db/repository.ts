/**
 * 数据访问：封装全部读写。界面层只能通过 IPC 调用这里的方法，不直接写 SQL。
 */
import type {
  AddWordsResult,
  BookPosition,
  BookFormat,
  BookSource,
  BookSummary,
  CollectRequest,
  CollectResult,
  Highlight,
  HighlightColor,
  HighlightPatch,
  NewHighlight,
  WordSource,
  ReviewLogEntry,
  GradeResponse,
  NewWordInput,
  Page,
  Settings,
  Snapshot,
  ThemeSetting,
  Word,
  WordCheck,
  WordPatch
} from '../../shared/api'
import { THEME_SETTINGS } from '../../shared/api'
import {
  nowIso,
  systemTimeZone,
  today as localToday,
  type DateStr
} from '../../shared/domain/dates'
import type { Clock } from '../clock'
import { planPlacements, type PageFill } from '../../shared/domain/pages'
import { activeDays, streakDays, type ReadingDay } from '../../shared/domain/streak'
import { splitMeaningInput } from '../../shared/domain/parse'
import { comparePositions } from '../../shared/domain/book'
import {
  DEFAULT_DAILY_NEW_LIMIT,
  MAX_DAILY_NEW_LIMIT,
  MIN_DAILY_NEW_LIMIT
} from '../../shared/domain/queue'
import {
  gradeWord as scheduleGrade,
  planUndo,
  type CheckRecord,
  type CheckResult,
  type Grade,
  type GradeOutcome,
  type GradeSnapshot,
  type WordSchedState,
  type WordStatus
} from '../../shared/domain/scheduler'
import type { SqlDb } from './connection'

export type { Clock }

export const systemClock: Clock = { now: () => new Date(), timeZone: systemTimeZone }

interface PageRow {
  id: string
  number: number
  started_on: string
  created_at: string
}

interface WordRow {
  id: string
  page_id: string
  row_no: number
  text: string
  meaning: string
  pos: string
  phonetic: string
  example: string
  mnemonic: string
  learned_on: string | null
  status: WordStatus
  lapses: number
  starred: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface CheckRow {
  word_id: string
  stage: number
  result: CheckResult
  grade: number | null
  done_on: string
}

function toPage(r: PageRow): Page {
  return { id: r.id, number: r.number, startedOn: r.started_on, createdAt: r.created_at }
}

function toWord(r: WordRow): Word {
  return {
    id: r.id,
    pageId: r.page_id,
    rowNo: r.row_no,
    text: r.text,
    meaning: r.meaning,
    pos: r.pos,
    phonetic: r.phonetic,
    example: r.example,
    mnemonic: r.mnemonic,
    learnedOn: r.learned_on,
    status: r.status,
    lapses: r.lapses,
    starred: r.starred === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at
  }
}

function toCheck(r: CheckRow): WordCheck {
  return {
    wordId: r.word_id,
    stage: r.stage,
    result: r.result,
    grade: r.grade as Grade | null,
    doneOn: r.done_on
  }
}

interface BookRow {
  id: string
  title: string
  author: string
  source: BookSource
  source_id: string
  file_hash: string
  added_at: string
  last_opened_at: string | null
  pos_chapter: number
  pos_block: number
  pos_offset: number
  progress: number
  deleted_at: string | null
  format: BookFormat
  parse_version: number
}

function toBook(r: BookRow): BookSummary {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    source: r.source,
    sourceId: r.source_id,
    addedAt: r.added_at,
    lastOpenedAt: r.last_opened_at,
    position: { chapter: r.pos_chapter, block: r.pos_block, offset: r.pos_offset },
    progress: r.progress,
    format: r.format,
    parseVersion: r.parse_version
  }
}

interface SourceRow {
  id: string
  word_id: string
  book_id: string
  chapter: number
  block: number
  offset: number
  sentence: string
  created_at: string
}

function toSource(r: SourceRow): WordSource {
  return {
    id: r.id,
    wordId: r.word_id,
    bookId: r.book_id,
    chapter: r.chapter,
    block: r.block,
    offset: r.offset,
    sentence: r.sentence,
    createdAt: r.created_at
  }
}

interface HighlightRow {
  id: string
  book_id: string
  start_chapter: number
  start_block: number
  start_offset: number
  end_chapter: number
  end_block: number
  end_offset: number
  text: string
  color: HighlightColor
  note: string
  created_at: string
}

function toHighlight(r: HighlightRow): Highlight {
  return {
    id: r.id,
    bookId: r.book_id,
    start: { chapter: r.start_chapter, block: r.start_block, offset: r.start_offset },
    end: { chapter: r.end_chapter, block: r.end_block, offset: r.end_offset },
    text: r.text,
    color: r.color,
    note: r.note,
    createdAt: r.created_at
  }
}

function newId(): string {
  return globalThis.crypto.randomUUID()
}

interface UndoEntry {
  wordId: string
  before: GradeSnapshot
  /** 评分前的 updated_at，撤销时一并恢复，保证数据库完全回到评分前。 */
  updatedAt: string
  outcome: GradeOutcome
}

const WORD_COLUMNS =
  'id, page_id, row_no, text, meaning, pos, phonetic, example, mnemonic, learned_on, status, lapses, starred, created_at, updated_at, deleted_at'

export class Repository {
  /** 本次运行中可撤销的评分（按 review_log id）。关闭应用后失效。 */
  private readonly undoEntries = new Map<string, UndoEntry>()

  constructor(
    private readonly db: SqlDb,
    private readonly clock: Clock = systemClock
  ) {}

  /** 当前使用的本地时区 */
  timeZone(): string {
    return this.clock.timeZone?.() ?? systemTimeZone()
  }

  /** 本地的“今天”：每次都按时钟实时计算。 */
  today(): DateStr {
    return localToday(this.clock.now(), this.timeZone())
  }

  private nowIso(): string {
    return nowIso(this.clock.now(), this.timeZone())
  }

  // ---------------------------------------------------------------- 读取

  getSnapshot(): Snapshot {
    const pages = this.db.all<PageRow>('SELECT * FROM pages ORDER BY number').map(toPage)
    const words = this.db
      .all<WordRow>(
        `SELECT w.* FROM words w JOIN pages p ON p.id = w.page_id
         WHERE w.deleted_at IS NULL ORDER BY p.number, w.row_no`
      )
      .map(toWord)
    const deletedWords = this.db
      .all<WordRow>(
        `SELECT w.* FROM words w JOIN pages p ON p.id = w.page_id
         WHERE w.deleted_at IS NOT NULL ORDER BY w.deleted_at DESC, p.number, w.row_no`
      )
      .map(toWord)
    const checks = this.db
      .all<CheckRow>(
        `SELECT c.* FROM checks c JOIN words w ON w.id = c.word_id
         WHERE w.deleted_at IS NULL ORDER BY c.word_id, c.stage`
      )
      .map(toCheck)
    const deletedChecks = this.db
      .all<CheckRow>(
        `SELECT c.* FROM checks c JOIN words w ON w.id = c.word_id
         WHERE w.deleted_at IS NOT NULL ORDER BY c.word_id, c.stage`
      )
      .map(toCheck)
    const today = this.today()
    const firstAnswers = this.db
      .all<{ reviewed_at: string }>('SELECT reviewed_at FROM review_log WHERE is_retry = 0')
      .map((r) => r.reviewed_at)
    const days = activeDays(firstAnswers, this.readingDays(), this.timeZone())
    return {
      today,
      timeZone: this.timeZone(),
      pages,
      words,
      deletedWords,
      checks,
      deletedChecks,
      settings: this.getSettings(),
      streak: streakDays(days, today),
      books: this.getBooks(),
      sources: this.getSources(),
      known: this.getKnown()
    }
  }

  private getWordRow(id: string, includeDeleted = false): WordRow {
    const row = this.db.get<WordRow>(
      `SELECT ${WORD_COLUMNS} FROM words WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
      [id]
    )
    if (!row) throw new Error('找不到这个词')
    return row
  }

  private getChecks(wordId: string): CheckRecord[] {
    return this.db
      .all<CheckRow>('SELECT * FROM checks WHERE word_id = ? ORDER BY stage', [wordId])
      .map(({ stage, result, grade, done_on }) => ({
        stage,
        result,
        grade: grade as Grade | null,
        doneOn: done_on
      }))
  }

  // ---------------------------------------------------------------- 录入与编辑

  addWords(items: NewWordInput[]): AddWordsResult {
    if (items.length === 0) return { words: [], newPageNumbers: [] }
    return this.db.transaction(() => this.insertWords(items))
  }

  /** 写进今天的页（没有就新建一页）。不开事务，由调用方包在事务里。 */
  private insertWords(items: NewWordInput[]): AddWordsResult {
    const today = this.today()
    const now = this.nowIso()
    const fills = this.db
      .all<{ number: number; started_on: string; active: number; max_row: number | null }>(
        `SELECT p.number, p.started_on,
                COUNT(CASE WHEN w.deleted_at IS NULL AND w.id IS NOT NULL THEN 1 END) AS active,
                MAX(w.row_no) AS max_row
         FROM pages p LEFT JOIN words w ON w.page_id = p.id
         GROUP BY p.id ORDER BY p.number`
      )
      .map<PageFill>((r) => ({
        number: r.number,
        startedOn: r.started_on,
        activeCount: r.active,
        maxRowNo: r.max_row ?? 0
      }))
    const plan = planPlacements(fills, today, items.length)

    {
      for (const p of plan.newPages) {
        this.db.run('INSERT INTO pages (id, number, started_on, created_at) VALUES (?, ?, ?, ?)', [
          newId(),
          p.number,
          p.startedOn,
          now
        ])
      }
      const pageIds = new Map(
        this.db
          .all<{ id: string; number: number }>('SELECT id, number FROM pages')
          .map((r) => [r.number, r.id])
      )
      const created: Word[] = []
      items.forEach((item, i) => {
        const place = plan.placements[i]
        const pageId = pageIds.get(place.pageNumber)
        if (!pageId) throw new Error('页不存在')
        // 给出 pos（例如从词典选出的词义）时原样保存；否则从词义开头拆出词性
        const split =
          item.pos === undefined
            ? splitMeaningInput(item.meaning)
            : { pos: item.pos.trim(), meaning: item.meaning.trim() }
        const id = newId()
        this.db.run(
          `INSERT INTO words (id, page_id, row_no, text, meaning, pos, phonetic, status, lapses, starred, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 0, 0, ?, ?)`,
          [
            id,
            pageId,
            place.rowNo,
            item.text.trim(),
            split.meaning,
            split.pos,
            (item.phonetic ?? '').trim(),
            now,
            now
          ]
        )
        created.push(toWord(this.getWordRow(id)))
      })
      return { words: created, newPageNumbers: plan.newPages.map((p) => p.number) }
    }
  }

  updateWord(id: string, patch: WordPatch): void {
    const fields: [string, string][] = []
    for (const key of ['text', 'meaning', 'pos', 'phonetic', 'example', 'mnemonic'] as const) {
      const value = patch[key]
      if (value !== undefined) fields.push([key, value.trim()])
    }
    if (fields.some(([k, v]) => k === 'text' && v === '')) throw new Error('单词不能为空')
    if (fields.length === 0) return
    this.getWordRow(id)
    this.db.transaction(() => {
      this.db.run(
        `UPDATE words SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...fields.map(([, v]) => v), this.nowIso(), id]
      )
    })
  }

  setStarred(id: string, starred: boolean): void {
    this.getWordRow(id)
    this.db.transaction(() => {
      this.db.run('UPDATE words SET starred = ?, updated_at = ? WHERE id = ?', [
        starred ? 1 : 0,
        this.nowIso(),
        id
      ])
    })
  }

  deleteWord(id: string): void {
    this.getWordRow(id)
    const now = this.nowIso()
    this.db.transaction(() => {
      this.db.run('UPDATE words SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id])
    })
  }

  restoreWord(id: string): void {
    this.getWordRow(id, true)
    this.db.transaction(() => {
      this.db.run('UPDATE words SET deleted_at = NULL, updated_at = ? WHERE id = ?', [
        this.nowIso(),
        id
      ])
    })
  }

  /** 彻底删除回收站里的一个词：连同 checks、review_log，不可撤销。 */
  purgeWord(id: string): void {
    const row = this.getWordRow(id, true)
    if (row.deleted_at === null) throw new Error('只能彻底删除回收站里的词')
    this.db.transaction(() => this.purge([id]))
  }

  /** 清空回收站，返回删除的词数。 */
  emptyTrash(): number {
    const ids = this.db
      .all<{ id: string }>('SELECT id FROM words WHERE deleted_at IS NOT NULL')
      .map((r) => r.id)
    if (ids.length > 0) this.db.transaction(() => this.purge(ids))
    return ids.length
  }

  private purge(ids: string[]): void {
    for (const id of ids) {
      this.db.run('DELETE FROM review_log WHERE word_id = ?', [id])
      this.db.run('DELETE FROM word_sources WHERE word_id = ?', [id])
      this.db.run('DELETE FROM checks WHERE word_id = ?', [id])
      this.db.run('DELETE FROM words WHERE id = ?', [id])
    }
    const gone = new Set(ids)
    for (const [logId, entry] of this.undoEntries)
      if (gone.has(entry.wordId)) this.undoEntries.delete(logId)
  }

  getReviewLog(wordId: string): ReviewLogEntry[] {
    this.getWordRow(wordId, true)
    return this.db
      .all<{ id: string; stage: number; grade: number; is_retry: number; reviewed_at: string }>(
        'SELECT id, stage, grade, is_retry, reviewed_at FROM review_log WHERE word_id = ? ORDER BY reviewed_at DESC, rowid DESC',
        [wordId]
      )
      .map((r) => ({
        id: r.id,
        stage: r.stage,
        grade: r.grade as Grade,
        isRetry: r.is_retry === 1,
        reviewedAt: r.reviewed_at
      }))
  }

  // ---------------------------------------------------------------- 评分与撤销

  /** 本轮第一次作答（或网格评分）：写 checks（含 missed）、更新单词、写 review_log，同一个事务。 */
  gradeWord(wordId: string, grade: Grade): GradeResponse {
    const row = this.getWordRow(wordId)
    const before: GradeSnapshot = {
      word: {
        status: row.status,
        learnedOn: row.learned_on,
        lapses: row.lapses,
        starred: row.starred === 1
      },
      checks: this.getChecks(wordId)
    }
    const today = this.today()
    const outcome = scheduleGrade(before.word, before.checks, today, grade)
    const logId = newId()
    const now = this.nowIso()

    this.db.transaction(() => {
      for (const c of outcome.checks) {
        this.db.run(
          'INSERT INTO checks (word_id, stage, result, grade, done_on) VALUES (?, ?, ?, ?, ?)',
          [wordId, c.stage, c.result, c.grade, c.doneOn]
        )
      }
      this.writeSchedState(wordId, outcome.word, now)
      this.db.run(
        'INSERT INTO review_log (id, word_id, stage, grade, is_retry, reviewed_at) VALUES (?, ?, ?, ?, 0, ?)',
        [logId, wordId, outcome.stage, grade, now]
      )
    })

    this.undoEntries.set(logId, { wordId, before, updatedAt: row.updated_at, outcome })
    return {
      logId,
      stage: outcome.stage,
      result: outcome.result,
      missedStages: outcome.checks.filter((c) => c.result === 'missed').map((c) => c.stage)
    }
  }

  /** 本轮重现：只写 review_log（is_retry = 1），不改 checks，不改 lapses。 */
  logRetry(wordId: string, stage: number, grade: Grade): string {
    this.getWordRow(wordId)
    const logId = newId()
    this.db.transaction(() => {
      this.db.run(
        'INSERT INTO review_log (id, word_id, stage, grade, is_retry, reviewed_at) VALUES (?, ?, ?, ?, 1, ?)',
        [logId, wordId, stage, grade, this.nowIso()]
      )
    })
    return logId
  }

  /** 撤销一次评分：恢复 checks（含 missed）、lapses、starred、status、learned_on，删除对应的 review_log。 */
  undoGrade(logId: string, retryLogIds: string[] = []): void {
    const entry = this.undoEntries.get(logId)
    if (!entry) throw new Error('这次评分已经无法撤销')
    const plan = planUndo(entry.before, entry.outcome)

    this.db.transaction(() => {
      const placeholders = plan.deleteStages.map(() => '?').join(', ')
      this.db.run(`DELETE FROM checks WHERE word_id = ? AND stage IN (${placeholders})`, [
        entry.wordId,
        ...plan.deleteStages
      ])
      for (const c of plan.restoreChecks) {
        this.db.run(
          'INSERT INTO checks (word_id, stage, result, grade, done_on) VALUES (?, ?, ?, ?, ?)',
          [entry.wordId, c.stage, c.result, c.grade, c.doneOn]
        )
      }
      this.writeSchedState(entry.wordId, plan.word, entry.updatedAt)
      this.db.run('DELETE FROM review_log WHERE id = ?', [logId])
      for (const id of retryLogIds) {
        this.db.run('DELETE FROM review_log WHERE id = ? AND is_retry = 1', [id])
      }
    })
    this.undoEntries.delete(logId)
  }

  private writeSchedState(wordId: string, s: WordSchedState, now: string): void {
    this.db.run(
      'UPDATE words SET status = ?, learned_on = ?, lapses = ?, starred = ?, updated_at = ? WHERE id = ?',
      [s.status, s.learnedOn, s.lapses, s.starred ? 1 : 0, now, wordId]
    )
  }

  // ---------------------------------------------------------------- 设置

  getSettings(): Settings {
    const rows = this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings')
    const map = new Map(rows.map((r) => [r.key, r.value]))
    const theme = map.get('theme')
    const limit = Number(map.get('dailyNewLimit'))
    return {
      theme: THEME_SETTINGS.includes(theme as ThemeSetting) ? (theme as ThemeSetting) : 'system',
      dailyNewLimit:
        Number.isInteger(limit) && limit >= MIN_DAILY_NEW_LIMIT && limit <= MAX_DAILY_NEW_LIMIT
          ? limit
          : DEFAULT_DAILY_NEW_LIMIT
    }
  }

  private setSetting(key: string, value: string): Settings {
    this.db.transaction(() => {
      this.db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value]
      )
    })
    return this.getSettings()
  }

  setTheme(theme: ThemeSetting): Settings {
    if (!THEME_SETTINGS.includes(theme)) throw new Error('无效的主题')
    return this.setSetting('theme', theme)
  }

  setDailyNewLimit(limit: number): Settings {
    if (!Number.isInteger(limit) || limit < MIN_DAILY_NEW_LIMIT || limit > MAX_DAILY_NEW_LIMIT) {
      throw new Error(`每日新词上限必须是 ${MIN_DAILY_NEW_LIMIT}–${MAX_DAILY_NEW_LIMIT} 之间的整数`)
    }
    return this.setSetting('dailyNewLimit', String(limit))
  }

  // ---------------------------------------------------------------- 书

  getBooks(): BookSummary[] {
    return this.db
      .all<BookRow>(
        `SELECT * FROM books WHERE deleted_at IS NULL
         ORDER BY COALESCE(last_opened_at, added_at) DESC, added_at DESC`
      )
      .map(toBook)
  }

  getBook(id: string, includeDeleted = false): BookSummary {
    const row = this.db.get<BookRow>(
      `SELECT * FROM books WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
      [id]
    )
    if (!row) throw new Error('找不到这本书')
    return toBook(row)
  }

  /** 按文件哈希找书（含已删除的：重复导入时恢复它，不再新增） */
  findBookByHash(hash: string): (BookSummary & { deleted: boolean }) | null {
    const row = this.db.get<BookRow>(
      'SELECT * FROM books WHERE file_hash = ? ORDER BY added_at LIMIT 1',
      [hash]
    )
    return row ? { ...toBook(row), deleted: row.deleted_at !== null } : null
  }

  addBook(input: {
    id: string
    title: string
    author: string
    source: BookSource
    sourceId: string
    fileHash: string
    format: BookFormat
    parseVersion: number
  }): BookSummary {
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO books (id, title, author, source, source_id, file_hash, added_at, format, parse_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.title,
          input.author,
          input.source,
          input.sourceId,
          input.fileHash,
          this.nowIso(),
          input.format,
          input.parseVersion
        ]
      )
    })
    return this.getBook(input.id)
  }

  deleteBook(id: string): void {
    this.getBook(id)
    this.db.transaction(() => {
      this.db.run('UPDATE books SET deleted_at = ? WHERE id = ?', [this.nowIso(), id])
    })
  }

  restoreBook(id: string): BookSummary {
    this.getBook(id, true)
    this.db.transaction(() => {
      this.db.run('UPDATE books SET deleted_at = NULL WHERE id = ?', [id])
    })
    return this.getBook(id)
  }

  markBookOpened(id: string): BookSummary {
    this.getBook(id)
    this.db.transaction(() => {
      this.db.run('UPDATE books SET last_opened_at = ? WHERE id = ?', [this.nowIso(), id])
    })
    return this.getBook(id)
  }

  /**
   * 书重新解析后换算锚点（一个事务）：阅读位置、全部高亮（含已删除的，撤销时还要用）、全部出处。
   * map 返回新锚点；返回 null 表示按原文找不到，由 fallback 给出章首。返回每类的总数和找不到的条数。
   */
  remapBookAnchors(
    bookId: string,
    map: (pos: BookPosition) => BookPosition | null,
    fallback: (pos: BookPosition) => BookPosition,
    format: BookFormat,
    parseVersion: number
  ): { total: number; failed: number } {
    this.getBook(bookId, true)
    let total = 0
    let failed = 0
    const conv = (pos: BookPosition): BookPosition => {
      total++
      const r = map(pos)
      if (r) return r
      failed++
      return fallback(pos)
    }
    this.db.transaction(() => {
      const b = this.db.get<BookRow>('SELECT * FROM books WHERE id = ?', [bookId])
      if (b) {
        const p = conv({ chapter: b.pos_chapter, block: b.pos_block, offset: b.pos_offset })
        this.db.run(
          'UPDATE books SET pos_chapter = ?, pos_block = ?, pos_offset = ?, format = ?, parse_version = ? WHERE id = ?',
          [p.chapter, p.block, p.offset, format, parseVersion, bookId]
        )
      }
      for (const h of this.db.all<HighlightRow>('SELECT * FROM highlights WHERE book_id = ?', [
        bookId
      ])) {
        const start = conv({
          chapter: h.start_chapter,
          block: h.start_block,
          offset: h.start_offset
        })
        let end = conv({ chapter: h.end_chapter, block: h.end_block, offset: h.end_offset })
        if (comparePositions(end, start) <= 0) end = { ...start, offset: start.offset + 1 }
        this.db.run(
          `UPDATE highlights SET start_chapter = ?, start_block = ?, start_offset = ?,
             end_chapter = ?, end_block = ?, end_offset = ? WHERE id = ?`,
          [start.chapter, start.block, start.offset, end.chapter, end.block, end.offset, h.id]
        )
      }
      for (const s of this.db.all<SourceRow>('SELECT * FROM word_sources WHERE book_id = ?', [
        bookId
      ])) {
        const p = conv({ chapter: s.chapter, block: s.block, offset: s.offset })
        this.db.run('UPDATE word_sources SET chapter = ?, block = ?, "offset" = ? WHERE id = ?', [
          p.chapter,
          p.block,
          p.offset,
          s.id
        ])
      }
    })
    return { total, failed }
  }

  saveBookPosition(id: string, pos: BookPosition, progress: number): void {
    this.getBook(id)
    this.db.transaction(() => {
      this.db.run(
        'UPDATE books SET pos_chapter = ?, pos_block = ?, pos_offset = ?, progress = ? WHERE id = ?',
        [pos.chapter, pos.block, pos.offset, Math.max(0, Math.min(1, progress)), id]
      )
    })
  }

  /** 累加今天（本地日期）在这本书上的阅读秒数 */
  logReading(bookId: string, seconds: number): void {
    this.getBook(bookId)
    const day = this.today()
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO reading_log (date, book_id, seconds) VALUES (?, ?, ?)
         ON CONFLICT(date, book_id) DO UPDATE SET seconds = seconds + excluded.seconds`,
        [day, bookId, seconds]
      )
    })
  }

  readingDays(): ReadingDay[] {
    return this.db.all<ReadingDay>('SELECT date, seconds FROM reading_log')
  }

  // ---------------------------------------------------------------- 收词与出处

  getSources(): WordSource[] {
    return this.db
      .all<SourceRow>(
        `SELECT s.* FROM word_sources s JOIN words w ON w.id = s.word_id
         WHERE w.deleted_at IS NULL ORDER BY s.created_at DESC, s.rowid DESC`
      )
      .map(toSource)
  }

  /**
   * 收词：单词本里已经有这个词（不区分大小写，不算已删除的）时只追加出处；否则按手动录入的规则写进今天的页（新词）。
   * words.example 为空时填入出处的句子。整个过程一个事务。
   */
  collectWord(req: CollectRequest): CollectResult {
    this.getBook(req.source.bookId)
    const text = req.word.text.trim()
    if (text === '') throw new Error('单词不能为空')
    return this.db.transaction(() => {
      const existing = this.db.get<{ id: string; number: number; example: string }>(
        `SELECT w.id, p.number, w.example FROM words w JOIN pages p ON p.id = w.page_id
         WHERE w.deleted_at IS NULL AND lower(w.text) = lower(?) ORDER BY p.number, w.row_no LIMIT 1`,
        [text]
      )
      let wordId: string
      let pageNumber: number
      let example = ''
      if (existing) {
        wordId = existing.id
        pageNumber = existing.number
        example = existing.example
      } else {
        const [created] = this.insertWords([{ ...req.word, text }]).words
        wordId = created.id
        pageNumber =
          this.db.get<{ number: number }>('SELECT number FROM pages WHERE id = ?', [created.pageId])
            ?.number ?? 0
      }
      const now = this.nowIso()
      const { bookId, chapter, block, offset } = req.source
      const sentence = req.source.sentence.trim()
      this.db.run(
        `INSERT INTO word_sources (id, word_id, book_id, chapter, block, "offset", sentence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId(), wordId, bookId, chapter, block, offset, sentence, now]
      )
      if (example.trim() === '' && sentence !== '') {
        this.db.run('UPDATE words SET example = ?, updated_at = ? WHERE id = ?', [
          sentence,
          now,
          wordId
        ])
      }
      return { wordId, pageNumber, created: !existing }
    })
  }

  // ---------------------------------------------------------------- 熟词

  getKnown(): string[] {
    return this.db
      .all<{ lemma: string }>('SELECT lemma FROM known_words ORDER BY created_at DESC, rowid DESC')
      .map((r) => r.lemma)
  }

  addKnown(lemma: string): void {
    const key = lemma.trim().toLowerCase()
    if (key === '') throw new Error('单词不能为空')
    this.db.transaction(() => {
      this.db.run('INSERT OR IGNORE INTO known_words (lemma, created_at) VALUES (?, ?)', [
        key,
        this.nowIso()
      ])
    })
  }

  removeKnown(lemma: string): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM known_words WHERE lemma = ?', [lemma.trim().toLowerCase()])
    })
  }

  // ---------------------------------------------------------------- 高亮与笔记

  listHighlights(bookId: string | null): Highlight[] {
    const rows = bookId
      ? this.db.all<HighlightRow>(
          `SELECT * FROM highlights WHERE deleted_at IS NULL AND book_id = ?
           ORDER BY created_at DESC, rowid DESC`,
          [bookId]
        )
      : this.db.all<HighlightRow>(
          `SELECT h.* FROM highlights h JOIN books b ON b.id = h.book_id
           WHERE h.deleted_at IS NULL AND b.deleted_at IS NULL ORDER BY h.created_at DESC, h.rowid DESC`
        )
    return rows.map(toHighlight)
  }

  addHighlight(h: NewHighlight): Highlight {
    this.getBook(h.bookId)
    const id = newId()
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO highlights (id, book_id, start_chapter, start_block, start_offset, end_chapter,
           end_block, end_offset, text, color, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          h.bookId,
          h.start.chapter,
          h.start.block,
          h.start.offset,
          h.end.chapter,
          h.end.block,
          h.end.offset,
          h.text,
          h.color,
          h.note ?? '',
          this.nowIso()
        ]
      )
    })
    return toHighlight(this.getHighlightRow(id))
  }

  updateHighlight(id: string, patch: HighlightPatch): void {
    this.getHighlightRow(id)
    this.db.transaction(() => {
      if (patch.color !== undefined)
        this.db.run('UPDATE highlights SET color = ? WHERE id = ?', [patch.color, id])
      if (patch.note !== undefined)
        this.db.run('UPDATE highlights SET note = ? WHERE id = ?', [patch.note, id])
    })
  }

  deleteHighlight(id: string): void {
    this.getHighlightRow(id)
    this.db.transaction(() => {
      this.db.run('UPDATE highlights SET deleted_at = ? WHERE id = ?', [this.nowIso(), id])
    })
  }

  restoreHighlight(id: string): void {
    this.getHighlightRow(id, true)
    this.db.transaction(() => {
      this.db.run('UPDATE highlights SET deleted_at = NULL WHERE id = ?', [id])
    })
  }

  private getHighlightRow(id: string, includeDeleted = false): HighlightRow {
    const row = this.db.get<HighlightRow>(
      `SELECT * FROM highlights WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
      [id]
    )
    if (!row) throw new Error('找不到这条高亮')
    return row
  }

  // ---------------------------------------------------------------- 翻译缓存与其它设置

  getTranslation(hash: string, kind: string): string | null {
    return (
      this.db.get<{ result: string }>(
        'SELECT result FROM translations WHERE hash = ? AND kind = ?',
        [hash, kind]
      )?.result ?? null
    )
  }

  putTranslation(hash: string, kind: string, result: string): void {
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO translations (hash, kind, result, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(hash, kind) DO UPDATE SET result = excluded.result, created_at = excluded.created_at`,
        [hash, kind, result, this.nowIso()]
      )
    })
  }

  getSetting(key: string): string | null {
    return (
      this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value ??
      null
    )
  }

  putSetting(key: string, value: string): void {
    this.setSetting(key, value)
  }

  // ---------------------------------------------------------------- 批量写入（示例数据）

  /** 清空单词数据（保留设置），并在同一个事务里执行 fill。 */
  replaceAllData(fill: (db: SqlDb) => void): void {
    this.db.transaction(() => {
      this.db.exec(
        'DELETE FROM review_log; DELETE FROM word_sources; DELETE FROM checks; DELETE FROM words; DELETE FROM pages;'
      )
      fill(this.db)
    })
    this.undoEntries.clear()
  }
}
