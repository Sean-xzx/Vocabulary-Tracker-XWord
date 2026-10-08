/**
 * 导入书（渲染进程这一侧）：主进程读文件、查大小 / 格式 / DRM / 重复；EPUB 的 XHTML 在这里用 DOMParser 解析——
 * DOMParser 生成的文档是惰性的：脚本不执行、图片等资源不加载；我们只读取结构，不把任何 HTML 插进页面。
 */
import { useEffect, useState } from 'react'
import type { BookSummary, ImportPrepared } from '@shared/api'
import { epubToBook, type ParseDoc, type XNode } from '@shared/domain/epub'
import { useApp } from '../../store/app'
import { toast, toastError } from '../../store/toast'

export const STANDARD_EBOOKS_URL = 'https://standardebooks.org/ebooks'
export const GUTENBERG_URL = 'https://www.gutenberg.org/'

/** XML 优先（EPUB 的正文是 XHTML）；解析出错（例如用了 &nbsp; 这类 HTML 实体）时回退到 HTML 解析 */
export const domParse: ParseDoc = (text, kind) => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, kind === 'xml' ? 'application/xml' : 'text/html')
  if (kind === 'xml' && doc.getElementsByTagName('parsererror').length > 0) return null
  return doc.documentElement as unknown as XNode
}

/** IPC 错误形如 “Error invoking remote method 'xxx': Error: 真正的消息” */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/** 失败时给出原因（格式、大小、DRM、扫描版 PDF、网络） */
export function reportImportError(error: unknown): void {
  toastError(new Error(errorMessage(error)))
}

/** 处理主进程的准备结果：EPUB 在这里解析后提交；PDF 在这里读出页数、书签并检查是不是扫描版 */
export async function finishImport(prep: ImportPrepared): Promise<BookSummary> {
  if (prep.status === 'pdf') {
    const { analyzePdf } = await import('../reader/pdfjs')
    const info = await analyzePdf(prep.bytes)
    return window.xword.importCommitPdf(prep.token, info)
  }
  if (prep.status !== 'parse') return prep.book
  const fallback = prep.fileName.replace(/\.[^.]+$/, '') || '未命名'
  const { book } = epubToBook(prep.files, domParse, fallback)
  return window.xword.importCommit(prep.token, book)
}

export async function importFromPath(path: string): Promise<BookSummary | null> {
  try {
    const prep = await window.xword.importPrepare(path)
    const book = await finishImport(prep)
    await useApp.getState().refresh()
    toast(prep.status === 'exists' ? `《${book.title}》已经在书架上` : `已导入《${book.title}》`, {
      label: '打开',
      run: () => useApp.getState().openBook(book.id)
    })
    return book
  } catch (error) {
    reportImportError(error)
    return null
  }
}

export async function pickAndImport(): Promise<void> {
  const path = await window.xword.importPick()
  if (path) await importFromPath(path)
}

/** 把文件拖进窗口的任何位置导入；返回是否正在拖入文件（显示提示） */
export function useFileDrop(): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    const onEnter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const onLeave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      void (async () => {
        for (const file of files) {
          const path = window.xword.pathForFile(file)
          if (path) await importFromPath(path)
        }
      })()
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
  return dragging
}
