/** 检查格的朗读说明（aria-label）。 */
import { formatMonthDot } from '@shared/domain/dates'
import type { CellState } from '@shared/domain/grid'

export function describeCell(cell: CellState): string {
  switch (cell.kind) {
    case 'ok':
      return cell.faint ? '模糊，已通过' : '已通过'
    case 'fail':
      return '忘了'
    case 'missed':
      return '漏'
    case 'due':
      return cell.overdue ? '拖欠，可以评分' : '今天到期，可以评分'
    case 'pending':
      return cell.due ? '待学，今天可以学' : '待学'
    case 'next':
      return `${formatMonthDot(cell.dueOn)} 到期`
    case 'empty':
      return '未到'
  }
}
