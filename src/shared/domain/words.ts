/**
 * 点词、取句（EPUB 与 PDF 共用）。
 * - wordAt：偏移处的完整单词；PDF 里行尾用连字符断开的单词（effec-⏎tive）合并成一个词再查；
 * - sentenceOf：偏移所在的完整句子；PDF 的文字层按阅读顺序拼接，行尾换行当作空格，行尾连字符去掉；
 * - displayTitle：书名只要主标题（去掉冒号后的副标题），全是小写字母时转成标题格式。
 */
import { sentenceAt } from './book'
import { tokenize } from './tokenize'

export interface WordHit {
  /** 查词用的单词（连字符断行已合并） */
  word: string
  /** 在文字里的起止偏移（跨行时覆盖两行） */
  start: number
  end: number
}

/** 两个词之间只有“行尾连字符 + 换行”：effec-⏎tive */
const LINE_HYPHEN_RE = /^-[ \t]*\n[ \t]*$/

export function wordAt(text: string, offset: number): WordHit | null {
  const tokens = tokenize(text)
  const i = tokens.findIndex((t) => t.start <= offset && offset < t.end)
  if (i < 0) {
    // 点在行尾连字符上：算作它前面的词
    if (text[offset] === '-') {
      const j = tokens.findIndex((t) => t.end === offset)
      if (j >= 0) return wordAt(text, tokens[j].start)
    }
    return null
  }
  let start = tokens[i].start
  let end = tokens[i].end
  let word = tokens[i].text
  const next = tokens[i + 1]
  const prev = tokens[i - 1]
  if (next && LINE_HYPHEN_RE.test(text.slice(end, next.start))) {
    word += next.text
    end = next.end
  } else if (prev && LINE_HYPHEN_RE.test(text.slice(prev.end, start))) {
    word = prev.text + word
    start = prev.start
  }
  return { word, start, end }
}

/** PDF 文字层：行尾连字符 + 换行去掉，其余换行当作空格；返回新文字和“新偏移 → 原偏移”的换算 */
export function joinLines(text: string): { text: string; toSource: (i: number) => number } {
  let out = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '-' && /^-[ \t]*\n/.test(text.slice(i, i + 4)) && /\p{L}/u.test(text[i - 1] ?? '')) {
      // 跳过“-⏎”
      const m = /^-[ \t]*\n[ \t]*/.exec(text.slice(i))!
      i += m[0].length - 1
      continue
    }
    map.push(i)
    out += ch === '\n' ? ' ' : ch
  }
  map.push(text.length)
  return { text: out, toSource: (i) => map[Math.max(0, Math.min(i, map.length - 1))] }
}

/** 偏移所在的完整句子；lines 为 true 时（PDF）先按阅读顺序把各行拼起来 */
export function sentenceOf(text: string, offset: number, lines = false): string {
  if (!lines) return sentenceAt(text, offset)
  const joined = joinLines(text)
  let j = 0
  while (j < joined.text.length && joined.toSource(j) < offset) j++
  return sentenceAt(joined.text, j)
}

/** 书名：去掉冒号后的副标题；全是小写时转成标题格式 */
export function displayTitle(title: string): string {
  let t = title.trim()
  const colon = t.search(/\s*[:：]\s/)
  if (colon > 0) t = t.slice(0, colon).trim()
  else {
    const c = t.indexOf(':')
    if (c > 0) t = t.slice(0, c).trim()
  }
  // 全小写（或只有第一个字母大写）的书名
  const lower = t === t.toLowerCase()
  const sentence = t.slice(1) === t.slice(1).toLowerCase() && /\s/.test(t)
  if (/\p{Ll}/u.test(t) && (lower || sentence)) {
    const small = new Set([
      'a',
      'an',
      'and',
      'as',
      'at',
      'but',
      'by',
      'for',
      'in',
      'of',
      'on',
      'or',
      'the',
      'to',
      'with'
    ])
    t = t
      .split(/(\s+)/)
      .map((w, i) =>
        /^\s+$/.test(w) || (i > 0 && small.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)
      )
      .join('')
  }
  return t || title.trim()
}
