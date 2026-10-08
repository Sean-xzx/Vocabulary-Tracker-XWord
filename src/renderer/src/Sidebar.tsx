/**
 * 侧栏（直接放在桌面上，不画边框）：顶部 Logo + 字标；最上方“今日”（首页）；两组并列——
 * 「阅读」书架、高亮与笔记；「单词」今日复习、单词本、词库；底部“连续打卡”小卡片、统计、设置。
 * 选中项的底色是一块单独的指示器，切换页面时用 transform 滑到新位置。Ctrl+1–8 依次对应这些入口。
 */
import {
  CalendarCheck,
  ChartColumn,
  Flame,
  Highlighter,
  House,
  Library,
  LibraryBig,
  NotebookPen,
  Settings,
  type LucideIcon
} from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { Wordmark, XWordMark } from './components/brand/XWordMark'
import { cx } from './lib/cx'
import { VIEWS, useApp, useTodayQueue, type NavViewId } from './store/app'

interface NavEntry {
  id: NavViewId
  label: string
  icon: LucideIcon
}

const HOME: NavEntry = { id: 'home', label: '今日', icon: House }
const GROUPS: { title: string; items: NavEntry[] }[] = [
  {
    title: '阅读',
    items: [
      { id: 'shelf', label: '书架', icon: LibraryBig },
      { id: 'highlights', label: '高亮与笔记', icon: Highlighter }
    ]
  },
  {
    title: '单词',
    items: [
      { id: 'today', label: '今日复习', icon: CalendarCheck },
      { id: 'wordbook', label: '单词本', icon: NotebookPen },
      { id: 'library', label: '词库', icon: Library }
    ]
  }
]
const FOOT: NavEntry[] = [
  { id: 'stats', label: '统计', icon: ChartColumn },
  { id: 'settings', label: '设置', icon: Settings }
]

function NavItem({
  item,
  current,
  count,
  onPick
}: {
  item: NavEntry
  current: boolean
  count?: number
  onPick: () => void
}): ReactElement {
  const Icon = item.icon
  return (
    <li>
      <button
        type="button"
        className={cx('nav-item', current && 'is-current')}
        aria-current={current ? 'page' : undefined}
        aria-keyshortcuts={`Control+${VIEWS.indexOf(item.id) + 1}`}
        data-view={item.id}
        onClick={onPick}
      >
        <Icon size={18} aria-hidden />
        <span className="nav-label">{item.label}</span>
        {count !== undefined && (
          <span
            className={cx('nav-count', count === 0 && 'is-zero')}
            aria-label={`今日队列 ${count} 个`}
          >
            {count}
          </span>
        )}
      </button>
    </li>
  )
}

export function Sidebar(): ReactElement {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const streak = useApp((s) => s.snapshot?.streak ?? 0)
  const queue = useTodayQueue()
  const nav = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState<{ y: number; h: number } | null>(null)

  // 选中底色的位置跟着当前页面走（窗口大小变化时重新量）
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = nav.current?.querySelector<HTMLElement>('.nav-item.is-current')
      if (el) {
        const top = el.getBoundingClientRect().top - (nav.current?.getBoundingClientRect().top ?? 0)
        setIndicator({ y: top, h: el.offsetHeight })
      } else setIndicator(null)
    }
    measure()
    // 下一帧再量，避免在 ResizeObserver 回调里改布局引起“loop completed”警告
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    })
    if (nav.current) observer.observe(nav.current)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [view])

  const item = (entry: NavEntry): ReactElement => (
    <NavItem
      key={entry.id}
      item={entry}
      current={view === entry.id}
      count={entry.id === 'today' ? queue?.items.length : undefined}
      onPick={() => setView(entry.id)}
    />
  )

  return (
    <nav ref={nav} className="sidebar" aria-label="主导航">
      {indicator && (
        <span
          className="nav-indicator"
          aria-hidden
          style={{ height: indicator.h, transform: `translateY(${indicator.y}px)` }}
        />
      )}
      <div className="sidebar-brand">
        <XWordMark size={28} />
        <Wordmark className="sidebar-wordmark" />
      </div>
      <ul className="nav-list nav-home">{item(HOME)}</ul>
      {GROUPS.map((g) => (
        <div key={g.title} className="nav-group" role="group" aria-label={g.title}>
          <div className="nav-group-title">{g.title}</div>
          <ul className="nav-list">{g.items.map(item)}</ul>
        </div>
      ))}
      <div className="sidebar-foot">
        <div className="streak-card" aria-label={`连续打卡 ${streak} 天`}>
          <Flame size={16} aria-hidden className="streak-icon" />
          <span>连续打卡</span>
          <span className="streak-num num">{streak}</span>
          <span>天</span>
        </div>
        <ul className="nav-list">{FOOT.map(item)}</ul>
      </div>
    </nav>
  )
}
