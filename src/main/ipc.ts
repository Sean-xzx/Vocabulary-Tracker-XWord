/**
 * IPC：只注册白名单里的通道；只接受来自本应用页面的调用；每个参数都经过校验。
 */
import {
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import {
  EVENTS,
  IPC,
  type AppInfo,
  type IpcChannel,
  type PowerReason,
  type ThemeSetting
} from '../shared/api'
import type { AiService } from './ai'
import type { Gutendex } from './books/gutendex'
import { ImportError, type Importer } from './books/importer'
import { readPdfAsset } from './books/pdfAssets'
import type { BookStore } from './books/store'
import { setDevNow, setTimeZone } from './clock'
import type { Repository } from './db/repository'
import type { DictService } from './dict'
import { fillSampleData } from './db/sample'
import { logError, logInfo } from './log'
import { NetError } from './net'
import * as v from './validate'
import { themeBackground } from './window'

export interface IpcContext {
  repo: Repository
  dict: DictService
  store: BookStore
  importer: Importer
  gutendex: Gutendex
  ai: AiService
  appInfo: AppInfo
  getWindow: () => BrowserWindow | null
  /** 判断调用方页面是否是本应用。 */
  isTrustedUrl: (url: string) => boolean
}

export function applyTheme(theme: ThemeSetting, win: BrowserWindow | null): void {
  nativeTheme.themeSource = theme
  win?.setBackgroundColor(themeBackground())
}

export function registerIpc(ctx: IpcContext): void {
  const { repo } = ctx

  const handle = (channel: IpcChannel, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, meta: unknown, ...args: unknown[]) => {
      const url = event.senderFrame?.url ?? ''
      if (!ctx.isTrustedUrl(url)) throw new Error('拒绝来自未知页面的调用')
      // 渲染进程报告的当前时区：之后“今天”都按它计算
      const { tz } = v.callMeta(meta)
      if (setTimeZone(tz)) logInfo(`时区变为 ${tz}`)
      return fn(...args)
    })
  }

  let firstSnapshot = true
  handle(IPC.getSnapshot, () => {
    const snapshot = repo.getSnapshot()
    if (firstSnapshot) {
      firstSnapshot = false
      logInfo(`渲染进程已连通：${snapshot.words.length} 个词，今天 ${snapshot.today}`)
    }
    return snapshot
  })
  handle(IPC.addWords, (items) => repo.addWords(v.newWords(items)))
  handle(IPC.updateWord, (wordId, patch) => repo.updateWord(v.id(wordId), v.wordPatch(patch)))
  handle(IPC.setStarred, (wordId, starred) => repo.setStarred(v.id(wordId), v.bool(starred)))
  handle(IPC.deleteWord, (wordId) => repo.deleteWord(v.id(wordId)))
  handle(IPC.restoreWord, (wordId) => repo.restoreWord(v.id(wordId)))
  handle(IPC.purgeWord, (wordId) => repo.purgeWord(v.id(wordId)))
  handle(IPC.emptyTrash, () => repo.emptyTrash())
  handle(IPC.getReviewLog, (wordId) => repo.getReviewLog(v.id(wordId)))
  handle(IPC.dictLookup, (word) => ctx.dict.lookup(v.dictWord(word)))
  handle(IPC.gradeWord, (req) => {
    const { wordId, grade } = v.gradeRequest(req)
    return repo.gradeWord(wordId, grade)
  })
  handle(IPC.logRetry, (req) => {
    const { wordId, stage, grade } = v.retryRequest(req)
    return repo.logRetry(wordId, stage, grade)
  })
  handle(IPC.undoGrade, (req) => {
    const { logId, retryLogIds } = v.undoRequest(req)
    repo.undoGrade(logId, retryLogIds)
  })
  handle(IPC.setTheme, (theme) => {
    const settings = repo.setTheme(v.theme(theme))
    applyTheme(settings.theme, ctx.getWindow())
    return settings
  })
  handle(IPC.setDailyNewLimit, (limit) => repo.setDailyNewLimit(v.integer(limit)))
  handle(IPC.getAppInfo, () => ctx.appInfo)
  handle(IPC.openDataFolder, async () => {
    const error = await shell.openPath(ctx.appInfo.dataDir)
    if (error) throw new Error(error)
  })
  handle(IPC.loadSampleData, () => {
    if (!ctx.appInfo.isDev) throw new Error('只有开发模式可以载入示例数据')
    repo.replaceAllData((db) => fillSampleData(db, repo.today()))
  })
  handle(IPC.openExternal, async (url) => {
    await shell.openExternal(v.externalUrl(url))
  })
  handle(IPC.dictLemmas, (words) => ctx.dict.lemmas(v.lemmaList(words)))

  // ---------------------------------------------------------------- 书
  const { importer, store, gutendex } = ctx
  const importFailure = (error: unknown): never => {
    // 导入失败是用户能看懂的原因（格式、大小、DRM、网络），直接给出中文说明
    if (error instanceof ImportError || error instanceof NetError) throw new Error(error.message)
    logError('导入失败', error)
    throw new Error('无法读取这个文件（文件损坏或格式不支持）')
  }
  handle(IPC.importPick, async () => {
    const win = ctx.getWindow()
    const options = {
      title: '导入书',
      properties: ['openFile' as const],
      filters: [
        { name: '电子书（EPUB、TXT、PDF）', extensions: ['epub', 'txt', 'pdf'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
  handle(IPC.importPrepare, (path) => {
    try {
      return importer.prepareFromPath(v.filePath(path))
    } catch (error) {
      return importFailure(error)
    }
  })
  handle(IPC.importCommit, (token, book) => {
    try {
      return importer.commit(v.id(token), v.parsedBook(book))
    } catch (error) {
      return importFailure(error)
    }
  })
  handle(IPC.bookOpen, (bookId, touch) => {
    const id = v.id(bookId)
    const book = v.bool(touch) ? repo.markBookOpened(id) : repo.getBook(id)
    return {
      book,
      meta: store.readMeta(id),
      toc: store.readToc(id),
      hasSource: store.hasSource(id)
    }
  })
  handle(IPC.bookChapter, (bookId, chapter) => {
    const id = v.id(bookId)
    repo.getBook(id)
    return store.readChapter(id, v.bookPosition({ chapter, block: 0, offset: 0 }).chapter)
  })
  handle(IPC.importCommitPdf, (token, info) => {
    try {
      return importer.commitPdf(v.id(token), v.pdfInfo(info))
    } catch (error) {
      return importFailure(error)
    }
  })
  handle(IPC.bookPdf, (bookId) => {
    const id = v.id(bookId)
    const book = repo.getBook(id)
    if (book.format !== 'pdf') throw new Error('这本书不是 PDF')
    const src = store.readSource(id)
    if (!src) throw new Error('PDF 文件不见了，请重新导入这本书')
    return src.bytes
  })
  handle(IPC.pdfAsset, (kind, name) => readPdfAsset(v.pdfAssetKind(kind), v.pdfAssetName(name)))
  handle(IPC.bookReparse, (bookId) => {
    try {
      return importer.prepareReparse(v.id(bookId))
    } catch (error) {
      return importFailure(error)
    }
  })
  handle(IPC.bookImage, (bookId, name) => {
    const id = v.id(bookId)
    repo.getBook(id)
    return store.readImage(id, v.imageName(name))
  })
  handle(IPC.bookSavePosition, (bookId, position, progress) =>
    repo.saveBookPosition(v.id(bookId), v.bookPosition(position), v.progress(progress))
  )
  handle(IPC.bookDelete, (bookId) => repo.deleteBook(v.id(bookId)))
  handle(IPC.bookRestore, (bookId) => void repo.restoreBook(v.id(bookId)))
  handle(IPC.logReading, (bookId, secs) => repo.logReading(v.id(bookId), v.seconds(secs)))
  handle(IPC.gutendexSearch, async (query) => {
    try {
      return await gutendex.search(v.searchQuery(query))
    } catch (error) {
      return importFailure(error)
    }
  })
  handle(IPC.gutendexDownload, async (gid) => {
    const id = v.gutenbergId(gid)
    try {
      const { bytes, download } = await gutendex.download(id, (p) => {
        const win = ctx.getWindow()
        if (win && !win.isDestroyed()) win.webContents.send(EVENTS.download, p)
      })
      logInfo(`已下载 Gutenberg #${id}（${download.format}，${bytes.byteLength} 字节）`)
      const ext = download.format === 'epub' ? 'epub' : 'txt'
      return importer.prepare(bytes, {
        fileName: `${download.title.slice(0, 80)}.${ext}`,
        source: 'gutenberg',
        sourceId: String(id)
      })
    } catch (error) {
      return importFailure(error)
    }
  })

  // ---------------------------------------------------------------- 收词、熟词、高亮
  handle(IPC.collectWord, (req) => repo.collectWord(v.collectRequest(req)))
  handle(IPC.addKnown, (lemma) => repo.addKnown(v.lemma(lemma)))
  handle(IPC.removeKnown, (lemma) => repo.removeKnown(v.lemma(lemma)))
  handle(IPC.listHighlights, (bookId) => repo.listHighlights(v.nullableId(bookId)))
  handle(IPC.addHighlight, (h) => repo.addHighlight(v.newHighlight(h)))
  handle(IPC.updateHighlight, (hid, patch) =>
    repo.updateHighlight(v.id(hid), v.highlightPatch(patch))
  )
  handle(IPC.deleteHighlight, (hid) => repo.deleteHighlight(v.id(hid)))
  handle(IPC.restoreHighlight, (hid) => repo.restoreHighlight(v.id(hid)))

  // ---------------------------------------------------------------- AI 翻译（key 从不回传）
  const { ai } = ctx
  handle(IPC.aiStatus, () => ai.status())
  handle(IPC.aiSaveKey, (key) => ai.saveKey(v.apiKey(key)))
  handle(IPC.aiClearKey, () => ai.clearKey())
  handle(IPC.aiSetModel, (model) => ai.setModel(v.modelName(model)))
  handle(IPC.aiTest, () => ai.test())
  handle(IPC.aiStart, (kind, text) => ai.start(v.aiKind(kind), v.aiText(text)))
  handle(IPC.aiCancel, (requestId) => ai.cancel(v.id(requestId)))

  // 测试开关：只在未打包时生效
  handle(IPC.devSetNow, (iso) => {
    if (!ctx.appInfo.isDev) throw new Error('只有开发模式可以修改时钟')
    setDevNow(v.instantOrNull(iso))
  })
  handle(IPC.devSimulatePower, (reason) => {
    if (!ctx.appInfo.isDev) throw new Error('只有开发模式可以模拟系统事件')
    notifyPower(ctx.getWindow(), v.powerReason(reason))
  })
  handle(IPC.devRestoreWindow, () => {
    if (!ctx.appInfo.isDev) throw new Error('只有开发模式可以控制窗口')
    // 端到端测试：窗口被最小化时页面不出动画帧（pdf.js 画不完），恢复但不抢焦点
    const win = ctx.getWindow()
    if (win && win.isMinimized()) {
      win.restore()
      win.showInactive()
    }
  })
}

/** 系统唤醒、屏幕解锁：通知渲染进程重新检查日期（不依赖午夜定时器，睡眠时它不会触发）。 */
export function notifyPower(win: BrowserWindow | null, reason: PowerReason): void {
  if (win && !win.isDestroyed()) win.webContents.send(EVENTS.clock, { reason })
}
