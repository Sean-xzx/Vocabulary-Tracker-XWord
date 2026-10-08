import { describe, expect, it } from 'vitest'
import { blockText } from './book'
import { decodeText, detectEncoding, isChapterHeading, txtToBook } from './txt'

describe('TXT 编码识别', () => {
  const text = 'Café “quoted” — done'
  it('UTF-8（有 / 没有 BOM）', () => {
    const bytes = new TextEncoder().encode(text)
    expect(decodeText(bytes)).toEqual({ text, encoding: 'utf-8' })
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]))).toEqual({
      text,
      encoding: 'utf-8'
    })
  })

  it('UTF-16 LE / BE（有 BOM，以及没有 BOM 时按 0 字节的分布判断）', () => {
    const le: number[] = []
    const be: number[] = []
    for (const ch of text) {
      const c = ch.charCodeAt(0)
      le.push(c & 0xff, c >> 8)
      be.push(c >> 8, c & 0xff)
    }
    expect(decodeText(new Uint8Array([0xff, 0xfe, ...le]))).toEqual({ text, encoding: 'utf-16le' })
    expect(decodeText(new Uint8Array([0xfe, 0xff, ...be]))).toEqual({ text, encoding: 'utf-16be' })
    expect(detectEncoding(new Uint8Array(le)).encoding).toBe('utf-16le')
    expect(detectEncoding(new Uint8Array(be)).encoding).toBe('utf-16be')
  })

  it('其他情况按 Windows-1252：0x93 / 0x94 是弯引号，0xE9 是 é', () => {
    const bytes = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x71, 0x94, 0x0d, 0x0a, 0x97])
    expect(decodeText(bytes)).toEqual({ text: 'Café “q”\n—', encoding: 'windows-1252' })
  })
})

describe('TXT 章节识别', () => {
  it('CHAPTER、Chapter、BOOK、PART、单独一行的罗马数字、PROLOGUE 等常见写法', () => {
    for (const h of [
      'CHAPTER I',
      'CHAPTER XII.',
      'Chapter 3',
      'Chapter Twenty-One',
      'CHAPTER I. THE BEGINNING',
      'BOOK ONE',
      'Book II: The Return',
      'PART III',
      'Part 2',
      'IV.',
      'I',
      'XLII',
      'PROLOGUE',
      'Epilogue'
    ])
      expect(isChapterHeading(h), h).toBe(true)
    for (const p of [
      'Did.',
      'I went home.',
      'The chapter was long.',
      'Chapter one of many things that happened\nnext line',
      ''
    ])
      expect(isChapterHeading(p), p).toBe(false)
  })

  it('按空行分段，硬换行合并；章节标题成为 h 块；标题前的内容单独一章', () => {
    const raw = [
      'A preface line.',
      '',
      'CHAPTER I.',
      '',
      'It was the best of times,',
      'it was the worst of times.',
      '',
      '',
      'Second para.',
      '',
      'II.',
      '',
      'Next chapter text.'
    ].join('\r\n')
    const { book } = txtToBook(raw, 'Two Cities')
    expect(book.title).toBe('Two Cities')
    expect(
      book.chapters.map((c) => [c.title, c.blocks.map((b) => `${b.k}:${blockText(b)}`)])
    ).toEqual([
      ['Two Cities', ['p:A preface line.']],
      [
        'CHAPTER I.',
        ['h:CHAPTER I.', 'p:It was the best of times, it was the worst of times.', 'p:Second para.']
      ],
      ['II.', ['h:II.', 'p:Next chapter text.']]
    ])
    expect(book.toc.map((e) => [e.title, e.chapter])).toEqual([
      ['Two Cities', 0],
      ['CHAPTER I.', 1],
      ['II.', 2]
    ])
  })

  it('识别不出章节、段落很多时按 200 段分成几部分', () => {
    const raw = Array.from({ length: 450 }, (_, i) => `Paragraph ${i + 1} text.`).join('\n\n')
    const { book } = txtToBook(raw, 'Long')
    expect(book.chapters.map((c) => [c.title, c.blocks.length])).toEqual([
      ['第 1 部分', 200],
      ['第 2 部分', 200],
      ['第 3 部分', 50]
    ])
  })
})

describe('Gutenberg 前后说明（TXT）', () => {
  it('只保留 START 与 END 之间的正文；从说明里读出书名和作者', () => {
    const raw = [
      'The Project Gutenberg eBook of The Yellow Wallpaper',
      '',
      'Title: The Yellow Wallpaper',
      '',
      'Author: Charlotte Perkins Gilman',
      '',
      '*** START OF THE PROJECT GUTENBERG EBOOK THE YELLOW WALLPAPER ***',
      '',
      'It is very seldom that mere ordinary people',
      'secure ancestral halls.',
      '',
      '*** END OF THE PROJECT GUTENBERG EBOOK THE YELLOW WALLPAPER ***',
      '',
      'Updated editions will replace the previous one.'
    ].join('\n')
    const { book, stripped } = txtToBook(raw, 'file')
    expect(stripped).toBe(true)
    expect(book.title).toBe('The Yellow Wallpaper')
    expect(book.author).toBe('Charlotte Perkins Gilman')
    expect(book.chapters.flatMap((c) => c.blocks.map(blockText))).toEqual([
      'It is very seldom that mere ordinary people secure ancestral halls.'
    ])
  })
})

describe('TXT 标题级别（v0.4）', () => {
  it('BOOK / PART / VOLUME 是一级标题，CHAPTER、罗马数字是二级；目录按级别缩进', () => {
    const text = [
      'Preface text.',
      'PART ONE',
      'CHAPTER I',
      'Body one.',
      'CHAPTER II',
      'Body two.',
      'PART TWO',
      'III.',
      'Body three.'
    ].join('\n\n')
    const { book } = txtToBook(text, 'T')
    expect(book.chapters.map((c) => [c.title, c.blocks[0].k, c.blocks[0].lv, c.role])).toEqual([
      ['T', 'p', undefined, 'front'],
      ['PART ONE', 'h', 1, 'body'],
      ['CHAPTER I', 'h', 2, 'body'],
      ['CHAPTER II', 'h', 2, 'body'],
      ['PART TWO', 'h', 1, 'body'],
      ['III.', 'h', 2, 'body']
    ])
    expect(book.toc.map((e) => [e.title, e.depth, e.group])).toEqual([
      ['T', 1, 'front'],
      ['PART ONE', 0, 'body'],
      ['CHAPTER I', 1, 'body'],
      ['CHAPTER II', 1, 'body'],
      ['PART TWO', 0, 'body'],
      ['III.', 1, 'body']
    ])
  })
})
