/**
 * PDF 的原版页面模式：和印刷版完全一样，文字可以选中。
 * - 每页一块画布（按 devicePixelRatio 渲染）+ pdf.js 的透明文字层；只渲染可见页前后各 2 页，其余释放；
 * - 缩放：适合宽度 / 适合页面 / 75%–200%（按书记住）；深色主题下纸张保持原色；
 * - 查词、选句、高亮、翻译都在文字层上做；高亮和单词本的虚线标记用 Range.getClientRects 画在覆盖层里，缩放、改窗口后重算；
 * - 锚点：“页码（chapter）+ 0 + 页内文字偏移”；页内文字按文字层顺序拼接，行尾加换行（见 shared/domain/pdf.ts）。
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
import { TextLayer, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { BookDetail, BookPosition, Highlight } from '@shared/api'
import { comparePositions } from '@shared/domain/book'
import { firstVisible, lastVisible, visiblePages } from '@shared/domain/pagination'
import { locateInPage, pageText } from '@shared/domain/pdf'
import { tokenize } from '@shared/domain/tokenize'
import { cx } from '../../lib/cx'
import { ensureLemmas } from '../../lib/lemmas'
import { fadeSlide, prefersReducedMotion } from '../../motion'
import { toastError } from '../../store/toast'
import type { PagesApi, PagesStatus } from './engine'
import { playFx } from './fx'
import { openPdf, type PDFDocumentProxy } from './pdfjs'
import type { MarkKind } from './pieces'
import type { ReaderPrefs } from './prefs'

const FLIP_SHIFT = 12
const FLIP_MS = 180
/** 可见页前后各预渲染几页 */
const KEEP = 2
const OUTER_GAP = 24
const SCROLLBAR = 16
/** pdf.js 的 100%：1pt = 96/72 px */
const PDF_TO_CSS = 96 / 72

interface PageData {
  text: string
  starts: number[]
  lengths: number[]
}

/** 一页的 DOM：画布 + 文字层 + 覆盖层 */
class PageView {
  readonly el: HTMLDivElement
  readonly textLayer: HTMLDivElement
  readonly overlay: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private task: { cancel: () => void } | null = null
  private layer: TextLayer | null = null
  ready: Promise<void>

  constructor(
    readonly index: number,
    page: PDFPageProxy,
    scale: number,
    data: Promise<PageData>,
    lang: string
  ) {
    const viewport = page.getViewport({ scale })
    const dpr = window.devicePixelRatio || 1
    this.el = document.createElement('div')
    this.el.className = 'pdf-page'
    // 界面是 zh-CN：不指定语言时文字层的通用字体 serif 会落到中文字体（西文字形更宽），和 pdf.js 量字宽用的字体对不上
    this.el.lang = lang
    this.el.dataset.page = String(index)
    this.el.style.width = `${Math.floor(viewport.width)}px`
    this.el.style.height = `${Math.floor(viewport.height)}px`
    this.el.style.setProperty('--scale-factor', String(scale))
    this.canvas = document.createElement('canvas')
    this.canvas.width = Math.floor(viewport.width * dpr)
    this.canvas.height = Math.floor(viewport.height * dpr)
    this.canvas.setAttribute('aria-hidden', 'true')
    this.textLayer = document.createElement('div')
    this.textLayer.className = 'textLayer'
    this.overlay = document.createElement('div')
    this.overlay.className = 'pdf-overlay'
    this.overlay.setAttribute('aria-hidden', 'true')
    this.el.append(this.canvas, this.textLayer, this.overlay)
    const render = page.render({
      canvas: this.canvas,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
    })
    this.task = render
    const container = this.textLayer
    const text = (async () => {
      await data
      const content = await page.getTextContent()
      const layer = new TextLayer({ textContentSource: content, container, viewport })
      this.layer = layer
      await layer.render()
      // 文字层的 span 与“有文字的项”一一对应：记下下标，换算偏移用
      layer.textDivs.forEach((d, i) => (d.dataset.i = String(i)))
    })()
    render.promise.then(
      () => (this.task = null),
      () => (this.task = null)
    )
    // 文字层排好就可以点词、选中、画覆盖层（画布渲染不影响这些）
    this.ready = text.catch(() => {})
  }

  destroy(): void {
    this.task?.cancel()
    this.layer?.cancel()
    this.el.remove()
    this.canvas.width = 0
    this.canvas.height = 0
  }
}

export interface PdfPagesProps {
  detail: BookDetail
  prefs: ReaderPrefs
  /** 书页区的可用尺寸 */
  area: { w: number; h: number }
  double: boolean
  start: { pos: BookPosition; flashEnd?: BookPosition }
  classify: ((word: string) => MarkKind | null) | null
  highlights: Highlight[]
  pendingHighlight: string | null
  onStatus: (s: PagesStatus) => void
}

export const PdfPages = forwardRef<PagesApi, PdfPagesProps>(function PdfPages(
  { detail, prefs, area, double, start, classify, highlights, pendingHighlight, onStatus },
  ref
): ReactElement {
  const bookId = detail.book.id
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [page, setPage] = useState(() => Math.max(0, start.pos.chapter))
  const [rendered, setRendered] = useState(0)
  const pageRef = useRef(page)
  const anchor = useRef<BookPosition>(start.pos)
  const views = useRef(new Map<number, PageView>())
  const texts = useRef(new Map<number, Promise<PageData>>())
  const loaded = useRef(new Map<number, PageData>())
  const slots = useRef<(HTMLDivElement | null)[]>([null, null])
  const spread = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pending = useRef<{ start: BookPosition; end: BookPosition } | null>(
    start.flashEnd ? { start: start.pos, end: start.flashEnd } : null
  )
  const count = doc?.numPages ?? detail.meta.chapters.length
  const lang = detail.meta.language || 'en'

  // ---------------------------------------------------------------- 打开文件
  useEffect(() => {
    let alive = true
    let opened: PDFDocumentProxy | null = null
    window.xword
      .bookPdf(bookId)
      .then((bytes) => openPdf(bytes))
      .then(async (d) => {
        opened = d
        const first = await d.getPage(1)
        const vp = first.getViewport({ scale: 1 })
        if (!alive) return
        setSize({ w: vp.width, h: vp.height })
        setDoc(d)
      })
      .catch((e: unknown) => alive && toastError(e))
    const cached = views.current
    return () => {
      alive = false
      for (const v of cached.values()) v.destroy()
      cached.clear()
      void opened?.loadingTask.destroy()
    }
  }, [bookId])

  /** 缩放比例：适合宽度 / 适合页面 / 固定比例 */
  const scale = useMemo(() => {
    if (!size) return 1
    // 留出竖向滚动条的宽度，适合宽度时不出现横向滚动
    const availW = Math.max(200, area.w - 2 * OUTER_GAP - SCROLLBAR)
    const availH = Math.max(200, area.h - 2 * OUTER_GAP)
    const fitW = availW / ((double ? 2 : 1) * size.w)
    const fitH = availH / size.h
    if (prefs.zoom === 'width') return fitW
    if (prefs.zoom === 'page') return Math.min(fitW, fitH)
    return prefs.zoom * PDF_TO_CSS
  }, [size, area, double, prefs.zoom])

  const textOf = useCallback(
    (index: number): Promise<PageData> => {
      let p = texts.current.get(index)
      if (!p && doc) {
        p = doc
          .getPage(index + 1)
          .then((pg) => pg.getTextContent())
          .then((c) => {
            const t = pageText(c.items as { str?: string; hasEOL?: boolean }[])
            const lengths = t.starts.map((s, k) => (t.starts[k + 1] ?? t.text.length) - s)
            const data = { ...t, lengths }
            loaded.current.set(index, data)
            void ensureLemmas(tokenize(t.text).map((x) => x.text))
            return data
          })
        texts.current.set(index, p)
      }
      return p ?? Promise.reject(new Error('PDF 还没打开'))
    },
    [doc]
  )

  // ---------------------------------------------------------------- 渲染可见页（前后各 2 页预渲染），其余释放
  const visible = useMemo(
    () => (double ? visiblePages(page, count, true) : [page]),
    [page, count, double]
  )
  useLayoutEffect(() => {
    if (!doc) return
    const keep = new Set<number>()
    const lo = Math.max(0, visible.filter((p) => p >= 0)[0] - KEEP)
    const hi = Math.min(count - 1, Math.max(...visible) + KEEP + (double ? 1 : 0))
    for (let i = lo; i <= hi; i++) keep.add(i)
    for (const [i, v] of views.current)
      if (!keep.has(i) || v.el.dataset.scale !== String(scale)) {
        v.destroy()
        views.current.delete(i)
      }
    let alive = true
    /** 把可见页的 DOM 放进对应的位置 */
    const attach = (): void => {
      visible.forEach((p, k) => {
        const slot = slots.current[k]
        if (!slot) return
        const v = p >= 0 ? views.current.get(p) : undefined
        if (v && v.el.parentElement !== slot) slot.replaceChildren(v.el)
        else if (!v) slot.replaceChildren()
      })
    }
    const want = [...keep].sort((a, b) => Math.abs(a - page) - Math.abs(b - page))
    for (const i of want) {
      if (views.current.has(i)) continue
      // getPage 是异步的：拿到页面后再创建
      void doc.getPage(i + 1).then((pg) => {
        if (!alive || views.current.has(i)) return
        const v = new PageView(i, pg, scale, textOf(i), lang)
        v.el.dataset.scale = String(scale)
        views.current.set(i, v)
        // 页面画好、文字层排好后刷新覆盖层和状态（翻页后才画好的也要刷新）
        void v.ready.then(() => views.current.get(i) === v && setRendered((n) => n + 1))
        attach()
      })
    }
    attach()
    return () => {
      alive = false
    }
  }, [doc, visible, scale, count, double, page, textOf, lang])

  // ---------------------------------------------------------------- 文字层 与 锚点

  const pageEl = (index: number): HTMLElement | null => {
    const v = views.current.get(index)
    return v && v.el.isConnected ? v.el : null
  }

  /** 文字层里的一个 DOM 位置 → 页内偏移 */
  const positionOf = (node: Node, offset: number): BookPosition | null => {
    const el = node instanceof HTMLElement ? node : node.parentElement
    const pg = el?.closest<HTMLElement>('.pdf-page')
    const layer = el?.closest<HTMLElement>('.textLayer')
    if (!pg || !layer) return null
    const index = Number(pg.dataset.page)
    const data = loaded.current.get(index)
    if (!data) return null
    const span = el?.closest<HTMLElement>('[data-i]')
    if (span) {
      const i = Number(span.dataset.i)
      const within = node.nodeType === Node.TEXT_NODE ? offset : offset > 0 ? data.lengths[i] : 0
      return {
        chapter: index,
        block: 0,
        offset: data.starts[i] + Math.min(within, data.lengths[i])
      }
    }
    // 落在文字层本身（两个 span 之间）：取前一个 span 的末尾
    let i = -1
    for (let k = Math.min(offset, layer.childNodes.length) - 1; k >= 0 && i < 0; k--) {
      const c = layer.childNodes[k]
      if (c instanceof HTMLElement && c.dataset.i) i = Number(c.dataset.i)
      else if (c instanceof HTMLElement) {
        const inner = c.querySelectorAll<HTMLElement>('[data-i]')
        if (inner.length > 0) i = Number(inner[inner.length - 1].dataset.i)
      }
    }
    return { chapter: index, block: 0, offset: i < 0 ? 0 : data.starts[i] + data.lengths[i] }
  }

  /** 页内偏移 → 文字节点 + 偏移 */
  const domPoint = (index: number, offset: number): { node: Node; offset: number } | null => {
    const el = pageEl(index)
    const data = loaded.current.get(index)
    if (!el || !data) return null
    const loc = locateInPage(data.starts, data.lengths, offset)
    const span = el.querySelector<HTMLElement>(`.textLayer [data-i="${loc.item}"]`)
    if (!span) return null
    const text = span.firstChild ?? span
    const max = text.nodeType === Node.TEXT_NODE ? (text as Text).data.length : 0
    return { node: text, offset: Math.min(loc.offset, max) }
  }

  const rangeOf = (a: BookPosition, b: BookPosition): Range | null => {
    const first = visible.filter((p) => p >= 0)
    const from =
      comparePositions(a, { chapter: first[0], block: 0, offset: 0 }) < 0
        ? { chapter: first[0], block: 0, offset: 0 }
        : a
    const lastPage = first[first.length - 1]
    const lastLen = loaded.current.get(lastPage)?.text.length ?? 0
    const to = b.chapter > lastPage ? { chapter: lastPage, block: 0, offset: lastLen } : b
    const pa = domPoint(from.chapter, from.offset)
    const pb = domPoint(to.chapter, to.offset)
    if (!pa || !pb) return null
    const r = document.createRange()
    try {
      r.setStart(pa.node, pa.offset)
      r.setEnd(pb.node, pb.offset)
    } catch {
      return null
    }
    return r
  }

  // ---------------------------------------------------------------- 覆盖层：高亮、单词本标记
  useLayoutEffect(() => {
    for (const p of visible) {
      if (p < 0) continue
      const v = views.current.get(p)
      const data = loaded.current.get(p)
      if (!v || !data || !v.el.isConnected) continue
      const base = v.el.getBoundingClientRect()
      const boxes: HTMLElement[] = []
      const draw = (range: Range, cls: string, extra?: (d: HTMLElement) => void): void => {
        for (const r of range.getClientRects()) {
          if (r.width < 1 || r.height < 1) continue
          const d = document.createElement('div')
          d.className = cls
          d.style.left = `${r.left - base.left}px`
          d.style.top = `${r.top - base.top}px`
          d.style.width = `${r.width}px`
          d.style.height = `${r.height}px`
          extra?.(d)
          boxes.push(d)
        }
      }
      for (const h of highlights) {
        if (h.start.chapter > p || h.end.chapter < p || h.id === pendingHighlight) continue
        const s = h.start.chapter === p ? h.start.offset : 0
        const e = h.end.chapter === p ? h.end.offset : data.text.length
        const a = domPoint(p, s)
        const b = domPoint(p, e)
        if (!a || !b) continue
        const r = document.createRange()
        try {
          r.setStart(a.node, a.offset)
          r.setEnd(b.node, b.offset)
        } catch {
          continue
        }
        draw(r, `pdf-hl hl-${h.color}`, (d) => (d.dataset.h = h.id))
      }
      if (classify) {
        const seen = new Map<string, MarkKind | null>()
        for (const t of tokenize(data.text)) {
          if (!seen.has(t.text)) seen.set(t.text, classify(t.text))
          const mark = seen.get(t.text)
          if (!mark) continue
          const a = domPoint(p, t.start)
          const b = domPoint(p, t.end)
          if (!a || !b) continue
          const r = document.createRange()
          try {
            r.setStart(a.node, a.offset)
            r.setEnd(b.node, b.offset)
          } catch {
            continue
          }
          draw(r, `pdf-mark w-${mark}`)
        }
      }
      v.overlay.replaceChildren(...boxes)
    }
  }, [visible, highlights, pendingHighlight, classify, rendered, scale])

  // ---------------------------------------------------------------- 翻页
  const flash = (s: BookPosition, e: BookPosition): void => {
    setTimeout(() => {
      const range = rangeOf(s, e)
      if (range && spread.current)
        void playFx(
          spread.current,
          range,
          'flash',
          'yellow',
          scroller.current?.getBoundingClientRect() ?? null
        )
    }, 0)
  }

  const show = (p: number, dir: number): void => {
    const target = Math.max(0, Math.min(count - 1, p))
    const first = double ? firstVisible(target, count, true) : target
    if (first === pageRef.current) return
    pageRef.current = first
    anchor.current = { chapter: first, block: 0, offset: 0 }
    setPage(first)
    const el = spread.current
    if (el && dir && !prefersReducedMotion())
      fadeSlide(el, { direction: 'in', x: dir > 0 ? FLIP_SHIFT : -FLIP_SHIFT, duration: FLIP_MS })
    scroller.current?.scrollTo({ top: 0 })
  }

  const flip = (dir: 1 | -1): void => {
    const cur = pageRef.current
    if (dir > 0) {
      const last = double ? lastVisible(cur, count, true) : cur
      if (last + 1 < count) show(last + 1, 1)
    } else {
      const first = double ? firstVisible(cur, count, true) : cur
      if (first > 0) show(first - 1, -1)
    }
  }

  // 起始位置有要标出的文字（出处、高亮）：这一页的文字层好了再标
  useEffect(() => {
    const f = pending.current
    if (!f || !doc) return
    if (!visible.includes(f.start.chapter) || !loaded.current.has(f.start.chapter)) return
    if (!views.current.get(f.start.chapter)?.el.isConnected) return
    pending.current = null
    flash(f.start, f.end)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, visible, doc])

  // ---------------------------------------------------------------- 状态
  const toc = detail.toc
  useEffect(() => {
    if (!doc) return
    const first = visible.filter((p) => p >= 0)[0] ?? 0
    const last = visible.filter((p) => p >= 0).pop() ?? first
    let current = -1
    toc.forEach((e, i) => {
      if (e.chapter <= first) current = i
    })
    const next = toc.find((e) => e.chapter > last)
    const v = views.current.get(first)
    onStatus({
      chapter: first,
      chapterTitle: current >= 0 ? toc[current].title : '',
      anchor: anchor.current,
      page: first + 1,
      total: count,
      chapterLeft: next ? next.chapter - last - 1 : null,
      progress: count > 0 ? (last + 1) / count : 0,
      tocPages: toc.map((e) => e.chapter + 1),
      bodyStart: null,
      frontPages: null,
      data: null,
      ready: !!v && v.el.isConnected && loaded.current.has(first)
    })
  }, [doc, visible, count, toc, rendered, onStatus])

  // ---------------------------------------------------------------- 对外接口
  useImperativeHandle(ref, (): PagesApi => ({
    next: () => flip(1),
    prev: () => flip(-1),
    // PDF 没有“章”：Home / End 到书签章节的首尾；没有书签时到全书首尾
    chapterStart: () => {
      const cur = pageRef.current
      const e = [...toc].reverse().find((x) => x.chapter <= cur)
      show(e ? e.chapter : 0, -1)
    },
    chapterEnd: () => {
      const cur = pageRef.current
      const e = toc.find((x) => x.chapter > cur)
      show(e ? e.chapter - 1 : count - 1, 1)
    },
    chapter: (delta) => {
      const cur = pageRef.current
      const e =
        delta > 0
          ? toc.find((x) => x.chapter > cur)
          : [...toc].reverse().find((x) => x.chapter < cur)
      if (e) show(e.chapter, delta)
    },
    goTo: (pos, flashEnd) => {
      const target = Math.max(0, Math.min(count - 1, pos.chapter))
      show(target, target > pageRef.current ? 1 : target < pageRef.current ? -1 : 0)
      anchor.current = { chapter: target, block: 0, offset: pos.offset }
      if (flashEnd) {
        pending.current = { start: pos, end: flashEnd }
        setRendered((n) => n + 1)
      }
    },
    goToPage: (n) => {
      show(n - 1, n - 1 >= pageRef.current ? 1 : -1)
      return true
    },
    positionOf,
    unitText: (pos) => {
      const d = loaded.current.get(pos.chapter)
      return d ? { text: d.text, lines: true } : null
    },
    rangeOf,
    fxHost: () => spread.current,
    visibleRect: () => scroller.current?.getBoundingClientRect() ?? null
  }))

  const vars = { '--pdf-gap': `${OUTER_GAP}px` } as CSSProperties
  return (
    <div ref={scroller} className="pdf-scroll" style={vars} data-rendered={rendered}>
      <div ref={spread} className={cx('pdf-spread', double && 'is-double')}>
        {visible.map((p, k) => (
          <div
            key={k}
            ref={(el) => {
              slots.current[k] = el
            }}
            className={cx('pdf-slot', p < 0 && 'is-blank')}
            style={p < 0 && size ? { width: size.w * scale, height: size.h * scale } : undefined}
          />
        ))}
      </div>
    </div>
  )
})
