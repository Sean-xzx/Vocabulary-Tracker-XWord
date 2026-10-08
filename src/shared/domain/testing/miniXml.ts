/**
 * 仅供单元测试：一个极简的 XML 解析器，产出满足 epub.ts 里 XNode 接口的节点树（Node 里没有 DOMParser）。
 * 支持元素、属性、文本、CDATA、注释、处理指令、DOCTYPE、自闭合标签，以及常见的命名实体和数字实体。
 * 格式错误（标签不配对、未知实体）时返回 null，与 DOMParser 的 parsererror 对应。
 */
import type { ParseDoc, XNode } from '../epub'

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}
/** HTML 模式额外认识的实体（XML 模式下遇到它们算格式错误，触发回退） */
const HTML_ENTITIES: Record<string, string> = { nbsp: ' ', mdash: '—', rsquo: '’' }

class MiniNode implements XNode {
  childNodes: MiniNode[] = []
  constructor(
    readonly nodeType: number,
    readonly localName: string | undefined,
    private readonly attrs: Map<string, string>,
    private readonly text: string
  ) {}

  get textContent(): string {
    return this.nodeType === 1 ? this.childNodes.map((c) => c.textContent).join('') : this.text
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
}

function decode(text: string, html: boolean): string | null {
  let ok = true
  const out = text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (_, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return String.fromCodePoint(code)
    }
    const v = ENTITIES[e] ?? (html ? HTML_ENTITIES[e] : undefined)
    if (v === undefined) ok = false
    return v ?? ''
  })
  return ok ? out : null
}

export function parseMiniXml(source: string, html = false): MiniNode | null {
  const root = new MiniNode(1, '#root', new Map(), '')
  const stack: MiniNode[] = [root]
  let i = 0
  const top = (): MiniNode => stack[stack.length - 1]
  while (i < source.length) {
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i)
      if (end < 0) return null
      i = end + 3
    } else if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i)
      if (end < 0) return null
      top().childNodes.push(new MiniNode(4, undefined, new Map(), source.slice(i + 9, end)))
      i = end + 3
    } else if (source.startsWith('<?', i) || source.startsWith('<!', i)) {
      const end = source.indexOf('>', i)
      if (end < 0) return null
      i = end + 1
    } else if (source.startsWith('</', i)) {
      const end = source.indexOf('>', i)
      if (end < 0) return null
      const name = source.slice(i + 2, end).trim()
      const node = stack.pop()
      if (!node || node === root || node.localName !== name.replace(/^.*:/, '')) {
        if (!html) return null
      }
      i = end + 1
    } else if (source[i] === '<') {
      const end = source.indexOf('>', i)
      if (end < 0) return null
      let body = source.slice(i + 1, end)
      const selfClosing = body.endsWith('/')
      if (selfClosing) body = body.slice(0, -1)
      const m = /^([^\s/>]+)([\s\S]*)$/.exec(body.trim())
      if (!m) return null
      const attrs = new Map<string, string>()
      for (const a of m[2].matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
        const value = decode(a[3] ?? a[4] ?? '', html)
        if (value === null) return null
        attrs.set(a[1], value)
      }
      const node = new MiniNode(1, m[1].replace(/^.*:/, ''), attrs, '')
      top().childNodes.push(node)
      const voidTag = html && /^(br|hr|img|meta|link|input)$/i.test(m[1])
      if (!selfClosing && !voidTag) stack.push(node)
      i = end + 1
    } else {
      const end = source.indexOf('<', i)
      const raw = source.slice(i, end < 0 ? source.length : end)
      const text = decode(raw, html)
      if (text === null) return null
      top().childNodes.push(new MiniNode(3, undefined, new Map(), text))
      i = end < 0 ? source.length : end
    }
  }
  if (stack.length !== 1 && !html) return null
  return root.childNodes.find((c) => c.nodeType === 1) ?? null
}

export const miniParse: ParseDoc = (text, kind) => parseMiniXml(text, kind === 'html')
