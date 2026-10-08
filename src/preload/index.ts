/**
 * preload（运行在沙箱中）：只把白名单里的类型化 API 暴露给页面，不暴露 ipcRenderer 本身。
 * 每次调用自动附带当前时区（CallMeta）：主进程感知不到系统时区的变化，渲染进程可以。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  EVENTS,
  IPC,
  type CallMeta,
  type EventMap,
  type IpcChannel,
  type XWordApi
} from '../shared/api'

function meta(): CallMeta {
  return { tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (channel: IpcChannel, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(channel, meta(), ...args)

const api: XWordApi = {
  getSnapshot: () => call(IPC.getSnapshot),
  addWords: (items) => call(IPC.addWords, items),
  updateWord: (id, patch) => call(IPC.updateWord, id, patch),
  setStarred: (id, starred) => call(IPC.setStarred, id, starred),
  deleteWord: (id) => call(IPC.deleteWord, id),
  restoreWord: (id) => call(IPC.restoreWord, id),
  purgeWord: (id) => call(IPC.purgeWord, id),
  emptyTrash: () => call(IPC.emptyTrash),
  getReviewLog: (wordId) => call(IPC.getReviewLog, wordId),
  dictLookup: (word) => call(IPC.dictLookup, word),
  dictLemmas: (words) => call(IPC.dictLemmas, words),
  gradeWord: (req) => call(IPC.gradeWord, req),
  logRetry: (req) => call(IPC.logRetry, req),
  undoGrade: (req) => call(IPC.undoGrade, req),
  setTheme: (theme) => call(IPC.setTheme, theme),
  setDailyNewLimit: (limit) => call(IPC.setDailyNewLimit, limit),
  getAppInfo: () => call(IPC.getAppInfo),
  openDataFolder: () => call(IPC.openDataFolder),
  openExternal: (url) => call(IPC.openExternal, url),
  loadSampleData: () => call(IPC.loadSampleData),

  importPick: () => call(IPC.importPick),
  importPrepare: (path) => call(IPC.importPrepare, path),
  importCommit: (token, book) => call(IPC.importCommit, token, book),
  importCommitPdf: (token, info) => call(IPC.importCommitPdf, token, info),
  bookPdf: (id) => call(IPC.bookPdf, id),
  pdfAsset: (kind, name) => call(IPC.pdfAsset, kind, name),
  pathForFile: (file) => webUtils.getPathForFile(file),
  bookOpen: (id, touch) => call(IPC.bookOpen, id, touch),
  bookChapter: (id, chapter) => call(IPC.bookChapter, id, chapter),
  bookReparse: (id) => call(IPC.bookReparse, id),
  bookImage: (id, name) => call(IPC.bookImage, id, name),
  bookSavePosition: (id, position, progress) => call(IPC.bookSavePosition, id, position, progress),
  bookDelete: (id) => call(IPC.bookDelete, id),
  bookRestore: (id) => call(IPC.bookRestore, id),
  logReading: (bookId, seconds) => call(IPC.logReading, bookId, seconds),
  gutendexSearch: (query) => call(IPC.gutendexSearch, query),
  gutendexDownload: (id) => call(IPC.gutendexDownload, id),

  collectWord: (req) => call(IPC.collectWord, req),
  addKnown: (lemma) => call(IPC.addKnown, lemma),
  removeKnown: (lemma) => call(IPC.removeKnown, lemma),
  listHighlights: (bookId) => call(IPC.listHighlights, bookId),
  addHighlight: (h) => call(IPC.addHighlight, h),
  updateHighlight: (id, patch) => call(IPC.updateHighlight, id, patch),
  deleteHighlight: (id) => call(IPC.deleteHighlight, id),
  restoreHighlight: (id) => call(IPC.restoreHighlight, id),

  aiStatus: () => call(IPC.aiStatus),
  aiSaveKey: (key) => call(IPC.aiSaveKey, key),
  aiClearKey: () => call(IPC.aiClearKey),
  aiSetModel: (model) => call(IPC.aiSetModel, model),
  aiTest: () => call(IPC.aiTest),
  aiStart: (kind, text) => call(IPC.aiStart, kind, text),
  aiCancel: (requestId) => call(IPC.aiCancel, requestId),

  devSetNow: (iso) => call(IPC.devSetNow, iso),
  devSimulatePower: (reason) => call(IPC.devSimulatePower, reason),
  devRestoreWindow: () => call(IPC.devRestoreWindow),
  on: (event, listener) => {
    const channel = EVENTS[event]
    if (!channel) throw new Error('未知事件')
    const handler = (_e: unknown, payload: unknown): void =>
      listener(payload as EventMap[typeof event])
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }
}

contextBridge.exposeInMainWorld('xword', api)
