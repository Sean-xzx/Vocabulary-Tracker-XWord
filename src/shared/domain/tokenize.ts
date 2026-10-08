/**
 * 分词与“在书里遇见单词本里的词”。
 * - 英文单词是可点击的片段：it's、don't 这类撇号词和 well-known 这类连字符词各算一个词；数字和标点不能点。
 * - 原形匹配：词典的 exchange 字段给出原形（went → go），单词本里的词和它的变形都能认出来；
 *   熟词（“我认识”）和它的所有变形都不再显示任何标记。
 */

export interface Token {
  start: number
  end: number
  text: string
}

/** 字母开头，中间可以有撇号、连字符连接的字母段 */
const WORD_RE = /\p{L}+(?:['’]\p{L}+)*(?:-\p{L}+(?:['’]\p{L}+)*)*/gu
const DIGIT_RE = /\p{Nd}/u

export function tokenize(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    // 紧挨着数字的字母（1990s、4th）不算单词
    if (DIGIT_RE.test(text[start - 1] ?? '') || DIGIT_RE.test(text[end] ?? '')) continue
    out.push({ start, end, text: m[0] })
  }
  return out
}

/** 查词和匹配用的形式：小写，弯撇号换成直撇号 */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/’/g, "'")
}

/** 去掉所有格（Darcy's → darcy）。其余形式交给词典的原形。 */
export function stripPossessive(word: string): string {
  return word.replace(/'s$/, '')
}

export type LemmaOf = (normalized: string) => string | undefined

export interface WordIndex {
  /** 单词本：匹配键（原样小写或原形）→ 词 id */
  words: Map<string, string>
  /** 熟词的原形 */
  known: Set<string>
}

/** 一个词的全部匹配键：本身、去掉所有格、词典原形 */
export function matchKeys(normalized: string, lemmaOf: LemmaOf): string[] {
  const keys = [normalized]
  const bare = stripPossessive(normalized)
  if (bare !== normalized) keys.push(bare)
  for (const k of [...keys]) {
    const lemma = lemmaOf(k)
    if (lemma && !keys.includes(lemma)) keys.push(lemma)
  }
  return keys
}

export function buildWordIndex(
  words: { id: string; text: string }[],
  known: Iterable<string>,
  lemmaOf: LemmaOf
): WordIndex {
  const map = new Map<string, string>()
  for (const w of words) {
    for (const k of matchKeys(normalizeWord(w.text.trim()), lemmaOf))
      if (!map.has(k)) map.set(k, w.id)
  }
  return { words: map, known: new Set([...known].map(normalizeWord)) }
}

export interface Encounter {
  /** 单词本里的词 id（没有为 null） */
  wordId: string | null
  /** 是熟词：不显示任何标记 */
  known: boolean
}

export function classifyWord(word: string, index: WordIndex, lemmaOf: LemmaOf): Encounter {
  const keys = matchKeys(normalizeWord(word), lemmaOf)
  if (keys.some((k) => index.known.has(k))) return { wordId: null, known: true }
  for (const k of keys) {
    const id = index.words.get(k)
    if (id) return { wordId: id, known: false }
  }
  return { wordId: null, known: false }
}

/**
 * 在出处的句子里找到这个词（原样、去掉所有格、或者原形相同的变形），复习卡片用荧光笔底色标出它。
 * 找不到时返回 null。
 */
export function findWordInText(text: string, wordText: string, lemmaOf: LemmaOf): Token | null {
  const target = normalizeWord(wordText.trim())
  const targetLemma = lemmaOf(target) ?? target
  const tokens = tokenize(text)
  return (
    tokens.find((t) => normalizeWord(t.text) === target) ??
    tokens.find((t) =>
      matchKeys(normalizeWord(t.text), lemmaOf).some((k) => k === target || k === targetLemma)
    ) ??
    null
  )
}

/** 收词、标熟词时用的原形：有原形用原形，否则用去掉所有格后的小写形式 */
export function lemmaFor(word: string, lemmaOf: LemmaOf): string {
  const n = stripPossessive(normalizeWord(word))
  return lemmaOf(n) ?? lemmaOf(normalizeWord(word)) ?? n
}
