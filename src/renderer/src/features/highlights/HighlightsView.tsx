/**
 * 高亮与笔记：按书分组、组内按时间倒序；点击任意一条跳回原文位置（跳过去后标出那段文字）。
 */
import { Highlighter } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { Highlight } from '@shared/api'
import { formatDate } from '@shared/domain/dates'
import { EmptyState, PageHead } from '../../components/ui'
import { cx } from '../../lib/cx'
import { useApp } from '../../store/app'
import { toastError } from '../../store/toast'
import { HIGHLIGHT_NAMES } from '../reader/labels'
import './highlights.css'

export function HighlightsView(): ReactElement {
  const books = useApp((s) => s.snapshot?.books ?? [])
  const openBook = useApp((s) => s.openBook)
  const [list, setList] = useState<Highlight[] | null>(null)

  useEffect(() => {
    let alive = true
    window.xword
      .listHighlights(null)
      .then((h) => alive && setList(h))
      .catch((e: unknown) => {
        toastError(e)
        if (alive) setList([])
      })
    return () => {
      alive = false
    }
  }, [])

  const groups = useMemo(() => {
    if (!list) return []
    const byBook = new Map<string, Highlight[]>()
    for (const h of list) {
      const g = byBook.get(h.bookId) ?? []
      g.push(h)
      byBook.set(h.bookId, g)
    }
    const titles = new Map(books.map((b) => [b.id, b]))
    // 最近有新高亮的书在前（组内已按时间倒序）
    return [...byBook.entries()]
      .filter(([id]) => titles.has(id))
      .map(([id, items]) => ({ book: titles.get(id)!, items }))
  }, [list, books])

  const total = list?.length ?? 0
  return (
    <div className="highlights">
      <PageHead
        eyebrow="阅读"
        title="高亮与笔记"
        meta={list ? `${groups.length} 本书 · ${total} 条` : undefined}
      />
      {list && groups.length === 0 ? (
        <EmptyState
          icon={Highlighter}
          text="还没有高亮。读书时选中一段文字，按 H 或点工具条上的颜色就能高亮。"
        />
      ) : (
        <div className="highlights-body">
          {groups.map(({ book, items }) => (
            <section key={book.id} className="hl-group" aria-label={book.title}>
              <h2 className="hl-group-title">
                {book.title}
                {book.author && <span className="hl-group-author">{book.author}</span>}
              </h2>
              <ul className="hl-list">
                {items.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className="hl-item"
                      onClick={() => openBook(h.bookId, h.start, h.end)}
                    >
                      <span className={cx('hl-bar', `hl-bar-${h.color}`)} aria-hidden />
                      <span className="hl-main">
                        <span className="hl-text">{h.text}</span>
                        {h.note && <span className="hl-note">{h.note}</span>}
                        <span className="hl-meta">
                          {HIGHLIGHT_NAMES[h.color]} · 第{' '}
                          <span className="num">{h.start.chapter + 1}</span> 章 ·{' '}
                          <span className="num">{formatDate(h.createdAt)}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
