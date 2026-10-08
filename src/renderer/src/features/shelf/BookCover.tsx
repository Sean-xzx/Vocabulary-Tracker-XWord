/**
 * 软件生成的封面（不使用原书封面，整个书架风格统一）：纸色底、衬线书名、作者名、底部一道荧光笔色块。
 */
import type { ReactElement } from 'react'
import { cx } from '../../lib/cx'
import './cover.css'

export function BookCover({
  title,
  author,
  size = 'md'
}: {
  title: string
  author: string
  size?: 'sm' | 'md'
}): ReactElement {
  return (
    <div className={cx('book-cover', `is-${size}`)} aria-hidden>
      <span className="book-cover-title">{title}</span>
      {author && <span className="book-cover-author">{author}</span>}
      <span className="book-cover-marker" />
    </div>
  )
}

/** 荧光笔样式的进度条（末端斜切），只用 scaleX */
export function MarkerProgress({ value, label }: { value: number; label: string }): ReactElement {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div
      className="marker-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <div className="marker-progress-fill" style={{ transform: `scaleX(${v})` }} />
    </div>
  )
}
