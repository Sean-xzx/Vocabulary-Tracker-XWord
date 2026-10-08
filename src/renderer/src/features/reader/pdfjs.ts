/**
 * 渲染进程里的 pdf.js（legacy 版：带新 API 的兼容代码，Electron 39 的 Chromium 142 需要）：
 * - worker 脚本打包进应用（?raw），用 blob: 地址起一个模块 worker（CSP 的 worker-src 只放宽了 'self' 和 blob:）；
 * - cMap 和标准字体经 IPC 由主进程从本地读取（页面是 file://，pdf.js 自己取不到），离线可用；
 * - 不用 wasm（CSP 不允许 wasm-unsafe-eval）：极少数 JPEG 2000 / JBIG2 图片可能显示不出来，文字不受影响。
 */
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerCode from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw'
import type { PdfInfo } from '@shared/api'
import {
  SCANNED_MESSAGE,
  flattenOutline,
  isScannedPdf,
  pageText,
  type OutlineNode
} from '@shared/domain/pdf'

export type { PDFDocumentProxy }

function ensureWorker(): void {
  if (GlobalWorkerOptions.workerPort) return
  const url = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }))
  GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' })
}

/** pdf.js 要 cMap / 标准字体时经 IPC 从主进程读取 */
class IpcDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (kind === 'cMapUrl') return window.xword.pdfAsset('cmap', filename)
    if (kind === 'standardFontDataUrl') return window.xword.pdfAsset('font', filename)
    throw new Error(`不支持的 PDF 数据：${kind}`)
  }
}

export function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  ensureWorker()
  return getDocument({
    data,
    // 这两个地址只是占位（必须以 / 结尾），实际数据由 IpcDataFactory 提供
    cMapUrl: 'xword-pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'xword-pdfjs/standard_fonts/',
    BinaryDataFactory: IpcDataFactory as never,
    useWorkerFetch: false,
    useWasm: false,
    useSystemFonts: false,
    enableXfa: false
  }).promise
}

/** 书签 → 目录（书签指向的页从 0 开始） */
export async function readOutline(doc: PDFDocumentProxy): Promise<PdfInfo['toc']> {
  type Items = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>
  const conv = async (items: Items): Promise<OutlineNode[]> =>
    Promise.all(
      (items ?? []).map(async (it) => {
        let page: number | null = null
        try {
          const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest
          const ref = dest?.[0]
          if (typeof ref === 'number') page = ref
          else if (ref && typeof ref === 'object')
            page = await doc.getPageIndex(ref as { num: number; gen: number })
        } catch {
          page = null
        }
        return { title: it.title ?? '', page, items: await conv(it.items) }
      })
    )
  return flattenOutline(await conv(await doc.getOutline()))
}

/** 导入前的检查：页数、书名、作者、书签；前 10 页几乎没有文字的是扫描版，拒绝 */
export async function analyzePdf(data: Uint8Array): Promise<PdfInfo> {
  const doc = await openPdf(data)
  try {
    const texts: string[] = []
    for (let i = 1; i <= Math.min(10, doc.numPages); i++) {
      const page = await doc.getPage(i)
      texts.push(
        pageText((await page.getTextContent()).items as { str?: string; hasEOL?: boolean }[]).text
      )
      page.cleanup()
    }
    if (isScannedPdf(texts)) throw new Error(SCANNED_MESSAGE)
    const meta = await doc.getMetadata().catch(() => null)
    const info = (meta?.info ?? {}) as { Title?: unknown; Author?: unknown }
    return {
      title: typeof info.Title === 'string' ? info.Title.trim().slice(0, 300) : '',
      author: typeof info.Author === 'string' ? info.Author.trim().slice(0, 300) : '',
      pages: doc.numPages,
      toc: await readOutline(doc)
    }
  } finally {
    void doc.loadingTask.destroy()
  }
}
