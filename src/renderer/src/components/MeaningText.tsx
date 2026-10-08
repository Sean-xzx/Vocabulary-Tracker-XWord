/**
 * 词义显示：词性 / 领域标记用次要色。词义本身是“带词性全文”（从词典选出）时按组显示，不重复显示 pos。
 */
import type { ReactElement, ReactNode } from 'react'
import { meaningParts } from '@shared/domain/parse'

export function MeaningText({
  pos,
  meaning,
  empty = null
}: {
  pos: string
  meaning: string
  empty?: ReactNode
}): ReactNode {
  const parts = meaningParts(pos, meaning)
  if (parts.length === 0) return empty
  return parts.map((p, i): ReactElement => (
    <span key={i} className="meaning-part">
      {p.label && <span className="pos">{p.label}</span>}
      {p.text}
    </span>
  ))
}
