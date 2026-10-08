/**
 * 两栏之间的分隔条（ui-spec §4）：平时 1px 低对比细线；悬停约 150ms 后变成 3px 陶土色线，光标变成左右拖动；
 * 实际可抓取区域约 9px；双击恢复默认宽度。宽度由父组件保存（localStorage）。
 * 这里拖动的是右侧栏的宽度：向左拖变宽。
 */
import { useRef, useState, type ReactElement } from 'react'
import { cx } from '../../lib/cx'

export function Splitter({
  value,
  min,
  max,
  defaultValue,
  minRest,
  onChange,
  onCommit
}: {
  value: number
  min: number
  max: number
  defaultValue: number
  /** 左侧至少保留的宽度 */
  minRest: number
  onChange: (value: number) => void
  onCommit: (value: number) => void
}): ReactElement {
  const drag = useRef<{ x: number; start: number; limit: number; last: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const clamp = (v: number, limit: number): number =>
    Math.round(Math.max(min, Math.min(v, Math.max(min, Math.min(max, limit)))))

  return (
    <div
      className={cx('splitter', dragging && 'is-dragging')}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整详情栏宽度（双击恢复默认）"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const container = e.currentTarget.parentElement
        const limit = container ? container.clientWidth - minRest : max
        drag.current = { x: e.clientX, start: value, limit, last: value }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.last = clamp(d.start + (d.x - e.clientX), d.limit)
        onChange(d.last)
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (!d) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        drag.current = null
        setDragging(false)
        onCommit(d.last)
      }}
      onDoubleClick={() => {
        onChange(defaultValue)
        onCommit(defaultValue)
      }}
    />
  )
}
