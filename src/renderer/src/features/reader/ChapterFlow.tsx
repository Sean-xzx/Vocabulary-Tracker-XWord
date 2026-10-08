/**
 * 一章的正文，排进 CSS 多栏（一栏 = 一页，见 reader.css 的 .rflow）。全部渲染成 React 元素和文本节点，不插入原书 HTML。
 * - 章首：标签（CHAPTER 3）+ 章名；章首页上方留出 1/3 空白；
 * - 标题按原书级别 h1–h6；段落首行缩进（标题、分隔后的第一段不缩进）；列表、引文按层级缩进；
 * - 图片不跨页；表格只做简单表格；书内链接只做书内跳转（data-link），外链一律不保留；
 * - 原书版式时，白名单里的样式记号映射成 s-* 类；统一版式时忽略。
 * 每个块是一个带 data-b（块下标）的元素，块内偏移 = 块里在这个位置之前的文字长度（与排版无关）。
 */
import { Fragment, memo, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import type { Block, Chapter } from '@shared/domain/book'
import { blockText } from '@shared/domain/book'
import { isChapterLabel, splitChapterLabel } from '@shared/domain/heading'
import { cx } from '../../lib/cx'
import { buildPieces, type BlockHighlight, type MarkKind } from './pieces'

const EMPTY: readonly BlockHighlight[] = []
const STYLE_TOKEN_RE = /^[a-z0-9]+$/

export interface FlowOptions {
  classify: ((word: string) => MarkKind | null) | null
  highlights: Map<number, BlockHighlight[]>
  /** 原书版式：使用块上的样式记号 */
  original: boolean
  /** 图片文件名 → 可显示的地址（还没读到时返回 undefined） */
  imageUrl: (src: string) => string | undefined
}

function styleClasses(block: Block, original: boolean): string | undefined {
  if (!original || !block.s) return undefined
  return block.s
    .filter((t) => STYLE_TOKEN_RE.test(t))
    .map((t) => `s-${t}`)
    .join(' ')
}

function Inlines({
  block,
  classify,
  highlights
}: {
  block: Block
  classify: FlowOptions['classify']
  highlights: readonly BlockHighlight[]
}): ReactNode {
  return buildPieces(block, classify, highlights).map((p, k) => {
    const r = p.run
    const cls = cx(
      p.mark && `w w-${p.mark}`,
      p.highlight && `hl hl-${p.highlight.color}`,
      p.highlight?.pending && 'is-pending',
      r.i && 'it',
      r.b && 'bd',
      r.sc && 'sc',
      r.a && 'rl'
    )
    let node: ReactNode = p.text
    if (cls || r.a)
      node = (
        <span className={cls} data-h={p.highlight?.id} data-link={r.a}>
          {p.text}
        </span>
      )
    if (r.sup) node = <sup>{node}</sup>
    else if (r.sub) node = <sub>{node}</sub>
    return <Fragment key={k}>{node}</Fragment>
  })
}

const BlockView = memo(function BlockView({
  block,
  index,
  opts,
  highlights
}: {
  block: Block
  index: number
  opts: FlowOptions
  highlights: readonly BlockHighlight[]
}): ReactElement {
  const s = styleClasses(block, opts.original)
  const body = <Inlines block={block} classify={opts.classify} highlights={highlights} />
  switch (block.k) {
    case 'hr':
      return <hr className={cx('rb rb-hr', s)} data-b={index} />
    case 'img': {
      if (!block.src) return <figure className="rb rb-img is-missing" data-b={index} />
      const url = opts.imageUrl(block.src)
      // 先按宽高比占位：图片加载前后排版不变，分页也不变
      const w = block.w ?? 400
      const h = block.h ?? 300
      const box = { '--img-w': `${w}px`, '--img-ratio': String(w / h) } as CSSProperties
      return (
        <figure className={cx('rb rb-img', s)} data-b={index}>
          <span className="rb-img-box" style={box}>
            {url ? <img src={url} alt={block.alt ?? ''} draggable={false} /> : null}
          </span>
        </figure>
      )
    }
    case 'h': {
      const lv = Math.max(1, Math.min(6, block.lv ?? 2))
      const Tag = `h${lv}` as 'h2'
      return (
        <Tag className={cx('rb rb-h', `rb-h${lv}`, s)} data-b={index}>
          {body}
        </Tag>
      )
    }
    case 'quote':
      return (
        <blockquote
          className={cx('rb rb-quote', s)}
          data-b={index}
          style={{ '--d': Math.max(1, block.d ?? 1) } as CSSProperties}
        >
          {body}
        </blockquote>
      )
    case 'li':
      return (
        <p
          className={cx(
            'rb rb-li',
            block.n !== undefined && 'is-ordered',
            block.cont && 'is-cont',
            s
          )}
          data-b={index}
          data-n={block.n !== undefined ? `${block.n}.` : undefined}
          style={{ '--d': Math.max(1, block.d ?? 1) } as CSSProperties}
        >
          {body}
        </p>
      )
    case 'pre':
      return (
        <pre className={cx('rb rb-pre', s)} data-b={index}>
          {body}
        </pre>
      )
    case 'cap':
      return (
        <p className={cx('rb rb-cap', s)} data-b={index}>
          {body}
        </p>
      )
    default:
      return (
        <p className={cx('rb rb-p', s)} data-b={index}>
          {body}
        </p>
      )
  }
})

/** 章首：返回章首元素和它占用的块数 */
function openerOf(chapter: Chapter): { node: ReactNode; used: number } {
  const [b0, b1] = chapter.blocks
  const role = chapter.role
  if (!b0 || b0.k !== 'h') {
    if (role === 'cover' || role === 'titlepage' || role === 'toc' || chapter.title.trim() === '')
      return { node: null, used: 0 }
    return {
      node: (
        <header className="ch-open">
          <h1 className="ch-name">{chapter.title}</h1>
        </header>
      ),
      used: 0
    }
  }
  const t0 = blockText(b0)
  if (isChapterLabel(t0) && b1?.k === 'h') {
    return {
      node: (
        <header className="ch-open">
          <p className="rb ch-label" data-b={0}>
            {t0}
          </p>
          <h1 className="rb ch-name" data-b={1}>
            {blockText(b1)}
          </h1>
        </header>
      ),
      used: 2
    }
  }
  const split = splitChapterLabel(t0)
  return {
    node: (
      <header className="ch-open">
        {split ? (
          <h1 className="rb ch-split" data-b={0}>
            <span className="ch-label">{split.label}</span>
            <span className="ch-sep">{split.sep}</span>
            <span className="ch-name">{split.name}</span>
          </h1>
        ) : (
          <h1 className="rb ch-name" data-b={0}>
            {t0}
          </h1>
        )}
      </header>
    ),
    used: 1
  }
}

/** 连续的表格单元格合成一张表 */
function tableOf(
  blocks: Block[],
  from: number,
  opts: FlowOptions
): { node: ReactElement; end: number } {
  const tb = blocks[from].tb
  let end = from
  const rows: { b: Block; i: number }[][] = []
  while (end < blocks.length && blocks[end].k === 'td' && blocks[end].tb === tb) {
    const r = blocks[end].r ?? 0
    ;(rows[r] ??= []).push({ b: blocks[end], i: end })
    end++
  }
  return {
    node: (
      <table key={`t${from}`} className="rb-table">
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r}>
              {cells.map(({ b, i }) => {
                const Cell = b.th ? 'th' : 'td'
                return (
                  <Cell key={i} className="rb rb-td" data-b={i}>
                    <Inlines
                      block={b}
                      classify={opts.classify}
                      highlights={opts.highlights.get(i) ?? EMPTY}
                    />
                  </Cell>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    ),
    end
  }
}

export function ChapterFlow({
  chapter,
  opts,
  lang,
  flowRef
}: {
  chapter: Chapter
  opts: FlowOptions
  lang: string
  flowRef?: (el: HTMLElement | null) => void
}): ReactElement {
  const blocks = chapter.blocks
  const opener = openerOf(chapter)
  const items: ReactNode[] = [<Fragment key="open">{opener.node}</Fragment>]
  for (let i = opener.used; i < blocks.length;) {
    if (blocks[i].k === 'td') {
      const t = tableOf(blocks, i, opts)
      items.push(t.node)
      i = t.end
      continue
    }
    items.push(
      <BlockView
        key={i}
        block={blocks[i]}
        index={i}
        opts={opts}
        highlights={opts.highlights.get(i) ?? EMPTY}
      />
    )
    i++
  }
  return (
    <article
      ref={flowRef}
      className={cx(
        'rflow',
        opts.original ? 'is-original' : 'is-unified',
        chapter.role && `role-${chapter.role}`
      )}
      lang={lang}
    >
      {items}
    </article>
  )
}
