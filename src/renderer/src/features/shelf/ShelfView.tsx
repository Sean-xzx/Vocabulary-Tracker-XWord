/**
 * 书架：「我的书」和「发现」两个标签页。
 * - 我的书：软件生成的封面网格 + 阅读进度；右上角“导入”；把文件拖进窗口任何位置也能导入（见 importBook.ts）。
 * - 发现：Gutendex 搜索 Project Gutenberg 的英文书（默认最热门的 32 本），下载后出现在「我的书」；
 *   底部两个外链用系统浏览器打开（不抓取任何网页）。
 */
import { Download, ExternalLink, LibraryBig, Search, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { BookSummary, DownloadProgress, GutendexBook } from '@shared/api'
import { Button, EmptyState, IconButton, PageHead, SegmentedControl } from '../../components/ui'
import { readLocal, writeLocal } from '../../lib/storage'
import { useApp } from '../../store/app'
import { toast, toastError } from '../../store/toast'
import { BookCover, MarkerProgress } from './BookCover'
import {
  GUTENBERG_URL,
  STANDARD_EBOOKS_URL,
  errorMessage,
  finishImport,
  pickAndImport,
  reportImportError
} from './importBook'
import './shelf.css'

type Tab = 'mine' | 'discover'
const TAB_KEY = 'xword.shelfTab'

/** 12345 → 12,345 */
function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function MyBooks({ onDiscover }: { onDiscover: () => void }): ReactElement {
  const books = useApp((s) => s.snapshot?.books ?? [])
  const openBook = useApp((s) => s.openBook)

  const remove = async (book: BookSummary): Promise<void> => {
    try {
      await window.xword.bookDelete(book.id)
      await useApp.getState().refresh()
      toast(`已从书架移除《${book.title}》`, {
        label: '撤销',
        run: async () => {
          try {
            await window.xword.bookRestore(book.id)
            await useApp.getState().refresh()
          } catch (error) {
            toastError(error)
          }
        }
      })
    } catch (error) {
      toastError(error)
    }
  }

  if (books.length === 0) {
    return (
      <EmptyState
        icon={LibraryBig}
        text="书架上还没有书。把 EPUB、TXT 或 PDF 拖进窗口，或者去「发现」下载一本。"
      >
        <Button icon={Upload} onClick={() => void pickAndImport()}>
          导入
        </Button>
        <Button variant="primary" icon={Search} onClick={onDiscover}>
          去发现
        </Button>
      </EmptyState>
    )
  }

  return (
    <ul className="shelf-grid" aria-label="我的书">
      {books.map((b) => (
        <li key={b.id} className="shelf-book">
          <button
            type="button"
            className="shelf-book-open"
            aria-label={`打开《${b.title}》`}
            onClick={() => openBook(b.id)}
          >
            <BookCover title={b.title} author={b.author} />
          </button>
          <div className="shelf-book-meta">
            <MarkerProgress value={b.progress} label={`《${b.title}》阅读进度`} />
            <span className="shelf-book-percent num">{Math.round(b.progress * 100)}%</span>
            <IconButton
              icon={Trash2}
              label="从书架移除"
              size="sm"
              iconSize={16}
              className="shelf-book-remove"
              onClick={() => void remove(b)}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

type RowState =
  | { kind: 'idle' }
  | { kind: 'downloading'; received: number; total: number }
  | { kind: 'done'; bookId: string }

function Discover(): ReactElement {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GutendexBook[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Record<number, RowState>>({})
  const openBook = useApp((s) => s.openBook)
  const request = useRef(0)

  /** 搜索（空字符串 = 最热门的书）；只保留最后一次请求的结果 */
  const fetchPage = useCallback((q: string) => {
    const id = ++request.current
    window.xword.gutendexSearch(q).then(
      (page) => {
        if (id !== request.current) return
        setResults(page.books)
        setLoading(false)
      },
      (e: unknown) => {
        if (id !== request.current) return
        setError(errorMessage(e))
        setLoading(false)
      }
    )
  }, [])

  const search = (q: string): void => {
    setLoading(true)
    setError(null)
    fetchPage(q)
  }

  // 打开“发现”时先列出最热门的前 32 本
  useEffect(() => fetchPage(''), [fetchPage])

  useEffect(
    () =>
      window.xword.on('download', (p: DownloadProgress) =>
        setRows((r) =>
          r[p.gutenbergId]?.kind === 'downloading'
            ? {
                ...r,
                [p.gutenbergId]: { kind: 'downloading', received: p.received, total: p.total }
              }
            : r
        )
      ),
    []
  )

  const download = async (book: GutendexBook): Promise<void> => {
    setRows((r) => ({ ...r, [book.id]: { kind: 'downloading', received: 0, total: 0 } }))
    try {
      const prep = await window.xword.gutendexDownload(book.id)
      const summary = await finishImport(prep)
      await useApp.getState().refresh()
      setRows((r) => ({ ...r, [book.id]: { kind: 'done', bookId: summary.id } }))
      toast(
        prep.status === 'exists' ? `《${summary.title}》已经在书架上` : `已下载《${summary.title}》`
      )
    } catch (e) {
      setRows((r) => ({ ...r, [book.id]: { kind: 'idle' } }))
      reportImportError(e)
    }
  }

  return (
    <div className="discover">
      <form
        className="search-field discover-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          void search(query)
        }}
      >
        <Search size={16} aria-hidden />
        <input
          aria-label="搜索 Project Gutenberg"
          placeholder="搜索书名或作者（英文），按 Enter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      <p className="discover-note">
        {loading && results
          ? '正在搜索…（Gutendex 的搜索有时要半分钟）'
          : query.trim() && results
            ? `“${query.trim()}”的搜索结果`
            : 'Project Gutenberg 最热门的英文书'}
      </p>

      {error ? (
        <div className="discover-error" role="alert">
          <span>{error}</span>
          <Button size="sm" onClick={() => void search(query)}>
            重试
          </Button>
        </div>
      ) : loading && !results ? (
        <p className="discover-loading">正在连接 Gutendex…</p>
      ) : results && results.length === 0 ? (
        <p className="discover-loading">没有找到这本书，换个关键词试试</p>
      ) : (
        <ul className="discover-list" aria-busy={loading}>
          {(results ?? []).map((b) => {
            const row = rows[b.id] ?? { kind: 'idle' }
            return (
              <li key={b.id} className="discover-row">
                <div className="discover-main">
                  <span className="discover-title">{b.title}</span>
                  <span className="discover-author">{b.authors.join(', ') || '佚名'}</span>
                </div>
                <span className="discover-count">
                  <span className="num">{formatCount(b.downloadCount)}</span> 次下载
                </span>
                <div className="discover-action">
                  {row.kind === 'downloading' ? (
                    <div className="discover-progress">
                      <MarkerProgress
                        value={row.total > 0 ? row.received / row.total : 0.15}
                        label={`下载《${b.title}》`}
                      />
                      <span className="num">
                        {row.total > 0
                          ? `${Math.round((row.received / row.total) * 100)}%`
                          : `${Math.round(row.received / 1024)} KB`}
                      </span>
                    </div>
                  ) : row.kind === 'done' ? (
                    <Button size="sm" onClick={() => openBook(row.bookId)}>
                      打开
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      icon={Download}
                      disabled={b.format === null}
                      onClick={() => void download(b)}
                    >
                      {b.format === null ? '无法下载' : '下载'}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <footer className="discover-foot">
        <div className="discover-links">
          <Button
            variant="ghost"
            size="sm"
            icon={ExternalLink}
            onClick={() => void window.xword.openExternal(STANDARD_EBOOKS_URL).catch(toastError)}
          >
            去 Standard Ebooks 挑精排版
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={ExternalLink}
            onClick={() => void window.xword.openExternal(GUTENBERG_URL).catch(toastError)}
          >
            去 Project Gutenberg 官网
          </Button>
        </div>
        <p className="discover-hint">下载 EPUB 后拖进来即可导入</p>
      </footer>
    </div>
  )
}

export function ShelfView(): ReactElement {
  const [tab, setTab] = useState<Tab>(() =>
    readLocal(TAB_KEY) === 'discover' ? 'discover' : 'mine'
  )
  const count = useApp((s) => s.snapshot?.books.length ?? 0)
  const pick = (t: Tab): void => {
    setTab(t)
    writeLocal(TAB_KEY, t)
  }
  return (
    <div className="shelf">
      <PageHead
        eyebrow="阅读"
        title="书架"
        meta={
          <SegmentedControl<Tab>
            label="书架"
            value={tab}
            onChange={pick}
            options={[
              { value: 'mine', label: `我的书 ${count}` },
              { value: 'discover', label: '发现' }
            ]}
          />
        }
        actions={
          <Button icon={Upload} onClick={() => void pickAndImport()}>
            导入
          </Button>
        }
      />
      <div className="shelf-body">
        {tab === 'mine' ? <MyBooks onDiscover={() => pick('discover')} /> : <Discover />}
      </div>
    </div>
  )
}
