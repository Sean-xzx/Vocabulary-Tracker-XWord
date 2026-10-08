/**
 * 词典（打包进软件的 ECDICT，只读）相关的纯函数：
 * 释义解析（词性分组 → 义项）、词形还原信息、考试标签，以及“所选义项 → 词义文字 / 词性”。
 */

export interface DictSense {
  text: string
  /** 义项自带的领域标记，例如 “计”；没有时为空串 */
  domain: string
}

export interface DictGroup {
  /** 在词典原文里的顺序（生成文字时按它排序） */
  index: number
  /** 词性标记，例如 “n.”“vt.”；领域组或没有词性时为空串 */
  pos: string
  /** 整组的领域标记，例如 “经”“网络” */
  domain: string
  senses: DictSense[]
}

export interface DictLemma {
  /** 原形 */
  word: string
  /** 输入的词是原形的哪几种变化，例如 ['过去式'] */
  forms: string[]
}

export interface DictEntry {
  word: string
  phonetic: string
  /** 显示顺序：[网络] 组排在最后，其余保持词典原顺序 */
  groups: DictGroup[]
  /** 考试标签的中文名，例如 ['四级', '雅思'] */
  tags: string[]
  oxford: boolean
  collins: number
  lemma: DictLemma | null
}

/** 词典的一行原始数据（字段顺序与 ecdict-lite.json.gz 的 fields 一致） */
export type DictRow = [
  word: string,
  phonetic: string,
  translation: string,
  tag: string,
  oxford: number,
  collins: number,
  exchange: string
]

export const WEB_DOMAIN = '网络'

const POS_WORDS = [
  'n',
  'v',
  'vt',
  'vi',
  'a',
  'adj',
  'ad',
  'adv',
  'prep',
  'conj',
  'pron',
  'num',
  'art',
  'int',
  'interj',
  'aux',
  'abbr',
  'pl',
  'pref',
  'suf',
  'phr',
  'det'
]
/** ECDICT 用 a. / ad. 表示形容词 / 副词，统一成更常见的写法 */
const POS_ALIASES: Record<string, string> = { a: 'adj', ad: 'adv' }
const POS_ALT = POS_WORDS.join('|')
const LEADING_POS_RE = new RegExp(`^((?:${POS_ALT})\\.(?:\\s*[&/]\\s*(?:${POS_ALT})\\.)*)\\s*`, 'i')
const LEADING_DOMAIN_RE = /^[[【]([^\]】]{1,12})[\]】]\s*/

const OPEN = '(（[【'
const CLOSE = ')）]】'

function normalizePos(raw: string): string {
  return raw
    .split(/\s*([&/])\s*/)
    .map((part) => {
      if (part === '&' || part === '/') return part
      const word = part.replace(/\.$/, '').toLowerCase()
      return `${POS_ALIASES[word] ?? word}.`
    })
    .join('')
}

/** 按中英文逗号、分号拆分义项；括号里的逗号不拆。 */
export function splitSenses(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (OPEN.includes(ch)) depth++
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1)
    if (depth === 0 && ',，;；'.includes(ch)) {
      out.push(current)
      current = ''
    } else current += ch
  }
  out.push(current)
  return out.map((s) => s.trim()).filter((s) => s !== '')
}

function parseSense(raw: string): DictSense {
  const m = LEADING_DOMAIN_RE.exec(raw)
  if (!m) return { text: raw, domain: '' }
  const text = raw.slice(m[0].length).trim()
  return text ? { text, domain: m[1].trim() } : { text: raw, domain: '' }
}

/** 把 translation 解析成“词性分组 → 义项列表”。[网络] 开头的组排到最后。 */
export function parseTranslation(translation: string): DictGroup[] {
  const groups: DictGroup[] = []
  const lines = translation
    .split(/\r?\n|\\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  lines.forEach((line, index) => {
    let rest = line
    let domain = ''
    let pos = ''
    const d = LEADING_DOMAIN_RE.exec(rest)
    if (d) {
      domain = d[1].trim()
      rest = rest.slice(d[0].length)
    } else {
      const p = LEADING_POS_RE.exec(rest)
      if (p) {
        pos = normalizePos(p[1])
        rest = rest.slice(p[0].length)
      }
    }
    const senses = splitSenses(rest).map(parseSense)
    if (senses.length > 0) groups.push({ index, pos, domain, senses })
  })
  return [
    ...groups.filter((g) => g.domain !== WEB_DOMAIN),
    ...groups.filter((g) => g.domain === WEB_DOMAIN)
  ]
}

// ---------------------------------------------------------------- 词形变化

export const FORM_LABELS: Record<string, string> = {
  p: '过去式',
  d: '过去分词',
  i: '现在分词',
  '3': '第三人称单数',
  r: '比较级',
  t: '最高级',
  s: '复数'
}

/** 从 exchange 字段（如 “0:go/1:p”）读出原形；输入的就是原形时返回 null。 */
export function parseLemma(word: string, exchange: string): DictLemma | null {
  const fields = new Map<string, string>()
  for (const part of exchange.split('/')) {
    const i = part.indexOf(':')
    if (i > 0) fields.set(part.slice(0, i), part.slice(i + 1))
  }
  const lemma = fields.get('0')?.trim()
  if (!lemma || lemma.toLowerCase() === word.toLowerCase()) return null
  const forms = [...(fields.get('1') ?? '')]
    .map((c) => FORM_LABELS[c])
    .filter((f): f is string => f !== undefined)
  return { word: lemma, forms: [...new Set(forms)] }
}

/** “went 是 go 的过去式” */
export function describeLemma(word: string, lemma: DictLemma): string {
  const forms = lemma.forms.length > 0 ? lemma.forms.join('、') : '变化形式'
  return `${word} 是 ${lemma.word} 的${forms}`
}

// ---------------------------------------------------------------- 考试标签

const TAG_LABELS: [string, string][] = [
  ['zk', '中考'],
  ['gk', '高考'],
  ['cet4', '四级'],
  ['cet6', '六级'],
  ['ky', '考研'],
  ['toefl', '托福'],
  ['ielts', '雅思'],
  ['gre', 'GRE']
]

export function tagLabels(tag: string): string[] {
  const tags = new Set(tag.split(/\s+/).filter(Boolean))
  return TAG_LABELS.filter(([key]) => tags.has(key)).map(([, label]) => label)
}

export function toDictEntry(row: DictRow): DictEntry {
  const [word, phonetic, translation, tag, oxford, collins, exchange] = row
  return {
    word,
    phonetic,
    groups: parseTranslation(translation),
    tags: tagLabels(tag),
    oxford: oxford === 1,
    collins,
    lemma: parseLemma(word, exchange)
  }
}

// ---------------------------------------------------------------- 选择义项

/** 义项的稳定编号：“组在原文中的序号:义项序号” */
export function senseKey(group: DictGroup, senseIndex: number): string {
  return `${group.index}:${senseIndex}`
}

/** 显示顺序下的全部义项（用于 1–9 编号和方向键移动）。 */
export function flatSenses(
  groups: DictGroup[]
): { key: string; group: DictGroup; sense: DictSense }[] {
  return groups.flatMap((group) =>
    group.senses.map((sense, i) => ({ key: senseKey(group, i), group, sense }))
  )
}

function groupLabel(group: DictGroup): string {
  return group.pos || (group.domain ? `[${group.domain}]` : '')
}

function senseText(sense: DictSense): string {
  return sense.domain ? `[${sense.domain}] ${sense.text}` : sense.text
}

export interface ComposedMeaning {
  /** 所选的全部词性，用“/”连接 */
  pos: string
  /** 带词性的完整文字，例如 “n. 能力；才能  adj. 有能力的” */
  meaning: string
}

/**
 * 所选义项 → 词义文字。同一组内用“；”连接，不同组之间用两个空格隔开，组的先后按词典原顺序。
 */
export function composeMeaning(
  groups: DictGroup[],
  selected: ReadonlySet<string>
): ComposedMeaning {
  const parts: string[] = []
  const pos: string[] = []
  for (const group of [...groups].sort((a, b) => a.index - b.index)) {
    const senses = group.senses.filter((_, i) => selected.has(senseKey(group, i)))
    if (senses.length === 0) continue
    const label = groupLabel(group)
    const text = senses.map(senseText).join('；')
    parts.push(label ? `${label} ${text}` : text)
    if (group.pos && !pos.includes(group.pos)) pos.push(group.pos)
  }
  return { pos: pos.join('/'), meaning: parts.join('  ') }
}

/** 批量录入用：第一组义项（优先非 [网络] 组）的全部义项。 */
export function firstGroupMeaning(entry: DictEntry): ComposedMeaning | null {
  const group = entry.groups[0]
  if (!group) return null
  return composeMeaning([group], new Set(group.senses.map((_, i) => senseKey(group, i))))
}
