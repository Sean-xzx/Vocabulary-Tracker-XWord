/**
 * 仅供测试：用 pdf-lib 生成 PDF 夹具（单元测试和 e2e 共用）。
 * - textPdf：三页正文、多级书签、第一页有一个行尾连字符断开的单词（effec- / tive）；
 * - scannedPdf：十页，每页只有一张图片和页码（模拟扫描版）。
 */
import { deflateSync } from 'node:zlib'
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  StandardFonts,
  type PDFPage,
  type PDFRef
} from 'pdf-lib'

export const PDF_TITLE = 'The Test Manual'

export const PDF_LINES: string[][] = [
  [
    'Chapter One',
    '',
    'Highly organized people know that being effec-',
    'tive is a habit. They plan the week before it',
    'begins, and they keep a simple lighthouse list.',
    'A second paragraph talks about the harbour and',
    'the quiet morning when the work was finished.'
  ],
  [
    'Chapter Two',
    '',
    'The keeper wrote a letter from the city. It said',
    'that the tower had been sold to new owners.',
    'Nobody in the village remembered such a winter.'
  ],
  [
    'Chapter Three',
    '',
    'In the end she returned, and the harbour was',
    'exactly as she remembered it.'
  ]
]

function crc32(buf: Uint8Array): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/** 纯色 PNG */
export function makePng(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3)
  }
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    const td = new Uint8Array([...type].map((c) => c.charCodeAt(0)))
    out.set(td, 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, w)
  v.setUint32(4, h)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0))
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const png = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    png.set(p, o)
    o += p.length
  }
  return png
}

interface Mark {
  title: string
  page: PDFPage
  children?: Mark[]
}

/** 写书签（Outlines）：pdf-lib 没有现成的接口，直接写 PDF 对象 */
function addOutline(doc: PDFDocument, marks: Mark[]): void {
  const ctx = doc.context
  const rootRef = ctx.nextRef()
  const build = (list: Mark[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = list.map(() => ctx.nextRef())
    let count = list.length
    list.forEach((m, i) => {
      const dict = ctx.obj({
        Title: PDFHexString.fromText(m.title),
        Parent: parent,
        Dest: [m.page.ref, 'XYZ', null, null, null]
      })
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1])
      if (i < list.length - 1) dict.set(PDFName.of('Next'), refs[i + 1])
      if (m.children && m.children.length > 0) {
        const sub = build(m.children, refs[i])
        dict.set(PDFName.of('First'), sub.first)
        dict.set(PDFName.of('Last'), sub.last)
        dict.set(PDFName.of('Count'), ctx.obj(sub.count))
        count += sub.count
      }
      ctx.assign(refs[i], dict)
    })
    return { first: refs[0], last: refs[refs.length - 1], count }
  }
  const top = build(marks, rootRef)
  ctx.assign(
    rootRef,
    ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count })
  )
  doc.catalog.set(PDFName.of('Outlines'), rootRef)
}

export async function textPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(PDF_TITLE)
  doc.setAuthor('P. Tester')
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const pages = PDF_LINES.map((lines, pi) => {
    const page = doc.addPage([420, 595])
    let y = 520
    lines.forEach((line, i) => {
      if (line === '') {
        y -= 12
        return
      }
      page.drawText(line, { x: 48, y, size: i === 0 ? 20 : 12, font: i === 0 ? bold : font })
      y -= i === 0 ? 30 : 18
    })
    page.drawText(String(pi + 1), { x: 206, y: 40, size: 10, font })
    return page
  })
  addOutline(doc, [
    {
      title: 'Chapter One',
      page: pages[0],
      children: [{ title: 'Being Effective', page: pages[0] }]
    },
    { title: 'Chapter Two', page: pages[1] },
    { title: 'Chapter Three', page: pages[2] }
  ])
  return doc.save()
}

export async function scannedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const png = await doc.embedPng(makePng(60, 80, [236, 232, 220]))
  for (let i = 0; i < 10; i++) {
    const page = doc.addPage([420, 595])
    page.drawImage(png, { x: 30, y: 60, width: 360, height: 480 })
    page.drawText(String(i + 1), { x: 206, y: 30, size: 10, font })
  }
  return doc.save()
}
