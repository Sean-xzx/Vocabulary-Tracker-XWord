/**
 * 网格里的勾和叉：用 SVG 画，笔触略带手写感。颜色由 currentColor 决定。
 * 每一笔都设 pathLength = 1，方便用 stroke-dashoffset 把它“写出来”（勾一笔，叉两笔）。
 */
import type { ReactElement } from 'react'

export function CheckMark({ size = 18 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="mark-svg">
      <path
        className="mark-stroke"
        d="M3.2 8.6 L6.4 11.8 L12.9 4.2"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CrossMark({ size = 18 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="mark-svg">
      <path
        className="mark-stroke mark-stroke-1"
        d="M4.4 4.4 L11.6 11.6"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        className="mark-stroke mark-stroke-2"
        d="M11.6 4.4 L4.4 11.6"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
