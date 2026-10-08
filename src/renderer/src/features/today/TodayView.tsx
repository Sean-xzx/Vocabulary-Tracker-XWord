/**
 * 今日复习：概览 → 复习中（收起导航栏）→ 完成页。队列为空时显示空状态。
 */
import { CalendarCheck, PenLine } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { queueFromSnapshot } from '@shared/snapshot'
import { Button, EmptyState } from '../../components/ui'
import { readLocal, writeLocal } from '../../lib/storage'
import { useApp, useTodayQueue } from '../../store/app'
import { DevSampleButton } from '../DevSampleButton'
import { Done } from './Done'
import { Overview, type Direction } from './Overview'
import { Session, type SessionSummary } from './Session'
import './today.css'

const DIRECTION_KEY = 'xword.reviewDirection'
const AUTO_SPEAK_KEY = 'xword.reviewAutoSpeak'

type Phase =
  | { kind: 'overview' }
  | { kind: 'session'; wordIds: string[]; run: number }
  | { kind: 'done'; summary: SessionSummary }

export function TodayView(): ReactElement | null {
  const snapshot = useApp((s) => s.snapshot)
  const setFocusMode = useApp((s) => s.setFocusMode)
  const openWordbookPage = useApp((s) => s.openWordbookPage)
  const queue = useTodayQueue()
  // 从首页点“开始复习”：直接进入复习（初始状态就是复习中）
  const [phase, setPhase] = useState<Phase>(() => {
    const s = useApp.getState()
    const ids = s.snapshot && s.autoStartReview ? queueFromSnapshot(s.snapshot).items : []
    return ids.length > 0
      ? { kind: 'session', wordIds: ids.map((i) => i.wordId), run: Date.now() }
      : { kind: 'overview' }
  })
  useEffect(() => {
    if (!useApp.getState().autoStartReview) return
    useApp.getState().clearAutoStart()
    if (phase.kind === 'session') useApp.getState().setFocusMode(true)
    // 只在挂载时处理一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set())
  const [direction, setDirection] = useState<Direction>(() =>
    readLocal(DIRECTION_KEY) === 'zh-en' ? 'zh-en' : 'en-zh'
  )
  const [autoSpeak, setAutoSpeak] = useState(() => readLocal(AUTO_SPEAK_KEY) !== 'false')
  const changeAutoSpeak = (enabled: boolean): void => {
    setAutoSpeak(enabled)
    writeLocal(AUTO_SPEAK_KEY, String(enabled))
  }

  // 离开这个页面时恢复导航栏
  useEffect(() => () => useApp.getState().setFocusMode(false), [])

  const start = useCallback(() => {
    if (!queue) return
    const wordIds = queue.items.filter((i) => !skipped.has(i.wordId)).map((i) => i.wordId)
    if (wordIds.length === 0) return
    setFocusMode(true)
    setPhase({ kind: 'session', wordIds, run: Date.now() })
  }, [queue, skipped, setFocusMode])

  const finish = (summary: SessionSummary): void => {
    setFocusMode(false)
    setSkipped(new Set())
    setPhase({ kind: 'done', summary })
    void useApp.getState().refresh()
  }

  if (!snapshot || !queue) return null

  if (phase.kind === 'session') {
    return (
      <Session
        key={phase.run}
        wordIds={phase.wordIds}
        direction={direction}
        autoSpeak={autoSpeak}
        onAutoSpeak={changeAutoSpeak}
        onFinish={finish}
      />
    )
  }

  if (phase.kind === 'done') return <Done snapshot={snapshot} summary={phase.summary} />

  if (queue.items.length === 0) {
    return (
      <EmptyState icon={CalendarCheck} text="今天没有要复习的词">
        <Button variant="primary" icon={PenLine} onClick={() => openWordbookPage(null)}>
          去录入新词
        </Button>
        <DevSampleButton />
      </EmptyState>
    )
  }

  return (
    <Overview
      snapshot={snapshot}
      queue={queue}
      skipped={skipped}
      onToggleSkip={(id) =>
        setSkipped((s) => {
          const next = new Set(s)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }
      direction={direction}
      onDirection={(d) => {
        setDirection(d)
        writeLocal(DIRECTION_KEY, d)
      }}
      onStart={start}
      autoSpeak={autoSpeak}
      onAutoSpeak={changeAutoSpeak}
    />
  )
}
