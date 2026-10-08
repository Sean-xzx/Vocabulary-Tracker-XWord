/**
 * IPC 参数校验。渲染进程传来的一切都视为不可信输入。
 */
import type {
  AiKind,
  BookPosition,
  CallMeta,
  CollectRequest,
  HighlightColor,
  HighlightPatch,
  NewHighlight,
  PdfAssetKind,
  PdfInfo,
  GradeRequest,
  PowerReason,
  NewWordInput,
  RetryRequest,
  ThemeSetting,
  UndoRequest,
  WordPatch
} from '../shared/api'
import { HIGHLIGHT_COLORS, THEME_SETTINGS } from '../shared/api'
import {
  BLOCK_KINDS,
  type Block,
  type BlockKind,
  type Chapter,
  type ChapterRole,
  type Inline,
  type ParsedBook,
  type TocEntry,
  type TocGroup
} from '../shared/domain/book'
import { isValidInstant, isValidTimeZone } from '../shared/domain/dates'
import { STAGE_COUNT, isGrade } from '../shared/domain/scheduler'

export class ValidationError extends Error {}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const LIMITS = {
  text: 200,
  meaning: 2000,
  pos: 40,
  phonetic: 200,
  example: 2000,
  mnemonic: 2000,
  batch: 2000,
  retryIds: 500
} as const

function fail(message: string): never {
  throw new ValidationError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) fail(`不允许的字段：${key}`)
}

function str(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== 'string') fail(`${name} 必须是字符串`)
  if (value.length > max) fail(`${name} 太长`)
  if (required && value.trim() === '') fail(`${name} 不能为空`)
  return value
}

export function id(value: unknown): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) fail('无效的 id')
  return value
}

export function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') fail('必须是布尔值')
  return value
}

export function newWords(value: unknown): NewWordInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.batch)
    fail('无效的单词列表')
  return value.map((item) => {
    if (!isRecord(item)) fail('无效的单词')
    onlyKeys(item, ['text', 'meaning', 'pos', 'phonetic'])
    const out: NewWordInput = {
      text: str(item.text, '单词', LIMITS.text, true),
      meaning: str(item.meaning ?? '', '词义', LIMITS.meaning)
    }
    if (item.pos !== undefined) out.pos = str(item.pos, '词性', LIMITS.pos)
    if (item.phonetic !== undefined) out.phonetic = str(item.phonetic, '音标', LIMITS.phonetic)
    return out
  })
}

export function wordPatch(value: unknown): WordPatch {
  if (!isRecord(value)) fail('无效的修改')
  const keys = ['text', 'meaning', 'pos', 'phonetic', 'example', 'mnemonic'] as const
  onlyKeys(value, keys)
  const out: WordPatch = {}
  for (const key of keys) {
    if (value[key] !== undefined) out[key] = str(value[key], key, LIMITS[key], key === 'text')
  }
  return out
}

function stage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= STAGE_COUNT)
    fail('无效的节点')
  return value
}

export function gradeRequest(value: unknown): GradeRequest {
  if (!isRecord(value)) fail('无效的评分')
  onlyKeys(value, ['wordId', 'grade'])
  if (!isGrade(value.grade)) fail('评分必须是 1–4')
  return { wordId: id(value.wordId), grade: value.grade }
}

export function retryRequest(value: unknown): RetryRequest {
  if (!isRecord(value)) fail('无效的评分')
  onlyKeys(value, ['wordId', 'stage', 'grade'])
  if (!isGrade(value.grade)) fail('评分必须是 1–4')
  return { wordId: id(value.wordId), stage: stage(value.stage), grade: value.grade }
}

export function undoRequest(value: unknown): UndoRequest {
  if (!isRecord(value)) fail('无效的撤销')
  onlyKeys(value, ['logId', 'retryLogIds'])
  const retryLogIds = value.retryLogIds ?? []
  if (!Array.isArray(retryLogIds) || retryLogIds.length > LIMITS.retryIds) fail('无效的重现记录')
  return { logId: id(value.logId), retryLogIds: retryLogIds.map(id) }
}

export function theme(value: unknown): ThemeSetting {
  if (!THEME_SETTINGS.includes(value as ThemeSetting)) fail('无效的主题')
  return value as ThemeSetting
}

/** 词典查询的单词：可以是空串（直接返回查不到） */
export function dictWord(value: unknown): string {
  return str(value, '单词', LIMITS.text)
}

export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail('必须是整数')
  return value
}

/** preload 自动附带的调用上下文：只有一个合法的 IANA 时区名 */
export function callMeta(value: unknown): CallMeta {
  if (!isRecord(value)) fail('缺少调用上下文')
  onlyKeys(value, ['tz'])
  if (!isValidTimeZone(value.tz)) fail('无效的时区')
  return { tz: value.tz }
}

/** 开发时钟：ISO 8601 时刻或 null */
export function instantOrNull(value: unknown): string | null {
  if (value === null) return null
  if (!isValidInstant(value) || value.length > 40) fail('无效的时刻')
  return value
}

export function powerReason(value: unknown): PowerReason {
  if (value !== 'resume' && value !== 'unlock-screen') fail('无效的事件')
  return value
}

// ---------------------------------------------------------------- 阅读器

export const BOOK_LIMITS = {
  chapters: 5000,
  blocksPerChapter: 100_000,
  runsPerBlock: 5000,
  totalChars: 60_000_000,
  title: 300,
  tocEntries: 20_000,
  lemmas: 20_000,
  sentence: 2000,
  highlightText: 20_000,
  note: 5000,
  path: 1024,
  apiKey: 200
} as const

function nonNegInt(value: unknown, name: string, max = 10_000_000): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max)
    fail(`无效的${name}`)
  return value
}

export function bookPosition(value: unknown): BookPosition {
  if (!isRecord(value)) fail('无效的位置')
  onlyKeys(value, ['chapter', 'block', 'offset'])
  return {
    chapter: nonNegInt(value.chapter, '章节', BOOK_LIMITS.chapters),
    block: nonNegInt(value.block, '块', BOOK_LIMITS.blocksPerChapter),
    offset: nonNegInt(value.offset, '偏移')
  }
}

export function progress(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    fail('无效的进度')
  return value
}

export function seconds(value: unknown): number {
  return nonNegInt(value, '时长', 3600)
}

export function pdfAssetKind(value: unknown): PdfAssetKind {
  if (value !== 'cmap' && value !== 'font') fail('无效的 PDF 数据类型')
  return value
}

/** cMap（.bcmap）或标准字体（.pfb / .ttf）的文件名，不能带路径 */
export function pdfAssetName(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,80}\.(bcmap|pfb|ttf|otf)$/.test(value))
    fail('无效的 PDF 数据文件')
  return value
}

/** 渲染进程读出的 PDF 信息 */
export function pdfInfo(value: unknown): PdfInfo {
  if (!isRecord(value)) fail('无效的 PDF')
  onlyKeys(value, ['title', 'author', 'pages', 'toc'])
  const pages = nonNegInt(value.pages, '页数', 100_000)
  if (pages === 0) fail('这个 PDF 没有页面')
  if (!Array.isArray(value.toc) || value.toc.length > BOOK_LIMITS.tocEntries) fail('无效的书签')
  const toc: TocEntry[] = value.toc.map((e) => {
    if (!isRecord(e)) fail('无效的书签')
    onlyKeys(e, ['title', 'chapter', 'block', 'depth', 'group'])
    const entry: TocEntry = {
      title: str(e.title, '书签', BOOK_LIMITS.title),
      chapter: nonNegInt(e.chapter, '页码', pages - 1),
      block: nonNegInt(e.block, '块', 0),
      depth: nonNegInt(e.depth, '层级', 10)
    }
    if (e.group !== undefined) {
      if (e.group !== 'body') fail('无效的书签分组')
      entry.group = 'body'
    }
    return entry
  })
  return {
    title: str(value.title, '书名', BOOK_LIMITS.title),
    author: str(value.author, '作者', BOOK_LIMITS.title),
    pages,
    toc
  }
}

/** 书目录 images/ 下的文件名（导入时生成：序号 + 扩展名） */
export function imageName(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,6}\.(png|jpg|gif|webp|svg)$/.test(value))
    fail('无效的图片')
  return value
}

export function filePath(value: unknown): string {
  const p = str(value, '文件路径', BOOK_LIMITS.path, true)
  if (!/^[A-Za-z]:[\\/]|^\\\\|^\//.test(p)) fail('必须是完整的文件路径')
  return p
}

export function gutenbergId(value: unknown): number {
  return nonNegInt(value, '书号', 10_000_000)
}

export function searchQuery(value: unknown): string {
  return str(value, '搜索词', 200)
}

export function lemmaList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > BOOK_LIMITS.lemmas) fail('无效的单词列表')
  return value.map((w) => str(w, '单词', LIMITS.text).toLowerCase())
}

export function lemma(value: unknown): string {
  return str(value, '单词', LIMITS.text, true)
}

/** 渲染进程解析好的书：逐项检查结构、类型和大小，多余的字段一律拒绝 */
const CHAPTER_ROLES: readonly ChapterRole[] = ['cover', 'titlepage', 'toc', 'front', 'body', 'back']
const TOC_GROUPS: readonly TocGroup[] = ['front', 'body', 'back']
const STYLE_TOKEN_RE = /^[a-z0-9]{1,16}$/
const LINK_RE = /^\d{1,5}:\d{1,6}$/
/** 图片在压缩包里的路径（导入时由主进程取出，换成书目录里的文件名） */
const IMAGE_SRC_RE = /^[^\0<>"|?*]{1,400}$/

function flag(value: unknown, name: string): 1 | undefined {
  if (value === undefined) return undefined
  if (value !== 1) fail(`无效的${name}`)
  return 1
}

function inlineRun(r: unknown): Inline {
  if (!isRecord(r)) fail('无效的文字片段')
  onlyKeys(r, ['t', 'i', 'b', 'sc', 'sup', 'sub', 'a'])
  if (typeof r.t !== 'string') fail('无效的文字片段')
  const run: Inline = { t: r.t }
  for (const k of ['i', 'b', 'sc', 'sup', 'sub'] as const) if (flag(r[k], '格式')) run[k] = 1
  if (r.a !== undefined) {
    if (typeof r.a !== 'string' || !LINK_RE.test(r.a)) fail('无效的书内链接')
    run.a = r.a
  }
  return run
}

function bookBlock(b: unknown, count: (n: number) => void): Block {
  if (!isRecord(b)) fail('无效的段落')
  onlyKeys(b, [
    'k',
    'c',
    'lv',
    'd',
    'n',
    'src',
    'alt',
    'w',
    'h',
    'tb',
    'r',
    'col',
    'th',
    's',
    'cont'
  ])
  if (!BLOCK_KINDS.includes(b.k as BlockKind)) fail('无效的段落类型')
  if (!Array.isArray(b.c) || b.c.length > BOOK_LIMITS.runsPerBlock) fail('无效的段落内容')
  const runs = b.c.map(inlineRun)
  count(runs.reduce((n, r) => n + r.t.length, 0))
  const block: Block = { k: b.k as BlockKind, c: runs }
  if (b.lv !== undefined) block.lv = Math.max(1, nonNegInt(b.lv, '标题级别', 6))
  if (b.d !== undefined) block.d = nonNegInt(b.d, '层级', 20)
  if (b.n !== undefined) block.n = nonNegInt(b.n, '序号', 1_000_000)
  if (b.tb !== undefined) block.tb = nonNegInt(b.tb, '表格', 100_000)
  if (b.r !== undefined) block.r = nonNegInt(b.r, '表格行', 100_000)
  if (b.col !== undefined) block.col = nonNegInt(b.col, '表格列', 1000)
  if (flag(b.th, '表头')) block.th = 1
  if (flag(b.cont, '列表')) block.cont = 1
  if (b.src !== undefined) {
    if (typeof b.src !== 'string' || !IMAGE_SRC_RE.test(b.src)) fail('无效的图片')
    block.src = b.src
  }
  if (b.alt !== undefined) block.alt = str(b.alt, '图片说明', 1000)
  if (b.w !== undefined) block.w = nonNegInt(b.w, '图片宽度', 100_000)
  if (b.h !== undefined) block.h = nonNegInt(b.h, '图片高度', 100_000)
  if (b.s !== undefined) {
    if (!Array.isArray(b.s) || b.s.length > 16) fail('无效的样式')
    block.s = b.s.map((t) => {
      if (typeof t !== 'string' || !STYLE_TOKEN_RE.test(t)) fail('无效的样式')
      return t
    })
  }
  return block
}

export function parsedBook(value: unknown): ParsedBook {
  if (!isRecord(value)) fail('无效的书')
  onlyKeys(value, ['title', 'author', 'language', 'chapters', 'toc'])
  if (!Array.isArray(value.chapters) || value.chapters.length === 0) fail('这本书里没有正文')
  if (value.chapters.length > BOOK_LIMITS.chapters) fail('章节太多')
  let total = 0
  const count = (n: number): void => {
    total += n
    if (total > BOOK_LIMITS.totalChars) fail('这本书太大了')
  }
  const chapters: Chapter[] = value.chapters.map((c) => {
    if (!isRecord(c)) fail('无效的章节')
    onlyKeys(c, ['title', 'blocks', 'role'])
    if (!Array.isArray(c.blocks) || c.blocks.length > BOOK_LIMITS.blocksPerChapter)
      fail('无效的章节内容')
    const chapter: Chapter = {
      title: str(c.title, '章节标题', BOOK_LIMITS.title),
      blocks: c.blocks.map((b) => bookBlock(b, count))
    }
    if (c.role !== undefined) {
      if (!CHAPTER_ROLES.includes(c.role as ChapterRole)) fail('无效的章节类型')
      chapter.role = c.role as ChapterRole
    }
    return chapter
  })
  // 书内链接必须指向存在的章节
  for (const ch of chapters)
    for (const b of ch.blocks)
      for (const r of b.c)
        if (r.a && Number(r.a.split(':')[0]) >= chapters.length) fail('无效的书内链接')
  if (!Array.isArray(value.toc) || value.toc.length > BOOK_LIMITS.tocEntries) fail('无效的目录')
  const toc: TocEntry[] = value.toc.map((e) => {
    if (!isRecord(e)) fail('无效的目录项')
    onlyKeys(e, ['title', 'chapter', 'block', 'depth', 'group'])
    const chapter = nonNegInt(e.chapter, '章节', chapters.length - 1)
    const entry: TocEntry = {
      title: str(e.title, '目录标题', BOOK_LIMITS.title),
      chapter,
      block: nonNegInt(e.block, '块', Math.max(0, chapters[chapter].blocks.length - 1)),
      depth: nonNegInt(e.depth, '层级', 10)
    }
    if (e.group !== undefined) {
      if (!TOC_GROUPS.includes(e.group as TocGroup)) fail('无效的目录分组')
      entry.group = e.group as TocGroup
    }
    return entry
  })
  return {
    title: str(value.title, '书名', BOOK_LIMITS.title),
    author: str(value.author, '作者', BOOK_LIMITS.title),
    language: str(value.language, '语言', 40),
    chapters,
    toc
  }
}

export function collectRequest(value: unknown): CollectRequest {
  if (!isRecord(value)) fail('无效的收词')
  onlyKeys(value, ['word', 'source'])
  const [word] = newWords([value.word])
  const s = value.source
  if (!isRecord(s)) fail('无效的出处')
  onlyKeys(s, ['bookId', 'chapter', 'block', 'offset', 'sentence'])
  const pos = bookPosition({ chapter: s.chapter, block: s.block, offset: s.offset })
  return {
    word,
    source: {
      bookId: id(s.bookId),
      ...pos,
      sentence: str(s.sentence, '句子', BOOK_LIMITS.sentence)
    }
  }
}

function highlightColor(value: unknown): HighlightColor {
  if (!HIGHLIGHT_COLORS.includes(value as HighlightColor)) fail('无效的颜色')
  return value as HighlightColor
}

export function newHighlight(value: unknown): NewHighlight {
  if (!isRecord(value)) fail('无效的高亮')
  onlyKeys(value, ['bookId', 'start', 'end', 'text', 'color', 'note'])
  const out: NewHighlight = {
    bookId: id(value.bookId),
    start: bookPosition(value.start),
    end: bookPosition(value.end),
    text: str(value.text, '文字', BOOK_LIMITS.highlightText, true),
    color: highlightColor(value.color)
  }
  if (value.note !== undefined) out.note = str(value.note, '笔记', BOOK_LIMITS.note)
  return out
}

export function highlightPatch(value: unknown): HighlightPatch {
  if (!isRecord(value)) fail('无效的修改')
  onlyKeys(value, ['color', 'note'])
  const out: HighlightPatch = {}
  if (value.color !== undefined) out.color = highlightColor(value.color)
  if (value.note !== undefined) out.note = str(value.note, '笔记', BOOK_LIMITS.note)
  return out
}

export function aiKind(value: unknown): AiKind {
  if (value !== 'translate' && value !== 'explain') fail('无效的类型')
  return value
}

/** 超过 1000 个字符由 AiService 给出中文提示；这里只挡住明显异常的输入 */
export function aiText(value: unknown): string {
  return str(value, '文字', 100_000, true)
}

export function apiKey(value: unknown): string {
  return str(value, 'API key', BOOK_LIMITS.apiKey, true)
}

export function modelName(value: unknown): string {
  return str(value, '模型名称', 64)
}

export function nullableId(value: unknown): string | null {
  return value === null ? null : id(value)
}

/** openExternal 只开 https，且只限白名单站点 */
export const EXTERNAL_HOSTS = [
  'standardebooks.org',
  'www.standardebooks.org',
  'gutenberg.org',
  'www.gutenberg.org',
  'calibre-ebook.com',
  'www.calibre-ebook.com',
  'platform.deepseek.com'
]

export function externalUrl(value: unknown): string {
  const raw = str(value, '网址', 500, true)
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    fail('无效的网址')
  }
  if (
    u.protocol !== 'https:' ||
    !EXTERNAL_HOSTS.includes(u.hostname) ||
    u.username !== '' ||
    u.password !== '' ||
    u.port !== ''
  )
    fail('不允许打开这个网址')
  return u.toString()
}
