import { useMemo } from 'react'
import { create } from 'zustand'
import type { AppInfo, BookPosition, Snapshot } from '@shared/api'
import type { TodayQueue } from '@shared/domain/queue'
import { queueFromSnapshot } from '@shared/snapshot'
import { devSetNow } from '../lib/clock'
import { markStartup } from '../lib/startup'

/** 导航里的页面（按侧栏顺序，Ctrl+1–8）；reader 是阅读页，不在导航里 */
export type NavViewId =
  'home' | 'shelf' | 'highlights' | 'today' | 'wordbook' | 'library' | 'stats' | 'settings'
export type ViewId = NavViewId | 'reader'
export const VIEWS: NavViewId[] = [
  'home',
  'shelf',
  'highlights',
  'today',
  'wordbook',
  'library',
  'stats',
  'settings'
]

/** 打开阅读页：书 + 要跳到的位置（缺省为上次读到的位置）；flashEnd 给出时，跳过去后标出 position 到它之间的文字 */
export interface ReaderTarget {
  bookId: string
  position?: BookPosition
  flashEnd?: BookPosition
  /** 每次打开都不同：同一本书的同一位置再次跳转也会生效 */
  nonce: number
}

interface AppState {
  snapshot: Snapshot | null
  appInfo: AppInfo | null
  loadError: string | null
  view: ViewId
  /** 每次导航都递增：再次点击当前页面的入口时让页面重新开始（例如从完成页回到概览） */
  viewKey: number
  /** 复习中：收起导航栏，只显示卡片 */
  focusMode: boolean
  /** 单词页要显示的页码；null 表示最新一页 */
  wordbookPage: number | null
  /** 打开单词页后要把焦点放到的词（从词库“在第 N 页查看”跳过来） */
  wordbookFocusWordId: string | null
  /** 阅读页打开的书；离开阅读页后保留，返回书架时用 */
  reader: ReaderTarget | null
  /** 词库要选中的词（从首页、阅读页跳过来） */
  libraryFocusWordId: string | null
  /** 从首页点“开始复习”：进入今日复习后直接开始 */
  autoStartReview: boolean
  init: () => Promise<void>
  refresh: () => Promise<Snapshot | null>
  setView: (view: NavViewId) => void
  setFocusMode: (on: boolean) => void
  openWordbookPage: (pageNumber: number | null, focusWordId?: string) => void
  clearWordbookFocus: () => void
  openBook: (bookId: string, position?: BookPosition, flashEnd?: BookPosition) => void
  openLibraryWord: (wordId: string) => void
  startReview: () => void
  clearAutoStart: () => void
}

let refreshing: Promise<Snapshot | null> | null = null
let nonce = 0

export const useApp = create<AppState>((set, get) => ({
  snapshot: null,
  appInfo: null,
  loadError: null,
  // 冷启动一律进入今日首页
  view: 'home',
  viewKey: 0,
  focusMode: false,
  wordbookPage: null,
  wordbookFocusWordId: null,
  reader: null,
  libraryFocusWordId: null,
  autoStartReview: false,

  init: async () => {
    try {
      const [snapshot, appInfo] = await Promise.all([
        window.xword.getSnapshot(),
        window.xword.getAppInfo()
      ])
      set({ snapshot, appInfo, loadError: null })
      if (appInfo.isDev) window.__xwordDev = { setNow: devSetNow }
      markStartup('dataReady')
    } catch (error) {
      set({ loadError: error instanceof Error ? error.message : String(error) })
    }
  },

  refresh: () => {
    // 合并并发的刷新请求
    if (!refreshing) {
      refreshing = window.xword
        .getSnapshot()
        .then((snapshot) => {
          set({ snapshot })
          return snapshot
        })
        .catch((error: unknown) => {
          set({ loadError: error instanceof Error ? error.message : String(error) })
          return null
        })
        .finally(() => {
          refreshing = null
        })
    }
    return refreshing
  },

  setView: (view) => set({ view, viewKey: get().viewKey + 1, focusMode: false }),

  setFocusMode: (on) => set({ focusMode: on }),

  openWordbookPage: (pageNumber, focusWordId) => {
    const changing = get().view !== 'wordbook'
    set({
      view: 'wordbook',
      focusMode: false,
      wordbookPage: pageNumber,
      wordbookFocusWordId: focusWordId ?? null,
      viewKey: changing ? get().viewKey + 1 : get().viewKey
    })
  },

  clearWordbookFocus: () => set({ wordbookFocusWordId: null }),

  openBook: (bookId, position, flashEnd) =>
    set({
      view: 'reader',
      focusMode: false,
      reader: { bookId, position, flashEnd, nonce: ++nonce },
      viewKey: get().viewKey + 1
    }),

  openLibraryWord: (wordId) =>
    set({
      view: 'library',
      focusMode: false,
      libraryFocusWordId: wordId,
      viewKey: get().viewKey + 1
    }),

  startReview: () =>
    set({ view: 'today', focusMode: false, autoStartReview: true, viewKey: get().viewKey + 1 }),

  clearAutoStart: () => set({ autoStartReview: false })
}))

/** 今日队列：由快照 + 调度核心算出。 */
export function useTodayQueue(): TodayQueue | null {
  const snapshot = useApp((s) => s.snapshot)
  return useMemo(() => (snapshot ? queueFromSnapshot(snapshot) : null), [snapshot])
}
