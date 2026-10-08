/**
 * 发现：通过 Gutendex API 搜索 Project Gutenberg 的英文书（languages=en），默认是最热门的前 32 本；
 * 下载优先 EPUB3（带图版本），其次纯文本。下载地址只能是 gutenberg.org（逐跳检查重定向）。不抓取任何网页。
 */
import type { DownloadProgress, GutendexBook, GutendexPage } from '../../shared/api'
import { HOSTS, NetError, guardedFetch, readBody, type NetPolicy } from '../net'
import { IMPORT_LIMITS } from './importer'

/** Gutendex 的全文搜索经常要 20–40 秒才返回（最热门列表 1–2 秒），超时给到 60 秒 */
const SEARCH_TIMEOUT_MS = 60_000
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000
const PAGE_SIZE = 32

interface RawBook {
  id: number
  title: string
  authors?: { name: string }[]
  download_count?: number
  formats?: Record<string, string>
}

export interface Download {
  url: string
  format: 'epub' | 'txt'
  title: string
}

/** 从 formats 里挑下载地址：EPUB3 带图 → 其它 EPUB → UTF-8 纯文本 → 其它纯文本 */
export function pickFormat(
  formats: Record<string, string>
): { url: string; format: Download['format'] } | null {
  const entries = Object.entries(formats)
  const epubs = entries.filter(([type]) => type.startsWith('application/epub+zip'))
  const epub =
    epubs.find(([, url]) => /\.epub3\.images/.test(url)) ??
    epubs.find(([, url]) => /images/.test(url)) ??
    epubs[0]
  if (epub) return { url: epub[1], format: 'epub' }
  const texts = entries.filter(
    ([type, url]) => type.startsWith('text/plain') && !/\.zip$/i.test(url)
  )
  const txt = texts.find(([type]) => /utf-8/i.test(type)) ?? texts[0]
  return txt ? { url: txt[1], format: 'txt' } : null
}

/** 作者名 “Austen, Jane” → “Jane Austen” */
function authorName(name: string): string {
  const m = /^([^,]+),\s*(.+)$/.exec(name)
  return m ? `${m[2]} ${m[1]}` : name
}

export class Gutendex {
  private readonly known = new Map<number, Download>()

  constructor(
    private readonly base: string,
    private readonly policy: { api: NetPolicy; files: NetPolicy },
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  static policies(devOrigin: string | null): { api: NetPolicy; files: NetPolicy } {
    const devOrigins = devOrigin ? [devOrigin] : []
    return {
      api: { hosts: HOSTS.gutendex, devOrigins },
      files: { hosts: HOSTS.gutenberg, devOrigins }
    }
  }

  async search(query: string): Promise<GutendexPage> {
    const params = new URLSearchParams({ languages: 'en' })
    if (query.trim()) params.set('search', query.trim())
    const json = await this.getJson<{ count: number; results: RawBook[] }>(
      `${this.base}/books/?${params.toString()}`
    )
    const books = (json.results ?? []).slice(0, PAGE_SIZE).map((r) => this.remember(r))
    return { books, count: json.count ?? books.length }
  }

  async download(
    id: number,
    onProgress: (p: DownloadProgress) => void
  ): Promise<{ bytes: Uint8Array; download: Download }> {
    let d = this.known.get(id)
    if (!d) {
      this.remember(await this.getJson<RawBook>(`${this.base}/books/${id}`))
      d = this.known.get(id)
    }
    if (!d) throw new NetError('这本书没有可以下载的 EPUB 或纯文本', 'http')
    const { response, controller, timer } = await guardedFetch(
      d.url,
      { headers: { Accept: '*/*' } },
      this.policy.files,
      DOWNLOAD_IDLE_TIMEOUT_MS,
      this.fetchImpl
    )
    if (!response.ok) {
      timer.stop()
      controller.abort()
      throw new NetError(`下载失败（服务器返回 ${response.status}）`, 'http', response.status)
    }
    const bytes = await readBody(
      response,
      controller,
      timer,
      IMPORT_LIMITS.fileBytes,
      (received, total) => onProgress({ gutenbergId: id, received, total })
    )
    return { bytes, download: d }
  }

  private remember(r: RawBook): GutendexBook {
    const picked = pickFormat(r.formats ?? {})
    if (picked) this.known.set(r.id, { ...picked, title: r.title })
    return {
      id: r.id,
      title: r.title,
      authors: (r.authors ?? []).map((a) => authorName(a.name)),
      downloadCount: r.download_count ?? 0,
      format: picked?.format ?? null
    }
  }

  private async getJson<T>(url: string): Promise<T> {
    const { response, controller, timer } = await guardedFetch(
      url,
      { headers: { Accept: 'application/json' } },
      this.policy.api,
      SEARCH_TIMEOUT_MS,
      this.fetchImpl
    )
    if (!response.ok) {
      timer.stop()
      controller.abort()
      throw new NetError(
        `Gutendex 返回错误（${response.status}），请稍后重试`,
        'http',
        response.status
      )
    }
    const body = await readBody(response, controller, timer, 10 * 1024 * 1024)
    try {
      return JSON.parse(new TextDecoder().decode(body)) as T
    } catch {
      throw new NetError('Gutendex 返回的内容无法识别', 'http')
    }
  }
}
