/**
 * 词典（ECDICT 精简版，只读）：主进程启动后在后台加载，不阻塞窗口显示。
 * 文件是“每个词条一行”的 JSON（见 scripts/dict-build.mjs），按小写单词排序。
 * 加载时只解压成 Buffer 并记下每行的位置；查询时二分查找，只解析用到的几十行。
 */
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import type { DictLookupResult } from '../shared/api'
import { parseLemma, toDictEntry, type DictEntry, type DictRow } from '../shared/domain/dict'
import { stripPossessive } from '../shared/domain/tokenize'

const gunzipAsync = promisify(gunzip)
const NEWLINE = 0x0a
const OPEN_BRACKET = 0x5b

export function normalizeQuery(word: string): string {
  return word.trim().replace(/\s+/g, ' ')
}

export class Dictionary {
  private constructor(
    private readonly buf: Buffer,
    private readonly starts: Int32Array,
    private readonly ends: Int32Array
  ) {}

  static async load(file: string): Promise<Dictionary> {
    const buf = await gunzipAsync(await readFile(file))
    const starts: number[] = []
    const ends: number[] = []
    let pos = 0
    while (pos < buf.length) {
      let end = buf.indexOf(NEWLINE, pos)
      if (end < 0) end = buf.length
      // 词条行以 [ 开头，行尾可能有逗号
      if (buf[pos] === OPEN_BRACKET) {
        starts.push(pos)
        ends.push(buf[end - 1] === 0x2c ? end - 1 : end)
      }
      pos = end + 1
    }
    if (starts.length === 0) throw new Error('词典文件里没有词条')
    return new Dictionary(buf, Int32Array.from(starts), Int32Array.from(ends))
  }

  get size(): number {
    return this.starts.length
  }

  private row(i: number): DictRow {
    return JSON.parse(this.buf.toString('utf8', this.starts[i], this.ends[i])) as DictRow
  }

  /** 只解析行首的单词（不解析整行），二分查找时用 */
  private key(i: number): string {
    const start = this.starts[i] + 1
    let end = start + 1
    for (;;) {
      end = this.buf.indexOf(0x22, end)
      if (end < 0 || this.buf[end - 1] !== 0x5c) break
      end++
    }
    if (end < 0) return this.row(i)[0].toLowerCase()
    return (JSON.parse(this.buf.toString('utf8', start, end + 1)) as string).toLowerCase()
  }

  /** 第一个 key >= target 的行号 */
  private lowerBound(target: string): number {
    let lo = 0
    let hi = this.size
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.key(mid) < target) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** 不区分大小写查找；有大小写完全一致的词条时优先返回它。 */
  findRow(word: string): DictRow | null {
    const query = normalizeQuery(word)
    if (query === '') return null
    const target = query.toLowerCase()
    let first: DictRow | null = null
    for (let i = this.lowerBound(target); i < this.size; i++) {
      const row = this.row(i)
      if (row[0].toLowerCase() !== target) break
      if (row[0] === query) return row
      first ??= row
    }
    return first
  }

  lookup(word: string): DictEntry | null {
    const row = this.findRow(word)
    return row ? toDictEntry(row) : null
  }

  /** 原形（小写）：词条的 exchange 里有“0:原形”时用它，否则就是词条本身；词典里没有时返回 undefined */
  lemma(word: string): string | undefined {
    const row = this.findRow(word)
    if (!row) return undefined
    const lemma = parseLemma(row[0], row[6])
    return (lemma ? lemma.word : row[0]).toLowerCase()
  }
}

/** 词典服务：加载状态 + 查询，供 IPC 调用。 */
export class DictService {
  private dict: Dictionary | null = null
  private failed = false

  async load(file: string): Promise<Dictionary> {
    try {
      this.dict = await Dictionary.load(file)
      return this.dict
    } catch (error) {
      this.failed = true
      throw error
    }
  }

  lookup(word: string): DictLookupResult {
    if (this.failed) return { status: 'unavailable' }
    if (!this.dict) return { status: 'loading' }
    const entry = this.dict.lookup(word)
    return entry ? { status: 'found', entry } : { status: 'notFound' }
  }

  private readonly lemmaCache = new Map<string, string>()

  /**
   * 一批词（已是小写）的原形：词典里查得到时取原形；查不到时试着去掉所有格；都没有就是它自己。
   * 词典还没加载好时返回 null，调用方稍后再试。
   */
  lemmas(words: string[]): Record<string, string> | null {
    if (!this.dict) return null
    const out: Record<string, string> = {}
    for (const w of words) {
      let lemma = this.lemmaCache.get(w)
      if (lemma === undefined) {
        lemma = this.dict.lemma(w) ?? this.dict.lemma(stripPossessive(w)) ?? w
        if (this.lemmaCache.size > 100_000) this.lemmaCache.clear()
        this.lemmaCache.set(w, lemma)
      }
      out[w] = lemma
    }
    return out
  }
}
