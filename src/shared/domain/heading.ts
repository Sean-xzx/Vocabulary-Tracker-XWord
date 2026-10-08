/**
 * 章首标题的“标签 + 章名”：CHAPTER 3 / BOOK II / PART ONE / 罗马数字 / 阿拉伯数字 这类是标签（小型大写、次要色），
 * 后面的文字是章名。TXT 分章也用这里的规则认出章节标题。
 */

const NUM =
  '(?:\\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|' +
  'fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:-\\w+)?|thirty(?:-\\w+)?|forty(?:-\\w+)?|' +
  'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|the\\s+\\w+)'
const WORD =
  '(?:chapter|book|part|volume|letter|section|canto|act|stave|scene|lecture|lesson|habit)'

/** 单独的罗马数字只认大写（避免把 did、mix 这类单词当成编号） */
const ROMAN = '[IVXLCDM]+'

const WORD_LABEL_RE = new RegExp(`^${WORD}\\s+${NUM}\\.?$`, 'i')
const BARE_LABEL_RE = new RegExp(`^(?:${ROMAN}|\\d+)\\.?$`)
const WORD_SPLIT_RE = new RegExp(`^(${WORD}\\s+${NUM})(\\s*[.:—–-]\\s*|\\s+)(\\S[\\s\\S]*)$`, 'i')
const BARE_SPLIT_RE = new RegExp(`^(${ROMAN}\\.|\\d+\\.)(\\s+)(\\S[\\s\\S]*)$`)
/** 大的分部（BOOK / PART / VOLUME）：TXT 里作为一级标题，CHAPTER 为二级 */
const MAJOR_RE = new RegExp(`^(?:book|part|volume)\\s+${NUM}\\b`, 'i')
const WORD_HEAD_RE = new RegExp(`^${WORD}\\s+${NUM}\\b`, 'i')
const BARE_HEAD_RE = new RegExp(`^${ROMAN}(?:\\.?$|\\.\\s)`)

/** 整段只是一个标签（CHAPTER III、IV.、12） */
export function isChapterLabel(text: string): boolean {
  const t = text.trim()
  return t.length <= 40 && (WORD_LABEL_RE.test(t) || BARE_LABEL_RE.test(t))
}

/** “CHAPTER 3. The Storm” → 标签、分隔、章名；不是这种形式返回 null。三段拼起来等于原文。 */
export function splitChapterLabel(
  text: string
): { label: string; sep: string; name: string } | null {
  const m = WORD_SPLIT_RE.exec(text) ?? BARE_SPLIT_RE.exec(text)
  if (!m || m[3].trim() === '') return null
  return { label: m[1], sep: m[2], name: m[3] }
}

/** TXT：像章节标题的一行；BOOK / PART / VOLUME 为 1 级，其余 2 级；不是返回 0 */
export function headingLevelOf(line: string): 0 | 1 | 2 {
  const t = line.trim()
  if (t === '' || t.length > 80) return 0
  if (MAJOR_RE.test(t)) return 1
  return WORD_HEAD_RE.test(t) || BARE_HEAD_RE.test(t) ? 2 : 0
}
