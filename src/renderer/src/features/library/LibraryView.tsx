/**
 * 词库页（用户自己录入的单词）：左边列表、右边详情，中间是可拖动的分隔条。
 * 列表：搜索（Ctrl+F）、九个筛选（带数量）、四种排序、窗口化渲染。
 * 键盘（焦点不在输入框时）：↑↓ 移动选中项，Enter 进入详情编辑，Delete 软删除（可撤销）。
 */
import { Library, Search, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Word } from '@shared/api'
import {
  LIBRARY_FILTERS,
  LIBRARY_SORTS,
  filterCounts,
  queryItems,
  toLibraryItems,
  type LibraryFilter,
  type LibrarySort
} from '@shared/domain/library'
import { checksByWord, pageById } from '@shared/snapshot'
import { Button, ConfirmDialog, EmptyState, IconButton, PageHead } from '../../components/ui'
import { WordAudioButton } from '../../components/WordAudioButton'
import { speak } from '../../lib/speech'
import { toast, toastError } from '../../store/toast'
import { cx } from '../../lib/cx'
import { hasModifier, isOverlayOpen, isTypingTarget } from '../../lib/keys'
import { readLocal, writeLocal } from '../../lib/storage'
import { deleteWord, emptyTrash, purgeWord, restoreWord } from '../../store/actions'
import { duration, fadeSlide } from '../../motion'
import { useApp, useTodayQueue } from '../../store/app'
import { Splitter } from './Splitter'
import { WordDetail, type WordDetailApi } from './WordDetail'
import { WordList, type WordListApi } from './WordList'
import './library.css'

const SORT_KEY = 'xword.librarySort'
const WIDTH_KEY = 'xword.libraryDetailWidth'
/** 详情栏宽度（px）：默认 480，范围 320–640；列表至少保留 280 */
const DETAIL_DEFAULT = 480
const DETAIL_MIN = 320
const DETAIL_MAX = 640
const LIST_MIN = 280
/** 搜索防抖：停顿后第一次按键立即搜索，连续输入时每 150ms 最多搜索一次 */
const SEARCH_DEBOUNCE = 150

const EMPTY_TEXT: Record<LibraryFilter, string> = {
  all: '词库里还没有单词，去单词页录入吧',
  due: '今天没有到期的词',
  overdue: '没有拖欠的词',
  starred: '还没有难词',
  new: '没有新词',
  learning: '没有正在学的词',
  mastered: '还没有已掌握的词',
  lapsed: '没有需要重学的词',
  trash: '回收站是空的'
}

/** 熟词（在书里点过“我认识”的词，原形）：不再显示任何标记；可以撤销 */
function KnownWords({ known }: { known: string[] }): ReactElement {
  const remove = async (lemma: string): Promise<void> => {
    try {
      await window.xword.removeKnown(lemma)
      await useApp.getState().refresh()
      toast(`已撤销熟词：${lemma}`, {
        label: '撤销',
        run: async () => {
          try {
            await window.xword.addKnown(lemma)
            await useApp.getState().refresh()
          } catch (e) {
            toastError(e)
          }
        }
      })
    } catch (e) {
      toastError(e)
    }
  }
  return (
    <div className="library-known" aria-label="熟词">
      {known.length === 0 ? (
        <p className="known-empty">
          还没有熟词。读书时点一个词，再点“我认识”，它和它的变形就不再显示标记。
        </p>
      ) : (
        <ul className="known-list">
          {known.map((k) => (
            <li key={k} className="known-chip">
              {k}
              <WordAudioButton word={k} />
              <IconButton
                icon={Undo2}
                label={`撤销熟词 ${k}`}
                size="sm"
                iconSize={16}
                onClick={() => void remove(k)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function initialSort(): LibrarySort {
  const saved = readLocal(SORT_KEY)
  return LIBRARY_SORTS.some((s) => s.id === saved) ? (saved as LibrarySort) : 'entry'
}

function initialWidth(): number {
  const saved = Number(readLocal(WIDTH_KEY))
  return Number.isFinite(saved) && saved >= DETAIL_MIN && saved <= DETAIL_MAX
    ? saved
    : DETAIL_DEFAULT
}

type Confirm = { kind: 'purge'; word: Word } | { kind: 'empty'; count: number } | null

export function LibraryView(): ReactElement | null {
  const snapshot = useApp((s) => s.snapshot)
  const openWordbookPage = useApp((s) => s.openWordbookPage)
  const queue = useTodayQueue()
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [sort, setSort] = useState<LibrarySort>(initialSort)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  // 从首页、阅读页跳过来时选中那个词
  const [selectedId, setSelectedId] = useState<string | null>(
    () => useApp.getState().libraryFocusWordId
  )
  const [showKnown, setShowKnown] = useState(false)
  useEffect(() => {
    if (useApp.getState().libraryFocusWordId) useApp.setState({ libraryFocusWordId: null })
  }, [])
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [detailWidth, setDetailWidth] = useState(initialWidth)
  const [reflow, setReflow] = useState(false)
  const reflowTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(reflowTimer.current), [])
  const searchInput = useRef<HTMLInputElement>(null)
  const listApi = useRef<WordListApi>(null)
  const detailApi = useRef<WordDetailApi>(null)
  const debounce = useRef<{ last: number; timer: number | undefined }>({
    last: 0,
    timer: undefined
  })

  useEffect(() => () => window.clearTimeout(debounce.current.timer), [])

  const data = useMemo(() => {
    if (!snapshot) return null
    const pages = pageById(snapshot.pages)
    const checks = checksByWord([...snapshot.checks, ...snapshot.deletedChecks])
    const all = [...snapshot.words, ...snapshot.deletedWords]
    const items = toLibraryItems(
      all.map((w) => ({
        ...w,
        pageNumber: pages.get(w.pageId)?.number ?? 0,
        checks: checks.get(w.id) ?? [],
        deleted: w.deletedAt !== null
      })),
      snapshot.today
    )
    return {
      items,
      checks,
      pages,
      words: new Map(all.map((w) => [w.id, w])),
      counts: filterCounts(items)
    }
  }, [snapshot])

  const queuedNew = useMemo(
    () => new Set(queue?.items.filter((i) => i.kind === 'new').map((i) => i.wordId) ?? []),
    [queue]
  )

  const list = useMemo(
    () => (data ? queryItems(data.items, filter, search, sort) : []),
    [data, filter, search, sort]
  )
  const selectedIndex = Math.max(
    0,
    list.findIndex((i) => i.id === selectedId)
  )
  const selected = list[selectedIndex] ?? null
  const selectedWord = selected ? (data?.words.get(selected.id) ?? null) : null

  const onQueryChange = (value: string): void => {
    setQuery(value)
    const d = debounce.current
    window.clearTimeout(d.timer)
    const wait = SEARCH_DEBOUNCE - (performance.now() - d.last)
    if (wait <= 0) {
      d.last = performance.now()
      setSearch(value)
    } else {
      d.timer = window.setTimeout(() => {
        d.last = performance.now()
        setSearch(value)
      }, wait)
    }
  }

  const select = (index: number): void => {
    const item = list[Math.max(0, Math.min(index, list.length - 1))]
    if (!item) return
    setSelectedId(item.id)
    listApi.current?.reveal(list.indexOf(item))
  }

  /** 删除 / 恢复 / 彻底删除一行：这一行淡出，下方的行 FLIP 上移 180 */
  const animateRemoval = (id: string): void => {
    const row = document.getElementById(`lib-${id}`)
    const inner = row?.parentElement
    if (row && inner) {
      const ghost = row.cloneNode(true) as HTMLElement
      ghost.removeAttribute('id')
      ghost.setAttribute('aria-hidden', 'true')
      ghost.classList.add('is-ghost')
      inner.appendChild(ghost)
      const anim = fadeSlide(ghost, { direction: 'out', duration: duration('--dur-micro') })
      if (anim) void anim.finished.finally(() => ghost.remove())
      else ghost.remove()
    }
    setReflow(true)
    window.clearTimeout(reflowTimer.current)
    reflowTimer.current = window.setTimeout(() => setReflow(false), duration('--dur-base') + 60)
  }

  const removeSelected = (): void => {
    if (!selectedWord || selectedWord.deletedAt !== null) return
    animateRemoval(selectedWord.id)
    // 删除后选中下一个（没有就选上一个）
    const next = list[selectedIndex + 1] ?? list[selectedIndex - 1]
    setSelectedId(next?.id ?? null)
    const id = selectedWord.id
    void deleteWord(selectedWord, () => setSelectedId(id))
  }

  const restoreSelected = (): void => {
    if (!selectedWord) return
    animateRemoval(selectedWord.id)
    const next = list[selectedIndex + 1] ?? list[selectedIndex - 1]
    setSelectedId(next?.id ?? null)
    void restoreWord(selectedWord)
  }

  // 键盘：每次渲染重新订阅，处理函数总是拿到最新状态
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key.toLowerCase() === 'f') {
        if (isOverlayOpen()) return
        if (isTypingTarget(e.target) && e.target !== searchInput.current) return
        e.preventDefault()
        searchInput.current?.focus()
        searchInput.current?.select()
        return
      }
      if (hasModifier(e) || e.shiftKey || isTypingTarget(e.target) || isOverlayOpen()) return
      const onButton = e.target instanceof HTMLButtonElement
      switch (e.key) {
        case 'r':
        case 'R':
          if (!selectedWord) return
          e.preventDefault()
          speak(selectedWord.text)
          break
        case 'ArrowDown':
          e.preventDefault()
          select(selectedIndex + 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          select(selectedIndex - 1)
          break
        case 'Enter':
          if (onButton || !selectedWord) return
          e.preventDefault()
          detailApi.current?.focusFirst()
          break
        case 'Delete':
          if (!selectedWord || selectedWord.deletedAt !== null) return
          e.preventDefault()
          removeSelected()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!snapshot || !data) return null

  const emptyText = search.trim() ? `没有找到“${search.trim()}”` : EMPTY_TEXT[filter]

  return (
    <div className="library">
      <PageHead
        eyebrow={<>{data.counts.all} 个词</>}
        title="词库"
        actions={
          <>
            <label className="library-search">
              <Search size={16} aria-hidden />
              <input
                ref={searchInput}
                type="search"
                aria-label="搜索单词或词义"
                aria-keyshortcuts="Control+F"
                placeholder="搜索单词或词义"
                spellCheck={false}
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault()
                    onQueryChange('')
                  }
                }}
              />
              <kbd>Ctrl F</kbd>
            </label>
            <label className="library-sort">
              <span className="sr-only">排序</span>
              <select
                aria-label="排序"
                value={sort}
                onChange={(e) => {
                  const next = e.target.value as LibrarySort
                  setSort(next)
                  writeLocal(SORT_KEY, next)
                }}
              >
                {LIBRARY_SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      />

      <div className="library-filters" role="radiogroup" aria-label="筛选">
        {LIBRARY_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={!showKnown && filter === f.id}
            className={cx('filter-chip', !showKnown && filter === f.id && 'is-selected')}
            onClick={() => {
              setFilter(f.id)
              setShowKnown(false)
              setSelectedId(null)
            }}
          >
            {f.label}
            <span className="filter-count">{data.counts[f.id]}</span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={showKnown}
          className={cx('filter-chip', showKnown && 'is-selected')}
          onClick={() => setShowKnown(true)}
        >
          熟词
          <span className="filter-count">{snapshot.known.length}</span>
        </button>
      </div>

      {showKnown ? (
        <KnownWords known={snapshot.known} />
      ) : (
        <div className="library-body">
          <div className="library-list">
            {filter === 'trash' && data.counts.trash > 0 && (
              <div className="library-trash-bar">
                <span className="muted">回收站里的词不参与复习；彻底删除后不能恢复。</span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Trash2}
                  onClick={() => setConfirm({ kind: 'empty', count: data.counts.trash })}
                >
                  清空回收站
                </Button>
              </div>
            )}

            {list.length === 0 ? (
              <EmptyState icon={Library} text={emptyText} />
            ) : (
              <WordList
                items={list}
                words={data.words}
                selectedId={selected?.id ?? null}
                today={snapshot.today}
                reflow={reflow}
                onSelect={setSelectedId}
                apiRef={listApi}
              />
            )}
          </div>

          <Splitter
            value={detailWidth}
            min={DETAIL_MIN}
            max={DETAIL_MAX}
            defaultValue={DETAIL_DEFAULT}
            minRest={LIST_MIN}
            onChange={setDetailWidth}
            onCommit={(w) => writeLocal(WIDTH_KEY, String(w))}
          />

          <aside className="library-detail" aria-label="单词详情" style={{ width: detailWidth }}>
            {selectedWord && selected ? (
              <WordDetail
                key={selectedWord.id}
                word={selectedWord}
                pageNumber={selected.pageNumber}
                checks={data.checks.get(selectedWord.id) ?? []}
                today={snapshot.today}
                newWordQueued={queuedNew.has(selectedWord.id)}
                apiRef={detailApi}
                onDelete={removeSelected}
                onRestore={restoreSelected}
                onPurge={() => setConfirm({ kind: 'purge', word: selectedWord })}
                onOpenPage={() => openWordbookPage(selected.pageNumber, selectedWord.id)}
              />
            ) : (
              <EmptyState icon={Library} text="选择一个词查看详情" />
            )}
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'empty' ? '清空回收站' : '彻底删除'}
        message={
          confirm?.kind === 'empty'
            ? `回收站里的 ${confirm.count} 个词会连同它们的复习记录一起删除，不能撤销。`
            : confirm?.kind === 'purge'
              ? `“${confirm.word.text}”会连同它的复习记录一起删除，不能撤销。`
              : ''
        }
        confirmLabel={confirm?.kind === 'empty' ? '清空' : '彻底删除'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'empty') void emptyTrash()
          else if (confirm?.kind === 'purge') {
            animateRemoval(confirm.word.id)
            const next = list[selectedIndex + 1] ?? list[selectedIndex - 1]
            setSelectedId(next?.id ?? null)
            void purgeWord(confirm.word)
          }
        }}
      />
    </div>
  )
}
