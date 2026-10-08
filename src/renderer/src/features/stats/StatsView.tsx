import { ChartColumn } from 'lucide-react'
import type { ReactElement } from 'react'
import { EmptyState, PageHead } from '../../components/ui'

export function StatsView(): ReactElement {
  return (
    <div className="stats">
      <PageHead eyebrow="记忆情况" title="统计" />
      <EmptyState icon={ChartColumn} text="统计还在准备中，以后会在这里显示记忆情况" />
    </div>
  )
}
