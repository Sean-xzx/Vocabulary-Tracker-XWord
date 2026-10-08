/**
 * XWord 标志（design-assets/logo/xword-mark*.svg）：一本带线圈的单词本，纸面上一道荧光笔、一道单词墨线，
 * 右侧复习栏的竖线和一个勾。颜色全部引用 CSS 变量：纸面 --paper，描边与线圈 --ink，复习栏竖线 --rule-strong，
 * 荧光笔 --marker，单词墨线 --mark-word（浅色为墨色、深色为纸色），勾 --ink。
 * size ≤ 32 自动换成加粗的小尺寸几何；variant="mono" 为单色版。
 * animate：'splash' 播放开屏的三笔（本子淡入 → 划 → 写 → 勾）；'check' 只写出那一笔勾（完成页）。
 */
import type { ReactElement } from 'react'
import { cx } from '../../lib/cx'
import './brand.css'

interface Geometry {
  bodyStroke: number
  rings: { x: number; width: number; rx: number }[]
  rule: { y1: number; y2: number; width: number }
  wordWidth: number
  checkWidth: number
}

const REGULAR: Geometry = {
  bodyStroke: 4,
  rings: [32.5, 47.5, 62.5].map((x) => ({ x, width: 5, rx: 2.5 })),
  rule: { y1: 26, y2: 82, width: 2.5 },
  wordWidth: 5,
  checkWidth: 4.5
}

const SMALL: Geometry = {
  bodyStroke: 7,
  rings: [31.5, 46.5, 61.5].map((x) => ({ x, width: 7, rx: 3.5 })),
  rule: { y1: 28, y2: 80, width: 3.5 },
  wordWidth: 7,
  checkWidth: 7
}

export type MarkAnimation = 'splash' | 'check'

export function XWordMark({
  size = 28,
  variant = 'default',
  small,
  animate,
  className,
  title
}: {
  size?: number
  variant?: 'default' | 'mono'
  /** 小尺寸加粗几何；缺省时 size ≤ 32 自动开启 */
  small?: boolean
  animate?: MarkAnimation
  className?: string
  title?: string
}): ReactElement {
  const g = (small ?? size <= 32) ? SMALL : REGULAR
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={cx(
        'xmark',
        variant === 'mono' && 'is-mono',
        animate && `is-anim-${animate}`,
        className
      )}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g className="xmark-book">
        <rect
          className="xmark-body"
          x="22"
          y="22"
          width="56"
          height="64"
          rx="8"
          strokeWidth={g.bodyStroke}
        />
        {g.rings.map((r) => (
          <rect
            key={r.x}
            className="xmark-ring"
            x={r.x}
            y="13"
            width={r.width}
            height="16"
            rx={r.rx}
          />
        ))}
        <line
          className="xmark-rule"
          x1="61"
          y1={g.rule.y1}
          x2="61"
          y2={g.rule.y2}
          strokeWidth={g.rule.width}
        />
      </g>
      <polygon className="xmark-marker" points="28,45 57,45 55.5,58 26.5,58" />
      <line className="xmark-word" x1="31" y1="51.5" x2="50" y2="51.5" strokeWidth={g.wordWidth} />
      <polyline
        className="xmark-check"
        points="64.5,52 68.5,56.5 75,47"
        pathLength={1}
        strokeWidth={g.checkWidth}
      />
    </svg>
  )
}

/** 字标：“XWord”，衬线字体，字重 600，字距 -0.02em */
export function Wordmark({ className }: { className?: string }): ReactElement {
  return <span className={cx('wordmark', className)}>XWord</span>
}
