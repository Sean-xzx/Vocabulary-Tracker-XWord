/**
 * EPUB / TXT 的书页排版模式：一章排进 CSS 多栏（栏宽 = 版心宽，栏距 = 左右页边距之和，所以相邻两栏正好相隔一页宽），
 * 把多栏容器平移到第 k 栏就是第 k 页。双页时两页共用一个裁切框（纸页紧挨着，中缝两侧的正文正好相隔一页宽）。
 * - 当前章节立即排版并扫描出每页开头的锚点（PageIndex）；其它章节在空闲时放进隐藏容器量页数，按“书 + 排版参数 + 窗口尺寸”缓存；
 * - 每章从新的一页开始，双页时章首在右页；空白页不编号；
 * - 位置永远记锚点（章节 + 块 + 偏移）：改字号、窗口、单双页后，重新排版并显示锚点所在的那一页；
 * - 快速连按：同一章里立即算出目标页，不排队；跨章时记下还没走完的步数，新章节排好后一次走完，不丢键。
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { BookDetail, BookPosition, Highlight } from '@shared/api'
import { blockText, progressAt, rangeInBlock, type Chapter } from '@shared/domain/book'
import {
  PageIndex,
  compareAnchor,
  firstVisible,
  globalPage,
  lastVisible,
  locatePage,
  totalPages,
  visiblePages,
  type PageGeometry
} from '@shared/domain/pagination'
import { displayTitle } from '@shared/domain/words'
import { cx } from '../../lib/cx'
import { readLocal, writeLocal } from '../../lib/storage'
import { fadeSlide, prefersReducedMotion } from '../../motion'
import { toastError } from '../../store/toast'
import { ChapterFlow, type FlowOptions } from './ChapterFlow'
import { domPointAt, positionOf as domPositionOf } from './domText'
import type { PagesApi, PagesStatus } from './engine'
import { playFx } from './fx'
import { blockColumn, countColumns, scanPages } from './pageScan'
import type { BlockHighlight, MarkKind } from './pieces'
import type { ReaderPrefs } from './prefs'

const FLIP_SHIFT = 12
const FLIP_MS = 180
const NO_IMAGE = (): undefined => undefined

type Request =
  | { kind: 'anchor'; anchor: BookPosition; flashEnd?: BookPosition; dir?: number }
  | { kind: 'page'; page: number; dir?: number }
  | { kind: 'last'; dir?: number }

interface Screen {
  chapter: number
  data: Chapter
  index: PageIndex
  /** 这一屏第一个真实页 */
  page: number
  /** 排版参数（和它不一致说明需要重新排版） */
  key: string
}

interface CountCache {
  key: string
  counts: (number | null)[]
  /** 每个目录项在它那一章里的页序 */
  toc: (number | null)[]
}

function cacheKeyOf(detail: BookDetail, prefs: ReaderPrefs, g: PageGeometry): string {
  const m = detail.meta
  return [
    m.chapters.length,
    m.totalChars,
    prefs.fontSize,
    prefs.lineHeight,
    prefs.layout,
    g.contentW,
    g.contentH,
    g.padX
  ].join('|')
}

function loadCache(bookId: string, key: string, chapters: number, toc: number): CountCache {
  try {
    const raw = JSON.parse(readLocal(`xword.pageCounts.${bookId}`) ?? 'null') as CountCache | null
    if (raw && raw.key === key && raw.counts.length === chapters && raw.toc.length === toc)
      return raw
  } catch {
    // 忽略
  }
  return { key, counts: Array(chapters).fill(null), toc: Array(toc).fill(null) }
}

/** 一段“章节 + 块 + 偏移”范围在当前章里的 DOM Range */
function domRange(
  root: HTMLElement,
  chapter: number,
  start: BookPosition,
  end: BookPosition
): Range | null {
  if (start.chapter > chapter || end.chapter < chapter) return null
  const els = root.querySelectorAll<HTMLElement>('[data-b]')
  if (els.length === 0) return null
  const from = start.chapter === chapter ? start : { chapter, block: 0, offset: 0 }
  const a = root.querySelector<HTMLElement>(`[data-b="${from.block}"]`) ?? els[0]
  const b =
    (end.chapter === chapter ? root.querySelector<HTMLElement>(`[data-b="${end.block}"]`) : null) ??
    els[els.length - 1]
  const pa = domPointAt(a, from.offset)
  const pb = end.chapter === chapter ? domPointAt(b, end.offset) : domPointAt(b, 1e9)
  const range = document.createRange()
  try {
    range.setStart(pa.node, pa.offset)
    range.setEnd(pb.node, pb.offset)
  } catch {
    return null
  }
  return range
}

export interface EpubPagesProps {
  detail: BookDetail
  prefs: ReaderPrefs
  geometry: PageGeometry
  start: { pos: BookPosition; flashEnd?: BookPosition }
  classify: ((word: string) => MarkKind | null) | null
  highlights: Highlight[]
  pendingHighlight: string | null
  onStatus: (s: PagesStatus) => void
}

export const EpubPages = forwardRef<PagesApi, EpubPagesProps>(function EpubPages(
  { detail, prefs, geometry: g, start, classify, highlights, pendingHighlight, onStatus },
  ref
): ReactElement {
  const bookId = detail.book.id
  const chapterCount = detail.meta.chapters.length
  const double = g.double
  const key = cacheKeyOf(detail, prefs, g)
  const lang = detail.meta.language || 'en'

  const [shown, setShown] = useState<{ chapter: number; data: Chapter } | null>(null)
  const [screen, setScreen] = useState<Screen | null>(null)
  const [fontsReady, setFontsReady] = useState(() => document.fonts.status === 'loaded')
  const [cache, setCache] = useState<CountCache>(() =>
    loadCache(bookId, key, chapterCount, detail.toc.length)
  )
  const [flow, setFlow] = useState<HTMLElement | null>(null)
  const spread = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const clip = useRef<HTMLDivElement>(null)
  const measureHost = useRef<HTMLDivElement>(null)

  const chapters = useRef(new Map<number, Chapter>())
  const loading = useRef(new Map<number, Promise<Chapter>>())
  const wanted = useRef(-1)
  const request = useRef<Request | null>(null)
  const steps = useRef(0)
  const busy = useRef(true)
  const anchor = useRef<BookPosition>(start.pos)
  const screenRef = useRef<Screen | null>(null)
  const doubleRef = useRef(double)

  // 排版参数变了：换一份页数缓存（渲染期间按 props 调整 state）
  if (cache.key !== key) setCache(loadCache(bookId, key, chapterCount, detail.toc.length))

  useEffect(() => {
    if (fontsReady) return
    let alive = true
    void document.fonts.ready.then(() => alive && setFontsReady(true))
    return () => {
      alive = false
    }
  }, [fontsReady])

  const getChapter = useCallback(
    (index: number): Promise<Chapter> => {
      const hit = chapters.current.get(index)
      if (hit) return Promise.resolve(hit)
      let p = loading.current.get(index)
      if (!p) {
        p = window.xword.bookChapter(bookId, index).then((c) => {
          chapters.current.set(index, c)
          loading.current.delete(index)
          return c
        })
        p.catch(() => loading.current.delete(index))
        loading.current.set(index, p)
      }
      return p
    },
    [bookId]
  )

  /** 换章：读到数据后渲染，排好版后按 req 决定显示哪一页 */
  const showChapter = useCallback(
    (index: number, req: Request) => {
      const c = Math.max(0, Math.min(chapterCount - 1, index))
      request.current = req
      busy.current = true
      wanted.current = c
      getChapter(c)
        .then((data) => {
          if (wanted.current === c) setShown({ chapter: c, data })
        })
        .catch(toastError)
    },
    [chapterCount, getChapter]
  )

  // 打开书：显示起始位置
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    showChapter(start.pos.chapter, { kind: 'anchor', anchor: start.pos, flashEnd: start.flashEnd })
  }, [start, showChapter])

  /** 翻页动效：从翻页方向淡入，位移 12px，180ms；减少动态效果时直接切换 */
  const animate = (dir: number | undefined): void => {
    const el = content.current
    if (!el || !dir || prefersReducedMotion()) return
    fadeSlide(el, { direction: 'in', x: dir > 0 ? FLIP_SHIFT : -FLIP_SHIFT, duration: FLIP_MS })
  }

  const flash = (s: BookPosition, e: BookPosition): void => {
    // 等这一屏画出来再标
    setTimeout(() => {
      const f = flow
      if (!f || !spread.current) return
      const range = domRange(f, screenRef.current?.chapter ?? -1, s, e)
      if (range)
        void playFx(
          spread.current,
          range,
          'flash',
          'yellow',
          clip.current?.getBoundingClientRect() ?? null
        )
    }, 0)
  }

  /** 同一章里换页 */
  const setPage = (page: number, dir: number): void => {
    const s = screenRef.current
    if (!s) return
    const p = firstVisible(
      Math.max(0, Math.min(s.index.count - 1, page)),
      s.index.count,
      doubleRef.current
    )
    if (p === s.page) {
      // 已经在这一屏（比如从高亮跳过来后按 Home）：锚点回到这一屏开头
      const first = s.index.startOf(p)
      if (compareAnchor(first, anchor.current) !== 0) {
        anchor.current = first
        const same = { ...s }
        screenRef.current = same
        setScreen(same)
      }
      return
    }
    const next = { ...s, page: p }
    screenRef.current = next
    anchor.current = s.index.startOf(p)
    setScreen(next)
    animate(dir)
  }

  /** 翻一屏；正在换章时先记下步数 */
  const flip = (dir: 1 | -1): void => {
    const s = screenRef.current
    if (busy.current || !s) {
      steps.current += dir
      return
    }
    const count = s.index.count
    const dbl = doubleRef.current
    if (dir > 0) {
      const last = dbl ? lastVisible(s.page, count, true) : s.page
      if (last + 1 < count) setPage(last + 1, 1)
      else if (s.chapter + 1 < chapterCount)
        showChapter(s.chapter + 1, { kind: 'page', page: 0, dir: 1 })
    } else {
      const first = dbl ? firstVisible(s.page, count, true) : s.page
      if (first > 0) setPage(first - 1, -1)
      else if (s.chapter > 0) showChapter(s.chapter - 1, { kind: 'last', dir: -1 })
    }
  }

  // ---------------------------------------------------------------- 排版：扫描每页开头，决定显示哪一页

  useLayoutEffect(() => {
    doubleRef.current = double
    // 换章时旧的多栏容器已经卸载：等新的容器挂上再量
    if (!shown || !flow || !flow.isConnected || !fontsReady) return
    const index = scanPages(flow, shown.chapter, g.stride, g.stride - g.contentW)
    // 没有指定目标时（改字号、窗口、单双页）显示锚点所在的页
    const req: Request = request.current ?? { kind: 'anchor', anchor: anchor.current }
    request.current = null
    let page: number
    if (req.kind === 'anchor') {
      page = index.pageOf(req.anchor)
      anchor.current = req.anchor
    } else {
      page = req.kind === 'last' ? index.count - 1 : Math.min(req.page, index.count - 1)
      anchor.current = index.startOf(firstVisible(page, index.count, double))
    }
    page = firstVisible(page, index.count, double)
    const next: Screen = { chapter: shown.chapter, data: shown.data, index, page, key }
    screenRef.current = next
    busy.current = false
    setScreen(next)
    setCache((c) => {
      if (c.counts[shown.chapter] === index.count) return c
      const counts = c.counts.slice()
      counts[shown.chapter] = index.count
      return { ...c, counts }
    })
    animate(req.dir)
    if (req.kind === 'anchor' && req.flashEnd) flash(req.anchor, req.flashEnd)
    // 换章时积下的步数一次走完
    const pending = steps.current
    steps.current = 0
    for (let k = 0; k < Math.abs(pending); k++) flip(pending > 0 ? 1 : -1)
    // 预读相邻章节
    if (shown.chapter + 1 < chapterCount) void getChapter(shown.chapter + 1).catch(() => {})
    if (shown.chapter > 0) void getChapter(shown.chapter - 1).catch(() => {})
    // flip / animate / flash 只读 ref，不需要作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, flow, fontsReady, key, double, g.stride, g.contentW, chapterCount, getChapter])

  // ---------------------------------------------------------------- 空闲时量其它章节的页数

  const ready = screen !== null && screen.key === key
  const flowOptsPlain = useMemo<FlowOptions>(
    () => ({
      classify: null,
      highlights: new Map(),
      original: prefs.layout === 'original',
      imageUrl: NO_IMAGE
    }),
    [prefs.layout]
  )
  useEffect(() => {
    const host = measureHost.current
    if (!ready || !host) return
    let cancelled = false
    const root = createRoot(host)
    const current = screenRef.current?.chapter ?? 0
    const order = [
      ...Array.from({ length: current }, (_, i) => i),
      ...Array.from({ length: chapterCount - current - 1 }, (_, i) => current + 1 + i)
    ]
    const tocOf = new Map<number, number[]>()
    detail.toc.forEach((e, i) => {
      if (e.block > 0) tocOf.set(e.chapter, [...(tocOf.get(e.chapter) ?? []), i])
    })
    const run = async (): Promise<void> => {
      for (const c of order) {
        const known =
          cache.counts[c] !== null && (tocOf.get(c) ?? []).every((i) => cache.toc[i] !== null)
        if (known) continue
        const data = await getChapter(c)
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (cancelled) return
        flushSync(() =>
          root.render(<ChapterFlow chapter={data} opts={flowOptsPlain} lang={lang} />)
        )
        const f = host.querySelector<HTMLElement>('.rflow')
        if (!f) continue
        const count = countColumns(f, g.stride, g.stride - g.contentW)
        const cols = (tocOf.get(c) ?? []).map(
          (i) => [i, blockColumn(f, detail.toc[i].block, g.stride)] as const
        )
        setCache((old) => {
          if (old.key !== key) return old
          const counts = old.counts.slice()
          counts[c] = old.counts[c] ?? count
          const toc = old.toc.slice()
          for (const [i, col] of cols) toc[i] = col
          return { ...old, counts, toc }
        })
      }
    }
    void run().catch(() => {})
    return () => {
      cancelled = true
      setTimeout(() => root.unmount(), 0)
    }
    // 只在排版参数变化、当前章排好后重新量；cache 的变化不需要重新开始
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, getChapter, flowOptsPlain])

  // 缓存写到本地（下次打开同样的排版不用再量）
  useEffect(() => {
    if (cache.key === key) writeLocal(`xword.pageCounts.${bookId}`, JSON.stringify(cache))
  }, [cache, key, bookId])

  // ---------------------------------------------------------------- 状态

  const tocPages = useMemo(
    () =>
      detail.toc.map((e, i) => {
        const base = globalPage(cache.counts, { chapter: e.chapter, page: 0 })
        if (base === null) return null
        if (e.block === 0) return base
        const inChapter =
          screen && screen.chapter === e.chapter && screen.key === key
            ? screen.index.pageOf({ block: e.block, offset: 0 })
            : cache.toc[i]
        return inChapter === null ? null : base + inChapter
      }),
    [detail.toc, cache, screen, key]
  )

  /** 正文从第几章开始（按章节分类）；前面的封面、书名页、目录、前言一共几页 */
  const bodyStart = useMemo(() => {
    const roles = detail.meta.chapters.map((c) => c.role)
    const i = roles.findIndex((r) => r === 'body')
    return i > 0 ? i : null
  }, [detail.meta.chapters])

  useEffect(() => {
    if (!screen) return
    const count = screen.index.count
    const pos = anchor.current
    const total = totalPages(cache.counts)
    onStatus({
      bodyStart,
      frontPages: bodyStart === null ? null : totalPages(cache.counts.slice(0, bodyStart)),
      chapter: screen.chapter,
      chapterTitle: detail.meta.chapters[screen.chapter]?.title ?? '',
      anchor: pos,
      page: globalPage(cache.counts, { chapter: screen.chapter, page: screen.page }),
      total,
      chapterLeft: count - 1 - lastVisible(screen.page, count, double),
      progress: progressAt(detail.meta, screen.data, pos),
      tocPages,
      data: screen.data,
      ready: screen.key === key
    })
  }, [screen, cache, tocPages, detail, double, key, onStatus, bodyStart])

  // ---------------------------------------------------------------- 对外接口

  useImperativeHandle(ref, (): PagesApi => ({
    next: () => flip(1),
    prev: () => flip(-1),
    chapterStart: () => setPage(0, -1),
    chapterEnd: () => setPage(Number.MAX_SAFE_INTEGER, 1),
    chapter: (delta) => {
      const s = screenRef.current
      const c = (busy.current || !s ? wanted.current : s.chapter) + delta
      if (c >= 0 && c < chapterCount) showChapter(c, { kind: 'page', page: 0, dir: delta })
    },
    goTo: (pos, flashEnd) => {
      const s = screenRef.current
      if (s && !busy.current && s.chapter === pos.chapter && s.key === key) {
        const p = firstVisible(s.index.pageOf(pos), s.index.count, doubleRef.current)
        const dir = p === s.page ? 0 : p > s.page ? 1 : -1
        if (p !== s.page) {
          const next = { ...s, page: p }
          screenRef.current = next
          setScreen(next)
          animate(dir)
        }
        anchor.current = pos
        if (flashEnd) flash(pos, flashEnd)
      } else showChapter(pos.chapter, { kind: 'anchor', anchor: pos, flashEnd })
    },
    goToPage: (n) => {
      const loc = locatePage(cache.counts, n)
      if (!loc) return false
      const s = screenRef.current
      if (s && !busy.current && s.chapter === loc.chapter)
        setPage(loc.page, loc.page >= s.page ? 1 : -1)
      else showChapter(loc.chapter, { kind: 'page', page: loc.page })
      return true
    },
    positionOf: (node, offset) => {
      const s = screenRef.current
      if (!s || !flow || !flow.contains(node)) return null
      const p = domPositionOf(node, offset)
      return p ? { chapter: s.chapter, ...p } : null
    },
    unitText: (pos) => {
      const s = screenRef.current
      const b = s && s.chapter === pos.chapter ? s.data.blocks[pos.block] : undefined
      return b ? { text: blockText(b), lines: false } : null
    },
    rangeOf: (a, b) => {
      const s = screenRef.current
      return s && flow ? domRange(flow, s.chapter, a, b) : null
    },
    fxHost: () => spread.current,
    visibleRect: () => clip.current?.getBoundingClientRect() ?? null
  }))

  // ---------------------------------------------------------------- 高亮与渲染

  const chapterIndex = shown?.chapter ?? -1
  const highlightsByBlock = useMemo(() => {
    const map = new Map<number, BlockHighlight[]>()
    const data = shown?.data
    if (!data) return map
    for (const h of highlights) {
      if (h.start.chapter > chapterIndex || h.end.chapter < chapterIndex) continue
      const first = h.start.chapter === chapterIndex ? h.start.block : 0
      const last = h.end.chapter === chapterIndex ? h.end.block : data.blocks.length - 1
      for (let b = first; b <= last && b < data.blocks.length; b++) {
        const r = rangeInBlock(h.start, h.end, chapterIndex, b, blockText(data.blocks[b]).length)
        if (!r) continue
        const list = map.get(b) ?? []
        list.push({
          id: h.id,
          color: h.color,
          start: r[0],
          end: r[1],
          pending: h.id === pendingHighlight
        })
        map.set(b, list)
      }
    }
    return map
  }, [highlights, shown, chapterIndex, pendingHighlight])

  // 当前章节的图片：经 IPC 取 data: 地址；占位的宽高比事先知道，加载前后排版不变
  const [images, setImages] = useState<Record<string, string>>({})
  useEffect(() => {
    const data = shown?.data
    if (!data) return
    let alive = true
    for (const b of data.blocks) {
      const src = b.k === 'img' ? b.src : undefined
      if (!src || images[src]) continue
      window.xword
        .bookImage(bookId, src)
        .then((url) => alive && setImages((m) => (m[src] ? m : { ...m, [src]: url })))
        .catch(() => {})
    }
    return () => {
      alive = false
    }
    // images 变化不需要重新请求（已有的会跳过）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, bookId])
  const imageUrl = useCallback((src: string) => images[src], [images])

  const flowOpts = useMemo<FlowOptions>(
    () => ({
      classify,
      highlights: highlightsByBlock,
      original: prefs.layout === 'original',
      imageUrl
    }),
    [classify, highlightsByBlock, prefs.layout, imageUrl]
  )

  const vars = {
    '--page-w': `${g.pageW}px`,
    '--page-h': `${g.pageH}px`,
    '--pad-x': `${g.padX}px`,
    '--pad-y': `${g.padY}px`,
    '--content-w': `${g.contentW}px`,
    '--content-h': `${g.contentH}px`,
    '--col-gap': `${g.stride - g.contentW}px`,
    '--opener-top': `${Math.max(0, Math.round(g.pageH / 3 - g.padY))}px`,
    '--reader-font-size': `${prefs.fontSize}px`,
    '--reader-line-height': String(prefs.lineHeight)
  } as CSSProperties

  const s = screen && screen.chapter === chapterIndex ? screen : null
  const count = s?.index.count ?? 1
  const slots = s
    ? double
      ? visiblePages(s.page, count, true)
      : [s.page]
    : double
      ? [-1, -1]
      : [-1]
  const left = s ? slots[0] : 0
  const bookTitle = displayTitle(detail.book.title)
  const chapterTitle = detail.meta.chapters[chapterIndex]?.title ?? ''

  return (
    <div ref={spread} className={cx('spread', double ? 'is-double' : 'is-single')} style={vars}>
      {slots.map((_, i) => (
        <div
          key={i}
          className={cx(
            'paper',
            double ? (i === 0 ? 'paper-left' : 'paper-right') : 'paper-single'
          )}
          aria-hidden
        />
      ))}
      <div ref={content} className="spread-content">
        {s &&
          slots.map((p, i) => {
            if (p < 0) return null
            const side = double ? (i === 0 ? 'left' : 'right') : 'single'
            const n = globalPage(cache.counts, { chapter: s.chapter, page: p })
            return (
              <div key={i} className={cx('page-furniture', `is-${side}`)} aria-hidden>
                {p > 0 && (
                  <div className="running-head">{side === 'left' ? bookTitle : chapterTitle}</div>
                )}
                {n !== null && <div className="folio num">{n}</div>}
              </div>
            )
          })}
        <div ref={clip} className="flow-clip">
          <div
            className="flow-shift"
            style={{
              transform: `translateX(${-left * g.stride}px)`,
              visibility: s ? undefined : 'hidden'
            }}
          >
            {shown && (
              <ChapterFlow
                key={shown.chapter}
                chapter={shown.data}
                opts={flowOpts}
                lang={lang}
                flowRef={setFlow}
              />
            )}
          </div>
        </div>
      </div>
      <div ref={measureHost} className="measure-host" aria-hidden />
    </div>
  )
})
