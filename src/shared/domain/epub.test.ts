/**
 * v0.4 EPUB 结构解析：代码生成的夹具，包含 landmarks、多级嵌套 nav、装饰性首字母 span、小型大写、图片和说明、表格、
 * 嵌套列表、CSS 白名单；以及“F OREWORD”（首字母被拆开）和“目录挤成一团”两个问题的回归测试。
 */
import { describe, expect, it } from 'vitest'
import { blockText, type Block, type ParsedBook } from './book'
import { StyleSheet, parseCss } from './css'
import { convertBody, epubToBook } from './epub'
import { miniParse } from './testing/miniXml'

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const XHTML = (body: string, head = '<link rel="stylesheet" href="css/book.css"/>'): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head>${head}</head>${body}</html>`

const CSS = `
@import url(fonts.css);
body { font-family: "Fancy"; color: gray; }
p { text-indent: 1.2em; margin: 0; }
.dropcap { float: left; font-size: 3.2em; line-height: 1; }
.sc { font-variant: small-caps; }
.center { text-align: center; color: red; font-family: Other; }
.noindent { text-indent: 0; }
h2.sub { margin-top: 2em; page-break-before: always; }
.tocline { display: block; }
.hidden { display: none; }
@media amzn-kf8 { .epigraph { font-style: italic; } }
`

function fixture(): Record<string, string> {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Structure Book</dc:title><dc:language>en</dc:language></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
    <item id="contents" href="contents.xhtml" media-type="application/xhtml+xml"/>
    <item id="fw" href="foreword.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ap" href="appendix.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="css/book.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="cover"/><itemref idref="title"/><itemref idref="contents"/><itemref idref="fw"/><itemref idref="c1"/><itemref idref="ap"/></spine>
</package>`
  const nav = XHTML(`<body>
  <nav epub:type="landmarks" hidden=""><ol>
    <li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
    <li><a epub:type="titlepage" href="title.xhtml">Title Page</a></li>
    <li><a epub:type="toc" href="contents.xhtml">Contents</a></li>
    <li><a epub:type="bodymatter" href="ch1.xhtml">Start</a></li>
  </ol></nav>
  <nav epub:type="toc"><ol>
    <li><a href="foreword.xhtml"><span class="dropcap">F</span>
      <span class="sc">OREWORD</span></a></li>
    <li><span>Part One</span><ol>
      <li><a href="ch1.xhtml">Chapter One</a><ol>
        <li><a href="ch1.xhtml#s1">A Section</a><ol>
          <li><a href="ch1.xhtml#s11">A Subsection</a></li>
        </ol></li>
      </ol></li>
    </ol></li>
    <li><a href="appendix.xhtml">Appendix</a></li>
  </ol></nav></body>`)
  const cover = XHTML(
    `<body><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="images/cover.jpg"/></svg></body>`
  )
  const title = XHTML(
    `<body><h1 class="center">Structure Book</h1><p class="center">An Author</p></body>`
  )
  // 书自带的目录页：每一项是 display:block 的 <a>，源码里项与项之间没有空白（只靠 CSS 分行）
  const contents = XHTML(
    `<body><h2>Contents</h2><div><a class="tocline" href="foreword.xhtml">Foreword</a><a class="tocline" href="ch1.xhtml">Chapter One</a><a class="tocline" href="ch1.xhtml#s1">A Section</a><a class="tocline" href="appendix.xhtml">Appendix</a></div></body>`
  )
  const foreword = XHTML(`<body><section epub:type="foreword">
  <h1><span class="dropcap">F</span>
      <span class="sc">OREWORD</span></h1>
  <p class="noindent"><span class="dropcap">T</span>
      his book was written in a <span class="sc">hurry</span>.</p>
  <p class="epigraph">An epigraph.</p>
  <p class="hidden">Hidden text.</p>
</section></body>`)
  const ch1 = XHTML(`<body epub:type="bodymatter">
  <h1>Chapter One</h1>
  <p>First paragraph.</p>
  <h2 id="s1" class="sub">A Section</h2>
  <p class="center">Centered line.</p>
  <p style="font-style: italic; color: blue">Italic by inline style.</p>
  <h3 id="s11">A Subsection</h3>
  <figure><img src="images/fig1.png" alt="A figure"/><figcaption>Figure 1. A caption.</figcaption></figure>
  <table><tr><th>Name</th><th>Value</th></tr><tr><td>alpha</td><td>1</td></tr></table>
  <ol><li>One<ul><li>Nested a</li><li>Nested b</li></ul></li><li>Two</li></ol>
  <blockquote><p>A quote.</p></blockquote>
  <pre>code  line 1
  line 2</pre>
  <p>See <a href="appendix.xhtml#ax">the appendix</a> or <a href="https://example.com">a site</a>.</p>
</body>`)
  const appendix = XHTML(
    `<body><section epub:type="appendix"><h1 id="ax">Appendix</h1><p>Extra.</p></section></body>`
  )
  return {
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf,
    'OEBPS/nav.xhtml': nav,
    'OEBPS/cover.xhtml': cover,
    'OEBPS/title.xhtml': title,
    'OEBPS/contents.xhtml': contents,
    'OEBPS/foreword.xhtml': foreword,
    'OEBPS/ch1.xhtml': ch1,
    'OEBPS/appendix.xhtml': appendix,
    'OEBPS/css/book.css': CSS
  }
}

function parse(): ParsedBook {
  return epubToBook(fixture(), miniParse, 'fallback').book
}

const texts = (blocks: Block[]): string[] => blocks.map((b) => `${b.k}:${blockText(b)}`)

describe('EPUB 结构解析（v0.4）', () => {
  it('按 landmarks、epub:type 分出封面 / 书名页 / 目录页 / 前言 / 正文 / 附录；目录分成三组、保留多级层级', () => {
    const book = parse()
    expect(book.chapters.map((c) => c.role)).toEqual([
      'cover',
      'titlepage',
      'toc',
      'front',
      'body',
      'back'
    ])
    expect(book.toc.map((e) => [e.title, e.depth, e.group, e.chapter, e.block])).toEqual([
      ['FOREWORD', 0, 'front', 3, 0],
      ['Part One', 0, 'body', 4, 0],
      ['Chapter One', 1, 'body', 4, 0],
      ['A Section', 2, 'body', 4, 2],
      ['A Subsection', 3, 'body', 4, 5],
      ['Appendix', 0, 'back', 5, 0]
    ])
    expect(book.chapters[0].blocks).toEqual([{ k: 'img', c: [], src: 'OEBPS/images/cover.jpg' }])
  })

  it('装饰性首字母和后面的字母合并，不加空格（正文、标题、目录标签都一样）', () => {
    const fw = parse().chapters[3]
    expect(fw.title).toBe('FOREWORD')
    expect(blockText(fw.blocks[0])).toBe('FOREWORD')
    expect(fw.blocks[0]).toMatchObject({ k: 'h', lv: 1 })
    expect(blockText(fw.blocks[1])).toBe('This book was written in a hurry.')
    // 小型大写是行内格式
    expect(fw.blocks[1].c.find((r) => r.t === 'hurry')).toMatchObject({ sc: 1 })
    // display:none 的内容跳过
    expect(texts(fw.blocks)).not.toContain('p:Hidden text.')
  })

  it('标题按原级别；图片和说明、表格、嵌套列表、引文、预排版；书内链接变成“章节:块”，外链去掉', () => {
    const ch = parse().chapters[4]
    expect(ch.blocks.filter((b) => b.k === 'h').map((b) => [blockText(b), b.lv])).toEqual([
      ['Chapter One', 1],
      ['A Section', 2],
      ['A Subsection', 3]
    ])
    const img = ch.blocks.find((b) => b.k === 'img')
    expect(img).toMatchObject({ src: 'OEBPS/images/fig1.png', alt: 'A figure' })
    expect(texts(ch.blocks)).toContain('cap:Figure 1. A caption.')
    expect(
      ch.blocks.filter((b) => b.k === 'td').map((b) => [blockText(b), b.r, b.col, b.th ?? 0])
    ).toEqual([
      ['Name', 0, 0, 1],
      ['Value', 0, 1, 1],
      ['alpha', 1, 0, 0],
      ['1', 1, 1, 0]
    ])
    expect(ch.blocks.filter((b) => b.k === 'li').map((b) => [blockText(b), b.d, b.n])).toEqual([
      ['One', 1, 1],
      ['Nested a', 2, undefined],
      ['Nested b', 2, undefined],
      ['Two', 1, 2]
    ])
    expect(ch.blocks.find((b) => b.k === 'quote')).toMatchObject({ d: 1 })
    expect(blockText(ch.blocks.find((b) => b.k === 'pre')!)).toBe('code  line 1\n  line 2')
    const see = ch.blocks[ch.blocks.length - 1]
    expect(see.c.find((r) => r.t === 'the appendix')?.a).toBe('5:0')
    expect(see.c.find((r) => r.t.includes('a site'))?.a).toBeUndefined()
  })

  it('CSS 白名单：对齐、缩进、字形、外边距、分页映射成样式记号；字体、颜色忽略；只按标签写的基础排版不算', () => {
    const book = parse()
    const ch = book.chapters[4]
    const by = (t: string): Block => ch.blocks.find((b) => blockText(b) === t)!
    expect(by('Centered line.').s).toEqual(['center'])
    expect(by('Italic by inline style.').s).toEqual(['i'])
    expect(by('A Section').s).toEqual(['mt4', 'pb'])
    // p { text-indent; margin } 只是基础排版，由书页排版规范代替
    expect(by('First paragraph.').s).toBeUndefined()
    const fw = book.chapters[3]
    expect(fw.blocks[1].s).toEqual(['noindent'])
    // @media 里的规则照样读取
    expect(fw.blocks.find((b) => blockText(b) === 'An epigraph.')?.s).toEqual(['i'])
  })

  it('书自带的目录页按 nav 的层级重新排成嵌套列表，每一项链接到正文', () => {
    const toc = parse().chapters[2]
    expect(toc.blocks[0]).toMatchObject({ k: 'h' })
    expect(toc.blocks.slice(1).map((b) => [blockText(b), b.d, b.c[0].a])).toEqual([
      ['FOREWORD', 1, '3:0'],
      ['Part One', 1, '4:0'],
      ['Chapter One', 2, '4:0'],
      ['A Section', 3, '4:2'],
      ['A Subsection', 4, '4:5'],
      ['Appendix', 1, '5:0']
    ])
  })
})

describe('回归：F OREWORD 与目录挤成一团', () => {
  const sheet = new StyleSheet(parseCss(CSS))

  it('首字母元素和后面的字母之间的换行不再变成空格', () => {
    const doc = miniParse(
      XHTML(`<body><p><span class="dropcap">F</span>
      <span class="sc">OREWORD</span></p><h2><span class="first-letter">P</span> ART <big>O</big> NE</h2></body>`),
      'xml'
    )!
    const blocks = convertBody(doc, sheet, 'OEBPS/x.xhtml').blocks
    expect(blocks.map((b) => blockText(b))).toEqual(['FOREWORD', 'PART ONE'])
  })

  it('只靠 CSS 分行的目录项各成一段，不再挤成一段', () => {
    const doc = miniParse(
      XHTML(
        `<body><div><a class="tocline" href="a.xhtml">Foreword</a><a class="tocline" href="b.xhtml">Chapter One</a><span class="tocline">Chapter Two</span></div></body>`
      ),
      'xml'
    )!
    const blocks = convertBody(doc, sheet, 'OEBPS/x.xhtml').blocks
    expect(blocks.map((b) => blockText(b))).toEqual(['Foreword', 'Chapter One', 'Chapter Two'])
  })

  it('目录标签和正文标题只差空白时以正文为准', () => {
    const files = fixture()
    files['OEBPS/nav.xhtml'] = files['OEBPS/nav.xhtml'].replace(
      /<a href="foreword.xhtml">[\s\S]*?<\/a>/,
      '<a href="foreword.xhtml">F OREWORD</a>'
    )
    const book = epubToBook(files, miniParse, 'x').book
    expect(book.toc[0].title).toBe('FOREWORD')
    expect(book.chapters[3].title).toBe('FOREWORD')
  })
})
