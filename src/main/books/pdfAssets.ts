/**
 * pdf.js 渲染 PDF 要用的本地数据：cMap（中日韩等字体的编码表）和 14 种标准字体。
 * 打包后在安装目录的 resources/pdfjs（electron-builder 的 extraResources），开发时直接读 node_modules/pdfjs-dist。
 * 渲染进程页面是 file://，pdf.js 自己去取这些文件会失败，所以经 IPC 由主进程读给它（离线可用）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { PdfAssetKind } from '../../shared/api'

const DIRS: Record<PdfAssetKind, string> = { cmap: 'cmaps', font: 'standard_fonts' }

export function pdfAssetRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'pdfjs')
    : join(app.getAppPath(), 'node_modules', 'pdfjs-dist')
}

export function readPdfAsset(kind: PdfAssetKind, name: string): Uint8Array {
  const file = join(pdfAssetRoot(), DIRS[kind], name)
  if (!existsSync(file)) throw new Error(`找不到 PDF 数据文件：${name}`)
  return readFileSync(file)
}
