/**
 * EPUB 导入：用代码生成两个夹具（EPUB 2 + NCX、EPUB 3 + nav），内容包含嵌套 span、脚注、软连字符、连字、弯引号，
 * 以及 Project Gutenberg 的前后说明；再加上 DRM、压缩炸弹、PDF、重复导入。
 * 正文解析用测试专用的极简 XML 解析器代替渲染进程里的 DOMParser（接口相同：只读结构）。
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { blockText, type ParsedBook } from '../../shared/domain/book'
import { epubToBook } from '../../shared/domain/epub'
import { miniParse } from '../../shared/domain/testing/miniXml'
import { SqlDb } from '../db/connection'
import { migrate } from '../db/migrations'
import { Repository } from '../db/repository'
import { DRM_MESSAGE, IMPORT_LIMITS, Importer, hasDrm, unzipEpubText } from './importer'
import { BookStore } from './store'

const TMP = join(process.cwd(), '.test-tmp', 'vitest-books')
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = { mimetype: strToU8('application/epub+zip') }
  for (const [k, v] of Object.entries(files)) entries[k] = typeof v === 'string' ? strToU8(v) : v
  return zipSync(entries)
}

/** EPUB 2：NCX 目录；嵌套 span、脚注、软连字符（&#xad; 与 &#xAD;）、连字 ﬁ ﬂ、弯引号；第二章用了 &nbsp;（XML 解析失败，回退 HTML） */
export function epub2Fixture(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Two Chapters</dc:title><dc:creator>Jane Doe</dc:creator><dc:creator>John Roe</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
  <navPoint id="n1" playOrder="1"><navLabel><text>Chapter I</text></navLabel><content src="text/ch1.xhtml#c1"/>
    <navPoint id="n2" playOrder="2"><navLabel><text>Footnotes</text></navLabel><content src="text/ch1.xhtml#fn1"/></navPoint>
  </navPoint>
  <navPoint id="n3" playOrder="3"><navLabel><text>Chapter II</text></navLabel><content src="text/ch%202.xhtml"/>
    <navPoint id="n4" playOrder="4"><navLabel><text>The End</text></navLabel><content src="text/ch%202.xhtml#end"/></navPoint>
  </navPoint>
</navMap></ncx>`
  const ch1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Ch1</title><style>p { color: red }</style></head>
<body>
  <h1 id="c1">Chapter I. The <i>Begin</i>ning</h1>
  <p>It was a <span class="a"><span class="b">bright</span> cold</span> day in April, and the clocks were
     strik&#xad;ing thir&#xAD;teen.</p>
  <p>The ﬁre was “ﬂickering” — she said,<a href="#fn1" epub:type="noteref"><sup>1</sup></a> <b>quite</b> softly.</p>
  <aside epub:type="footnote" id="fn1"><p>A footnote.</p></aside>
</body></html>`
  const ch2 = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch2</title><script>alert(1)</script></head>
<body><section>
  <h2>Chapter II</h2>
  <blockquote><p>To be,&nbsp;or not to be.</p></blockquote>
  <ul><li>First item</li><li>Second <em>item</em></li></ul>
  <hr/>
  <p class="poem">Line one<br/>Line two</p>
  <p id="end">The <strong>end</strong>.</p>
  <img src="x.png" alt="pic"/>
</section></body></html>`
  return zip({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf,
    'OEBPS/toc.ncx': ncx,
    'OEBPS/text/ch1.xhtml': ch1,
    'OEBPS/text/ch 2.xhtml': ch2,
    'OEBPS/style.css': 'p { color: red }'
  })
}

/** EPUB 3：nav 目录（前面还有一个 landmarks nav）；Project Gutenberg 的 pg-header / START / END / pg-footer；只有图片的封面页；字体混淆（不是 DRM） */
export function epub3Fixture(): Uint8Array {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:creator>Austen, Jane</dc:creator></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="t1" href="text.xhtml" media-type="application/xhtml+xml"/>
    <item id="t2" href="text2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="images/cover.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="cover"/><itemref idref="t1"/><itemref idref="t2"/></spine>
</package>`
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
  <nav epub:type="landmarks"><ol><li><a href="cover.xhtml">Cover</a></li></ol></nav>
  <nav epub:type="toc"><ol>
    <li><a href="text.xhtml#ch1">Chapter I</a></li>
    <li><a href="text2.xhtml#ch2">Chapter II</a><ol><li><a href="text2.xhtml#bye">Farewell</a></li></ol></li>
  </ol></nav>
</body></html>`
  const cover = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><img src="images/cover.png"/></body></html>`
  const text = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
  <section id="pg-header"><p>The Project Gutenberg eBook of Test Book</p><p>This ebook is for the use of anyone.</p></section>
  <p>*** START OF THE PROJECT GUTENBERG EBOOK TEST BOOK ***</p>
  <h2 id="ch1">CHAPTER I</h2>
  <p>Hello “world” — it’s a well-known story.</p>
</body></html>`
  const text2 = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
  <h2 id="ch2">CHAPTER II</h2>
  <p id="bye">Goodbye.</p>
  <p>*** END OF THE PROJECT GUTENBERG EBOOK TEST BOOK ***</p>
  <section id="pg-footer"><p>Full license text.</p></section>
</body></html>`
  const encryption = `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
  <enc:CipherData><enc:CipherReference URI="OEBPS/fonts/a.otf"/></enc:CipherData></enc:EncryptedData></encryption>`
  return zip({
    'META-INF/container.xml': CONTAINER,
    'META-INF/encryption.xml': encryption,
    'OEBPS/content.opf': opf,
    'OEBPS/nav.xhtml': nav,
    'OEBPS/cover.xhtml': cover,
    'OEBPS/text.xhtml': text,
    'OEBPS/text2.xhtml': text2,
    'OEBPS/images/cover.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  })
}

function simple(book: ParsedBook): unknown {
  return book.chapters.map((c) => ({
    title: c.title,
    blocks: c.blocks.map((b) =>
      b.c.length > 1 || b.c.some((r) => r.i || r.b) ? { k: b.k, c: b.c } : `${b.k}:${blockText(b)}`
    )
  }))
}

describe('EPUB 2 + NCX', () => {
  it('按 spine 顺序读取正文；只解压文本文件；清洗文本；目录锚点定位到块', () => {
    const files = unzipEpubText(epub2Fixture())
    expect(Object.keys(files).sort()).toEqual([
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/style.css',
      'OEBPS/text/ch 2.xhtml',
      'OEBPS/text/ch1.xhtml',
      'OEBPS/toc.ncx'
    ])
    expect(hasDrm(files)).toBe(false)
    const { book, stripped } = epubToBook(files, miniParse, 'fallback')
    expect(stripped).toBe(false)
    expect(book.title).toBe('Two Chapters')
    expect(book.author).toBe('Jane Doe, John Roe')
    expect(book.language).toBe('en')
    expect(simple(book)).toEqual([
      {
        title: 'Chapter I',
        blocks: [
          { k: 'h', c: [{ t: 'Chapter I. The ' }, { t: 'Begin', i: 1 }, { t: 'ning' }] },
          // 嵌套 span 合并成一段；源码里的换行变成空格；软连字符去掉
          'p:It was a bright cold day in April, and the clocks were striking thirteen.',
          // 连字展开；弯引号和破折号保持原样；脚注编号是上标，链接到书内的脚注（章节:块）
          {
            k: 'p',
            c: [
              { t: 'The fire was “flickering” — she said,' },
              { t: '1', sup: 1, a: '0:3' },
              { t: ' ' },
              { t: 'quite', b: 1 },
              { t: ' softly.' }
            ]
          },
          'p:A footnote.'
        ]
      },
      {
        title: 'Chapter II',
        blocks: [
          'h:Chapter II',
          // &nbsp; 让 XML 解析失败，回退 HTML 解析；不间断空格合并成普通空格
          'quote:To be, or not to be.',
          'li:First item',
          { k: 'li', c: [{ t: 'Second ' }, { t: 'item', i: 1 }] },
          'hr:',
          'p:Line one\nLine two',
          { k: 'p', c: [{ t: 'The ' }, { t: 'end', b: 1 }, { t: '.' }] },
          // 图片保留为单独的块（src 是压缩包里的路径，导入时由主进程取出）
          'img:'
        ]
      }
    ])
    expect(book.toc).toEqual([
      { title: 'Chapter I', chapter: 0, block: 0, depth: 0, group: 'body' },
      { title: 'Footnotes', chapter: 0, block: 3, depth: 1, group: 'body' },
      { title: 'Chapter II', chapter: 1, block: 0, depth: 0, group: 'body' },
      { title: 'The End', chapter: 1, block: 6, depth: 1, group: 'body' }
    ])
  })
})

describe('EPUB 3 + nav', () => {
  it('目录读 nav（跳过 landmarks）；去掉 Gutenberg 前后说明；封面页在 Gutenberg 说明之前，一并去掉；字体混淆不是 DRM', () => {
    const files = unzipEpubText(epub3Fixture())
    expect(Object.keys(files)).not.toContain('OEBPS/images/cover.png')
    expect(hasDrm(files)).toBe(false)
    const { book, stripped } = epubToBook(files, miniParse, 'fallback')
    expect(stripped).toBe(true)
    expect(book.title).toBe('Test Book')
    expect(simple(book)).toEqual([
      { title: 'Chapter I', blocks: ['h:CHAPTER I', 'p:Hello “world” — it’s a well-known story.'] },
      { title: 'Chapter II', blocks: ['h:CHAPTER II', 'p:Goodbye.'] }
    ])
    expect(book.toc).toEqual([
      { title: 'Chapter I', chapter: 0, block: 0, depth: 0, group: 'body' },
      { title: 'Chapter II', chapter: 1, block: 0, depth: 0, group: 'body' },
      { title: 'Farewell', chapter: 1, block: 1, depth: 1, group: 'body' }
    ])
  })
})

describe('不可信内容的防护', () => {
  it('加密了正文（不是字体混淆）或有 rights.xml：判定为 DRM', () => {
    const drm = `<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
      <CipherData><CipherReference URI="OEBPS/text.xhtml"/></CipherData></EncryptedData></encryption>`
    expect(hasDrm({ 'META-INF/encryption.xml': drm })).toBe(true)
    expect(hasDrm({ 'META-INF/rights.xml': '<rights/>' })).toBe(true)
  })

  it('压缩包条目太多、解压后太大：拒绝', () => {
    const many: Record<string, Uint8Array> = {}
    for (let i = 0; i <= IMPORT_LIMITS.entries; i++) many[`f${i}.txt`] = new Uint8Array(0)
    expect(() => unzipEpubText(zipSync(many))).toThrow('文件太多')
    // 压缩后很小、解压后号称超过 500MB 的“压缩炸弹”：按条目声明的大小在解压前就拒绝
    const bomb = zipSync({ 'a.xhtml': strToU8('<p>x</p>') })
    const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength)
    for (let i = 0; i < bomb.byteLength - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 0xfffffff0, true) // 中央目录
      if (view.getUint32(i, true) === 0x04034b50) view.setUint32(i + 22, 0xfffffff0, true) // 本地文件头
    }
    expect(() => unzipEpubText(bomb)).toThrow('500MB')
  })
})

describe('导入流程（主进程）', () => {
  async function setup(): Promise<{ importer: Importer; repo: Repository; store: BookStore }> {
    const db = await SqlDb.open(null)
    migrate(db)
    const repo = new Repository(db)
    const dir = join(TMP, String(Math.random()).slice(2))
    mkdirSync(dir, { recursive: true })
    const store = new BookStore(dir)
    return { importer: new Importer(repo, store, () => {}), repo, store }
  }

  it('EPUB：主进程解压并检查，渲染进程解析后提交；按文件哈希去重，删掉过的重复导入时恢复', async () => {
    const { importer, repo, store } = await setup()
    const bytes = epub3Fixture()
    const prep = importer.prepare(bytes, {
      fileName: 'test.epub',
      source: 'gutenberg',
      sourceId: '42'
    })
    expect(prep.status).toBe('parse')
    if (prep.status !== 'parse') return
    const { book } = epubToBook(prep.files, miniParse, 'test')
    const summary = importer.commit(prep.token, book)
    expect(summary).toMatchObject({
      title: 'Test Book',
      author: 'Austen, Jane',
      source: 'gutenberg',
      sourceId: '42'
    })
    const meta = store.readMeta(summary.id)
    expect(meta.sourceUrl).toBe('https://www.gutenberg.org/ebooks/42')
    expect(meta.licenseUrl).toBe('https://www.gutenberg.org/policy/license.html')
    expect(meta.chapters.map((c) => c.title)).toEqual(['Chapter I', 'Chapter II'])
    expect(store.readChapter(summary.id, 1).blocks).toHaveLength(2)
    expect(() => importer.commit(prep.token, book)).toThrow('过期')

    const again = importer.prepare(bytes, { fileName: 'copy.epub', source: 'import', sourceId: '' })
    expect(again).toMatchObject({ status: 'exists', book: { id: summary.id } })
    repo.deleteBook(summary.id)
    const restored = importer.prepare(bytes, {
      fileName: 'copy.epub',
      source: 'import',
      sourceId: ''
    })
    expect(restored).toMatchObject({ status: 'exists', book: { id: summary.id } })
    expect(repo.getBooks()).toHaveLength(1)
  })

  it('TXT 直接导入；PDF 交给渲染进程读出信息后提交（原文件存进书目录）；DRM 提示无法导入；超过 200MB 拒绝', async () => {
    const { importer, store } = await setup()
    const txt = strToU8('CHAPTER I\n\nIt was a dark night.\n\nCHAPTER II\n\nThe end.\n')
    const prep = importer.prepare(txt, { fileName: 'night.txt', source: 'import', sourceId: '' })
    expect(prep).toMatchObject({ status: 'imported', book: { title: 'night', format: 'txt' } })
    const pdf = importer.prepare(strToU8('%PDF-1.7 ...'), {
      fileName: 'a.pdf',
      source: 'import',
      sourceId: ''
    })
    expect(pdf.status).toBe('pdf')
    if (pdf.status !== 'pdf') return
    const book = importer.commitPdf(pdf.token, {
      title: '',
      author: 'A',
      pages: 3,
      toc: [{ title: 'One', chapter: 1, block: 0, depth: 0 }]
    })
    expect(book).toMatchObject({ title: 'a', format: 'pdf' })
    expect(store.readSource(book.id)?.format).toBe('pdf')
    expect(store.readMeta(book.id).chapters).toHaveLength(3)
    expect(() =>
      importer.prepare(strToU8('not a pdf'), { fileName: 'b.pdf', source: 'import', sourceId: '' })
    ).toThrow('PDF')
    const drm = zip({
      'META-INF/container.xml': CONTAINER,
      'META-INF/rights.xml': '<rights/>'
    })
    expect(() =>
      importer.prepare(drm, { fileName: 'drm.epub', source: 'import', sourceId: '' })
    ).toThrow(DRM_MESSAGE)
    const huge = { byteLength: IMPORT_LIMITS.fileBytes + 1 } as Uint8Array
    expect(() =>
      importer.prepare(huge, { fileName: 'big.txt', source: 'import', sourceId: '' })
    ).toThrow('200MB')
  })
})
