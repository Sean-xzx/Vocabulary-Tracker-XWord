/**
 * 主进程与渲染进程共用的 IPC 类型与通道白名单。
 * 渲染进程只能通过 preload 暴露的 window.xword 访问数据。
 */
import type { DateStr } from './domain/dates'
import type { BookMeta, ParsedBook, TocEntry, Chapter } from './domain/book'
import type { DictEntry } from './domain/dict'
import type { CheckRecord, CheckResult, Grade, WordStatus } from './domain/scheduler'

export type ThemeSetting = 'system' | 'light' | 'dark'
export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'light', 'dark']

export interface Page {
  id: string
  number: number
  startedOn: DateStr
  createdAt: string
}

export interface Word {
  id: string
  pageId: string
  rowNo: number
  text: string
  meaning: string
  pos: string
  phonetic: string
  example: string
  mnemonic: string
  learnedOn: DateStr | null
  status: WordStatus
  lapses: number
  starred: boolean
  createdAt: string
  updatedAt: string
  /** 软删除时间；未删除为 null */
  deletedAt: string | null
}

export interface WordCheck extends CheckRecord {
  wordId: string
}

export interface Settings {
  theme: ThemeSetting
  dailyNewLimit: number
}

export interface Snapshot {
  /** 主进程按本地时钟和本地时区算出的“今天”。 */
  today: DateStr
  /** 算“今天”用的时区（IANA 名） */
  timeZone: string
  pages: Page[]
  /** 未软删除的词。 */
  words: Word[]
  /** 回收站：已软删除的词（按删除时间倒序）。 */
  deletedWords: Word[]
  /** 未软删除的词的检查记录。 */
  checks: WordCheck[]
  /** 回收站里的词的检查记录（词库详情显示用）。 */
  deletedChecks: WordCheck[]
  settings: Settings
  /** 连续打卡天数（本地日期）：当天有过第一次作答，或累计阅读满 5 分钟 */
  streak: number
  /** 书架上的书（未删除），最近打开的在前 */
  books: BookSummary[]
  /** 未删除的词的出处，新的在前 */
  sources: WordSource[]
  /** 熟词（原形，小写） */
  known: string[]
}

// ---------------------------------------------------------------- 阅读器

export type BookSource = 'gutenberg' | 'import'
/** 书的格式：EPUB / TXT 用书页排版模式，PDF 用原版页面模式 */
export type BookFormat = 'epub' | 'txt' | 'pdf'

/** 书里的位置：章节下标 + 块下标 + 块内字符偏移（UTF-16） */
export interface BookPosition {
  chapter: number
  block: number
  offset: number
}

export interface BookSummary {
  id: string
  title: string
  author: string
  source: BookSource
  sourceId: string
  addedAt: string
  lastOpenedAt: string | null
  position: BookPosition
  /** 0–1 */
  progress: number
  format: BookFormat
  /** 正文的解析版本：1 = v0.3 导入，2 = v0.4 按原书结构解析（PDF 不解析正文，也记 2） */
  parseVersion: number
}

/** 打开一本书时读到的元数据（meta.json + toc.json） */
export interface BookDetail {
  book: BookSummary
  meta: BookMeta
  toc: TocEntry[]
  /** 书目录里存着原文件（v0.3 导入的书没有） */
  hasSource: boolean
}

export interface WordSource {
  id: string
  wordId: string
  bookId: string
  chapter: number
  block: number
  offset: number
  /** 这个词所在的完整句子 */
  sentence: string
  createdAt: string
}

export type HighlightColor = 'yellow' | 'green' | 'red' | 'blue' | 'purple'
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  'yellow',
  'green',
  'red',
  'blue',
  'purple'
]

export interface Highlight {
  id: string
  bookId: string
  start: BookPosition
  end: BookPosition
  text: string
  color: HighlightColor
  note: string
  createdAt: string
}

export interface NewHighlight {
  bookId: string
  start: BookPosition
  end: BookPosition
  text: string
  color: HighlightColor
  note?: string
}

export interface HighlightPatch {
  color?: HighlightColor
  note?: string
}

/** 收词：单词（新词时用）+ 出处 */
export interface CollectRequest {
  word: NewWordInput
  source: {
    bookId: string
    chapter: number
    block: number
    offset: number
    sentence: string
  }
}

export interface CollectResult {
  wordId: string
  pageNumber: number
  /** false：这个词已经在单词本里，只追加了出处 */
  created: boolean
}

/** 导入：TXT 在主进程直接完成；EPUB 把文本文件交给渲染进程用 DOMParser 解析，再用 importCommit 提交 */
export type ImportPrepared =
  | { status: 'imported'; book: BookSummary }
  | { status: 'exists'; book: BookSummary }
  | { status: 'parse'; token: string; files: Record<string, string>; fileName: string }
  /** 重新解析时没有原文件：需要用户重新导入 */
  | { status: 'missing'; book: BookSummary }
  /** PDF：渲染进程用 pdf.js 读出页数、书签、判断是不是扫描版，再用 importCommitPdf 提交 */
  | { status: 'pdf'; token: string; fileName: string; bytes: Uint8Array }

/** 渲染进程读出的 PDF 信息 */
export interface PdfInfo {
  title: string
  author: string
  pages: number
  /** 书签（chapter 是页码，从 0 开始） */
  toc: TocEntry[]
}

/** PDF 渲染用的本地数据（pdf.js 的 cMap、标准字体） */
export type PdfAssetKind = 'cmap' | 'font'

export interface GutendexBook {
  id: number
  title: string
  authors: string[]
  downloadCount: number
  /** 能下载的格式（优先 EPUB3 带图版本，其次纯文本）；没有时不能下载 */
  format: 'epub' | 'txt' | null
}

export interface GutendexPage {
  books: GutendexBook[]
  count: number
}

export interface DownloadProgress {
  gutenbergId: number
  received: number
  /** 未知时为 0 */
  total: number
}

// ---------------------------------------------------------------- AI 翻译

export type AiKind = 'translate' | 'explain'

export interface AiStatus {
  /** 只告诉渲染进程“已设置 / 未设置”，key 本身不回传 */
  hasKey: boolean
  model: string
  /** 系统不支持 safeStorage 加密时为 false，不能保存 key */
  canEncrypt: boolean
}

export type AiErrorCode =
  'noKey' | 'unauthorized' | 'balance' | 'rateLimit' | 'network' | 'timeout' | 'server' | 'tooLong'

export interface AiError {
  code: AiErrorCode
  message: string
  /** 断网、超时、服务器错误可以重试 */
  retryable: boolean
}

export type AiStart =
  | { status: 'cached'; result: string }
  | { status: 'stream'; requestId: string }
  | { status: 'error'; error: AiError }

export interface AiChunk {
  requestId: string
  delta?: string
  done?: boolean
  error?: AiError
}

export interface NewWordInput {
  text: string
  meaning: string
  /** 给出时原样保存（例如从词典选出的词性）；省略时从 meaning 开头拆出词性 */
  pos?: string
  phonetic?: string
}

export interface AddWordsResult {
  words: Word[]
  /** 这次新建的页码。 */
  newPageNumbers: number[]
}

export interface WordPatch {
  text?: string
  meaning?: string
  pos?: string
  phonetic?: string
  example?: string
  mnemonic?: string
}

export interface GradeRequest {
  wordId: string
  grade: Grade
}

export interface GradeResponse {
  logId: string
  stage: number
  result: Extract<CheckResult, 'ok' | 'fail'>
  missedStages: number[]
}

export interface RetryRequest {
  wordId: string
  stage: number
  grade: Grade
}

export interface UndoRequest {
  /** 第一次作答的 review_log id。 */
  logId: string
  /** 同时要删除的重现记录（is_retry = 1）。 */
  retryLogIds?: string[]
}

export interface ReviewLogEntry {
  id: string
  stage: number
  grade: Grade
  isRetry: boolean
  reviewedAt: string
}

/** 词典查询结果：词典还在后台加载时为 loading；加载失败为 unavailable。 */
export type DictLookupResult =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'notFound' }
  | { status: 'found'; entry: DictEntry }

export interface AppInfo {
  version: string
  isDev: boolean
  dataDir: string
  dbPath: string
}

export const IPC = {
  getSnapshot: 'xword:get-snapshot',
  addWords: 'xword:add-words',
  updateWord: 'xword:update-word',
  setStarred: 'xword:set-starred',
  deleteWord: 'xword:delete-word',
  restoreWord: 'xword:restore-word',
  purgeWord: 'xword:purge-word',
  emptyTrash: 'xword:empty-trash',
  getReviewLog: 'xword:get-review-log',
  dictLookup: 'xword:dict-lookup',
  dictLemmas: 'xword:dict-lemmas',
  gradeWord: 'xword:grade-word',
  logRetry: 'xword:log-retry',
  undoGrade: 'xword:undo-grade',
  setTheme: 'xword:set-theme',
  setDailyNewLimit: 'xword:set-daily-new-limit',
  getAppInfo: 'xword:get-app-info',
  openDataFolder: 'xword:open-data-folder',
  openExternal: 'xword:open-external',
  loadSampleData: 'xword:load-sample-data',
  // 书
  importPick: 'xword:import-pick',
  importPrepare: 'xword:import-prepare',
  importCommit: 'xword:import-commit',
  importCommitPdf: 'xword:import-commit-pdf',
  bookPdf: 'xword:book-pdf',
  pdfAsset: 'xword:pdf-asset',
  bookOpen: 'xword:book-open',
  bookChapter: 'xword:book-chapter',
  bookReparse: 'xword:book-reparse',
  bookImage: 'xword:book-image',
  bookSavePosition: 'xword:book-save-position',
  bookDelete: 'xword:book-delete',
  bookRestore: 'xword:book-restore',
  logReading: 'xword:log-reading',
  gutendexSearch: 'xword:gutendex-search',
  gutendexDownload: 'xword:gutendex-download',
  // 收词、熟词、高亮
  collectWord: 'xword:collect-word',
  addKnown: 'xword:add-known',
  removeKnown: 'xword:remove-known',
  listHighlights: 'xword:list-highlights',
  addHighlight: 'xword:add-highlight',
  updateHighlight: 'xword:update-highlight',
  deleteHighlight: 'xword:delete-highlight',
  restoreHighlight: 'xword:restore-highlight',
  // AI 翻译
  aiStatus: 'xword:ai-status',
  aiSaveKey: 'xword:ai-save-key',
  aiClearKey: 'xword:ai-clear-key',
  aiSetModel: 'xword:ai-set-model',
  aiTest: 'xword:ai-test',
  aiStart: 'xword:ai-start',
  aiCancel: 'xword:ai-cancel',
  // 测试开关（只在未打包时有效）
  devSetNow: 'xword:dev-set-now',
  devSimulatePower: 'xword:dev-simulate-power',
  devRestoreWindow: 'xword:dev-restore-window'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** 每次 IPC 调用由 preload 自动附带的上下文（第一个参数）。 */
export interface CallMeta {
  /** 渲染进程当前的时区（Chromium 会跟随系统时区变化） */
  tz: string
}

export type PowerReason = 'resume' | 'unlock-screen'

/** 主进程推给渲染进程的事件（白名单）。 */
export interface EventMap {
  /** 系统唤醒、屏幕解锁：渲染进程重新检查日期 */
  clock: { reason: PowerReason }
  /** Gutenberg 下载进度 */
  download: DownloadProgress
  /** AI 流式输出 */
  ai: AiChunk
}

export const EVENTS: { [K in keyof EventMap]: string } = {
  clock: 'xword:event:clock',
  download: 'xword:event:download',
  ai: 'xword:event:ai'
}

export interface XWordApi {
  getSnapshot(): Promise<Snapshot>
  addWords(items: NewWordInput[]): Promise<AddWordsResult>
  updateWord(id: string, patch: WordPatch): Promise<void>
  setStarred(id: string, starred: boolean): Promise<void>
  deleteWord(id: string): Promise<void>
  restoreWord(id: string): Promise<void>
  /** 彻底删除回收站里的一个词（连同 checks、review_log），不可撤销。 */
  purgeWord(id: string): Promise<void>
  /** 清空回收站，返回删除的词数。 */
  emptyTrash(): Promise<number>
  /** 一个词的复习记录，按时间倒序。 */
  getReviewLog(wordId: string): Promise<ReviewLogEntry[]>
  dictLookup(word: string): Promise<DictLookupResult>
  /** 一批词的原形（小写）；词典里查不到的词原样返回小写。词典未加载时返回 null */
  dictLemmas(words: string[]): Promise<Record<string, string> | null>
  gradeWord(req: GradeRequest): Promise<GradeResponse>
  logRetry(req: RetryRequest): Promise<string>
  undoGrade(req: UndoRequest): Promise<void>
  setTheme(theme: ThemeSetting): Promise<Settings>
  setDailyNewLimit(limit: number): Promise<Settings>
  getAppInfo(): Promise<AppInfo>
  openDataFolder(): Promise<void>
  /** 用系统浏览器打开白名单里的 https 网站 */
  openExternal(url: string): Promise<void>
  /** 仅开发模式可用：清空现有数据并载入示例数据。 */
  loadSampleData(): Promise<void>

  /** 弹出文件选择框；返回选中的文件路径（取消时为 null） */
  importPick(): Promise<string | null>
  /** 读取并检查一个文件（大小、格式、DRM、去重）；TXT 直接导入 */
  importPrepare(path: string): Promise<ImportPrepared>
  /** 提交渲染进程解析好的 EPUB */
  importCommit(token: string, book: ParsedBook): Promise<BookSummary>
  /** 提交渲染进程读出的 PDF 信息（不是扫描版才提交） */
  importCommitPdf(token: string, info: PdfInfo): Promise<BookSummary>
  /** PDF 原文件的内容 */
  bookPdf(id: string): Promise<Uint8Array>
  /** pdf.js 的 cMap / 标准字体（打包在本地） */
  pdfAsset(kind: PdfAssetKind, name: string): Promise<Uint8Array>
  /** 拖进窗口的文件对应的本地路径（preload 用 webUtils 取得） */
  pathForFile(file: File): string
  /** 读书的元数据和目录；touch 为 true 时记为“刚打开”（阅读页用；首页、书架只读取） */
  bookOpen(id: string, touch: boolean): Promise<BookDetail>
  bookChapter(id: string, chapter: number): Promise<Chapter>
  /** 按新规则重新解析旧书（原文件在书目录里时）；EPUB 返回 parse，需要在渲染进程解析后 importCommit */
  bookReparse(id: string): Promise<ImportPrepared>
  /** 书里的图片（data: 地址） */
  bookImage(id: string, name: string): Promise<string>
  bookSavePosition(id: string, position: BookPosition, progress: number): Promise<void>
  bookDelete(id: string): Promise<void>
  bookRestore(id: string): Promise<void>
  logReading(bookId: string, seconds: number): Promise<void>
  gutendexSearch(query: string): Promise<GutendexPage>
  gutendexDownload(gutenbergId: number): Promise<ImportPrepared>

  collectWord(req: CollectRequest): Promise<CollectResult>
  addKnown(lemma: string): Promise<void>
  removeKnown(lemma: string): Promise<void>
  /** bookId 为 null 时返回全部书的高亮 */
  listHighlights(bookId: string | null): Promise<Highlight[]>
  addHighlight(h: NewHighlight): Promise<Highlight>
  updateHighlight(id: string, patch: HighlightPatch): Promise<void>
  deleteHighlight(id: string): Promise<void>
  restoreHighlight(id: string): Promise<void>

  aiStatus(): Promise<AiStatus>
  aiSaveKey(key: string): Promise<AiStatus>
  aiClearKey(): Promise<AiStatus>
  aiSetModel(model: string): Promise<AiStatus>
  /** 测试连接：成功返回 null，失败返回错误 */
  aiTest(): Promise<AiError | null>
  aiStart(kind: AiKind, text: string): Promise<AiStart>
  aiCancel(requestId: string): Promise<void>

  /** 仅开发 / 测试：把主进程的时钟拨到指定时刻（null 恢复） */
  devSetNow(iso: string | null): Promise<void>
  /** 仅开发 / 测试：模拟系统唤醒 / 屏幕解锁 */
  devSimulatePower(reason: PowerReason): Promise<void>
  /** 仅开发 / 测试：窗口被最小化时恢复（不抢焦点） */
  devRestoreWindow(): Promise<void>
  /** 订阅主进程事件，返回取消订阅的函数 */
  on<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): () => void
}
