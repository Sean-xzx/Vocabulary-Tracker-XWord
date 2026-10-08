/**
 * 阅读页外壳：像真正的书一样一页一页地读。进入后侧栏收起。
 * - 顶栏 48px：返回、书名（只要主标题）、当前章节、目录、页面设置；底栏 40px：第 N / M 页（点一下可输入页码跳转）、
 *   荧光笔样式的细进度线、本章剩余页数、全书百分比；
 * - 中间是桌面，书页由引擎排版（EPUB / TXT：EpubPages；PDF：PdfPages）；
 * - 翻页：← / PageUp 上一页，→ / PageDown / 空格 下一页，点击左右 15% 区域，滚轮一格一页；Home / End 本章首尾；[ / ] 换章；
 * - 点词查词、选中后高亮 / 笔记 / 翻译 / 收词、点高亮打开菜单，在两种模式里走同一套逻辑（经由 PagesApi 换算锚点）。
 * 位置、高亮、出处都存锚点，不存页码；每 2 秒节流保存一次。
 */
import { ArrowLeft, ListTree, Settings2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type WheelEvent as ReactWheelEvent
} from 'react'
import type { BookDetail, BookPosition, Highlight, HighlightColor } from '@shared/api'
import { comparePositions } from '@shared/domain/book'
import { DOUBLE_MIN_WIDTH, pageGeometry } from '@shared/domain/pagination'
import { tokenize } from '@shared/domain/tokenize'
import { displayTitle, sentenceOf, wordAt } from '@shared/domain/words'
import { Button, EmptyState, IconButton } from '../../components/ui'
import { hasModifier, isOverlayOpen, isTypingTarget } from '../../lib/keys'
import { duration } from '../../motion'
import { useApp } from '../../store/app'
import { toast, toastError } from '../../store/toast'
import { errorMessage, finishImport, reportImportError } from '../shelf/importBook'
import type { PagesApi, PagesStatus } from './engine'
import { EpubPages } from './EpubPages'
import { PdfPages } from './PdfPages'
import { playFx } from './fx'
import { HighlightMenu } from './HighlightMenu'
import { LookupCard, type LookupTarget } from './LookupCard'
import { caretAt, rangeContains } from './pageScan'
import { loadPrefs, savePrefs, type ReaderPrefs } from './prefs'
import { ReaderSettings } from './ReaderSettings'
import { SelectionToolbar } from './SelectionToolbar'
import { currentTocIndex } from './toc'
import { TocDrawer } from './TocDrawer'
import { TranslatePanel } from './TranslatePanel'
import { useReadingTimer } from './useReadingTimer'
import { useWordMarks } from './useWordMarks'
import './reader.css'

const SAVE_INTERVAL_MS = 2000
/** 正文的解析版本（与主进程 importer 的 PARSE_VERSION 一致） */
const PARSE_VERSION = 2
/** 正文前面超过这么多页时，首次打开显示“跳到正文” */
const FRONT_PAGES_LIMIT = 10
/** 左右两侧点击翻页的区域 */
const CLICK_ZONE = 0.15
const RESIZE_SETTLE_MS = 120

interface SelectionInfo {
  start: BookPosition
  end: BookPosition
  text: string
  rect: DOMRect
  /** 只选中了一个英文单词 */
  word: LookupTarget | null
}

/** 查词卡片、高亮菜单要一个真实元素做参照：在单词所在的位置放一个看不见的定位块 */
function useAnchorEl(): (rect: DOMRect) => HTMLElement {
  const el = useRef<HTMLElement | null>(null)
  useEffect(
    () => () => {
      el.current?.remove()
      el.current = null
    },
    []
  )
  return useCallback((rect: DOMRect) => {
    const a = document.createElement('div')
    a.className = 'reader-anchor'
    a.setAttribute('aria-hidden', 'true')
    a.style.left = `${rect.left}px`
    a.style.top = `${rect.top}px`
    a.style.width = `${Math.max(1, rect.width)}px`
    a.style.height = `${Math.max(1, rect.height)}px`
    document.body.appendChild(a)
    // 旧的参照块等弹层淡出后再删
    const old = el.current
    if (old) setTimeout(() => old.remove(), 400)
    el.current = a
    return a
  }, [])
}

function useStageSize(stage: HTMLElement | null): { w: number; h: number; win: number } | null {
  const [size, setSize] = useState<{ w: number; h: number; win: number } | null>(null)
  useEffect(() => {
    if (!stage) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const read = (): void => {
      const r = stage.getBoundingClientRect()
      setSize((s) =>
        s &&
        s.w === Math.round(r.width) &&
        s.h === Math.round(r.height) &&
        s.win === window.innerWidth
          ? s
          : { w: Math.round(r.width), h: Math.round(r.height), win: window.innerWidth }
      )
    }
    const ro = new ResizeObserver(() => {
      // 拖动窗口时不必每一帧都重新排版
      if (timer) clearTimeout(timer)
      timer = setTimeout(read, RESIZE_SETTLE_MS)
    })
    ro.observe(stage)
    read()
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [stage])
  return size
}

export function ReaderView(): ReactElement | null {
  const target = useApp((s) => s.reader)
  const setView = useApp((s) => s.setView)
  const [detail, setDetail] = useState<BookDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bookId = target?.bookId ?? null
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => loadPrefs(target?.bookId ?? ''))
  const [status, setStatus] = useState<PagesStatus | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [aaOpen, setAaOpen] = useState(false)
  const [aaAnchor, setAaAnchor] = useState<HTMLButtonElement | null>(null)
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const api = useRef<PagesApi>(null)
  const marks = useWordMarks(status?.data ?? null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [pendingHighlight, setPendingHighlight] = useState<string | null>(null)
  const [lookup, setLookup] = useState<(LookupTarget & { autoCollect?: boolean }) | null>(null)
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [menu, setMenu] = useState<{
    id: string
    anchor: HTMLElement
    focusNote: boolean
    word: LookupTarget | null
  } | null>(null)
  const collectRef = useRef<(() => void) | null>(null)
  const [translate, setTranslate] = useState<{ text: string; rect: DOMRect; nonce: number } | null>(
    null
  )
  const [jumping, setJumping] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
  const [legacy, setLegacy] = useState(false)
  const [firstOpen, setFirstOpen] = useState(false)
  const anchorEl = useAnchorEl()
  const size = useStageSize(stage)

  // ---------------------------------------------------------------- 打开书

  useEffect(() => {
    if (!target) return
    let alive = true
    const show = (d: BookDetail): void => {
      if (!alive) return
      setFirstOpen(
        d.book.progress === 0 && d.book.position.chapter === 0 && d.book.position.block === 0
      )
      setDetail(d)
      void window.xword
        .listHighlights(d.book.id)
        .then((h) => alive && setHighlights(h))
        .catch(toastError)
      void useApp.getState().refresh()
    }
    const open = async (): Promise<void> => {
      const d = await window.xword.bookOpen(target.bookId, true)
      if (!alive) return
      if (d.book.format === 'pdf' || d.book.parseVersion >= PARSE_VERSION) return show(d)
      if (!d.hasSource) {
        // v0.3 导入的书没有保存原文件：照旧显示，提示重新导入
        setLegacy(true)
        return show(d)
      }
      // 原文件还在：按新规则重新解析（阅读位置、高亮、出处在主进程里按原文换算）
      setUpgrading(true)
      await finishImport(await window.xword.bookReparse(d.book.id))
      if (!alive) return
      setUpgrading(false)
      show(await window.xword.bookOpen(target.bookId, false))
    }
    open().catch((e: unknown) => alive && setError(errorMessage(e)))
    return () => {
      alive = false
    }
  }, [target])

  /** 重新导入原文件：同一个文件会按新规则重新解析这本书 */
  const reimport = async (): Promise<void> => {
    const path = await window.xword.importPick()
    if (!path || !bookId) return
    try {
      const book = await finishImport(await window.xword.importPrepare(path))
      if (book.id !== bookId) {
        toast(`这不是同一个文件，已作为新书《${book.title}》导入`)
        return
      }
      useApp.getState().openBook(bookId)
    } catch (e) {
      reportImportError(e)
    }
  }

  const start = useMemo(() => {
    if (!detail) return null
    const pos = target?.position ?? detail.book.position
    const chapter = Math.max(0, Math.min(pos.chapter, detail.meta.chapters.length - 1))
    return {
      pos: chapter === pos.chapter ? pos : { chapter, block: 0, offset: 0 },
      flashEnd: target?.position ? target.flashEnd : undefined
    }
  }, [detail, target])

  const geometry = useMemo(() => {
    if (!size) return null
    const double = prefs.spread === 'double' && size.win >= DOUBLE_MIN_WIDTH
    return pageGeometry(size.w, size.h, double, prefs.margin)
  }, [size, prefs.spread, prefs.margin])

  const changePrefs = (next: ReaderPrefs): void => {
    setPrefs(next)
    if (bookId) savePrefs(bookId, next)
  }

  // ---------------------------------------------------------------- 翻页后关掉跟正文位置有关的弹层

  const closeFloating = useCallback(() => {
    setLookup(null)
    setMenu(null)
    setSelection(null)
  }, [])
  const lastStatus = useRef<PagesStatus | null>(null)
  const onStatus = useCallback(
    (s: PagesStatus) => {
      const old = lastStatus.current
      lastStatus.current = s
      if (old && (old.anchor !== s.anchor || old.chapter !== s.chapter)) closeFloating()
      setStatus(s)
    },
    [closeFloating]
  )
  // 窗口尺寸、排版变了，页面重新排版：弹层的位置已经不对（渲染期间按 props 调整 state）
  const [lastGeometry, setLastGeometry] = useState(geometry)
  if (lastGeometry !== geometry) {
    setLastGeometry(geometry)
    setLookup(null)
    setMenu(null)
    setSelection(null)
  }

  // ---------------------------------------------------------------- 保存位置

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<{ position: BookPosition; progress: number } | null>(null)
  const flushSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const last = latest.current
    if (!bookId || !last) return
    latest.current = null
    void window.xword.bookSavePosition(bookId, last.position, last.progress).catch(() => {})
  }, [bookId])

  useEffect(() => {
    if (!status) return
    latest.current = { position: status.anchor, progress: status.progress }
    // 每 2 秒最多保存一次（节流，最后一次一定会保存）
    if (!saveTimer.current) saveTimer.current = setTimeout(flushSave, SAVE_INTERVAL_MS)
  }, [status, flushSave])

  useEffect(
    () => () => {
      flushSave()
      void useApp.getState().refresh()
    },
    [flushSave]
  )

  // ---------------------------------------------------------------- 高亮

  const clearSelection = (): void => {
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const fx = (
    range: Range | null,
    kind: 'underline' | 'highlight',
    color?: HighlightColor
  ): void => {
    const host = api.current?.fxHost()
    if (range && host) void playFx(host, range, kind, color, api.current?.visibleRect() ?? null)
  }

  const createHighlight = async (color: HighlightColor, openNote = false): Promise<void> => {
    const sel = selection
    if (!sel || !bookId) return
    clearSelection()
    try {
      const h = await window.xword.addHighlight({
        bookId,
        start: sel.start,
        end: sel.end,
        text: sel.text.slice(0, 20_000),
        color
      })
      setPendingHighlight(h.id)
      setHighlights((list) => [h, ...list])
      // 荧光笔从左往右划出（200ms），划完再显示真正的底色
      // 用定时器而不是动画的结束事件：窗口被遮挡时动画不推进，高亮也不能一直透明
      setTimeout(() => {
        fx(api.current?.rangeOf(h.start, h.end) ?? null, 'highlight', color)
        setTimeout(() => {
          setPendingHighlight((p) => (p === h.id ? null : p))
          if (openNote) {
            const r = api.current?.rangeOf(h.start, h.end)?.getClientRects()[0]
            if (r) setMenu({ id: h.id, anchor: anchorEl(r), focusNote: true, word: null })
          }
        }, duration('--dur-sweep'))
      }, 0)
      if (!openNote)
        toast('已高亮', {
          label: '撤销',
          run: () => void removeHighlight(h, false)
        })
    } catch (e) {
      toastError(e)
    }
  }

  const removeHighlight = async (h: Highlight, withUndo: boolean): Promise<void> => {
    try {
      await window.xword.deleteHighlight(h.id)
      setHighlights((list) => list.filter((x) => x.id !== h.id))
      setMenu(null)
      if (withUndo)
        toast('已删除高亮', {
          label: '撤销',
          run: async () => {
            try {
              await window.xword.restoreHighlight(h.id)
              setHighlights((list) => [h, ...list.filter((x) => x.id !== h.id)])
            } catch (e) {
              toastError(e)
            }
          }
        })
    } catch (e) {
      toastError(e)
    }
  }

  const patchHighlight = async (
    id: string,
    patch: { color?: HighlightColor; note?: string }
  ): Promise<void> => {
    try {
      await window.xword.updateHighlight(id, patch)
      setHighlights((list) => list.map((h) => (h.id === id ? { ...h, ...patch } : h)))
    } catch (e) {
      toastError(e)
    }
  }

  // ---------------------------------------------------------------- 点词

  /** 屏幕上 (x, y) 处的单词；点在空白处返回 null */
  const hitWord = (x: number, y: number): { target: LookupTarget; pos: BookPosition } | null => {
    const pages = api.current
    const caret = caretAt(x, y)
    if (!pages || !caret) return null
    const pos = pages.positionOf(caret.node, caret.offset)
    if (!pos) return null
    const unit = pages.unitText(pos)
    if (!unit) return null
    for (const o of [pos.offset, pos.offset - 1]) {
      const w = wordAt(unit.text, o)
      if (!w) continue
      const range = pages.rangeOf({ ...pos, offset: w.start }, { ...pos, offset: w.end })
      const rect = range && rangeContains(range, x, y)
      if (!rect) continue
      return {
        pos: { ...pos, offset: o },
        target: {
          word: w.word,
          chapter: pos.chapter,
          block: pos.block,
          start: w.start,
          end: w.end,
          sentence: sentenceOf(unit.text, w.start, unit.lines),
          anchor: anchorEl(rect)
        }
      }
    }
    return null
  }

  /** 屏幕上 (x, y) 处的高亮 */
  const hitHighlight = (x: number, y: number): { h: Highlight; rect: DOMRect } | null => {
    const pages = api.current
    const caret = caretAt(x, y)
    if (!pages || !caret) return null
    const pos = pages.positionOf(caret.node, caret.offset)
    if (!pos) return null
    for (const h of highlights) {
      if (comparePositions(h.start, pos) > 0 || comparePositions(pos, h.end) >= 0) continue
      const range = pages.rangeOf(h.start, h.end)
      const rect = range && rangeContains(range, x, y)
      if (rect) return { h, rect }
    }
    return null
  }

  /** 收词成功：正文里这个词下方用荧光笔划出下划线（200ms） */
  const onCollected = useCallback((t: LookupTarget) => {
    setTimeout(() => {
      const pos = { chapter: t.chapter, block: t.block }
      const range = api.current?.rangeOf({ ...pos, offset: t.start }, { ...pos, offset: t.end })
      const host = api.current?.fxHost()
      if (range && host)
        void playFx(host, range, 'underline', 'yellow', api.current?.visibleRect() ?? null)
    }, 0)
  }, [])

  const onStageClick = (e: ReactMouseEvent<HTMLElement>): void => {
    const pages = api.current
    if (!pages || !stage || e.button !== 0) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    const el = e.target as HTMLElement
    if (el.closest('button, input, a[href]')) return
    // 书内链接：只做书内跳转
    const link = el.closest<HTMLElement>('[data-link]')?.dataset.link
    if (link) {
      const [chapter, block] = link.split(':').map(Number)
      if (Number.isInteger(chapter) && Number.isInteger(block)) {
        pages.goTo({ chapter, block, offset: 0 }, { chapter, block: block + 1, offset: 0 })
        return
      }
    }
    const hl = hitHighlight(e.clientX, e.clientY)
    const word = hitWord(e.clientX, e.clientY)
    if (hl) {
      setLookup(null)
      setMenu({
        id: hl.h.id,
        anchor: anchorEl(hl.rect),
        focusNote: false,
        word: word?.target ?? null
      })
      return
    }
    if (word) {
      setMenu(null)
      setLookup(word.target)
      return
    }
    // 左右两侧 15% 翻页
    const r = stage.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    if (x < CLICK_ZONE) pages.prev()
    else if (x > 1 - CLICK_ZONE) pages.next()
  }

  // ---------------------------------------------------------------- 滚轮：一格一页

  const wheel = useRef({ acc: 0, last: 0, flipped: 0 })
  const onWheel = (e: ReactWheelEvent<HTMLElement>): void => {
    if (isOverlayOpen() || tocOpen) return
    // PDF 放大后页面比窗口高：滚轮用来上下滚动
    const sc = (e.target as HTMLElement).closest?.('.pdf-scroll')
    if (sc && sc.scrollHeight > sc.clientHeight + 1) return
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    if (d === 0) return
    const w = wheel.current
    const now = performance.now()
    // 停下来 300ms 以上重新累计；触控板的小步滚动累计到一格再翻
    if (now - w.last > 300 || Math.sign(d) !== Math.sign(w.acc)) w.acc = 0
    w.last = now
    w.acc += e.deltaMode === 0 ? d : d * 40
    if (Math.abs(w.acc) >= 40 && now - w.flipped > 150) {
      if (w.acc > 0) api.current?.next()
      else api.current?.prev()
      w.acc = 0
      w.flipped = now
    }
  }

  // ---------------------------------------------------------------- 选区

  useEffect(() => {
    const read = (): void => {
      const sel = window.getSelection()
      const pages = api.current
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !pages) {
        setSelection(null)
        return
      }
      const range = sel.getRangeAt(0)
      const start = pages.positionOf(range.startContainer, range.startOffset)
      const end = pages.positionOf(range.endContainer, range.endOffset)
      const text = sel
        .toString()
        .replace(/-\n(?=\p{L})/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!start || !end || text === '' || comparePositions(start, end) >= 0) {
        setSelection(null)
        return
      }
      const tokens = tokenize(text)
      const single =
        tokens.length === 1 &&
        tokens[0].text === text &&
        start.chapter === end.chapter &&
        start.block === end.block
      let word: LookupTarget | null = null
      if (single) {
        const unit = pages.unitText(start)
        const w = unit ? wordAt(unit.text, start.offset) : null
        if (unit && w)
          word = {
            word: w.word,
            chapter: start.chapter,
            block: start.block,
            start: w.start,
            end: w.end,
            sentence: sentenceOf(unit.text, w.start, unit.lines),
            anchor: anchorEl(range.getBoundingClientRect())
          }
      }
      setSelection({ start, end, text, rect: range.getBoundingClientRect(), word })
    }
    const onUp = (): void => {
      // 等浏览器把选区定下来再读（不用 rAF：窗口被遮挡时它不触发）
      setTimeout(read, 0)
    }
    const onChange = (): void => {
      if (window.getSelection()?.isCollapsed) setSelection(null)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.shiftKey) read()
    }
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('selectionchange', onChange)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('selectionchange', onChange)
    }
  }, [anchorEl])

  /** 翻译选中的文字（T）：面板在选区下方；选区保留 */
  const openTranslate = (): void => {
    if (!selection) return
    setTranslate({ text: selection.text, rect: selection.rect, nonce: Date.now() })
  }

  const collectSelection = (): void => {
    if (!selection?.word) return
    const word = selection.word
    clearSelection()
    setLookup({ ...word, autoCollect: true })
  }

  const copySelection = (): void => {
    // 剪贴板权限一律拒绝；用浏览器自带的复制命令复制当前选区
    const ok = document.execCommand('copy')
    toast(ok ? '已复制' : '复制失败，请用 Ctrl+C')
  }

  const exit = (): void => setView('shelf')

  // ---------------------------------------------------------------- 键盘

  const onKey = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target) || hasModifier(e)) return
    if (e.key === 'Escape') {
      if (tocOpen) {
        e.preventDefault()
        setTocOpen(false)
        return
      }
      if (isOverlayOpen()) return
      e.preventDefault()
      exit()
      return
    }
    if (isOverlayOpen() || tocOpen) return
    const key = e.key.toLowerCase()
    // 选区快捷键：H 高亮（黄），A 收进单词本（只选中一个词时），T 翻译
    if (selection && !e.shiftKey && key === 'h') {
      e.preventDefault()
      void createHighlight('yellow')
      return
    }
    if (selection?.word && !e.shiftKey && key === 'a') {
      e.preventDefault()
      collectSelection()
      return
    }
    if (selection && !e.shiftKey && key === 't') {
      e.preventDefault()
      openTranslate()
      return
    }
    const pages = api.current
    if (!pages) return
    // 焦点在按钮上时，空格交给按钮自己
    if (e.key === ' ' && e.target instanceof HTMLButtonElement) return
    switch (e.key) {
      case 'ArrowLeft':
      case 'PageUp':
        pages.prev()
        break
      case 'ArrowRight':
      case 'PageDown':
        pages.next()
        break
      case ' ':
        if (e.shiftKey) pages.prev()
        else pages.next()
        break
      case 'Home':
        pages.chapterStart()
        break
      case 'End':
        pages.chapterEnd()
        break
      case '[':
        pages.chapter(-1)
        break
      case ']':
        pages.chapter(1)
        break
      case 'm':
        setTocOpen(true)
        break
      case 'p':
        setAaOpen(true)
        break
      default:
        return
    }
    e.preventDefault()
  }
  const onKeyRef = useRef(onKey)
  useLayoutEffect(() => {
    onKeyRef.current = onKey
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent): void => onKeyRef.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // ---------------------------------------------------------------- 阅读时长

  const stageRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    stageRef.current = stage
  }, [stage])
  useReadingTimer(bookId, stageRef)

  // ---------------------------------------------------------------- 渲染

  if (!target) {
    return (
      <div className="reader is-empty">
        <EmptyState icon={ArrowLeft} text="还没有打开书">
          <Button onClick={exit}>返回书架</Button>
        </EmptyState>
      </div>
    )
  }
  if (error) {
    return (
      <div className="reader is-empty">
        <EmptyState
          icon={ArrowLeft}
          text={error.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')}
        >
          <Button onClick={exit}>返回书架</Button>
        </EmptyState>
      </div>
    )
  }

  const toc = detail?.toc ?? []
  const pct = Math.round((status?.progress ?? 0) * 100)
  const anchor = status?.anchor

  return (
    <div
      className="reader"
      data-ready={status?.ready ? '' : undefined}
      data-anchor={anchor ? `${anchor.chapter}:${anchor.block}:${anchor.offset}` : undefined}
    >
      <header className="reader-bar">
        <IconButton icon={ArrowLeft} label="返回书架" shortcut="Esc" onClick={exit} />
        <div className="reader-title">
          <span className="reader-book">{detail ? displayTitle(detail.book.title) : ''}</span>
          {status?.chapterTitle && <span className="reader-chapter">{status.chapterTitle}</span>}
        </div>
        <IconButton
          icon={ListTree}
          label="目录"
          shortcut="M"
          active={tocOpen}
          onClick={() => setTocOpen((o) => !o)}
        />
        <IconButton
          ref={setAaAnchor}
          icon={Settings2}
          label="页面设置"
          shortcut="P"
          active={aaOpen}
          onClick={() => setAaOpen((o) => !o)}
        />
      </header>

      <div ref={setStage} className="reader-stage" onClick={onStageClick} onWheel={onWheel}>
        {upgrading && <p className="reader-note">正在按原书结构重新排版……</p>}
        {legacy && (
          <div className="reader-banner" role="status">
            <span>
              这本书是旧版本导入的，没有保存原文件。重新导入同一个文件后按原书版式排版，阅读位置、高亮和出处都会保留。
            </span>
            <Button size="sm" onClick={() => void reimport()}>
              重新导入
            </Button>
          </div>
        )}
        {!legacy &&
          firstOpen &&
          status?.bodyStart != null &&
          status.frontPages != null &&
          status.frontPages > FRONT_PAGES_LIMIT &&
          status.chapter < status.bodyStart && (
            <div className="reader-banner is-compact">
              <Button
                size="sm"
                onClick={() => {
                  setFirstOpen(false)
                  api.current?.goTo({ chapter: status.bodyStart ?? 0, block: 0, offset: 0 })
                }}
              >
                跳到正文
              </Button>
            </div>
          )}
        {detail && start && size && detail.book.format === 'pdf' && (
          <PdfPages
            ref={api}
            detail={detail}
            prefs={prefs}
            area={size}
            double={prefs.spread === 'double' && size.win >= DOUBLE_MIN_WIDTH}
            start={start}
            classify={marks.classify}
            highlights={highlights}
            pendingHighlight={pendingHighlight}
            onStatus={onStatus}
          />
        )}
        {detail && start && geometry && detail.book.format !== 'pdf' && (
          <EpubPages
            ref={api}
            detail={detail}
            prefs={prefs}
            geometry={geometry}
            start={start}
            classify={marks.classify}
            highlights={highlights}
            pendingHighlight={pendingHighlight}
            onStatus={onStatus}
          />
        )}
      </div>

      <footer className="reader-foot">
        {jumping ? (
          <form
            className="foot-jump"
            onSubmit={(e) => {
              e.preventDefault()
              const n = Number(new FormData(e.currentTarget).get('page'))
              if (Number.isFinite(n) && n >= 1 && !api.current?.goToPage(Math.floor(n)))
                toast('页数还在计算，请稍后再试')
              setJumping(false)
            }}
          >
            <span>跳到第</span>
            <input
              name="page"
              className="text-input foot-jump-input num"
              inputMode="numeric"
              autoFocus
              aria-label="页码"
              defaultValue={status?.page ?? ''}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => setJumping(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setJumping(false)
                }
              }}
            />
            <span>页</span>
          </form>
        ) : (
          <button
            type="button"
            className="foot-page"
            title="输入页码跳转"
            onClick={() => setJumping(true)}
          >
            {status?.page != null
              ? status.total != null
                ? `第 ${status.page} / ${status.total} 页`
                : `第 ${status.page} 页`
              : '正在排版'}
          </button>
        )}
        <div
          className="foot-progress"
          role="progressbar"
          aria-label="阅读进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div
            className="foot-progress-fill"
            style={{ transform: `scaleX(${status?.progress ?? 0})` }}
          />
        </div>
        {status?.chapterLeft != null && (
          <span className="foot-left">
            {status.chapterLeft > 0 ? `本章还剩 ${status.chapterLeft} 页` : '本章最后一页'}
          </span>
        )}
        <span className="foot-pct num">{pct}%</span>
      </footer>

      <TocDrawer
        open={tocOpen}
        toc={toc}
        pages={status?.tocPages ?? []}
        current={anchor ? currentTocIndex(toc, anchor.chapter, anchor.block) : -1}
        onPick={(e) => {
          setTocOpen(false)
          api.current?.goTo({ chapter: e.chapter, block: e.block, offset: 0 })
        }}
        onClose={() => setTocOpen(false)}
      />
      <ReaderSettings
        anchor={aaAnchor}
        open={aaOpen}
        prefs={prefs}
        pdf={detail?.book.format === 'pdf'}
        doubleAvailable={(size?.win ?? 0) >= DOUBLE_MIN_WIDTH}
        onChange={changePrefs}
        onClose={() => setAaOpen(false)}
      />
      {lookup && bookId && (
        <LookupCard
          key={`${lookup.chapter}:${lookup.block}:${lookup.start}`}
          target={lookup}
          bookId={bookId}
          wordId={marks.wordIdOf(lookup.word)}
          autoCollect={lookup.autoCollect}
          collectRef={collectRef}
          onCollected={onCollected}
          onClose={() => setLookup(null)}
        />
      )}
      {translate && (
        <TranslatePanel
          key={translate.nonce}
          text={translate.text}
          rect={translate.rect}
          onClose={() => setTranslate(null)}
        />
      )}
      {selection && !lookup && !menu && !translate && (
        <SelectionToolbar
          rect={selection.rect}
          singleWord={selection.word !== null}
          onTranslate={openTranslate}
          onHighlight={(c) => void createHighlight(c)}
          onNote={() => void createHighlight('yellow', true)}
          onCollect={collectSelection}
          onCopy={copySelection}
        />
      )}
      {menu &&
        (() => {
          const h = highlights.find((x) => x.id === menu.id)
          if (!h) return null
          return (
            <HighlightMenu
              key={menu.id}
              anchor={menu.anchor}
              highlight={h}
              focusNote={menu.focusNote}
              onColor={(color) => void patchHighlight(h.id, { color })}
              onNote={(note) => void patchHighlight(h.id, { note })}
              onDelete={() => void removeHighlight(h, true)}
              onLookup={
                menu.word
                  ? () => {
                      const w = menu.word
                      setMenu(null)
                      setLookup(w)
                    }
                  : null
              }
              onClose={() => setMenu(null)}
            />
          )
        })()}
    </div>
  )
}
