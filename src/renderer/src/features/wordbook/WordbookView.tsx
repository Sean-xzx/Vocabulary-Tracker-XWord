/**
 * 单词页：页头（翻页、跳页、批量录入）+ 网格（格子状态、评分、编辑、行操作）+ 输入行。
 */
import { NotebookPen } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { AddWordsResult, NewWordInput, Snapshot } from '@shared/api'
import { cellStates, headerDates } from '@shared/domain/grid'
import { PAGE_SIZE } from '@shared/domain/pages'
import { normalizeWord } from '@shared/domain/parse'
import { checksByWord } from '@shared/snapshot'
import { CheckMark } from '../../components/marks'
import { EmptyState } from '../../components/ui'
import { hasModifier, isOverlayOpen, isTypingTarget } from '../../lib/keys'
import { addWords } from '../../store/actions'
import { useApp, useTodayQueue } from '../../store/app'
import { toast } from '../../store/toast'
import { BatchDialog } from './BatchDialog'
import { EntryRow, type EntryApi } from './EntryRow'
import { PageHeader } from './PageHeader'
import { WordGrid, type GridApi, type GridRow } from './WordGrid'
import './wordbook.css'

function pageNumberOf(snapshot: Snapshot | null, pageId: string): number | null {
  return snapshot?.pages.find((p) => p.id === pageId)?.number ?? null
}

export function WordbookView(): ReactElement | null {
  const snapshot = useApp((s) => s.snapshot)
  const wanted = useApp((s) => s.wordbookPage)
  const openPage = useApp((s) => s.openWordbookPage)
  const focusWordId = useApp((s) => s.wordbookFocusWordId)
  const queue = useTodayQueue()
  const gridApi = useRef<GridApi>(null)
  const entryApi = useRef<EntryApi>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [newRowId, setNewRowId] = useState<string | null>(null)
  const flashTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  const pages = useMemo(() => snapshot?.pages ?? [], [snapshot])
  const page = pages.find((p) => p.number === wanted) ?? pages[pages.length - 1] ?? null

  const derived = useMemo(() => {
    if (!snapshot) return null
    const checks = checksByWord(snapshot.checks)
    const counts = new Map<string, number>()
    const existing = new Map<string, number>()
    const pageNumbers = new Map(snapshot.pages.map((p) => [p.id, p.number]))
    for (const w of snapshot.words) {
      counts.set(w.pageId, (counts.get(w.pageId) ?? 0) + 1)
      const key = normalizeWord(w.text)
      if (!existing.has(key)) existing.set(key, pageNumbers.get(w.pageId) ?? 0)
    }
    return { checks, counts, existing }
  }, [snapshot])

  const queuedNew = useMemo(
    () => new Set(queue?.items.filter((i) => i.kind === 'new').map((i) => i.wordId) ?? []),
    [queue]
  )

  // 从词库“在第 N 页查看”跳过来：焦点放到那一行
  useEffect(() => {
    if (!focusWordId) return
    const frame = requestAnimationFrame(() => {
      gridApi.current?.focusWord(focusWordId)
      useApp.getState().clearWordbookFocus()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusWordId, page?.id])

  // PageUp / PageDown 翻页（输入框内、弹层打开时不触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return
      if (hasModifier(e) || isTypingTarget(e.target) || isOverlayOpen()) return
      const state = useApp.getState()
      const all = state.snapshot?.pages ?? []
      if (all.length === 0) return
      const current = all.findIndex((p) => p.number === state.wordbookPage)
      const index = current >= 0 ? current : all.length - 1
      const target = all[index + (e.key === 'PageUp' ? -1 : 1)]
      if (!target) return
      e.preventDefault()
      state.openWordbookPage(target.number)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!snapshot || !derived) return null
  const today = snapshot.today

  const pageWords = page ? snapshot.words.filter((w) => w.pageId === page.id) : []
  const rows: GridRow[] = pageWords.map((word) => ({
    word,
    cells: cellStates(word, derived.checks.get(word.id) ?? [], today, queuedNew.has(word.id))
  }))
  const isOpenTodayPage = page !== null && page.startedOn === today && pageWords.length < PAGE_SIZE
  const rowLabel = isOpenTodayPage ? String(pageWords.length + 1) : '+'

  const afterAdd = (res: AddWordsResult, single: boolean): void => {
    const latest = useApp.getState().snapshot
    const first = res.words[0]
    const last = res.words[res.words.length - 1]
    if (!first || !last) return
    const target = pageNumberOf(latest, (single ? last : first).pageId)
    if (target === null) return
    if (single) {
      // 写进了当前显示以外的页（通常是新开的一页）：自动切过去并提示
      if (target !== page?.number) {
        openPage(target)
        toast(
          res.newPageNumbers.includes(target) ? `已开始第 ${target} 页` : `已写入第 ${target} 页`
        )
      }
    } else {
      const lastPage = pageNumberOf(latest, last.pageId)
      openPage(target)
      toast(
        lastPage !== null && lastPage !== target
          ? `已写入 ${res.words.length} 个词（第 ${target}–${lastPage} 页）`
          : `已写入 ${res.words.length} 个词（第 ${target} 页）`
      )
    }
  }

  const submitOne = async (input: NewWordInput): Promise<boolean> => {
    const res = await addWords([input])
    if (!res) return false
    afterAdd(res, true)
    // 新的一行：荧光笔划出 200 → 600 淡去
    setNewRowId(res.words[0]?.id ?? null)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setNewRowId(null), 1000)
    return true
  }

  return (
    <div className="wordbook">
      <PageHeader
        page={page}
        pages={pages}
        counts={derived.counts}
        today={today}
        onGo={(n) => openPage(n)}
        onBatch={() => setBatchOpen(true)}
      />

      <div className="wordbook-body">
        {!page && <EmptyState icon={NotebookPen} text="还没有单词页，在下面写下第一个词吧" />}

        <WordGrid
          rows={rows}
          pageLabel={page ? `第 ${page.number} 页` : '新的一页'}
          dates={headerDates(pageWords)}
          today={today}
          onExitBottom={() => entryApi.current?.focus()}
          newRowId={newRowId}
          apiRef={gridApi}
          entryRow={
            <EntryRow
              rowLabel={rowLabel}
              existing={derived.existing}
              autoFocus={pages.length === 0}
              onSubmit={submitOne}
              onExitTop={() => {
                if (rows.length > 0) gridApi.current?.focusLastRow()
              }}
              apiRef={entryApi}
            />
          }
        />
      </div>

      <footer className="wordbook-legend" aria-hidden>
        <span className="legend-item">
          <span className="legend-swatch is-due" />
          今天到期
        </span>
        <span className="legend-item">
          <span className="legend-swatch is-late" />
          拖欠
        </span>
        <span className="legend-item">
          <span className="mark">
            <CheckMark size={16} />
          </span>
          模糊
        </span>
        <span className="legend-hint">单击到期格评分 · 按 1–4 快速评分 · R 朗读</span>
      </footer>

      <BatchDialog
        open={batchOpen}
        existing={derived.existing}
        onClose={() => setBatchOpen(false)}
        onDone={(res) => {
          setBatchOpen(false)
          afterAdd(res, false)
        }}
      />
    </div>
  )
}
