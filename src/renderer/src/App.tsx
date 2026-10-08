import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Splash } from './components/brand/Splash'
import { ToastViewport } from './components/ui'
import { HighlightsView } from './features/highlights/HighlightsView'
import { HomeView } from './features/home/HomeView'
import { LibraryView } from './features/library/LibraryView'
import { ReaderView } from './features/reader/ReaderView'
import { ShelfView } from './features/shelf/ShelfView'
import { importFromPath, useFileDrop } from './features/shelf/importBook'
import { SettingsView } from './features/settings/SettingsView'
import { StatsView } from './features/stats/StatsView'
import { TodayView } from './features/today/TodayView'
import { WordbookView } from './features/wordbook/WordbookView'
import { clockNow, currentTimeZone } from './lib/clock'
import { cx } from './lib/cx'
import { startDayWatch } from './lib/dayWatch'
import { isOverlayOpen, isTypingTarget } from './lib/keys'
import { markStartup } from './lib/startup'
import { Sidebar } from './Sidebar'
import { stopSpeaking } from './lib/speech'
import { VIEWS, useApp, type ViewId } from './store/app'
import './app.css'

const VIEW_COMPONENTS: Record<ViewId, () => ReactElement | null> = {
  home: HomeView,
  shelf: ShelfView,
  highlights: HighlightsView,
  reader: ReaderView,
  today: TodayView,
  wordbook: WordbookView,
  library: LibraryView,
  stats: StatsView,
  settings: SettingsView
}

export default function App(): ReactElement {
  const view = useApp((s) => s.view)
  const viewKey = useApp((s) => s.viewKey)
  const focusMode = useApp((s) => s.focusMode)
  const snapshot = useApp((s) => s.snapshot)
  const loadError = useApp((s) => s.loadError)
  const [splash, setSplash] = useState(true)
  // 离开页面或重新进入同页时停止旧声音（也取消尚未加载完成的语音请求）。
  useEffect(() => () => stopSpeaking(), [view, viewKey])
  const endSplash = useCallback(() => {
    setSplash(false)
    markStartup('interactive')
  }, [])

  useEffect(() => {
    void useApp
      .getState()
      .init()
      .then(() => {
        // 测试开关（只在开发 / 测试环境挂上）：按界面流程导入本地文件
        if (useApp.getState().appInfo?.isDev && window.__xwordDev)
          window.__xwordDev.importPath = importFromPath
      })
    // 窗口获得焦点时照常刷新（别处可能改过数据）；日期检查另见下方 startDayWatch
    const onFocus = (): void => void useApp.getState().refresh()
    window.addEventListener('focus', onFocus)
    // 系统唤醒、屏幕解锁、页面重新可见、每 60 秒：日期或时区变了就刷新
    const stopWatch = startDayWatch({
      now: clockNow,
      timeZone: currentTimeZone,
      current: () => useApp.getState().snapshot,
      refresh: () => void useApp.getState().refresh(),
      triggers: [
        (check) => window.xword.on('clock', check),
        (check) => {
          const onVisible = (): void => {
            if (document.visibilityState === 'visible') check()
          }
          document.addEventListener('visibilitychange', onVisible)
          return () => document.removeEventListener('visibilitychange', onVisible)
        }
      ]
    })
    return () => {
      window.removeEventListener('focus', onFocus)
      stopWatch()
    }
  }, [])

  // 把文件拖进窗口的任何位置都能导入
  const dragging = useFileDrop()

  // Ctrl+1–8 切换页面（复习中、阅读中、输入框内、弹层打开时不触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > VIEWS.length) return
      const state = useApp.getState()
      if (state.focusMode || state.view === 'reader' || isTypingTarget(e.target) || isOverlayOpen())
        return
      e.preventDefault()
      state.setView(VIEWS[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const Current = VIEW_COMPONENTS[view]
  const reading = view === 'reader'

  return (
    <div className={cx('app', focusMode && 'is-focus', reading && 'is-reading')}>
      {!focusMode && !reading && <Sidebar />}
      <main className="main">
        {loadError ? (
          <div className="load-error" role="alert">
            数据加载失败：{loadError}
          </div>
        ) : snapshot ? (
          <div key={viewKey} className="view">
            <Current />
          </div>
        ) : (
          <div className="skeleton" aria-hidden />
        )}
      </main>
      {dragging && (
        <div className="drop-hint" aria-hidden>
          <span>松开即可导入这本书（EPUB、TXT、PDF）</span>
        </div>
      )}
      <ToastViewport />
      {splash && <Splash ready={snapshot !== null || loadError !== null} onDone={endSplash} />}
    </div>
  )
}
