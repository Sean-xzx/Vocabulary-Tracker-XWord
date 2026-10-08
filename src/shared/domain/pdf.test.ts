/**
 * PDF：pdf-lib 生成的夹具（多页、书签、行尾连字符，以及扫描版），用 pdf.js（legacy 版，Node 可用）提取文字。
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { flattenOutline, isScannedPdf, locateInPage, pageText, type OutlineNode } from './pdf'
import { PDF_TITLE, scannedPdf, textPdf } from './testing/pdfFixtures'
import { sentenceOf, wordAt } from './words'

async function open(bytes: Uint8Array): Promise<pdfjs.PDFDocumentProxy> {
  return pdfjs.getDocument({
    data: bytes,
    useSystemFonts: false,
    standardFontDataUrl: `${join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g, '/')}/`
  }).promise
}

async function texts(doc: pdfjs.PDFDocumentProxy): Promise<{ text: string; starts: number[] }[]> {
  const out: { text: string; starts: number[] }[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    out.push(pageText((await page.getTextContent()).items as { str?: string; hasEOL?: boolean }[]))
  }
  return out
}

async function outline(doc: pdfjs.PDFDocumentProxy): Promise<OutlineNode[]> {
  const conv = async (
    items: Awaited<ReturnType<pdfjs.PDFDocumentProxy['getOutline']>>
  ): Promise<OutlineNode[]> =>
    Promise.all(
      (items ?? []).map(async (it) => {
        const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest
        const ref = dest?.[0]
        const page =
          ref && typeof ref === 'object'
            ? await doc.getPageIndex(ref as { num: number; gen: number })
            : null
        return { title: it.title, page, items: await conv(it.items) }
      })
    )
  return conv(await doc.getOutline())
}

describe('PDF 文字层', () => {
  it('多页文字提取、书签展开成目录、元数据', async () => {
    const doc = await open(await textPdf())
    expect(doc.numPages).toBe(3)
    const meta = await doc.getMetadata()
    expect((meta.info as { Title?: string }).Title).toBe(PDF_TITLE)
    const pages = await texts(doc)
    expect(pages[1].text).toContain('The keeper wrote a letter from the city.')
    expect(isScannedPdf(pages.map((p) => p.text))).toBe(false)
    expect(flattenOutline(await outline(doc))).toEqual([
      { title: 'Chapter One', chapter: 0, block: 0, depth: 0, group: 'body' },
      { title: 'Being Effective', chapter: 0, block: 0, depth: 1, group: 'body' },
      { title: 'Chapter Two', chapter: 1, block: 0, depth: 0, group: 'body' },
      { title: 'Chapter Three', chapter: 2, block: 0, depth: 0, group: 'body' }
    ])
  })

  it('行尾连字符断开的单词：点前半或后半都得到完整的词；跨行的句子按阅读顺序拼好', async () => {
    const [p1] = await texts(await open(await textPdf()))
    const i = p1.text.indexOf('effec-')
    expect(p1.text.slice(i, i + 12)).toMatch(/^effec-\n/)
    expect(wordAt(p1.text, i + 2)?.word).toBe('effective')
    expect(wordAt(p1.text, p1.text.indexOf('tive is') + 1)?.word).toBe('effective')
    expect(sentenceOf(p1.text, i + 2, true)).toMatch(/being effective is a habit\.$/)
    expect(sentenceOf(p1.text, p1.text.indexOf('plan the week'), true)).toBe(
      'They plan the week before it begins, and they keep a simple lighthouse list.'
    )
    // 偏移 → 文字项 → 偏移（落在换行上时算上一项的末尾）
    const lengths = p1.starts.map((s, k) => (p1.starts[k + 1] ?? p1.text.length) - s)
    const loc = locateInPage(p1.starts, lengths, i + 2)
    expect(p1.starts[loc.item] + loc.offset).toBe(i + 2)
  })

  it('扫描版：前 10 页几乎没有文字', async () => {
    const doc = await open(await scannedPdf())
    const pages = await texts(doc)
    expect(pages).toHaveLength(10)
    expect(isScannedPdf(pages.map((p) => p.text))).toBe(true)
    expect(isScannedPdf(['x', 'y', 'A real page with plenty of words on it, clearly text.'])).toBe(
      false
    )
  })
})
