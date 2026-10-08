import type { KeyboardEvent, ReactElement } from 'react'
import { GRADE_LABELS, isGrade, type Grade } from '@shared/domain/scheduler'
import { cx } from '../../lib/cx'

const GRADES: Grade[] = [1, 2, 3, 4]

/** 网格评分浮层里的四档按钮；按 1–4 直接选。 */
export function GradePicker({ onPick }: { onPick: (grade: Grade) => void }): ReactElement {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const n = Number(e.key)
    if (isGrade(n)) {
      e.preventDefault()
      e.stopPropagation()
      onPick(n)
      return
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const buttons = Array.from(e.currentTarget.querySelectorAll('button'))
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]
      next?.focus()
      e.preventDefault()
    }
  }
  return (
    <div className="grade-picker" role="group" aria-label="评分" onKeyDown={onKeyDown}>
      {GRADES.map((g) => (
        <button
          key={g}
          type="button"
          className={cx('grade-chip', g === 1 && 'is-forgot')}
          onClick={() => onPick(g)}
        >
          <span>{GRADE_LABELS[g]}</span>
          <kbd>{g}</kbd>
        </button>
      ))}
    </div>
  )
}
