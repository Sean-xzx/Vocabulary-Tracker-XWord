/**
 * XWord 的统一书籍格式：章节 → 块（扁平列表）→ 行内片段。所有来源（EPUB、TXT、Gutenberg）导入时都转成它，
 * 不插入原书的任何 HTML；原书的字体、颜色、背景、脚本一律丢弃。
 * - 块：标题 h（级别 lv）、段落 p、引文 quote、列表项 li、分隔 hr、预排版 pre、图片 img、图片说明 cap、表格单元格 td；
 * - 行内格式：斜体 i、加粗 b、小型大写 sc、上标 sup、下标 sub、书内链接 a；换行（诗行里的 <br>）保留为 \n。
 * 位置（锚点）用“章节下标 + 块下标 + 块内字符偏移（UTF-16）”表示，与排版无关：改字号、窗口、单双页都不会跑。
 */

export type BlockKind = 'h' | 'p' | 'quote' | 'li' | 'hr' | 'pre' | 'img' | 'cap' | 'td'
export const BLOCK_KINDS: readonly BlockKind[] = [
  'h',
  'p',
  'quote',
  'li',
  'hr',
  'pre',
  'img',
  'cap',
  'td'
]

export interface Inline {
  t: string
  i?: 1
  b?: 1
  /** 小型大写 */
  sc?: 1
  sup?: 1
  sub?: 1
  /** 书内链接的目标“章节:块”（外链不保留） */
  a?: string
}

/**
 * v0.3 的书只有 h / p / quote / li / hr；v0.4 重新解析后按原书结构保留：标题级别 lv（1–6）、
 * 列表与引文的嵌套层级 d（从 1 开始）、有序列表序号 n、图片文件 src / 替代文字 alt / 宽高 w h、
 * 表格单元格（tb 表号、r 行、col 列、th 表头）、原书版式的样式记号 s（白名单映射成 XWord 的样式）。
 */
export interface Block {
  k: BlockKind
  c: Inline[]
  lv?: number
  d?: number
  n?: number
  src?: string
  tb?: number
  r?: number
  col?: number
  th?: 1
  s?: string[]
  /** 图片的替代文字 */
  alt?: string
  /** 图片的像素宽高（导入时读出，排版时先按比例占位） */
  w?: number
  h?: number
  /** 列表项里的第二段及以后（不再显示项目符号） */
  cont?: 1
}

export type ChapterRole = 'cover' | 'titlepage' | 'toc' | 'front' | 'body' | 'back'

export interface Chapter {
  title: string
  blocks: Block[]
  role?: ChapterRole
}

export type TocGroup = 'front' | 'body' | 'back'

export interface TocEntry {
  title: string
  chapter: number
  block: number
  depth: number
  group?: TocGroup
}

/** 渲染进程（EPUB）或主进程（TXT）解析出的书 */
export interface ParsedBook {
  title: string
  author: string
  language: string
  chapters: Chapter[]
  toc: TocEntry[]
}

/** meta.json：不含正文 */
export interface BookMeta {
  title: string
  author: string
  language: string
  /** 来源页面与许可（Gutenberg 的书保留来源和许可链接） */
  sourceUrl: string
  licenseUrl: string
  fileName: string
  chapters: { title: string; blocks: number; chars: number; role?: ChapterRole }[]
  totalChars: number
}

// ---------------------------------------------------------------- 文本清洗

/** 连字展开成普通字母 */
const LIGATURES: Record<string, string> = {
  ﬀ: 'ff',
  ﬁ: 'fi',
  ﬂ: 'fl',
  ﬃ: 'ffi',
  ﬄ: 'ffl',
  ﬅ: 'st',
  ﬆ: 'st'
}
const LIGATURE_RE = /[ﬀ-ﬆ]/g
const SOFT_HYPHEN_RE = /\u00AD/g
/** 除换行外的空白（含不间断空格、零宽空格） */
const SPACE_RE = /[ \t\f\v\r\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/g

/**
 * 统一为 NFC、去掉软连字符、展开连字、把连续空白合并成一个空格。弯引号、破折号保持原样。
 * keepNewlines 为 false 时换行也当作空白（HTML 源码里的换行）；为 true 时保留单个 \n（<br>、TXT 的诗行）。
 */
export function cleanText(text: string, keepNewlines = false): string {
  let s = text
    .normalize('NFC')
    .replace(SOFT_HYPHEN_RE, '')
    .replace(LIGATURE_RE, (ch) => LIGATURES[ch] ?? ch)
  if (!keepNewlines) s = s.replace(/\n/g, ' ')
  s = s.replace(SPACE_RE, ' ')
  if (keepNewlines) s = s.replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n')
  return s
}

/** 两个片段的行内格式是否相同 */
function sameFormat(a: Inline, b: Inline): boolean {
  return (
    !!a.i === !!b.i &&
    !!a.b === !!b.b &&
    !!a.sc === !!b.sc &&
    !!a.sup === !!b.sup &&
    !!a.sub === !!b.sub &&
    (a.a ?? '') === (b.a ?? '')
  )
}

/**
 * 合并相邻同格式片段、去掉块首尾空白与跨片段的重复空格；清洗后为空的块返回 null（hr、img 除外）。
 * 块上的其它字段（级别、层级、样式记号……）原样保留。pre 块保留原有空白，只去掉首尾的空行。
 */
export function normalizeBlock(block: Block): Block | null {
  const { c, ...rest } = block
  if (block.k === 'hr' || block.k === 'img') return { ...rest, c: [] }
  const pre = block.k === 'pre'
  const out: Inline[] = []
  for (const run of c) {
    let t = run.t
    const prev = out[out.length - 1]
    const prevText = prev?.t ?? ''
    // 片段交界处不留两个空白
    if (!pre && (/[ \n]$/.test(prevText) || out.length === 0)) t = t.replace(/^[ \n]+/, '')
    if (pre && out.length === 0) t = t.replace(/^\n+/, '')
    if (t === '') continue
    if (prev && sameFormat(prev, run)) prev.t += t
    else out.push({ ...run, t })
  }
  // 去掉结尾空白
  while (out.length > 0) {
    const last = out[out.length - 1]
    last.t = last.t.replace(pre ? /\s+$/ : /[ \n]+$/, '')
    if (last.t === '') out.pop()
    else break
  }
  return out.length === 0 ? null : { ...rest, c: out }
}

export function blockText(block: Block): string {
  let s = ''
  for (const run of block.c) s += run.t
  return s
}

// ---------------------------------------------------------------- Project Gutenberg 的前后说明

const PG_START_RE = /\*{3}\s*START OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK/i
const PG_END_RE =
  /\*{3}\s*END OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK|^End of (?:the |this )?Project Gutenberg'?s? /i

export const GUTENBERG_LICENSE_URL = 'https://www.gutenberg.org/policy/license.html'

export function gutenbergSourceUrl(id: string | number): string {
  return `https://www.gutenberg.org/ebooks/${id}`
}

/** TXT：只保留 *** START … *** 与 *** END … *** 之间的正文；返回说明里的 Title / Author。 */
export function stripGutenbergText(text: string): {
  body: string
  title: string
  author: string
  stripped: boolean
} {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => PG_START_RE.test(l))
  let end = -1
  for (let i = Math.max(0, start + 1); i < lines.length; i++) {
    if (PG_END_RE.test(lines[i].trim())) {
      end = i
      break
    }
  }
  const header = start >= 0 ? lines.slice(0, start) : lines.slice(0, 60)
  const field = (name: string): string => {
    const line = header.find((l) => l.startsWith(`${name}:`))
    return line ? line.slice(name.length + 1).trim() : ''
  }
  const title = start >= 0 ? field('Title') : ''
  const author = start >= 0 ? field('Author') : ''
  if (start < 0 && end < 0) return { body: text, title, author, stripped: false }
  const body = lines.slice(start >= 0 ? start + 1 : 0, end >= 0 ? end : lines.length).join('\n')
  return { body, title, author, stripped: true }
}

/**
 * EPUB：按块扫描整本书，去掉 START 那一块及之前、END 那一块及之后的内容；去掉因此变空的章节，目录随之重排。
 */
export function stripGutenbergBook(book: ParsedBook): { book: ParsedBook; stripped: boolean } {
  let start: [number, number] | null = null
  let end: [number, number] | null = null
  for (let ci = 0; ci < book.chapters.length && !end; ci++) {
    const blocks = book.chapters[ci].blocks
    for (let bi = 0; bi < blocks.length && !end; bi++) {
      const text = blockText(blocks[bi]).trim()
      if (!start && PG_START_RE.test(text)) start = [ci, bi]
      else if (PG_END_RE.test(text)) end = [ci, bi]
    }
  }
  if (!start && !end) return { book, stripped: false }
  const keep = (ci: number, bi: number): boolean => {
    if (start && (ci < start[0] || (ci === start[0] && bi <= start[1]))) return false
    if (end && (ci > end[0] || (ci === end[0] && bi >= end[1]))) return false
    return true
  }
  const chapters: Chapter[] = []
  // 旧（章节, 块）→ 新（章节, 块）
  const remap = new Map<string, [number, number]>()
  book.chapters.forEach((ch, ci) => {
    const blocks: Block[] = []
    ch.blocks.forEach((b, bi) => {
      if (!keep(ci, bi)) return
      remap.set(`${ci}:${bi}`, [chapters.length, blocks.length])
      blocks.push(b)
    })
    if (blocks.some((b) => b.k !== 'hr')) chapters.push({ ...ch, blocks })
    else for (const [k, v] of remap) if (v[0] === chapters.length) remap.delete(k)
  })
  const toc: TocEntry[] = []
  for (const e of book.toc) {
    // 目录项指向的块被删掉时，指到同一章里下一个保留的块
    const src = book.chapters[e.chapter]
    let target: [number, number] | undefined
    for (let bi = e.block; src && bi < src.blocks.length && !target; bi++) {
      target = remap.get(`${e.chapter}:${bi}`)
    }
    if (target) toc.push({ ...e, chapter: target[0], block: target[1] })
  }
  // 书内链接（章节:块）跟着换算；指向被删掉部分的链接去掉
  for (const ch of chapters)
    for (const b of ch.blocks)
      for (const r of b.c) {
        if (!r.a) continue
        const t = remap.get(r.a)
        if (t) r.a = `${t[0]}:${t[1]}`
        else delete r.a
      }
  return { book: { ...book, chapters, toc }, stripped: true }
}

// ---------------------------------------------------------------- 位置与进度

export function chapterChars(chapter: Chapter): number {
  let n = 0
  for (const b of chapter.blocks) n += blockText(b).length
  return n
}

/** 由书和来源信息生成 meta.json */
export function buildMeta(
  book: ParsedBook,
  info: { sourceUrl: string; licenseUrl: string; fileName: string }
): BookMeta {
  const chapters = book.chapters.map((c) => ({
    title: c.title,
    blocks: c.blocks.length,
    chars: chapterChars(c),
    ...(c.role ? { role: c.role } : {})
  }))
  return {
    title: book.title,
    author: book.author,
    language: book.language,
    ...info,
    chapters,
    totalChars: chapters.reduce((n, c) => n + c.chars, 0)
  }
}

/** 阅读进度 0–1：之前各章的字数 + 本章之前各块的字数 + 块内偏移，除以全书字数。 */
export function progressAt(
  meta: Pick<BookMeta, 'chapters' | 'totalChars'>,
  chapter: Chapter,
  pos: { chapter: number; block: number; offset: number }
): number {
  if (meta.totalChars <= 0) return 0
  let n = 0
  for (let i = 0; i < pos.chapter && i < meta.chapters.length; i++) n += meta.chapters[i].chars
  for (let i = 0; i < pos.block && i < chapter.blocks.length; i++)
    n += blockText(chapter.blocks[i]).length
  n += pos.offset
  return Math.max(0, Math.min(1, n / meta.totalChars))
}

/** 两个位置的先后：负数 a 在前 */
export function comparePositions(
  a: { chapter: number; block: number; offset: number },
  b: { chapter: number; block: number; offset: number }
): number {
  return a.chapter - b.chapter || a.block - b.block || a.offset - b.offset
}

/**
 * 一段跨块的选区 [start, end) 落在某一块里的范围；不相交时返回 null。
 * 只依赖“章节 + 块 + 偏移”，与字号、行高、版心宽度无关。
 */
export function rangeInBlock(
  start: { chapter: number; block: number; offset: number },
  end: { chapter: number; block: number; offset: number },
  chapter: number,
  block: number,
  length: number
): [number, number] | null {
  const here = { chapter, block, offset: 0 }
  const tail = { chapter, block, offset: length }
  if (comparePositions(end, here) <= 0 || comparePositions(start, tail) >= 0) return null
  const from = start.chapter === chapter && start.block === block ? start.offset : 0
  const to = end.chapter === chapter && end.block === block ? end.offset : length
  return from < to ? [Math.max(0, from), Math.min(length, to)] : null
}

// ---------------------------------------------------------------- 句子

const SENTENCE_MAX = 400

/** 某个偏移所在的完整句子（以 . ! ? 以及随后的引号、括号结束；换行也算分界）。太长时截取偏移附近。 */
export function sentenceAt(text: string, offset: number): string {
  const isEnd = (i: number): boolean => {
    // text[i] 是句末标点，后面跟着引号 / 括号，再后面是空白或结尾
    if (!/[.!?…]/.test(text[i] ?? '')) return false
    let j = i + 1
    while (j < text.length && /["'”’)\]]/.test(text[j])) j++
    return j >= text.length || /\s/.test(text[j])
  }
  let start = 0
  for (let i = Math.min(offset, text.length) - 1; i >= 0; i--) {
    if (text[i] === '\n' || isEnd(i)) {
      start = i + 1
      break
    }
  }
  let end = text.length
  for (let i = Math.max(offset, start); i < text.length; i++) {
    if (text[i] === '\n') {
      end = i
      break
    }
    if (isEnd(i)) {
      let j = i + 1
      while (j < text.length && /["'”’)\]]/.test(text[j])) j++
      end = j
      break
    }
  }
  let s = text.slice(start, end).trim()
  if (s.length > SENTENCE_MAX) {
    const local = Math.max(0, offset - start)
    const from = Math.max(0, local - SENTENCE_MAX / 2)
    s = `…${text.slice(start + from, start + from + SENTENCE_MAX).trim()}…`
  }
  return s
}
