import { ChevronDown, ChevronLeft, ChevronRight, ListPlus } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactElement } from 'react'
import type { Page } from '@shared/api'
import { formatMonthDay, type DateStr } from '@shared/domain/dates'
import { PAGE_SIZE } from '@shared/domain/pages'
import { Button, IconButton, PageHead, Popover } from '../../components/ui'
import { cx } from '../../lib/cx'

function startedLabel(startedOn: DateStr, today: DateStr): string {
  return startedOn === today ? '今天开始' : `${formatMonthDay(startedOn)}开始`
}

function PageJump({
  pages,
  counts,
  current,
  onPick
}: {
  pages: Page[]
  counts: Map<string, number>
  current: number | null
  onPick: (n: number) => void
}): ReactElement {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)

  const onListKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(e.currentTarget.querySelectorAll('button'))
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
    e.preventDefault()
  }

  // 最新的页在最上面
  const ordered = [...pages].reverse()
  return (
    <>
      <Button
        ref={setAnchor}
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={pages.length === 0}
        onClick={() => setOpen((o) => !o)}
      >
        跳页
        <ChevronDown size={16} aria-hidden />
      </Button>
      <Popover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        placement="bottom-end"
        label="跳到某一页"
      >
        <div className="page-jump-list" onKeyDown={onListKey}>
          {ordered.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cx('page-jump-item', p.number === current && 'is-current')}
              aria-current={p.number === current ? 'page' : undefined}
              onClick={() => {
                setOpen(false)
                onPick(p.number)
              }}
            >
              <span>第 {p.number} 页</span>
              <span className="muted">
                {formatMonthDay(p.startedOn)} · {counts.get(p.id) ?? 0}/{PAGE_SIZE}
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  )
}

export function PageHeader({
  page,
  pages,
  counts,
  today,
  onGo,
  onBatch
}: {
  page: Page | null
  pages: Page[]
  counts: Map<string, number>
  today: DateStr
  onGo: (pageNumber: number) => void
  onBatch: () => void
}): ReactElement {
  const index = page ? pages.findIndex((p) => p.id === page.id) : -1
  const prev = index > 0 ? pages[index - 1] : null
  const next = index >= 0 && index < pages.length - 1 ? pages[index + 1] : null

  return (
    <PageHead
      eyebrow="单词页"
      title={page ? `第 ${page.number} 页` : '还没有单词页'}
      meta={
        page && (
          <>
            {startedLabel(page.startedOn, today)} · 已写 {counts.get(page.id) ?? 0} / {PAGE_SIZE}
          </>
        )
      }
      actions={
        <>
          <PageJump pages={pages} counts={counts} current={page?.number ?? null} onPick={onGo} />
          <div className="btn-group">
            <IconButton
              icon={ChevronLeft}
              label="上一页"
              shortcut="PageUp"
              disabled={!prev}
              onClick={() => prev && onGo(prev.number)}
            />
            <IconButton
              icon={ChevronRight}
              label="下一页"
              shortcut="PageDown"
              disabled={!next}
              onClick={() => next && onGo(next.number)}
            />
          </div>
          <Button variant="secondary" icon={ListPlus} onClick={onBatch}>
            批量录入
          </Button>
        </>
      }
    />
  )
}
