/**
 * 复习前的概览：到期 / 新词 / 拖欠，预计用时，队列（可跳过），方向，开始（Enter）。
 */
import { Star } from 'lucide-react'
import { useEffect, useMemo, type ReactElement } from 'react'
import type { Snapshot } from '@shared/api'
import { formatMonthDay, formatWeekday } from '@shared/domain/dates'
import { estimateMinutes, type TodayQueue } from '@shared/domain/queue'
import { STAGE_LABELS } from '@shared/domain/scheduler'
import { pageById } from '@shared/snapshot'
import { Button, PageHead, SegmentedControl } from '../../components/ui'
import { WordAudioButton } from '../../components/WordAudioButton'
import { cx } from '../../lib/cx'
import { hasModifier, isOverlayOpen, isTypingTarget } from '../../lib/keys'

export type Direction = 'en-zh' | 'zh-en'

export function Overview({
  snapshot,
  queue,
  skipped,
  onToggleSkip,
  direction,
  onDirection,
  autoSpeak,
  onAutoSpeak,
  onStart
}: {
  snapshot: Snapshot
  queue: TodayQueue
  skipped: Set<string>
  onToggleSkip: (wordId: string) => void
  direction: Direction
  onDirection: (d: Direction) => void
  autoSpeak: boolean
  onAutoSpeak: (enabled: boolean) => void
  onStart: () => void
}): ReactElement {
  const words = useMemo(() => new Map(snapshot.words.map((w) => [w.id, w])), [snapshot])
  const pages = useMemo(() => pageById(snapshot.pages), [snapshot])
  const active = queue.items.filter((i) => !skipped.has(i.wordId))

  // Enter 开始复习（输入框内、弹层打开时不触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || hasModifier(e) || isTypingTarget(e.target) || isOverlayOpen()) return
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return
      if (active.length === 0) return
      e.preventDefault()
      onStart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active.length, onStart])

  const tailFrom = queue.items.length > 6 ? queue.items.length - 2 : Infinity

  return (
    <div className="overview">
      <PageHead
        eyebrow={`${formatMonthDay(snapshot.today)} · ${formatWeekday(snapshot.today)}`}
        title="今日复习"
        actions={
          <SegmentedControl<Direction>
            label="复习方向"
            value={direction}
            onChange={onDirection}
            options={[
              { value: 'en-zh', label: '英 → 中' },
              { value: 'zh-en', label: '中 → 英' }
            ]}
          />
        }
      />

      <section className="overview-top">
        <dl className="overview-stats">
          <div>
            <dt>到期复习</dt>
            <dd>{queue.reviewCount}</dd>
          </div>
          <span className="stat-sep" aria-hidden />
          <div>
            <dt>新词</dt>
            <dd>{queue.newCount}</dd>
          </div>
          <span className="stat-sep" aria-hidden />
          <div>
            <dt>其中拖欠</dt>
            <dd>{queue.overdueCount}</dd>
          </div>
        </dl>
        <div className="overview-actions">
          <p className="overview-estimate">
            预计 {estimateMinutes(active.length)} 分钟 ·{' '}
            <span className="muted">
              {active.length} 个词{skipped.size > 0 && `，跳过 ${skipped.size} 个`}
            </span>
          </p>
          <Button variant="primary" size="lg" disabled={active.length === 0} onClick={onStart}>
            开始复习
            <kbd>Enter</kbd>
          </Button>
        </div>
      </section>

      {queue.deferredNewCount > 0 && (
        <p className="overview-note">
          另有 {queue.deferredNewCount} 个新词超出今天的上限（{snapshot.settings.dailyNewLimit}
          ），留到之后再学。
        </p>
      )}

      <label className="review-audio-toggle">
        <input
          type="checkbox"
          checked={autoSpeak}
          onChange={(e) => onAutoSpeak(e.target.checked)}
        />
        自动朗读单词 <span className="muted">中译英翻面后朗读 · 使用系统英语语音</span>
      </label>

      <section className="queue-card">
        <header className="queue-card-head">
          <span>复习顺序</span>
          <span>勾选即跳过</span>
        </header>
        <ol className="queue-list" aria-label="复习顺序">
          {queue.items.map((item, i) => {
            const word = words.get(item.wordId)
            if (!word) return null
            const page = pages.get(word.pageId)
            const isSkipped = skipped.has(item.wordId)
            return (
              <li
                key={item.wordId}
                className={cx(
                  'queue-item',
                  isSkipped && 'is-skipped',
                  i >= tailFrom && (i === queue.items.length - 1 ? 'is-tail-1' : 'is-tail-2')
                )}
              >
                <span className="queue-index">{i + 1}</span>
                <span className="queue-word">
                  {word.text}
                  {word.starred && <Star size={12} className="star-badge" aria-label="难词" />}
                </span>
                {item.overdueDays > 0 && (
                  <span className="tag is-late queue-overdue">拖欠 {item.overdueDays} 天</span>
                )}
                <WordAudioButton word={word.text} />
                {word.starred && <span className="tag is-due">难词</span>}
                <span className="queue-meta">
                  第 {page?.number} 页 · {item.kind === 'new' ? '新词' : STAGE_LABELS[item.stage]}
                </span>
                <label className="queue-skip" aria-label={`跳过 ${word.text}`}>
                  <input
                    type="checkbox"
                    checked={isSkipped}
                    onChange={() => onToggleSkip(item.wordId)}
                  />
                </label>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
