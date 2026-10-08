/**
 * 目录抽屉：从左侧滑出（只动 transform），宽 320px，overlay 表面。
 * 按“前言部分 / 正文 / 附录”分组（组名 12px、--faint）；每深一级缩进 16px；一级 14.5px / 600，二级 14px，三级及以下 13px、--soft；
 * 页码右对齐（衬线、等宽数字、--faint）；当前章节用 --tint-select 底色。Esc、点遮罩、再按目录按钮关闭。
 * PDF 没有书签时只显示“跳到第几页”。
 */
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import type { TocEntry } from '@shared/domain/book'
import { IconButton } from '../../components/ui'
import { cx } from '../../lib/cx'
import { TOC_GROUP_NAMES, groupToc } from './toc'

export function TocDrawer({
  open,
  toc,
  pages,
  current,
  onPick,
  onClose,
  empty
}: {
  open: boolean
  toc: TocEntry[]
  /** 每个目录项的全书页码（未知为 null） */
  pages: readonly (number | null)[]
  current: number
  onPick: (entry: TocEntry) => void
  onClose: () => void
  /** 没有目录时显示的内容 */
  empty?: ReactNode
}): ReactElement {
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const el =
      list.current?.querySelector<HTMLElement>('.toc-item.is-current') ??
      list.current?.querySelector<HTMLElement>('.toc-item')
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'center' })
  }, [open])

  const groups = groupToc(toc)
  const showGroups = groups.some((g) => g.group !== 'body')

  return (
    <>
      <div className={cx('toc-scrim', open && 'is-open')} aria-hidden onClick={onClose} />
      <aside
        className={cx('toc-drawer', open && 'is-open')}
        aria-label="目录"
        aria-hidden={!open}
        inert={!open}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <header className="toc-head">
          <span className="toc-title">目录</span>
          <IconButton
            icon={X}
            label="关闭目录"
            shortcut="Esc"
            size="sm"
            iconSize={16}
            onClick={onClose}
          />
        </header>
        <div ref={list} className="toc-list">
          {toc.length === 0 && empty}
          {groups.map((g, gi) => (
            <section key={gi} className="toc-group" aria-label={TOC_GROUP_NAMES[g.group]}>
              {showGroups && <h3 className="toc-group-title">{TOC_GROUP_NAMES[g.group]}</h3>}
              <ul role="list">
                {g.items.map(({ entry, index }) => {
                  const level = Math.min(3, entry.depth + 1)
                  const page = pages[index]
                  return (
                    <li key={index}>
                      <button
                        type="button"
                        className={cx(
                          'toc-item',
                          `toc-l${level}`,
                          index === current && 'is-current'
                        )}
                        style={{ paddingLeft: 12 + entry.depth * 16 }}
                        aria-current={index === current ? 'location' : undefined}
                        onClick={() => onPick(entry)}
                      >
                        <span className="toc-text">{entry.title}</span>
                        {page != null && <span className="toc-page num">{page}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </>
  )
}
