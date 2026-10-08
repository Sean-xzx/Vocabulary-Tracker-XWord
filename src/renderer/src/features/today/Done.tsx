/**
 * 完成页：今天复习了几个、其中忘了几个、明天待复习几个；Logo 里的那一笔勾写出一次。不撒花，不做数字滚动。
 */
import { useMemo, type ReactElement } from 'react'
import type { Snapshot } from '@shared/api'
import { addDays } from '@shared/domain/dates'
import { queueFromSnapshot } from '@shared/snapshot'
import { XWordMark } from '../../components/brand/XWordMark'
import { Button } from '../../components/ui'
import { useApp } from '../../store/app'
import type { SessionSummary } from './Session'

export function Done({
  snapshot,
  summary
}: {
  snapshot: Snapshot
  summary: SessionSummary
}): ReactElement {
  const openWordbookPage = useApp((s) => s.openWordbookPage)

  const stats = useMemo(() => {
    // “今天”的统计以数据库为准：今天完成的检查格（不含漏），包括网格里评的
    const todays = snapshot.checks.filter((c) => c.doneOn === snapshot.today && c.grade !== null)
    const tomorrow = queueFromSnapshot(snapshot, addDays(snapshot.today, 1))
    return {
      reviewed: todays.length,
      forgot: todays.filter((c) => c.result === 'fail').length,
      tomorrow: tomorrow.reviewCount
    }
  }, [snapshot])

  return (
    <div className="done">
      <XWordMark size={64} animate="check" />
      <h1>{summary.completed ? '今天的复习完成了' : '这一轮先到这里'}</h1>
      <dl className="done-stats">
        <div>
          <dt>今天复习了</dt>
          <dd>{stats.reviewed}</dd>
        </div>
        <span className="stat-sep" aria-hidden />
        <div>
          <dt>其中忘了</dt>
          <dd>{stats.forgot}</dd>
        </div>
        <span className="stat-sep" aria-hidden />
        <div>
          <dt>明天待复习</dt>
          <dd>{stats.tomorrow}</dd>
        </div>
      </dl>
      <Button variant="primary" size="lg" autoFocus onClick={() => openWordbookPage(null)}>
        回到单词页
      </Button>
    </div>
  )
}
