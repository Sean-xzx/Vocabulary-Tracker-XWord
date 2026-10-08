/**
 * 原书 CSS 的白名单解析（只读，不执行任何东西）。只认简单选择器（标签、类、id，以及后代 / 子代组合），
 * 只取这些属性：text-align、text-indent、font-style、font-weight、small-caps、text-transform、上下外边距、分页；
 * 另外读 display（none 的内容跳过，block 的行内元素当块处理）、float 和 font-size（认出放大的首字母）。
 * 字体、颜色、背景等一律忽略。
 *
 * 映射成 XWord 的样式记号（reader.css 里的 s-*）：只有来自类 / id 选择器或内联 style 的声明才算“原书版式”，
 * 只按标签写的基础排版（p { text-indent; margin }）由 XWord 的书页排版规范代替。
 */

export interface CssRule {
  selector: Selector
  specificity: number
  order: number
  decls: Map<string, string>
}

/** 复合选择器链：从左到右，comb 是它和前一个之间的组合符 */
type Selector = { tag: string; classes: string[]; id: string; comb: ' ' | '>' }[]

export interface ElementInfo {
  tag: string
  classes: string[]
  id: string
  style: string
}

const MAX_CSS = 2_000_000

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

function parseSelector(text: string): Selector | null {
  const s = text.trim()
  // 伪类、伪元素、属性选择器、兄弟组合符：不支持，整条忽略
  if (s === '' || /[:[\]~+*]/.test(s)) return null
  const out: Selector = []
  let comb: ' ' | '>' = ' '
  for (const tok of s.replace(/\s*>\s*/g, ' > ').split(/\s+/)) {
    if (tok === '>') {
      comb = '>'
      continue
    }
    const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(tok)
    if (!m) return null
    const parts = m[2].match(/[.#][\w-]+/g) ?? []
    out.push({
      tag: (m[1] ?? '').toLowerCase(),
      classes: parts.filter((p) => p[0] === '.').map((p) => p.slice(1)),
      id: parts.find((p) => p[0] === '#')?.slice(1) ?? '',
      comb
    })
    comb = ' '
  }
  return out.length > 0 ? out : null
}

function specificityOf(sel: Selector): number {
  let ids = 0
  let classes = 0
  let tags = 0
  for (const c of sel) {
    if (c.id) ids++
    classes += c.classes.length
    if (c.tag) tags++
  }
  return ids * 10000 + classes * 100 + tags
}

export function parseDecls(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of text.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const prop = part.slice(0, i).trim().toLowerCase()
    const value = part
      .slice(i + 1)
      .replace(/!important/i, '')
      .trim()
      .toLowerCase()
    if (prop && value) out.set(prop, value)
  }
  // 简写：margin → 上下外边距；font → 只看 italic / bold / small-caps
  const margin = out.get('margin')
  if (margin) {
    const v = margin.split(/\s+/)
    if (!out.has('margin-top')) out.set('margin-top', v[0])
    if (!out.has('margin-bottom')) out.set('margin-bottom', v[2] ?? v[0])
  }
  const font = out.get('font')
  if (font) {
    if (/\bitalic\b/.test(font) && !out.has('font-style')) out.set('font-style', 'italic')
    if (/\b(bold|[6-9]00)\b/.test(font) && !out.has('font-weight')) out.set('font-weight', 'bold')
    if (/\bsmall-caps\b/.test(font) && !out.has('font-variant'))
      out.set('font-variant', 'small-caps')
  }
  return out
}

/** 解析样式表；@media 里的规则照常读取，@font-face / @page / @import 等忽略 */
export function parseCss(css: string, startOrder = 0): CssRule[] {
  const rules: CssRule[] = []
  let order = startOrder
  const src = stripComments(css.slice(0, MAX_CSS))
  const walk = (text: string): void => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) return
      // 前面可能有 @import …; 这类不带大括号的语句：只看最后一个分号之后
      const head = (text.slice(i, open).split(';').pop() ?? '').trim()
      // 找到配对的右括号
      let depth = 1
      let j = open + 1
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') depth--
        j++
      }
      const body = text.slice(open + 1, j - 1)
      const at = /^@([\w-]+)/.exec(head)
      if (at) {
        if (at[1] === 'media' || at[1] === 'supports') walk(body)
      } else {
        const decls = parseDecls(body)
        for (const s of head.split(',')) {
          const selector = parseSelector(s)
          if (selector)
            rules.push({ selector, specificity: specificityOf(selector), order: order++, decls })
        }
      }
      i = j
    }
  }
  walk(src)
  return rules
}

function matchesCompound(c: Selector[number], el: ElementInfo): boolean {
  if (c.tag && c.tag !== el.tag) return false
  if (c.id && c.id !== el.id) return false
  return c.classes.every((k) => el.classes.includes(k))
}

/** el 是当前元素，ancestors 从近到远 */
function matches(sel: Selector, el: ElementInfo, ancestors: readonly ElementInfo[]): boolean {
  let k = sel.length - 1
  if (!matchesCompound(sel[k], el)) return false
  let a = 0
  while (k > 0) {
    const comb = sel[k].comb
    k--
    if (comb === '>') {
      if (a >= ancestors.length || !matchesCompound(sel[k], ancestors[a])) return false
      a++
    } else {
      while (a < ancestors.length && !matchesCompound(sel[k], ancestors[a])) a++
      if (a >= ancestors.length) return false
      a++
    }
  }
  return true
}

export interface MatchedStyle {
  /** 属性 → 值 */
  value: Map<string, string>
  /** 属性 → 这个值是不是来自类 / id 选择器或内联 style（“原书版式”才用） */
  specific: Map<string, boolean>
}

export class StyleSheet {
  private readonly byKey = new Map<string, CssRule[]>()
  private readonly generic: CssRule[] = []

  constructor(readonly rules: CssRule[]) {
    // 按最右边的复合选择器建索引，匹配时只看可能命中的规则
    for (const r of rules) {
      const last = r.selector[r.selector.length - 1]
      const key = last.id ? `#${last.id}` : last.classes[0] ? `.${last.classes[0]}` : last.tag
      if (!key) this.generic.push(r)
      else this.byKey.set(key, [...(this.byKey.get(key) ?? []), r])
    }
  }

  static empty = new StyleSheet([])

  match(el: ElementInfo, ancestors: readonly ElementInfo[]): MatchedStyle {
    const cands = [
      ...this.generic,
      ...(this.byKey.get(el.tag) ?? []),
      ...(el.id ? (this.byKey.get(`#${el.id}`) ?? []) : []),
      ...el.classes.flatMap((c) => this.byKey.get(`.${c}`) ?? [])
    ]
    const hit = [...new Set(cands)]
      .filter((r) => matches(r.selector, el, ancestors))
      .sort((a, b) => a.specificity - b.specificity || a.order - b.order)
    const value = new Map<string, string>()
    const specific = new Map<string, boolean>()
    for (const r of hit) {
      for (const [p, v] of r.decls) {
        value.set(p, v)
        specific.set(p, r.specificity >= 100)
      }
    }
    if (el.style) {
      for (const [p, v] of parseDecls(el.style)) {
        value.set(p, v)
        specific.set(p, true)
      }
    }
    return { value, specific }
  }
}

/** 长度 → em（px 按 16px、pt 按 12pt 折算；百分比按字号） */
export function toEm(v: string): number | null {
  const m = /^(-?[\d.]+)(em|rem|px|pt|%|ex)?$/.exec(v.trim())
  if (!m) return v.trim() === '0' ? 0 : null
  const n = Number.parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  switch (m[2]) {
    case 'px':
      return n / 16
    case 'pt':
      return n / 12
    case '%':
      return n / 100
    case 'ex':
      return n / 2
    default:
      return n
  }
}

const HALF_EMS = (v: string): number | null => {
  const em = toEm(v)
  return em === null ? null : Math.max(0, Math.min(6, Math.round(em * 2)))
}

/** 块元素的样式记号（原书版式） */
export function blockTokens(style: MatchedStyle): string[] {
  const out: string[] = []
  const v = (p: string): string | undefined =>
    style.specific.get(p) ? style.value.get(p) : undefined
  const align = v('text-align')
  if (align === 'center' || align === 'right' || align === 'left') out.push(align)
  const indent = v('text-indent')
  if (indent !== undefined) {
    const em = toEm(indent)
    if (em !== null) out.push(em <= 0 ? 'noindent' : 'indent')
  }
  if (v('font-style') === 'italic' || v('font-style') === 'oblique') out.push('i')
  const weight = v('font-weight')
  if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) out.push('b')
  if (v('font-variant') === 'small-caps' || v('font-variant-caps') === 'small-caps') out.push('sc')
  const tt = v('text-transform')
  if (tt === 'uppercase') out.push('upper')
  else if (tt === 'lowercase') out.push('lower')
  else if (tt === 'capitalize') out.push('capitalize')
  const mt = v('margin-top')
  const mtv = mt !== undefined ? HALF_EMS(mt) : null
  if (mtv !== null) out.push(`mt${mtv}`)
  const mb = v('margin-bottom')
  const mbv = mb !== undefined ? HALF_EMS(mb) : null
  if (mbv !== null) out.push(`mb${mbv}`)
  // 分页：标签选择器写的也算（原书就是要从新的一页开始）
  const pb = style.value.get('page-break-before') ?? style.value.get('break-before')
  if (pb && /^(always|page|left|right|recto|verso)$/.test(pb)) out.push('pb')
  return out
}

/** 行内格式（任何选择器都算：这是内容的强调，不是排版） */
export function inlineFlags(style: MatchedStyle): { i?: 1; b?: 1; sc?: 1 } {
  const out: { i?: 1; b?: 1; sc?: 1 } = {}
  const fs = style.value.get('font-style')
  if (fs === 'italic' || fs === 'oblique') out.i = 1
  const w = style.value.get('font-weight')
  if (w === 'bold' || w === 'bolder' || Number(w) >= 600) out.b = 1
  if (
    style.value.get('font-variant') === 'small-caps' ||
    style.value.get('font-variant-caps') === 'small-caps'
  )
    out.sc = 1
  return out
}

/** 放大的首字母：左浮动，或字号明显大于正文 */
export function isEnlarged(style: MatchedStyle): boolean {
  if (style.value.get('float') === 'left') return true
  const size = style.value.get('font-size')
  if (!size) return false
  if (/^(large|x-large|xx-large|xxx-large|larger)$/.test(size)) return true
  const em = toEm(size)
  return em !== null && em >= 1.2
}
