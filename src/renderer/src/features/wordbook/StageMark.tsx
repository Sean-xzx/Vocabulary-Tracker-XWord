/**
 * 检查格的内容（勾、叉、漏、待学、下一节点日期）。单词页网格和词库详情的迷你网格共用。
 * swept：刚评完分，勾（或叉的两笔）沿笔画写出来。
 */
import type { ReactNode } from 'react'
import { formatMonthDot } from '@shared/domain/dates'
import type { CellState } from '@shared/domain/grid'
import { CheckMark, CrossMark } from '../../components/marks'
import { cx } from '../../lib/cx'

export function StageMark({ cell, swept }: { cell: CellState; swept: boolean }): ReactNode {
  switch (cell.kind) {
    case 'ok':
    case 'fail':
      return (
        <span
          className={cx(
            'mark',
            cell.kind === 'fail' ? 'is-fail' : cell.faint ? 'is-faint' : 'is-ok',
            swept && 'is-sweep'
          )}
        >
          {cell.kind === 'fail' ? <CrossMark /> : <CheckMark />}
        </span>
      )
    case 'missed':
      return <span className="cell-missed">漏</span>
    case 'due':
      return cell.overdue ? <span className="overdue-dot" aria-hidden /> : null
    case 'pending':
      return <span className="cell-pending">待学</span>
    case 'next':
      return <span className="cell-next num">{formatMonthDot(cell.dueOn)}</span>
    case 'empty':
      return null
  }
}
