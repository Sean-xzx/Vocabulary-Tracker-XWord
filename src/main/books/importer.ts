/**
 * 导入书（本地文件或 Gutenberg 下载）。导入的书一律当作不可信内容：
 * - 单个文件不超过 200MB；EPUB 解压后的总大小不超过 500MB、条目不超过 10000 个（防压缩炸弹）；
 * - EPUB 先只解压文本文件（xhtml / html / xml / opf / ncx / css）交给渲染进程；图片等解析完只取正文用到的，SVG 先清理；
 * - 结构解析在渲染进程里用 DOMParser 完成（只读结构），结果经过 validate.parsedBook 校验后才写入；
 * - TXT 在这里直接解析（纯文本，不涉及 HTML）；
 * - 原文件存进书目录（source.epub / source.txt），以后解析规则升级时可以重新解析。
 * 按文件的 SHA-256 去重：同一本书重复导入时不新增（删掉过的恢复）；v0.3 导入的旧书再导入同一个文件时，
 * 按新规则重新解析，阅读位置、高亮、出处按原文换算成新锚点（找不到的落到章首，条数写日志）。
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { unzipSync } from 'fflate'
import type {
  BookFormat,
  BookPosition,
  BookSource,
  BookSummary,
  ImportPrepared,
  PdfInfo
} from '../../shared/api'
import { AnchorMapper } from '../../shared/domain/anchors'
import {
  GUTENBERG_LICENSE_URL,
  gutenbergSourceUrl,
  type Chapter,
  type ParsedBook
} from '../../shared/domain/book'
import { txtToBook, decodeText } from '../../shared/domain/txt'
import type { Repository } from '../db/repository'
import { IMAGE_MAX_BYTES, imageSize, sanitizeSvg, sniffImage } from './images'
import type { BookStore } from './store'

export const IMPORT_LIMITS = {
  fileBytes: 200 * 1024 * 1024,
  unzippedBytes: 500 * 1024 * 1024,
  entries: 10000
} as const

/** 正文的解析版本：v0.4 按原书结构解析 */
export const PARSE_VERSION = 2

export const DRM_MESSAGE = '这本书有版权保护（DRM），无法导入'

export class ImportError extends Error {}

export interface ImportOrigin {
  fileName: string
  source: BookSource
  sourceId: string
}

const TEXT_ENTRY_RE = /\.(x?html?|xml|opf|ncx|css)$/i
/** 字体混淆不是 DRM（EPUB 允许用它保护嵌入字体） */
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']

export function sniff(bytes: Uint8Array, fileName: string): 'pdf' | 'epub' | 'txt' {
  const head = String.fromCharCode(...bytes.subarray(0, 5))
  if (head.startsWith('%PDF') || /\.pdf$/i.test(fileName)) return 'pdf'
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
    return 'epub'
  if (/\.epub$/i.test(fileName)) return 'epub'
  return 'txt'
}

/** 按 BOM 或 XML 声明里的 encoding 解码 */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const enc = /encoding\s*=\s*["']([A-Za-z0-9_-]+)["']/.exec(head)?.[1]?.toLowerCase()
  if (enc && enc !== 'utf-8' && enc !== 'utf8') {
    try {
      return new TextDecoder(enc).decode(bytes)
    } catch {
      // 不认识的编码按 UTF-8
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/** 有加密的非字体资源、或者有 Adobe 的 rights.xml，就是 DRM */
export function hasDrm(files: Record<string, string>): boolean {
  const names = Object.keys(files)
  if (names.some((n) => /^META-INF\/rights\.xml$/i.test(n))) return true
  const enc = names.find((n) => /^META-INF\/encryption\.xml$/i.test(n))
  if (!enc) return false
  for (const block of files[enc].split(/<(?:\w+:)?EncryptedData\b/).slice(1)) {
    const algorithm = /Algorithm\s*=\s*["']([^"']+)["']/.exec(block)?.[1] ?? ''
    if (!FONT_OBFUSCATION.includes(algorithm)) return true
  }
  return false
}

/** 解压满足条件的条目；条目数、解压后总大小超过上限时拒绝 */
function unzipSome(
  bytes: Uint8Array,
  want: (name: string, size: number) => boolean
): Record<string, Uint8Array> {
  let entries = 0
  let declared = 0
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(bytes, {
      filter: (file) => {
        entries++
        declared += file.originalSize
        if (entries > IMPORT_LIMITS.entries) throw new ImportError('压缩包里的文件太多，无法导入')
        if (declared > IMPORT_LIMITS.unzippedBytes)
          throw new ImportError('解压后的内容超过 500MB，无法导入')
        return want(file.name, file.originalSize)
      }
    })
  } catch (error) {
    if (error instanceof ImportError) throw error
    throw new ImportError('无法读取这个 EPUB（文件损坏或不是 EPUB）')
  }
  let actual = 0
  for (const data of Object.values(raw)) {
    actual += data.byteLength
    if (actual > IMPORT_LIMITS.unzippedBytes)
      throw new ImportError('解压后的内容超过 500MB，无法导入')
  }
  return raw
}

/** 只解压文本文件 */
export function unzipEpubText(bytes: Uint8Array): Record<string, string> {
  const raw = unzipSome(bytes, (name) => TEXT_ENTRY_RE.test(name) || /^META-INF\//i.test(name))
  const files: Record<string, string> = {}
  for (const [name, data] of Object.entries(raw)) files[name] = decodeXml(data)
  return files
}

/**
 * 取出正文用到的图片：按文件头认格式（PNG / JPEG / GIF / WebP / SVG），SVG 先清理，读出宽高；
 * 块的 src 从压缩包路径换成书目录里的文件名。取不出来或清不干净的图片 src 置空（不显示）。
 */
export function extractImages(bytes: Uint8Array, book: ParsedBook): Map<string, Uint8Array> {
  const wanted = new Set<string>()
  for (const c of book.chapters)
    for (const b of c.blocks) if (b.k === 'img' && b.src) wanted.add(b.src.toLowerCase())
  const out = new Map<string, Uint8Array>()
  if (wanted.size === 0) return out
  const raw = unzipSome(
    bytes,
    (name, size) => wanted.has(name.toLowerCase()) && size <= IMAGE_MAX_BYTES
  )
  const byPath = new Map(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]))
  const named = new Map<string, { name: string; w?: number; h?: number } | null>()
  for (const c of book.chapters)
    for (const b of c.blocks) {
      if (b.k !== 'img' || !b.src) continue
      const key = b.src.toLowerCase()
      if (!named.has(key)) {
        let data = byPath.get(key)
        const ext = data ? sniffImage(data) : null
        if (data && ext === 'svg') {
          const clean = sanitizeSvg(new TextDecoder('utf-8').decode(data))
          data = clean === null ? undefined : new TextEncoder().encode(clean)
        }
        if (!data || !ext || data.byteLength > IMAGE_MAX_BYTES) named.set(key, null)
        else {
          const name = `${out.size + 1}.${ext}`
          out.set(name, data)
          const size = imageSize(data, ext)
          named.set(key, { name, ...(size ?? {}) })
        }
      }
      const n = named.get(key)
      if (!n) {
        b.src = ''
        continue
      }
      b.src = n.name
      if (n.w && n.h) {
        b.w = n.w
        b.h = n.h
      }
    }
  return out
}

interface Pending extends ImportOrigin {
  hash: string
  expires: number
  bytes: Uint8Array
  format: BookFormat
  /** 重新解析已有的书（id）；新书为 null */
  reparseOf: string | null
}

const TOKEN_TTL_MS = 10 * 60 * 1000

export class Importer {
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly repo: Repository,
    private readonly store: BookStore,
    private readonly log: (message: string) => void
  ) {}

  prepareFromPath(path: string): ImportPrepared {
    let size: number
    try {
      const st = statSync(path)
      if (!st.isFile()) throw new Error()
      size = st.size
    } catch {
      throw new ImportError('找不到这个文件')
    }
    if (size > IMPORT_LIMITS.fileBytes) throw new ImportError('文件超过 200MB，无法导入')
    const name = basename(path)
    return this.prepare(readFileSync(path), { fileName: name, source: 'import', sourceId: '' })
  }

  prepare(bytes: Uint8Array, origin: ImportOrigin): ImportPrepared {
    if (bytes.byteLength > IMPORT_LIMITS.fileBytes)
      throw new ImportError('文件超过 200MB，无法导入')
    const kind = sniff(bytes, origin.fileName)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const existing = this.repo.findBookByHash(hash)
    if (existing && this.store.has(existing.id)) {
      const book = existing.deleted ? this.repo.restoreBook(existing.id) : existing
      if (book.parseVersion >= PARSE_VERSION && this.store.hasSource(book.id))
        return { status: 'exists', book }
      // 旧版本导入的书：用这个原文件按新规则重新解析
      return this.start(
        bytes,
        { ...origin, fileName: this.store.readMeta(book.id).fileName },
        hash,
        kind,
        book.id
      )
    }
    return this.start(bytes, origin, hash, kind, null)
  }

  /** 打开旧书时：原文件还在就重新解析；没有原文件返回 missing（界面提示重新导入） */
  prepareReparse(bookId: string): ImportPrepared {
    const book = this.repo.getBook(bookId)
    const src = this.store.readSource(bookId)
    if (!src) return { status: 'missing', book }
    if (src.format === 'pdf') return { status: 'exists', book }
    const meta = this.store.readMeta(bookId)
    const hash = createHash('sha256').update(src.bytes).digest('hex')
    return this.start(
      src.bytes,
      { fileName: meta.fileName, source: book.source, sourceId: book.sourceId },
      hash,
      src.format,
      bookId
    )
  }

  private start(
    bytes: Uint8Array,
    origin: ImportOrigin,
    hash: string,
    format: BookFormat,
    reparseOf: string | null
  ): ImportPrepared {
    const p: Pending = { ...origin, hash, expires: 0, bytes, format, reparseOf }
    const fallbackTitle = basename(origin.fileName, extname(origin.fileName)) || '未命名'
    if (format === 'pdf') {
      // 页数、书签、是不是扫描版由渲染进程用 pdf.js 读出后提交
      if (!String.fromCharCode(...bytes.subarray(0, 5)).startsWith('%PDF'))
        throw new ImportError('无法读取这个 PDF（文件损坏或不是 PDF）')
      const token = randomUUID()
      this.sweep()
      this.pending.set(token, { ...p, expires: Date.now() + TOKEN_TTL_MS })
      return { status: 'pdf', token, fileName: origin.fileName, bytes }
    }
    if (format === 'txt') {
      const { text } = decodeText(bytes)
      const { book } = txtToBook(text, fallbackTitle)
      if (book.chapters.length === 0) throw new ImportError('这个文件里没有可以读取的正文')
      return { status: 'imported', book: this.finish(book, p, new Map()) }
    }
    const files = unzipEpubText(bytes)
    if (hasDrm(files)) throw new ImportError(DRM_MESSAGE)
    const token = randomUUID()
    this.sweep()
    this.pending.set(token, { ...p, expires: Date.now() + TOKEN_TTL_MS })
    return { status: 'parse', token, files, fileName: origin.fileName }
  }

  /** 渲染进程解析好的 EPUB（已校验） */
  commit(token: string, book: ParsedBook): BookSummary {
    const p = this.pending.get(token)
    if (!p || p.expires < Date.now()) throw new ImportError('导入已过期，请重新导入')
    this.pending.delete(token)
    if (!p.reparseOf) {
      const existing = this.repo.findBookByHash(p.hash)
      if (existing && this.store.has(existing.id))
        return existing.deleted ? this.repo.restoreBook(existing.id) : existing
    }
    const images = extractImages(p.bytes, book)
    return this.finish(book, p, images)
  }

  /** 渲染进程读出的 PDF 信息（已校验）：原文件存进书目录，每页算一“章”，书签是目录 */
  commitPdf(token: string, info: PdfInfo): BookSummary {
    const p = this.pending.get(token)
    if (!p || p.expires < Date.now() || p.format !== 'pdf')
      throw new ImportError('导入已过期，请重新导入')
    this.pending.delete(token)
    const existing = this.repo.findBookByHash(p.hash)
    if (existing && this.store.has(existing.id))
      return existing.deleted ? this.repo.restoreBook(existing.id) : existing
    const id = randomUUID()
    const title = info.title.trim() || basename(p.fileName, extname(p.fileName)) || '未命名'
    this.store.writePdf(id, { ...info, title }, p.fileName, p.bytes)
    const summary = this.repo.addBook({
      id,
      title: title.slice(0, 300),
      author: info.author.slice(0, 300),
      source: p.source,
      sourceId: p.sourceId,
      fileHash: p.hash,
      format: 'pdf',
      parseVersion: PARSE_VERSION
    })
    this.log(`已导入 PDF《${summary.title}》：${info.pages} 页，${info.toc.length} 个书签`)
    return summary
  }

  private finish(book: ParsedBook, p: Pending, images: Map<string, Uint8Array>): BookSummary {
    return p.reparseOf ? this.reparse(p.reparseOf, book, p, images) : this.save(book, p, images)
  }

  private save(book: ParsedBook, p: Pending, images: Map<string, Uint8Array>): BookSummary {
    const id = randomUUID()
    const gutenberg = p.source === 'gutenberg'
    const meta = this.store.write(
      id,
      book,
      {
        sourceUrl: gutenberg ? gutenbergSourceUrl(p.sourceId) : '',
        licenseUrl: gutenberg ? GUTENBERG_LICENSE_URL : '',
        fileName: p.fileName
      },
      { source: { format: p.format, bytes: p.bytes }, images }
    )
    const summary = this.repo.addBook({
      id,
      title: book.title.slice(0, 300) || '未命名',
      author: book.author.slice(0, 300),
      source: p.source,
      sourceId: p.sourceId,
      fileHash: p.hash,
      format: p.format,
      parseVersion: PARSE_VERSION
    })
    this.log(
      `已导入《${summary.title}》：${meta.chapters.length} 章，${meta.totalChars} 字符，${images.size} 张图片（${p.source}）`
    )
    return summary
  }

  /** 按新规则重新解析已有的书：先按原文换算锚点，再写入新正文，最后在一个事务里更新数据库 */
  private reparse(
    id: string,
    book: ParsedBook,
    p: Pending,
    images: Map<string, Uint8Array>
  ): BookSummary {
    const oldMeta = this.store.readMeta(id)
    const oldChapters: Chapter[] = this.store.readAllChapters(id)
    const mapper = new AnchorMapper(oldChapters, book.chapters)
    const last = book.chapters.length - 1
    // 找不到的落到章首：旧章节开头对应的新章节；再不行按章节下标
    const fallback = (pos: BookPosition): BookPosition => {
      const start = mapper.map({ chapter: pos.chapter, block: 0, offset: 0 })
      return { chapter: start?.chapter ?? Math.min(pos.chapter, last), block: 0, offset: 0 }
    }
    this.store.write(
      id,
      book,
      { sourceUrl: oldMeta.sourceUrl, licenseUrl: oldMeta.licenseUrl, fileName: oldMeta.fileName },
      { source: { format: p.format, bytes: p.bytes }, images }
    )
    const r = this.repo.remapBookAnchors(
      id,
      (pos) => mapper.map(pos),
      fallback,
      p.format,
      PARSE_VERSION
    )
    const summary = this.repo.getBook(id)
    this.log(
      `已按新规则重新解析《${summary.title}》：${oldChapters.length} → ${book.chapters.length} 章；` +
        `阅读位置、高亮、出处共 ${r.total} 个锚点按原文转换，${r.failed} 个找不到、落到章首`
    )
    return summary
  }

  private sweep(): void {
    const now = Date.now()
    for (const [k, v] of this.pending) if (v.expires < now) this.pending.delete(k)
  }
}
