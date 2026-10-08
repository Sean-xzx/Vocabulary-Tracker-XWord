/**
 * TXT 导入：编码识别 → 去掉 Gutenberg 前后说明 → 按空行分段 → 识别章节标题 → 统一格式。
 * 编码：有 BOM 按 BOM；看起来是 UTF-16（大量 0 字节）按 UTF-16；能按 UTF-8 严格解码就用 UTF-8；否则按 Windows-1252。
 */
import {
  cleanText,
  normalizeBlock,
  stripGutenbergText,
  type Block,
  type Chapter,
  type ParsedBook,
  type TocEntry
} from './book'
import { headingLevelOf } from './heading'

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export function detectEncoding(bytes: Uint8Array): { encoding: TextEncodingName; bom: number } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { encoding: 'utf-8', bom: 3 }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', bom: 2 }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', bom: 2 }
  // 没有 BOM 的 UTF-16：英文文本的奇数（LE）或偶数（BE）字节大多是 0
  const sample = Math.min(bytes.length, 4096) & ~1
  if (sample >= 4) {
    let evenZero = 0
    let oddZero = 0
    for (let i = 0; i < sample; i += 2) {
      if (bytes[i] === 0) evenZero++
      if (bytes[i + 1] === 0) oddZero++
    }
    const pairs = sample / 2
    if (oddZero > pairs * 0.3 && evenZero < pairs * 0.05) return { encoding: 'utf-16le', bom: 0 }
    if (evenZero > pairs * 0.3 && oddZero < pairs * 0.05) return { encoding: 'utf-16be', bom: 0 }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { encoding: 'utf-8', bom: 0 }
  } catch {
    return { encoding: 'windows-1252', bom: 0 }
  }
}

export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncodingName } {
  const { encoding, bom } = detectEncoding(bytes)
  const text = new TextDecoder(encoding).decode(bytes.subarray(bom))
  return { text: text.replace(/\r\n?/g, '\n'), encoding }
}

// ---------------------------------------------------------------- 章节标题

const WORD_NUMBER =
  '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth))?'
const ROMAN = '[IVXLCDM]+'
const HEADING_RE = new RegExp(
  [
    // CHAPTER I. / Chapter 12 / BOOK ONE / PART II: The Title
    `^(?:CHAPTER|Chapter|BOOK|Book|PART|Part|VOLUME|Volume|STAVE|Stave|LETTER|Letter)\\s+(?:${ROMAN}|\\d+|${WORD_NUMBER})\\b[.:]?(?:\\s.*)?$`,
    // 单独一行的罗马数字：“IV.”
    `^${ROMAN}\\.?$`,
    '^(?:PROLOGUE|Prologue|EPILOGUE|Epilogue|PREFACE|Preface|INTRODUCTION|Introduction)\\.?$'
  ].join('|'),
  'i'
)

/** 一段是不是章节标题：只有一行、不长、符合常见写法（CHAPTER、Chapter、BOOK、PART、单独一行的罗马数字等） */
export function isChapterHeading(paragraph: string): boolean {
  const p = paragraph.trim()
  if (p === '' || p.includes('\n') || p.length > 80) return false
  // 大小写不敏感的正则会把“I”这类单词也当罗马数字；单独的罗马数字必须全大写
  if (new RegExp(`^${ROMAN}\\.?$`, 'i').test(p) && !new RegExp(`^${ROMAN}\\.?$`).test(p))
    return false
  return HEADING_RE.test(p)
}

/** 没有识别出章节时，每这么多段分成一部分 */
const PART_SIZE = 200

function paragraphBlock(text: string, kind: Block['k'] = 'p'): Block | null {
  // 硬换行合并成空格
  return normalizeBlock({ k: kind, c: [{ t: cleanText(text.replace(/\n/g, ' ')) }] })
}

export function txtToBook(
  raw: string,
  fallbackTitle: string
): { book: ParsedBook; stripped: boolean } {
  const { body, title, author, stripped } = stripGutenbergText(raw.replace(/\r\n?/g, '\n'))
  const paragraphs = body
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim() !== '')

  const bookTitle = cleanText(title) || fallbackTitle
  const chapters: Chapter[] = []
  let current: Chapter | null = null
  let found = false
  for (const p of paragraphs) {
    if (isChapterHeading(p)) {
      found = true
      const heading = cleanText(p.trim())
      // BOOK / PART / VOLUME 是一级标题，CHAPTER、罗马数字等是二级
      const lv = headingLevelOf(heading) === 1 ? 1 : 2
      current = { title: heading, blocks: [{ k: 'h', lv, c: [{ t: heading }] }], role: 'body' }
      chapters.push(current)
      continue
    }
    const block = paragraphBlock(p)
    if (!block) continue
    if (!current) {
      current = { title: bookTitle, blocks: [], role: found ? 'body' : 'front' }
      chapters.push(current)
    }
    current.blocks.push(block)
  }

  // 没认出任何章节：整本都是正文
  if (!found) for (const c of chapters) c.role = 'body'
  let result = chapters.filter((c) => c.blocks.some((b) => b.k !== 'h') || c.blocks.length > 0)
  if (!found && result.length === 1 && result[0].blocks.length > PART_SIZE) {
    const blocks = result[0].blocks
    result = []
    for (let i = 0; i < blocks.length; i += PART_SIZE) {
      result.push({ title: `第 ${result.length + 1} 部分`, blocks: blocks.slice(i, i + PART_SIZE) })
    }
  }
  const parts = result.some((c) => c.blocks[0]?.k === 'h' && c.blocks[0].lv === 1)
  const toc: TocEntry[] = result.map((c, i) => ({
    title: c.title,
    chapter: i,
    block: 0,
    depth: parts && !(c.blocks[0]?.k === 'h' && c.blocks[0].lv === 1) ? 1 : 0,
    group: c.role === 'front' ? 'front' : 'body'
  }))
  return {
    book: { title: bookTitle, author: cleanText(author), language: 'en', chapters: result, toc },
    stripped
  }
}
