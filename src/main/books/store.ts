/**
 * 书的正文存储：userData/books/<bookId>/ 下的 meta.json、toc.json、chapters/0001.json……，
 * 以及原文件 source.epub / source.txt / source.pdf（重新解析、PDF 渲染用）和 images/（EPUB 里的图片）。
 * 正文不进 sql.js 数据库（每日备份只备份数据库）。先写到临时目录，全部写完再改名，避免留下半本书。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { BookFormat, PdfInfo } from '../../shared/api'
import {
  buildMeta,
  type BookMeta,
  type Chapter,
  type ParsedBook,
  type TocEntry
} from '../../shared/domain/book'
import { IMAGE_MIME, IMAGE_NAME_RE, type ImageExt } from './images'

const ID_RE = /^[0-9a-f-]{36}$/i
const SOURCE_EXTS: readonly BookFormat[] = ['epub', 'txt', 'pdf']

export interface StoreExtras {
  /** 原文件 */
  source?: { format: BookFormat; bytes: Uint8Array }
  /** images/ 下的文件名 → 内容 */
  images?: Map<string, Uint8Array>
}

export class BookStore {
  constructor(private readonly root: string) {}

  private dir(id: string): string {
    if (!ID_RE.test(id)) throw new Error('无效的书 id')
    return join(this.root, id)
  }

  has(id: string): boolean {
    return existsSync(join(this.dir(id), 'meta.json'))
  }

  write(
    id: string,
    book: ParsedBook,
    info: { sourceUrl: string; licenseUrl: string; fileName: string },
    extras: StoreExtras = {}
  ): BookMeta {
    const target = this.dir(id)
    const tmp = `${target}.tmp`
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(join(tmp, 'chapters'), { recursive: true })
    const meta = buildMeta(book, info)
    writeFileSync(join(tmp, 'meta.json'), JSON.stringify(meta))
    writeFileSync(join(tmp, 'toc.json'), JSON.stringify(book.toc))
    book.chapters.forEach((c, i) => {
      writeFileSync(join(tmp, 'chapters', chapterFile(i)), JSON.stringify(c))
    })
    if (extras.images && extras.images.size > 0) {
      mkdirSync(join(tmp, 'images'))
      for (const [name, bytes] of extras.images) {
        if (!IMAGE_NAME_RE.test(name)) throw new Error('无效的图片文件名')
        writeFileSync(join(tmp, 'images', name), bytes)
      }
    }
    if (extras.source)
      writeFileSync(join(tmp, `source.${extras.source.format}`), extras.source.bytes)
    rmSync(target, { recursive: true, force: true })
    renameSync(tmp, target)
    return meta
  }

  /** PDF：不解析正文，每页算一“章”（进度、锚点都按页），书签就是目录；原文件存为 source.pdf */
  writePdf(id: string, info: PdfInfo, fileName: string, bytes: Uint8Array): BookMeta {
    const target = this.dir(id)
    const tmp = `${target}.tmp`
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    const meta: BookMeta = {
      title: info.title,
      author: info.author,
      language: 'en',
      sourceUrl: '',
      licenseUrl: '',
      fileName,
      chapters: Array.from({ length: info.pages }, (_, i) => ({
        title: `第 ${i + 1} 页`,
        blocks: 1,
        chars: 1
      })),
      totalChars: info.pages
    }
    writeFileSync(join(tmp, 'meta.json'), JSON.stringify(meta))
    writeFileSync(join(tmp, 'toc.json'), JSON.stringify(info.toc))
    writeFileSync(join(tmp, 'source.pdf'), bytes)
    rmSync(target, { recursive: true, force: true })
    renameSync(tmp, target)
    return meta
  }

  readMeta(id: string): BookMeta {
    return this.readJson<BookMeta>(join(this.dir(id), 'meta.json'))
  }

  readToc(id: string): TocEntry[] {
    return this.readJson<TocEntry[]>(join(this.dir(id), 'toc.json'))
  }

  readChapter(id: string, index: number): Chapter {
    return this.readJson<Chapter>(join(this.dir(id), 'chapters', chapterFile(index)))
  }

  /** 全书的章节（重新解析时换算锚点用） */
  readAllChapters(id: string): Chapter[] {
    const meta = this.readMeta(id)
    return meta.chapters.map((_, i) => this.readChapter(id, i))
  }

  /** 原文件；v0.3 导入的书没有保存原文件，返回 null */
  readSource(id: string): { format: BookFormat; bytes: Uint8Array } | null {
    for (const format of SOURCE_EXTS) {
      const file = join(this.dir(id), `source.${format}`)
      if (existsSync(file)) return { format, bytes: readFileSync(file) }
    }
    return null
  }

  hasSource(id: string): boolean {
    return SOURCE_EXTS.some((f) => existsSync(join(this.dir(id), `source.${f}`)))
  }

  /** PDF 原文件的路径（渲染进程经 IPC 读取内容） */
  sourcePath(id: string, format: BookFormat): string {
    return join(this.dir(id), `source.${format}`)
  }

  /** 图片 → data: 地址 */
  readImage(id: string, name: string): string {
    if (!IMAGE_NAME_RE.test(name)) throw new Error('无效的图片')
    const file = join(this.dir(id), 'images', name)
    if (!existsSync(file)) throw new Error('图片不见了')
    const ext = name.slice(name.lastIndexOf('.') + 1) as ImageExt
    return `data:${IMAGE_MIME[ext]};base64,${readFileSync(file).toString('base64')}`
  }

  imageNames(id: string): string[] {
    const dir = join(this.dir(id), 'images')
    return existsSync(dir) ? readdirSync(dir).filter((n) => IMAGE_NAME_RE.test(n)) : []
  }

  private readJson<T>(file: string): T {
    if (!existsSync(file)) throw new Error('书的文件不见了，请重新导入这本书')
    return JSON.parse(readFileSync(file, 'utf8')) as T
  }
}

function chapterFile(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 99999) throw new Error('无效的章节')
  return `${String(index + 1).padStart(4, '0')}.json`
}
