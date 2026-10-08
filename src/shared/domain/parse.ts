/**
 * 录入解析：批量录入的逐行解析、词性拆分、查重用的规范化。
 */

const POS_TOKENS = [
  'n',
  'v',
  'vt',
  'vi',
  'adj',
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
const POS_ALT = POS_TOKENS.join('|')
/** 行内第一个词性标记（前面必须是空白，避免把单词里的点当成词性）。 */
const INLINE_POS_RE = new RegExp(`\\s(?:${POS_ALT})\\.`, 'i')
/** 词义开头的词性标记，例如 “vt. 放弃” 或 “n./v. 访问”。 */
const LEADING_POS_RE = new RegExp(`^((?:(?:${POS_ALT})\\.\\s*(?:[/&,]\\s*)?)+)\\s*`, 'i')

/** 中日韩文字、兼容表意文字、中文标点、全角字符的码点范围 */
const CJK_RANGES: [number, number][] = [
  [0x3400, 0x9fff],
  [0xf900, 0xfaff],
  [0x3000, 0x303f],
  [0xff00, 0xffef]
]
const CJK_RE = new RegExp(
  `[${CJK_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`
)

export interface ParsedEntry {
  text: string
  pos: string
  meaning: string
}

/** 把词义开头的词性标记拆出来。 */
export function splitPos(meaning: string): { pos: string; meaning: string } {
  const trimmed = meaning.trim()
  const match = LEADING_POS_RE.exec(trimmed)
  if (!match) return { pos: '', meaning: trimmed }
  return { pos: match[1].trim(), meaning: trimmed.slice(match[0].length).trim() }
}

/** 词性标记或领域标记（如 “[计]”）开头的一组，例如 “n. 能力；才能”。 */
const GROUP_LABEL_RE = new RegExp(
  `^((?:(?:${POS_ALT})\\.\\s*(?:[/&,]\\s*)?)+|[[【][^\\]】]{1,12}[\\]】])\\s*`,
  'i'
)
/** 组与组之间用两个及以上空格隔开（从词典选出的词义就是这种格式）。 */
const GROUP_SEP_RE = /\s{2,}/

export interface MeaningPart {
  /** 词性或领域标记，显示成次要色 */
  label: string
  text: string
}

/**
 * 显示用：词义本身以词性开头（从词典选出的“带词性全文”）时直接按组拆开，不再重复显示 pos 字段；
 * 否则是“pos + 词义”。
 */
export function meaningParts(pos: string, meaning: string): MeaningPart[] {
  const text = meaning.trim()
  if (!GROUP_LABEL_RE.test(text)) return pos || text ? [{ label: pos, text }] : []
  return text.split(GROUP_SEP_RE).map((group) => {
    const m = GROUP_LABEL_RE.exec(group)
    return m ? { label: m[1].trim(), text: group.slice(m[0].length) } : { label: '', text: group }
  })
}

/** 编辑框里显示的完整词义（含词性）。 */
export function meaningInputText(pos: string, meaning: string): string {
  const text = meaning.trim()
  if (GROUP_LABEL_RE.test(text) || !pos) return text
  return `${pos} ${text}`.trim()
}

/**
 * 手动输入的词义 → pos + meaning。多组的“带词性全文”（组间两个空格）保持原样，pos 取各组词性用“/”连接；
 * 其余沿用 splitPos：把开头的词性拆到 pos。
 */
export function splitMeaningInput(value: string): { pos: string; meaning: string } {
  const text = value.trim()
  const groups = text.split(GROUP_SEP_RE)
  if (groups.length > 1 && groups.every((g) => GROUP_LABEL_RE.test(g))) {
    const pos: string[] = []
    for (const g of groups) {
      const label = GROUP_LABEL_RE.exec(g)?.[1].trim() ?? ''
      if (label && !label.startsWith('[') && !label.startsWith('【') && !pos.includes(label))
        pos.push(label)
    }
    return { pos: pos.join('/'), meaning: text }
  }
  return splitPos(text)
}

export function parseLine(line: string): ParsedEntry | null {
  const raw = line.replace(/\s+$/, '')
  if (raw.trim() === '') return null

  let text: string
  let rest: string
  const tab = raw.indexOf('\t')
  if (tab >= 0) {
    text = raw.slice(0, tab)
    rest = raw.slice(tab + 1)
  } else {
    const cjk = raw.search(CJK_RE)
    const posMatch = INLINE_POS_RE.exec(raw)
    const posIndex = posMatch ? posMatch.index + 1 : -1
    const candidates = [cjk, posIndex].filter((i) => i > 0)
    if (candidates.length === 0) {
      text = raw
      rest = ''
    } else {
      const cut = Math.min(...candidates)
      text = raw.slice(0, cut)
      rest = raw.slice(cut)
    }
  }

  text = text.trim()
  if (text === '') return null
  const { pos, meaning } = splitPos(rest)
  return { text, pos, meaning }
}

export function parseBatch(input: string): ParsedEntry[] {
  return input
    .split(/\r?\n/)
    .map(parseLine)
    .filter((e): e is ParsedEntry => e !== null)
}

/** 查重用：去掉首尾空白、合并内部空白、不区分大小写。 */
export function normalizeWord(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}
