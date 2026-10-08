/**
 * 词库详情：编辑单词、音标、词义、例句、助记（失焦或 Ctrl+Enter 保存，Esc 放弃修改）；
 * 只读的 6 节点迷你网格；复习历史（倒序，重现单独标注）；在第 N 页查看；难词 / 删除 / 恢复 / 彻底删除；
 * “从词典选择词义”打开与录入行相同的义项面板。
 */
import { BookOpen, NotebookPen, RotateCcw, Star, Trash2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type Ref
} from 'react'
import type { ReviewLogEntry, Word } from '@shared/api'
import { formatClock, formatMonthDot, toLocalDate, type DateStr } from '@shared/domain/dates'
import { composeMeaning } from '@shared/domain/dict'
import { cellStates } from '@shared/domain/grid'
import { STATUS_LABELS } from '@shared/domain/library'
import { meaningInputText, splitMeaningInput } from '@shared/domain/parse'
import { GRADE_LABELS, STAGE_LABELS, stageDueOn, type CheckRecord } from '@shared/domain/scheduler'
import { Button } from '../../components/ui'
import { WordAudioButton } from '../../components/WordAudioButton'
import { cx } from '../../lib/cx'
import { setStarred, updateWord } from '../../store/actions'
import { useApp } from '../../store/app'
import './sources.css'
import { toast } from '../../store/toast'
import { SensePanel, type SensePanelApi } from '../dict/SensePanel'
import { useDictLookup } from '../dict/useDictLookup'
import { describeCell } from '../wordbook/cellText'
import { StageMark } from '../wordbook/StageMark'

export interface WordDetailApi {
  /** Enter：进入编辑（焦点到单词框） */
  focusFirst: () => void
}

// ---------------------------------------------------------------- 可编辑字段

function Field({
  label,
  value,
  multiline = false,
  hideLabel = false,
  wide = false,
  placeholder,
  className,
  onSave,
  inputRef
}: {
  label: string
  value: string
  multiline?: boolean
  /** 标签只给读屏用（单词、音标直接显示成大字） */
  hideLabel?: boolean
  /** 占满详情的两栏 */
  wide?: boolean
  placeholder?: string
  className?: string
  onSave: (value: string) => void
  inputRef?: Ref<HTMLInputElement>
}): ReactElement {
  const [draft, setDraft] = useState(value)
  const [shown, setShown] = useState(value)
  const skipBlur = useRef(false)
  // 保存后（或别处改动后）值变了：输入框跟着更新
  if (shown !== value) {
    setShown(value)
    setDraft(value)
  }

  const commit = (): void => {
    if (draft !== value) onSave(draft)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.ctrlKey || !multiline)) {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      skipBlur.current = true
      setDraft(value)
      e.currentTarget.blur()
    }
  }

  const common = {
    'aria-label': label,
    className: cx('detail-input', className),
    placeholder,
    spellCheck: false,
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onKeyDown,
    onBlur: () => {
      if (skipBlur.current) skipBlur.current = false
      else commit()
    }
  }

  return (
    <label className={cx('detail-field', wide && 'is-wide')}>
      <span className={hideLabel ? 'sr-only' : 'detail-label'}>{label}</span>
      {multiline ? (
        <textarea rows={2} {...common} />
      ) : hideLabel ? (
        // 单词、音标：输入框宽度跟着文字走（隐藏的镜像文字撑开宽度）
        <span className={cx('detail-autosize', className)}>
          <span className="detail-autosize-mirror" aria-hidden>
            {draft || placeholder || ' '}
          </span>
          <input ref={inputRef} size={1} {...common} />
        </span>
      ) : (
        <input ref={inputRef} {...common} />
      )}
    </label>
  )
}

// ---------------------------------------------------------------- 复习历史

function History({ wordId, version }: { wordId: string; version: string }): ReactElement {
  const [log, setLog] = useState<ReviewLogEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    window.xword
      .getReviewLog(wordId)
      .then((entries) => {
        if (!cancelled) setLog(entries)
      })
      .catch(() => {
        if (!cancelled) setLog([])
      })
    return () => {
      cancelled = true
    }
  }, [wordId, version])

  if (!log) return <p className="detail-muted">…</p>
  if (log.length === 0) return <p className="detail-muted">还没有复习记录</p>
  return (
    <ol className="history">
      {log.map((r) => (
        <li key={r.id} className={cx('history-item', r.isRetry && 'is-retry')}>
          <span className="history-date num">{formatMonthDot(toLocalDate(r.reviewedAt))}</span>
          <span className="history-time num">{formatClock(r.reviewedAt)}</span>
          <span className="history-stage">{STAGE_LABELS[r.stage]}</span>
          <span className="history-grade">{GRADE_LABELS[r.grade]}</span>
          {r.isRetry && <span className="history-retry">本轮重现</span>}
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------- 出处

/** 这个词在书里的全部出处；每一条都可以点击跳回原文 */
function Sources({ wordId }: { wordId: string }): ReactElement | null {
  const snapshot = useApp((s) => s.snapshot)
  const openBook = useApp((s) => s.openBook)
  if (!snapshot) return null
  const list = snapshot.sources.filter((s) => s.wordId === wordId)
  if (list.length === 0) return null
  const books = new Map(snapshot.books.map((b) => [b.id, b]))
  return (
    <section className="detail-section is-wide" aria-label="出处">
      <h3 className="detail-title">出处</h3>
      <ul className="source-list">
        {list.map((s) => {
          const book = books.get(s.bookId)
          return (
            <li key={s.id}>
              <button
                type="button"
                className="source-item"
                disabled={!book}
                onClick={() =>
                  openBook(s.bookId, { chapter: s.chapter, block: s.block, offset: s.offset })
                }
              >
                <span className="source-sentence">{s.sentence}</span>
                <span className="source-where">
                  {book ? (
                    <>
                      《{book.title}》第 <span className="num">{s.chapter + 1}</span> 章
                    </>
                  ) : (
                    '这本书已从书架移除'
                  )}
                  <span className="source-date num">
                    {formatMonthDot(toLocalDate(s.createdAt))}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------- 详情

export function WordDetail({
  word,
  pageNumber,
  checks,
  today,
  newWordQueued,
  onDelete,
  onRestore,
  onPurge,
  onOpenPage,
  apiRef
}: {
  word: Word
  pageNumber: number
  checks: CheckRecord[]
  today: DateStr
  newWordQueued: boolean
  onDelete: () => void
  onRestore: () => void
  onPurge: () => void
  onOpenPage: () => void
  apiRef?: Ref<WordDetailApi>
}): ReactElement {
  const deleted = word.deletedAt !== null
  const textInput = useRef<HTMLInputElement>(null)
  const dictButton = useRef<HTMLButtonElement | null>(null)
  const [dictAnchor, setDictAnchor] = useState<HTMLButtonElement | null>(null)
  const dictButtonRef = useCallback((el: HTMLButtonElement | null) => {
    dictButton.current = el
    setDictAnchor(el)
  }, [])
  const [panelOpen, setPanelOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const panelApi = useRef<SensePanelApi>(null)
  const dict = useDictLookup()
  const entry = dict.result?.status === 'found' ? dict.result.entry : null

  useImperativeHandle(apiRef, () => ({ focusFirst: () => textInput.current?.focus() }))

  // 查到义项后焦点进入面板
  useEffect(() => {
    if (panelOpen && entry) panelApi.current?.focusFirst()
  }, [panelOpen, entry])

  const save = (patch: Parameters<typeof updateWord>[1]): void => {
    void updateWord(word.id, patch)
  }

  const closePanel = (): void => {
    setPanelOpen(false)
    dictButton.current?.focus()
  }

  const commitDict = async (): Promise<void> => {
    if (!entry || selected.size === 0) return
    const composed = composeMeaning(entry.groups, selected)
    const ok = await updateWord(word.id, {
      meaning: composed.meaning,
      pos: composed.pos,
      phonetic: entry.phonetic || word.phonetic
    })
    if (ok) {
      closePanel()
      toast(`已更新 ${word.text} 的词义`)
    }
  }

  const cells = cellStates(word, checks, today, newWordQueued)

  return (
    <div className="detail">
      <header className="detail-head">
        <Field
          label="单词"
          value={word.text}
          className="detail-word"
          hideLabel
          inputRef={textInput}
          onSave={(v) => {
            if (v.trim()) save({ text: v })
            else toast('单词不能为空')
          }}
        />
        <Field
          label="音标"
          value={word.phonetic}
          className="detail-phonetic"
          hideLabel
          placeholder="音标"
          onSave={(v) => save({ phonetic: v })}
        />
        <WordAudioButton word={word.text} shortcut="R" />
      </header>
      <div className="detail-tags">
        <span className="tag is-outline">{STATUS_LABELS[word.status]}</span>
        {word.starred && (
          <span className="tag is-due">
            难词
            {word.lapses > 0 && <> · 错 {word.lapses} 次</>}
          </span>
        )}
        {deleted && <span className="tag is-outline">已删除</span>}
      </div>

      <div className="detail-grid">
        <Field
          label="词义"
          multiline
          value={meaningInputText(word.pos, word.meaning)}
          placeholder="还没有词义"
          onSave={(v) => save(splitMeaningInput(v))}
        />
        <Field
          label="助记"
          multiline
          value={word.mnemonic}
          placeholder="写一句帮自己记住的话"
          onSave={(v) => save({ mnemonic: v })}
        />
        <Field
          label="例句"
          multiline
          wide
          className="is-example"
          value={word.example}
          placeholder="例句"
          onSave={(v) => save({ example: v })}
        />

        <Sources wordId={word.id} />

        <section className="detail-section is-wide">
          <h3 className="detail-title">复习格</h3>
          <div className="mini-grid" role="group" aria-label="复习节点">
            {cells.map((cell, stage) => {
              const due = word.learnedOn ? stageDueOn(word.learnedOn, stage) : null
              return (
                <div
                  key={stage}
                  className="mini-cell"
                  aria-label={`${STAGE_LABELS[stage]}：${describeCell(cell)}`}
                >
                  <span
                    className={cx(
                      'mini-box',
                      cell.kind === 'due' && (cell.overdue ? 'is-overdue' : 'is-due'),
                      cell.kind === 'pending' && cell.due && 'is-due'
                    )}
                  >
                    {cell.kind === 'next' ? null : <StageMark cell={cell} swept={false} />}
                  </span>
                  <span className="mini-label">{STAGE_LABELS[stage]}</span>
                  <span className="mini-date num">
                    {due ? (due === today ? '今天' : formatMonthDot(due)) : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="detail-section is-wide">
          <h3 className="detail-title">复习历史</h3>
          <History wordId={word.id} version={word.updatedAt} />
        </section>
      </div>

      <div className="detail-actions">
        {deleted ? (
          <>
            <Button variant="secondary" icon={RotateCcw} onClick={onRestore}>
              恢复
            </Button>
            <Button variant="ghost" icon={Trash2} onClick={onPurge}>
              彻底删除
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" icon={NotebookPen} onClick={onOpenPage}>
              在第 {pageNumber} 页查看
            </Button>
            <Button
              ref={dictButtonRef}
              variant="secondary"
              icon={BookOpen}
              onClick={() => {
                setSelected(new Set())
                setPanelOpen(true)
                void dict.run(word.text)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && panelOpen) {
                  e.preventDefault()
                  e.stopPropagation()
                  setPanelOpen(false)
                }
              }}
            >
              从词典选择词义
            </Button>
            <Button
              variant="ghost"
              icon={Star}
              className={cx(word.starred && 'is-starred')}
              aria-pressed={word.starred}
              onClick={() => void setStarred(word, !word.starred)}
            >
              {word.starred ? '取消难词' : '标记难词'}
            </Button>
            <Button variant="ghost" icon={Trash2} onClick={onDelete}>
              删除
            </Button>
          </>
        )}
      </div>

      <SensePanel
        anchor={dictAnchor}
        open={panelOpen}
        word={word.text}
        result={dict.result}
        selected={selected}
        preview={entry ? composeMeaning(entry.groups, selected).meaning : undefined}
        apiRef={panelApi}
        onToggle={(key) => {
          const next = new Set(selected)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          setSelected(next)
        }}
        onCommit={() => void commitDict()}
        onBack={closePanel}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  )
}
