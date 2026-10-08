/**
 * 旧数据迁移：v0.3 导入的书（没有原文件、首字母被拆开、整本一章）在 v0.4 重新导入同一个文件时按新规则重新解析；
 * 阅读位置、高亮、出处按原文换算成新锚点，文字仍然是原来那段。以及迁移 8（books.format / parse_version）。
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { blockText, type Chapter, type ParsedBook } from '../../shared/domain/book'
import { epubToBook } from '../../shared/domain/epub'
import { miniParse } from '../../shared/domain/testing/miniXml'
import { SqlDb } from '../db/connection'
import { MIGRATIONS, migrate } from '../db/migrations'
import { Repository } from '../db/repository'
import { Importer, PARSE_VERSION } from './importer'
import { BookStore } from './store'

const TMP = join(process.cwd(), '.test-tmp', 'vitest-reparse')
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const XHTML = (body: string): string =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="s.css"/></head><body>${body}</body></html>`

function epub(): Uint8Array {
  const files: Record<string, string> = {
    'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    'OEBPS/content.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old Book</dc:title></metadata>
<manifest><item id="t" href="text.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
<spine toc="ncx"><itemref idref="t"/></spine></package>`,
    'OEBPS/toc.ncx': `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
<navPoint id="a"><navLabel><text>Foreword</text></navLabel><content src="text.xhtml#fw"/></navPoint>
<navPoint id="b"><navLabel><text>Chapter One</text></navLabel><content src="text.xhtml#c1"/></navPoint></navMap></ncx>`,
    'OEBPS/s.css': '.dc { float: left; font-size: 3em }',
    'OEBPS/text.xhtml': XHTML(`<p>Copyright 2009.</p>
<h2 id="fw"><span class="dc">F</span>
<span>OREWORD</span></h2>
<p>Twenty years ago when I wrote this book, I had no idea how the world would change.</p>
<h2 id="c1">Chapter One</h2>
<p>There is no real excellence in all this world which can be separated from right living.</p>`)
  }
  const entries: Record<string, Uint8Array> = { mimetype: strToU8('application/epub+zip') }
  for (const [k, v] of Object.entries(files)) entries[k] = strToU8(v)
  return zipSync(entries)
}

/** v0.3 当时存下的结构：整本一章，首字母被拆开 */
const OLD: ParsedBook = {
  title: 'Old Book',
  author: '',
  language: 'en',
  chapters: [
    {
      title: 'F OREWORD',
      blocks: [
        { k: 'p', c: [{ t: 'Copyright 2009.' }] },
        { k: 'h', c: [{ t: 'F OREWORD' }] },
        {
          k: 'p',
          c: [
            {
              t: 'Twenty years ago when I wrote this book, I had no idea how the world would change.'
            }
          ]
        },
        { k: 'h', c: [{ t: 'Chapter One' }] },
        {
          k: 'p',
          c: [
            {
              t: 'There is no real excellence in all this world which can be separated from right living.'
            }
          ]
        }
      ]
    }
  ],
  toc: [
    { title: 'F OREWORD', chapter: 0, block: 1, depth: 0 },
    { title: 'Chapter One', chapter: 0, block: 3, depth: 0 }
  ]
}

function at(
  chapters: Chapter[],
  p: { chapter: number; block: number; offset: number },
  n: number
): string {
  return blockText(chapters[p.chapter].blocks[p.block]).slice(p.offset, p.offset + n)
}

describe('v0.3 旧书重新解析', () => {
  it('重新导入同一个文件：按新规则解析、保存原文件，位置 / 高亮 / 出处按原文换算', async () => {
    const db = await SqlDb.open(null)
    migrate(db, undefined, { timeZone: 'Asia/Shanghai' })
    const repo = new Repository(db)
    const store = new BookStore(join(TMP, 'books'))
    const logs: string[] = []
    const importer = new Importer(repo, store, (m) => logs.push(m))
    const bytes = epub()
    const id = '11111111-2222-4333-8444-555555555555'
    store.write(id, OLD, { sourceUrl: '', licenseUrl: '', fileName: 'old.epub' })
    repo.addBook({
      id,
      title: 'Old Book',
      author: '',
      source: 'import',
      sourceId: '',
      fileHash: createHash('sha256').update(bytes).digest('hex'),
      format: 'epub',
      parseVersion: 1
    })
    // 旧锚点：位置在 “wrote this book”，高亮 “no real excellence”，出处 “world”
    const pos = { chapter: 0, block: 2, offset: 30 }
    repo.saveBookPosition(id, pos, 0.4)
    const hs = { chapter: 0, block: 4, offset: 9 }
    const he = { chapter: 0, block: 4, offset: 27 }
    const h = repo.addHighlight({
      bookId: id,
      start: hs,
      end: he,
      text: 'no real excellence',
      color: 'yellow'
    })
    const src = {
      chapter: 0,
      block: 2,
      offset: blockText(OLD.chapters[0].blocks[2]).indexOf('world')
    }
    repo.collectWord({
      word: { text: 'world', meaning: '' },
      source: { bookId: id, ...src, sentence: 'x' }
    })

    const prep = importer.prepare(bytes, { fileName: 'old.epub', source: 'import', sourceId: '' })
    expect(prep.status).toBe('parse')
    if (prep.status !== 'parse') return
    const { book } = epubToBook(prep.files, miniParse, 'x')
    const summary = importer.commit(prep.token, book)
    expect(summary.id).toBe(id)
    expect(summary.parseVersion).toBe(PARSE_VERSION)
    expect(store.hasSource(id)).toBe(true)

    const chapters = store.readAllChapters(id)
    expect(chapters.map((c) => c.title)).toEqual(['Old Book', 'Foreword', 'Chapter One'])
    expect(blockText(chapters[1].blocks[0])).toBe('FOREWORD')
    const oldChapters = OLD.chapters
    const book2 = repo.getBook(id)
    expect(at(chapters, book2.position, 16)).toBe(at(oldChapters, pos, 16))
    const h2 = repo.listHighlights(id).find((x) => x.id === h.id)!
    expect(
      blockText(chapters[h2.start.chapter].blocks[h2.start.block]).slice(
        h2.start.offset,
        h2.end.offset
      )
    ).toBe('no real excellence')
    const s2 = repo.getSnapshot().sources[0]
    expect(at(chapters, s2, 5)).toBe('world')
    // 位置 1 个 + 高亮起止 2 个 + 出处 1 个
    expect(logs.join(' ')).toMatch(/4 个锚点按原文转换，0 个找不到/)

    // 再导入同一个文件：已经是新版本，不再重新解析
    expect(
      importer.prepare(bytes, { fileName: 'old.epub', source: 'import', sourceId: '' }).status
    ).toBe('exists')
  })
})

describe('迁移 8：books.format 与 parse_version', () => {
  it('旧书按原文件名标出 TXT，解析版本记为 1，日志写明待转换的锚点数', async () => {
    const db = await SqlDb.open(null)
    // 先迁移到版本 7，放两本旧书
    for (const m of MIGRATIONS.filter((x) => x.version <= 7)) {
      db.transaction(() => {
        if (m.sql) db.exec(m.sql)
        if (m.run) m.run(db, { timeZone: 'Asia/Shanghai' })
        db.exec(`PRAGMA user_version = ${m.version}`)
      })
    }
    for (const [bid, name] of [
      ['a1111111-2222-4333-8444-555555555555', 'x.txt'],
      ['b1111111-2222-4333-8444-555555555555', 'y.epub']
    ])
      db.run(
        `INSERT INTO books (id, title, source, file_hash, added_at) VALUES (?, ?, 'import', ?, '2026-01-01T00:00:00+08:00')`,
        [bid, name, name]
      )
    const logs: string[] = []
    const names: Record<string, string> = {
      'a1111111-2222-4333-8444-555555555555': 'x.txt',
      'b1111111-2222-4333-8444-555555555555': 'y.epub'
    }
    migrate(db, (m) => logs.push(m), { timeZone: 'Asia/Shanghai', bookFileName: (id) => names[id] })
    expect(db.all('SELECT format, parse_version FROM books ORDER BY id')).toEqual([
      { format: 'txt', parse_version: 1 },
      { format: 'epub', parse_version: 1 }
    ])
    expect(logs.join('\n')).toMatch(/迁移到版本 8：2 本书（其中 TXT 1 本）待按原书结构重新解析/)
  })
})
