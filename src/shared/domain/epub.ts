/**
 * EPUB 2 / 3 → 统一格式（v0.4：按原书结构保留）。只读取文档的结构（标签名、属性、文本）和 CSS 白名单，
 * 不执行任何脚本、不插入任何 HTML。解析 XML / XHTML 用调用方给的 parse 函数（渲染进程里是 DOMParser，单元测试里是极简解析器）。
 * - 块：h1–h6（原级别）、段落、引文、有序 / 无序列表（可嵌套）、简单表格、图片和图片说明、分隔、预排版；
 *   行内：斜体、加粗、小型大写、上标、下标、书内链接（外链不保留）；
 * - 行内元素之间只保留原文里的空白，不自己加空格；放大的首字母（class 含 dropcap / first-letter，或字号明显放大、左浮动的
 *   单个字母）和后面的字母合并，中间的空白去掉——“F OREWORD”就是这里的空白造成的；
 * - CSS 只取白名单（见 css.ts）；display:none 的内容跳过，display:block 的行内元素当块处理——
 *   只靠 CSS 分行的目录页（每项是 display:block 的 <a> / <span>）因此不会再挤成一段；
 * - 章节：按 spine 顺序，一个文档里有多个目录项时在目录项处拆开；按 landmarks、guide、epub:type 和标题
 *   分出封面 / 书名页 / 目录页 / 前言部分 / 正文 / 附录；书自带的目录页按 nav 的层级重新排成嵌套列表；
 * - 目录读 nav（EPUB 3）的完整层级，没有时读 NCX（EPUB 2）；
 * - Project Gutenberg 的前后说明去掉。
 */
import {
  blockText,
  cleanText,
  normalizeBlock,
  stripGutenbergBook,
  type Block,
  type BlockKind,
  type Chapter,
  type ChapterRole,
  type Inline,
  type ParsedBook,
  type TocEntry,
  type TocGroup
} from './book'
import {
  StyleSheet,
  blockTokens,
  inlineFlags,
  isEnlarged,
  parseCss,
  type ElementInfo,
  type MatchedStyle
} from './css'

/** DOM 的最小子集（浏览器 DOM 与测试用的解析器都满足） */
export interface XNode {
  nodeType: number
  textContent: string | null
  childNodes: ArrayLike<XNode>
  localName?: string
  getAttribute?: (name: string) => string | null
}

/** 返回文档根元素；解析失败时返回 null */
export type ParseDoc = (text: string, kind: 'xml' | 'html') => XNode | null

const ELEMENT = 1
const TEXT = 3
const CDATA = 4

function children(node: XNode): XNode[] {
  return Array.from(node.childNodes)
}

function nameOf(node: XNode): string {
  return (node.localName ?? '').toLowerCase().replace(/^.*:/, '')
}

function attr(node: XNode, name: string): string {
  return node.getAttribute?.(name) ?? ''
}

/** epub:type（XML 里是带前缀的属性；HTML 解析时属性名原样保留） */
function epubType(node: XNode): string {
  return (attr(node, 'epub:type') || attr(node, 'type') || attr(node, 'role')).toLowerCase()
}

function* elements(node: XNode): Generator<XNode> {
  for (const c of children(node)) {
    if (c.nodeType !== ELEMENT) continue
    yield c
    yield* elements(c)
  }
}

function find(node: XNode, name: string): XNode | undefined {
  for (const e of elements(node)) if (nameOf(e) === name) return e
  return undefined
}

function findAll(node: XNode, name: string): XNode[] {
  return [...elements(node)].filter((e) => nameOf(e) === name)
}

function text(node: XNode | undefined): string {
  return node ? cleanText(node.textContent ?? '').trim() : ''
}

// ---------------------------------------------------------------- 路径

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i + 1) : ''
}

/** 相对 href → 压缩包里的路径（去掉锚点、解码 %xx、处理 ./ 和 ../） */
export function resolveHref(base: string, href: string): { path: string; fragment: string } {
  const hash = href.indexOf('#')
  const rawPath = hash >= 0 ? href.slice(0, hash) : href
  const fragment = hash >= 0 ? href.slice(hash + 1) : ''
  let decoded = rawPath
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    // 保持原样
  }
  const parts = (decoded.startsWith('/') ? decoded.slice(1) : dirOf(base) + decoded).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return { path: rawPath === '' ? base : out.join('/'), fragment }
}

/** 压缩包里的路径大小写可能不一致：先精确匹配，再忽略大小写匹配 */
function lookup(files: Record<string, string>, path: string): string | undefined {
  if (path in files) return files[path]
  const lower = path.toLowerCase()
  const key = Object.keys(files).find((k) => k.toLowerCase() === lower)
  return key ? files[key] : undefined
}

const EXTERNAL_RE = /^[a-z][a-z0-9+.-]*:/i

// ---------------------------------------------------------------- 正文 → 块

const SKIP = new Set([
  'head',
  'script',
  'style',
  'title',
  'audio',
  'video',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'canvas',
  'map',
  'source',
  'track',
  'link',
  'meta',
  'math'
])
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const BLOCKS = new Set([
  'p',
  'div',
  'section',
  'article',
  'body',
  'main',
  'header',
  'footer',
  'aside',
  'nav',
  'figure',
  'address',
  'center',
  'hgroup',
  'dl',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'picture'
])
const ITALIC = new Set(['i', 'em', 'cite', 'var', 'dfn'])
const BOLD = new Set(['b', 'strong'])
/** 能继承的样式记号（对齐、缩进、字形、大小写） */
const INHERITED_GROUPS: { test: RegExp }[] = [
  { test: /^(center|right|left)$/ },
  { test: /^(noindent|indent)$/ },
  { test: /^i$/ },
  { test: /^b$/ },
  { test: /^sc$/ },
  { test: /^(upper|lower|capitalize)$/ }
]
const DROPCAP_CLASS_RE = /drop|first-?letter|initial|big-?cap|cap-?first|leading-?letter|firstcap/i
/** Project Gutenberg 的前后说明所在的元素 id */
const PG_BOILERPLATE_IDS = new Set([
  'pg-header',
  'pg-footer',
  'pg-start-separator',
  'pg-end-separator'
])

function mergeInherited(parent: string[], own: string[]): string[] {
  const out = parent.slice()
  for (const t of own) {
    const g = INHERITED_GROUPS.find((x) => x.test.test(t))
    if (!g) continue
    const i = out.findIndex((x) => g.test.test(x))
    if (i >= 0) out[i] = t
    else out.push(t)
  }
  return out
}

interface ListItem {
  d: number
  n: number | undefined
  used: boolean
}

interface State {
  kind: BlockKind
  lv: number
  quote: number
  li: ListItem | null
  i: boolean
  b: boolean
  sc: boolean
  sup: boolean
  sub: boolean
  a: string
  pre: boolean
  /** 能继承的样式记号 */
  inh: string[]
  /** 当前块元素自己的下外边距 */
  own: string[]
}

const ROOT_STATE: State = {
  kind: 'p',
  lv: 0,
  quote: 0,
  li: null,
  i: false,
  b: false,
  sc: false,
  sup: false,
  sub: false,
  a: '',
  pre: false,
  inh: [],
  own: []
}

export interface Converted {
  blocks: Block[]
  /** 元素 id → 块下标（目录锚点、书内链接用） */
  ids: Map<string, number>
  /** 文档的 epub:type（body 或第一个 section 上的） */
  types: string
  /** 书内链接的文字占全部文字的比例（大于一半的是目录页） */
  linkShare: number
  /** 文档里有 <nav epub:type="toc"> */
  hasTocNav: boolean
}

class Converter {
  readonly blocks: Block[] = []
  readonly ids = new Map<string, number>()
  private buffer: Inline[] = []
  private bufState: State = ROOT_STATE
  private glue = false
  private pending: string[] = []
  private lists: { ordered: boolean; n: number }[] = []
  private table: { id: number; row: number; col: number } | null = null
  private tables = 0
  private cell = 0
  textChars = 0
  linkChars = 0

  constructor(
    private readonly sheet: StyleSheet,
    private readonly docPath: string
  ) {}

  private flush(): void {
    if (this.buffer.length === 0) return
    const st = this.bufState
    const runs = this.buffer
    this.buffer = []
    const block: Block = { k: st.kind, c: runs }
    if (st.kind === 'h') block.lv = Math.max(1, Math.min(6, st.lv || 2))
    if (st.kind === 'quote') block.d = Math.max(1, st.quote)
    if (st.kind === 'li' && st.li) {
      block.d = st.li.d
      if (st.li.used || st.li.n === -1) block.cont = 1
      else if (st.li.n !== undefined) block.n = st.li.n
      st.li.used = true
    }
    if (st.kind === 'td' && this.table) {
      block.tb = this.table.id
      block.r = Math.max(0, this.table.row)
      block.col = Math.max(0, this.table.col - 1)
      if (st.b && st.own.includes('th')) block.th = 1
    }
    const s = [...st.inh, ...this.pending, ...st.own.filter((t) => t !== 'th')]
    const out = normalizeBlock(block)
    if (!out) return
    if (s.length > 0) out.s = [...new Set(s)]
    this.pending = []
    this.blocks.push(out)
  }

  private push(t: string, st: State): void {
    let s = t
    if (this.glue) {
      s = s.replace(/^[ \n]+/, '')
      if (s === '') return
      this.glue = false
    }
    if (s === '') return
    if (this.buffer.length === 0) this.bufState = st
    const run: Inline = { t: s }
    if (st.i) run.i = 1
    if (st.b) run.b = 1
    if (st.sc) run.sc = 1
    if (st.sup) run.sup = 1
    else if (st.sub) run.sub = 1
    if (st.a) run.a = st.a
    this.buffer.push(run)
    const n = s.trim().length
    this.textChars += n
    if (st.a) this.linkChars += n
  }

  private hasText(): boolean {
    return this.buffer.some((r) => r.t.trim() !== '')
  }

  private image(node: XNode, st: State, style: MatchedStyle | null, dropcapClass: boolean): void {
    const src = attr(node, 'src') || attr(node, 'xlink:href') || attr(node, 'href')
    const alt = cleanText(attr(node, 'alt')).trim()
    // 首字母做成了图片：用替代文字代替，和后面的字母合并
    if (/^\p{L}{1,2}$/u.test(alt) && (dropcapClass || (style !== null && isEnlarged(style)))) {
      this.push(alt, st)
      this.glue = true
      return
    }
    if (!src || EXTERNAL_RE.test(src)) return
    // 表格里的图、夹在文字中间的小图不单独成块
    if (this.cell > 0 || this.hasText()) return
    this.flush()
    const block: Block = { k: 'img', c: [], src: resolveHref(this.docPath, src).path }
    if (alt) block.alt = alt.slice(0, 500)
    if (this.pending.length > 0) {
      block.s = this.pending
      this.pending = []
    }
    this.blocks.push(block)
  }

  walk(node: XNode, st: State, ancestors: ElementInfo[]): void {
    if (node.nodeType === TEXT || node.nodeType === CDATA) {
      const raw = node.textContent ?? ''
      this.push(st.pre ? raw.normalize('NFC').replace(/­/g, '') : cleanText(raw), st)
      return
    }
    if (node.nodeType !== ELEMENT) return
    const name = nameOf(node)
    if (SKIP.has(name)) return
    const id = attr(node, 'id')
    if (PG_BOILERPLATE_IDS.has(id)) return
    if (node.getAttribute?.('hidden') != null) return
    const type = epubType(node)
    if (name === 'nav' && /\b(landmarks|page-list)\b/.test(type)) return
    const info: ElementInfo = {
      tag: name,
      classes: attr(node, 'class').split(/\s+/).filter(Boolean),
      id,
      style: attr(node, 'style')
    }
    const style = this.sheet.match(info, ancestors)
    const display = style.value.get('display')
    if (display === 'none') return
    // 锚点指向接下来要产生的那一块（正在累积的段落也算这一块）
    if (id && !this.ids.has(id)) this.ids.set(id, this.blocks.length)
    const chain = [info, ...ancestors]

    if (name === 'svg') {
      for (const img of findAll(node, 'image')) this.image(img, st, null, false)
      return
    }
    if (name === 'img' || name === 'image') {
      const dropcap = DROPCAP_CLASS_RE.test(attr(node, 'class'))
      this.image(node, st, style, dropcap)
      return
    }
    if (name === 'br') {
      if (this.buffer.length === 0) this.bufState = st
      this.buffer.push({ t: '\n' })
      return
    }
    if (name === 'hr') {
      if (this.cell > 0) return
      this.flush()
      const last = this.blocks[this.blocks.length - 1]
      if (last && last.k !== 'hr') this.blocks.push({ k: 'hr', c: [] })
      return
    }

    const next: State = { ...st, own: st.own }
    let isBlock = BLOCKS.has(name)
    if (HEADINGS.has(name)) {
      next.kind = 'h'
      next.lv = Number(name[1])
      isBlock = true
    } else if (name === 'blockquote') {
      if (st.kind !== 'h') {
        next.kind = 'quote'
        next.quote = st.quote + 1
      }
      isBlock = true
    } else if (name === 'ul' || name === 'ol') {
      isBlock = true
    } else if (name === 'li') {
      const list = this.lists[this.lists.length - 1]
      next.kind = 'li'
      next.li = {
        d: Math.max(1, this.lists.length),
        n: list?.ordered ? list.n++ : undefined,
        used: false
      }
      isBlock = true
    } else if (name === 'dd') {
      next.kind = 'li'
      next.li = { d: this.lists.length + 1, n: -1, used: true }
      isBlock = true
    } else if (name === 'dt') {
      next.kind = 'p'
      next.b = true
      isBlock = true
    } else if (name === 'pre') {
      next.kind = 'pre'
      next.pre = true
      isBlock = true
    } else if (name === 'figcaption') {
      next.kind = 'cap'
      isBlock = true
    } else if (name === 'table' || name === 'tr') {
      isBlock = true
    } else if (name === 'td' || name === 'th') {
      isBlock = true
    } else if (name === 'a') {
      const href = attr(node, 'href')
      if (href && !EXTERNAL_RE.test(href)) {
        const r = resolveHref(this.docPath, href)
        next.a = `${r.path.toLowerCase()}#${r.fragment}`
      } else next.a = ''
    }
    if (ITALIC.has(name)) next.i = true
    if (BOLD.has(name)) next.b = true
    if (name === 'sup') next.sup = true
    if (name === 'sub') next.sub = true
    if (name === 'th') next.b = true
    if (display === 'block' || display === 'list-item' || display === 'flex' || display === 'grid')
      isBlock = true
    else if ((display === 'inline' || display === 'inline-block') && !HEADINGS.has(name))
      isBlock = name === 'td' || name === 'th' || name === 'tr' || name === 'table'

    // 放大的首字母：一两个字母，class 像 dropcap，或者字号明显放大 / 左浮动
    const content = (node.textContent ?? '').trim()
    const dropcap =
      !HEADINGS.has(name) &&
      name !== 'p' &&
      name !== 'div' &&
      /^\p{L}{1,2}$/u.test(content) &&
      (DROPCAP_CLASS_RE.test(attr(node, 'class')) || isEnlarged(style) || name === 'big')
    if (dropcap) isBlock = false

    if (!isBlock) {
      const f = inlineFlags(style)
      if (f.i) next.i = true
      if (f.b) next.b = true
      if (f.sc) next.sc = true
      for (const c of children(node)) this.walk(c, next, chain)
      if (dropcap) {
        // 首字母自己末尾的空白也去掉
        const last = this.buffer[this.buffer.length - 1]
        if (last) last.t = last.t.replace(/[ \n]+$/, '')
        this.glue = true
      }
      return
    }

    // ---- 块元素
    const own = blockTokens(style)
    next.inh = mergeInherited(st.inh, own)
    next.own = own.filter((t) => /^mb\d$/.test(t))
    if (name === 'th') next.own = [...next.own, 'th']

    if (this.cell > 0 && name !== 'td' && name !== 'th') {
      // 表格单元格里的块：不拆开，换行接着写
      if (this.hasText()) this.buffer.push({ t: '\n' })
      for (const c of children(node)) this.walk(c, next, chain)
      return
    }
    this.flush()
    this.glue = false
    for (const t of own)
      if (/^(mt\d|pb)$/.test(t) && !this.pending.includes(t)) this.pending.push(t)

    if (name === 'ul' || name === 'ol') {
      const start = Number.parseInt(attr(node, 'start'), 10)
      this.lists.push({ ordered: name === 'ol', n: Number.isFinite(start) ? start : 1 })
      for (const c of children(node)) this.walk(c, next, chain)
      this.flush()
      this.lists.pop()
      return
    }
    if (name === 'table') {
      if (this.table) {
        for (const c of children(node)) this.walk(c, next, chain)
        return
      }
      this.table = { id: this.tables++, row: -1, col: 0 }
      for (const c of children(node)) this.walk(c, next, chain)
      this.flush()
      this.table = null
      return
    }
    if (name === 'tr' && this.table) {
      this.table.row++
      this.table.col = 0
      for (const c of children(node)) this.walk(c, next, chain)
      this.flush()
      return
    }
    if ((name === 'td' || name === 'th') && this.table) {
      next.kind = 'td'
      this.table.col++
      this.cell++
      for (const c of children(node)) this.walk(c, next, chain)
      this.flush()
      this.cell--
      return
    }
    for (const c of children(node)) this.walk(c, next, chain)
    this.flush()
  }

  finish(): void {
    this.flush()
    while (this.blocks.length > 0 && this.blocks[this.blocks.length - 1].k === 'hr')
      this.blocks.pop()
  }
}

export function convertBody(
  body: XNode,
  sheet: StyleSheet = StyleSheet.empty,
  docPath = ''
): Converted {
  const conv = new Converter(sheet, docPath)
  conv.walk(body, ROOT_STATE, [])
  conv.finish()
  const first = children(body).find((c) => c.nodeType === ELEMENT)
  const types = `${epubType(body)} ${first && nameOf(first) === 'section' ? epubType(first) : ''}`
  return {
    blocks: conv.blocks,
    ids: conv.ids,
    types: types.trim(),
    linkShare: conv.textChars > 0 ? conv.linkChars / conv.textChars : 0,
    hasTocNav: findAll(body, 'nav').some((n) => /\btoc\b/.test(epubType(n)))
  }
}

/** 一个元素里的文字（目录项的标签）：按正文同样的规则处理首字母和空白，换行变成空格 */
function labelOf(node: XNode, sheet: StyleSheet, path: string): string {
  const conv = new Converter(sheet, path)
  conv.walk(node, { ...ROOT_STATE, kind: 'p' }, [])
  conv.finish()
  return conv.blocks
    .map((b) => blockText(b))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------- 样式表

function sheetFor(
  doc: XNode,
  path: string,
  files: Record<string, string>,
  cache: Map<string, StyleSheet>
): StyleSheet {
  const parts: { key: string; css: string }[] = []
  for (const link of findAll(doc, 'link')) {
    if (!/stylesheet/i.test(attr(link, 'rel'))) continue
    const href = attr(link, 'href')
    if (!href || EXTERNAL_RE.test(href)) continue
    const p = resolveHref(path, href).path
    const css = lookup(files, p)
    if (css !== undefined) parts.push({ key: p, css })
  }
  for (const st of findAll(doc, 'style'))
    parts.push({ key: `inline:${st.textContent}`, css: st.textContent ?? '' })
  const key = parts.map((p) => p.key).join('|')
  const hit = cache.get(key)
  if (hit) return hit
  let order = 0
  const rules = parts.flatMap((p) => {
    const r = parseCss(p.css, order)
    order += r.length
    return r
  })
  const sheet = new StyleSheet(rules)
  cache.set(key, sheet)
  return sheet
}

// ---------------------------------------------------------------- 目录

interface RawToc {
  title: string
  /** 小写路径 + '#' + 片段；没有链接的分组标题为空 */
  href: string
  depth: number
}

function readNav(nav: XNode, base: string, sheet: StyleSheet): RawToc[] {
  const out: RawToc[] = []
  const walkList = (list: XNode, depth: number): void => {
    for (const li of children(list)) {
      if (li.nodeType !== ELEMENT || nameOf(li) !== 'li') continue
      const label = children(li).find(
        (c) => c.nodeType === ELEMENT && (nameOf(c) === 'a' || nameOf(c) === 'span')
      )
      const href = label ? attr(label, 'href') : ''
      if (label) {
        const r = href ? resolveHref(base, href) : null
        out.push({
          title: labelOf(label, sheet, base),
          href: r ? `${r.path.toLowerCase()}#${r.fragment}` : '',
          depth
        })
      }
      const sub = children(li).find(
        (c) => c.nodeType === ELEMENT && (nameOf(c) === 'ol' || nameOf(c) === 'ul')
      )
      if (sub) walkList(sub, depth + 1)
    }
  }
  const ol =
    children(nav).find(
      (c) => c.nodeType === ELEMENT && (nameOf(c) === 'ol' || nameOf(c) === 'ul')
    ) ?? find(nav, 'ol')
  if (ol) walkList(ol, 0)
  return out
}

function readNcx(doc: XNode, base: string): RawToc[] {
  const out: RawToc[] = []
  const walkPoints = (node: XNode, depth: number): void => {
    for (const p of children(node)) {
      if (p.nodeType !== ELEMENT || nameOf(p) !== 'navpoint') continue
      const label = find(p, 'navlabel')
      const content = children(p).find((c) => c.nodeType === ELEMENT && nameOf(c) === 'content')
      const src = content ? attr(content, 'src') : ''
      const r = src ? resolveHref(base, src) : null
      out.push({
        title: text(label),
        href: r ? `${r.path.toLowerCase()}#${r.fragment}` : '',
        depth
      })
      walkPoints(p, depth + 1)
    }
  }
  const map = find(doc, 'navmap')
  if (map) walkPoints(map, 0)
  return out
}

// ---------------------------------------------------------------- 章节分类

/** epub:type / landmarks / guide 的类型 → 章节分类 */
function roleOfType(type: string): ChapterRole | 'start' | null {
  const t = type.toLowerCase()
  if (/\bcover\b/.test(t)) return 'cover'
  if (/\b(title-?page|halftitle-?page|half-title)\b/.test(t)) return 'titlepage'
  if (/\b(toc|contents)\b/.test(t)) return 'toc'
  if (/\b(bodymatter|text|start)\b/.test(t)) return 'start'
  if (
    /\b(frontmatter|copyright-?page|dedication|epigraph|foreword|preface|prologue-?front|acknowledg\w*|imprint|imprimatur|contributors|other-credits|errata|seriespage)\b/.test(
      t
    )
  )
    return 'front'
  if (
    /\b(backmatter|appendix|afterword|glossary|index|bibliography|colophon|notes|endnotes|rearnotes|footnotes|conclusion)\b/.test(
      t
    )
  )
    return 'back'
  if (/\b(chapter|part|volume|division|introduction)\b/.test(t)) return 'body'
  return null
}

const FRONT_TITLE_RE =
  /^(copyright|contents|table of contents|dedication|acknowledg|foreword|preface|epigraph|title page|half title|also by|praise for|about this (e-?)?book|cover)\b/i
const BACK_TITLE_RE =
  /^(appendix|afterword|index|glossary|bibliography|notes|endnotes|about the authors?|acknowledg|colophon|also by|further reading|credits|permissions)\b/i

function groupOf(role: ChapterRole | undefined): TocGroup {
  if (role === 'back') return 'back'
  if (role === 'body' || role === undefined) return 'body'
  return 'front'
}

// ---------------------------------------------------------------- 入口

export class EpubError extends Error {}

interface Piece {
  doc: number
  from: number
  to: number
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export function epubToBook(
  files: Record<string, string>,
  parse: ParseDoc,
  fallbackTitle: string
): { book: ParsedBook; stripped: boolean } {
  const container = lookup(files, 'META-INF/container.xml')
  const containerDoc = container ? parse(container, 'xml') : null
  const rootfile = containerDoc ? find(containerDoc, 'rootfile') : undefined
  const opfPath = rootfile ? attr(rootfile, 'full-path') : ''
  const opfText = opfPath ? lookup(files, opfPath) : undefined
  const opf = opfText ? parse(opfText, 'xml') : null
  if (!opf) throw new EpubError('不是有效的 EPUB：找不到 OPF 文件')

  const metadata = find(opf, 'metadata')
  const title = text(metadata && find(metadata, 'title')) || fallbackTitle
  const author = metadata
    ? findAll(metadata, 'creator')
        .map((c) => text(c))
        .filter(Boolean)
        .join(', ')
    : ''
  const language = text(metadata && find(metadata, 'language')) || 'en'

  const manifest = new Map<string, { path: string; type: string; props: string }>()
  for (const item of findAll(opf, 'item')) {
    manifest.set(attr(item, 'id'), {
      path: resolveHref(opfPath, attr(item, 'href')).path,
      type: attr(item, 'media-type'),
      props: attr(item, 'properties')
    })
  }
  const spineEl = find(opf, 'spine')
  const refs = spineEl ? findAll(spineEl, 'itemref') : []
  const linear = refs.filter((r) => attr(r, 'linear') !== 'no')
  const spine = (linear.length > 0 ? linear : refs)
    .map((r) => manifest.get(attr(r, 'idref')))
    .filter((m): m is { path: string; type: string; props: string } => !!m)
  const sheets = new Map<string, StyleSheet>()

  // ---- 目录与 landmarks：nav 优先，其次 NCX；guide 补充分类
  let rawToc: RawToc[] = []
  const typeByHref = new Map<string, string>()
  const navItem = [...manifest.values()].find((m) => /\bnav\b/.test(m.props))
  const navText = navItem ? lookup(files, navItem.path) : undefined
  if (navItem && navText) {
    const doc = parse(navText, 'xml') ?? parse(navText, 'html')
    if (doc) {
      const sheet = sheetFor(doc, navItem.path, files, sheets)
      const navs = findAll(doc, 'nav')
      const tocNav =
        navs.find((n) => /\btoc\b/.test(epubType(n))) ??
        navs.find((n) => !/\b(landmarks|page-list)\b/.test(epubType(n)))
      if (tocNav) rawToc = readNav(tocNav, navItem.path, sheet)
      const landmarks = navs.find((n) => /\blandmarks\b/.test(epubType(n)))
      if (landmarks)
        for (const a of findAll(landmarks, 'a')) {
          const href = attr(a, 'href')
          if (!href) continue
          const r = resolveHref(navItem.path, href)
          typeByHref.set(`${r.path.toLowerCase()}#${r.fragment}`, epubType(a))
        }
    }
  }
  if (rawToc.length === 0) {
    const ncxId = spineEl ? attr(spineEl, 'toc') : ''
    const ncxItem =
      manifest.get(ncxId) ??
      [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml')
    const ncxText = ncxItem ? lookup(files, ncxItem.path) : undefined
    const doc = ncxText ? parse(ncxText, 'xml') : null
    if (ncxItem && doc) rawToc = readNcx(doc, ncxItem.path)
  }
  const guide = find(opf, 'guide')
  if (guide)
    for (const ref of findAll(guide, 'reference')) {
      const href = attr(ref, 'href')
      if (!href) continue
      const r = resolveHref(opfPath, href)
      const key = `${r.path.toLowerCase()}#${r.fragment}`
      if (!typeByHref.has(key)) typeByHref.set(key, attr(ref, 'type'))
    }

  // ---- 正文：每个 spine 文档先整体转换
  const docs: (Converted & { path: string })[] = []
  for (const item of spine) {
    if (!/html|xml/.test(item.type) && !/\.x?html?$/i.test(item.path)) continue
    const source = lookup(files, item.path)
    if (source === undefined) continue
    const doc = parse(source, 'xml') ?? parse(source, 'html')
    const body = doc ? (find(doc, 'body') ?? doc) : null
    if (!doc || !body) continue
    const sheet = sheetFor(doc, item.path, files, sheets)
    const converted = convertBody(body, sheet, item.path)
    if (!converted.blocks.some((b) => b.k !== 'hr')) continue
    docs.push({ ...converted, path: item.path.toLowerCase() })
  }
  if (docs.length === 0) throw new EpubError('这本书里没有可以读取的正文')
  const docIndex = new Map(docs.map((d, i) => [d.path, i]))

  /** 路径#片段 → 文档 + 块 */
  const locate = (href: string): { doc: number; block: number } | null => {
    const hash = href.indexOf('#')
    const path = hash >= 0 ? href.slice(0, hash) : href
    const frag = hash >= 0 ? href.slice(hash + 1) : ''
    const d = docIndex.get(path)
    if (d === undefined) return null
    const block = frag ? (docs[d].ids.get(frag) ?? 0) : 0
    return { doc: d, block: Math.max(0, Math.min(block, docs[d].blocks.length - 1)) }
  }

  // 没有链接的分组标题指向后面第一个有链接的项
  const tocTargets = rawToc.map((e, i) => {
    let loc = e.href ? locate(e.href) : null
    for (let k = i + 1; !loc && !e.href && k < rawToc.length && rawToc[k].depth > e.depth; k++)
      loc = rawToc[k].href ? locate(rawToc[k].href) : null
    return loc
  })

  // ---- 在目录项处拆章：文档开头有目录项时只在同级（或更高级）的项处拆；开头没有目录项的长文档在最高两级处拆
  const cuts = docs.map(() => new Set<number>([0]))
  docs.forEach((_, di) => {
    const entries = rawToc
      .map((e, i) => ({ e, loc: tocTargets[i] }))
      .filter((x) => x.loc && x.loc.doc === di)
    if (entries.length === 0) return
    const atStart = entries.find((x) => x.loc!.block === 0)
    const minDepth = Math.min(...entries.map((x) => x.e.depth))
    const limit = atStart ? atStart.e.depth : minDepth + 1
    for (const x of entries) if (x.loc!.block > 0 && x.e.depth <= limit) cuts[di].add(x.loc!.block)
  })
  const pieces: Piece[] = []
  docs.forEach((d, di) => {
    const points = [...cuts[di]].sort((a, b) => a - b)
    points.forEach((from, k) => {
      const to = k + 1 < points.length ? points[k + 1] : d.blocks.length
      if (to > from) pieces.push({ doc: di, from, to })
    })
  })
  /** 文档 + 块 → 章节 + 块 */
  const toChapter = (doc: number, block: number): [number, number] => {
    let found = 0
    pieces.forEach((p, i) => {
      if (p.doc === doc && p.from <= block) found = i
    })
    return [found, block - pieces[found].from]
  }

  const chapters: Chapter[] = pieces.map((p) => ({
    title: '',
    blocks: docs[p.doc].blocks.slice(p.from, p.to).map((b) => ({ ...b }))
  }))

  // ---- 目录（完整层级）
  const toc: TocEntry[] = []
  rawToc.forEach((e, i) => {
    const loc = tocTargets[i]
    if (!loc || !e.title) return
    const [chapter, block] = toChapter(loc.doc, loc.block)
    toc.push({ title: e.title, chapter, block, depth: Math.min(e.depth, 5) })
  })

  // ---- 章节标题与分类
  chapters.forEach((c, i) => {
    // 同一处有几层目录项（“Part One”分组 → “Chapter One”）时取最里层的，那才是这一章的名字
    const entry =
      toc.filter((e) => e.chapter === i && e.block === 0).pop() ?? toc.find((e) => e.chapter === i)
    const heading = c.blocks.find((b) => b.k === 'h')
    c.title = entry?.title || (heading ? blockText(heading).replace(/\n/g, ' ') : '')
    // 标题只是用加粗段落写的：第一块的文字就是目录里的章名时，把它当作一级标题
    const first = c.blocks[0]
    if (
      first &&
      first.k === 'p' &&
      entry &&
      entry.block === 0 &&
      norm(blockText(first)) === norm(entry.title)
    )
      c.blocks[0] = { ...first, k: 'h', lv: 1 }
  })
  const typed: (ChapterRole | 'start' | null)[] = chapters.map((c, i) => {
    const p = pieces[i]
    const d = docs[p.doc]
    if (p.from === 0) {
      if (d.hasTocNav) return 'toc'
      const t = roleOfType(d.types)
      if (t) return t
    }
    for (const [href, type] of typeByHref) {
      const loc = locate(href)
      if (loc && loc.doc === p.doc && loc.block === p.from) {
        const t = roleOfType(type)
        if (t) return t
      }
    }
    // 几乎全是书内链接的页面是目录页
    const links = c.blocks.flatMap((b) => b.c).filter((r) => r.a)
    const chars = c.blocks.reduce((n, b) => n + blockText(b).length, 0)
    const linkChars = links.reduce((n, r) => n + r.t.length, 0)
    if (links.length >= 3 && linkChars / Math.max(1, chars) > 0.6) return 'toc'
    if (c.blocks.every((b) => b.k === 'img' || b.k === 'hr') && i === 0) return 'cover'
    return null
  })
  /** 用来判断前言 / 附录的名字：章名，没有时用第一段文字 */
  const labelOfChapter = (c: Chapter): string =>
    (c.title || (c.blocks[0] ? blockText(c.blocks[0]).slice(0, 80) : '')).trim()
  let bodyStart = typed.findIndex((t) => t === 'start' || t === 'body')
  if (bodyStart < 0)
    bodyStart = chapters.findIndex(
      (c, i) =>
        typed[i] === null &&
        !FRONT_TITLE_RE.test(labelOfChapter(c)) &&
        c.blocks.some((b) => b.k !== 'img')
    )
  if (bodyStart < 0) bodyStart = 0
  chapters.forEach((c, i) => {
    const t = typed[i]
    if (t && t !== 'start') c.role = t
    else if (t === 'start') c.role = 'body'
    else if (i < bodyStart) c.role = 'front'
    else if (BACK_TITLE_RE.test(labelOfChapter(c)) && i > bodyStart) c.role = 'back'
    else c.role = 'body'
    if (!c.title) c.title = i === 0 && c.role !== 'body' ? title : `第 ${i + 1} 部分`
  })
  for (const e of toc) e.group = groupOf(chapters[e.chapter]?.role)

  // 目录标签和正文里的标题只差空白（“F OREWORD” / “FOREWORD”）：以正文为准；书里照抄目录的段落也一并改正
  const fixed = new Map<string, string>()
  for (const e of toc) {
    const b = chapters[e.chapter]?.blocks[e.block]
    if (!b) continue
    const body = blockText(b).replace(/\s+/g, ' ').trim()
    if (
      body !== e.title &&
      norm(body) === norm(e.title) &&
      body.split(' ').length < e.title.split(' ').length
    ) {
      fixed.set(e.title, body)
      e.title = body
    }
  }
  if (fixed.size > 0)
    for (const c of chapters) {
      if (fixed.has(c.title)) c.title = fixed.get(c.title) ?? c.title
      for (const b of c.blocks) {
        const t = blockText(b).trim()
        const good = fixed.get(t)
        if (good && b.c.length === 1) b.c = [{ ...b.c[0], t: good }]
      }
    }

  // ---- 书内链接：路径#片段 → 章节:块；找不到的去掉
  for (const c of chapters)
    for (const b of c.blocks)
      for (const r of b.c) {
        if (!r.a) continue
        const loc = locate(r.a)
        if (!loc) {
          delete r.a
          continue
        }
        const [ch, bl] = toChapter(loc.doc, loc.block)
        r.a = `${ch}:${bl}`
      }

  // ---- 书自带的目录页：按 nav 的层级重新排成嵌套列表
  chapters.forEach((c) => {
    if (c.role !== 'toc' || toc.length === 0) return
    const heading = c.blocks.find((b) => b.k === 'h')
    const blocks: Block[] = [heading ?? { k: 'h', lv: 1, c: [{ t: c.title || 'Contents' }] }]
    for (const e of toc) {
      if (chapters[e.chapter] === c) continue
      blocks.push({
        k: 'li',
        d: e.depth + 1,
        cont: 1,
        c: [{ t: e.title, a: `${e.chapter}:${e.block}` }]
      })
    }
    c.blocks = blocks
  })
  // 目录页换了内容：指向它内部的目录项回到开头
  for (const e of toc) if (chapters[e.chapter]?.role === 'toc') e.block = 0

  const finalToc =
    toc.length > 0
      ? toc
      : chapters.map((c, i) => ({
          title: c.title,
          chapter: i,
          block: 0,
          depth: 0,
          group: groupOf(c.role)
        }))

  return stripGutenbergBook({ title, author, language, chapters, toc: finalToc })
}
