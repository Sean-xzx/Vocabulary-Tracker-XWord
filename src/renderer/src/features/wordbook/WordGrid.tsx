/**
 * 单词页网格：序号、单词、词义、6 个节点列、行操作。
 * 键盘：方向键 / Home / End 移动；Enter 编辑（单词、词义）或打开评分；1–4 直接评分；S 难词；Delete 删除。
 */
import { Star, Trash2 } from 'lucide-react'
import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref
} from 'react'
import type { Word } from '@shared/api'
import { formatMonthDot, type DateStr } from '@shared/domain/dates'
import type { CellState } from '@shared/domain/grid'
import { meaningInputText, splitMeaningInput } from '@shared/domain/parse'
import { STAGE_LABELS, isGrade, type Grade } from '@shared/domain/scheduler'
import { MeaningText } from '../../components/MeaningText'
import { WordAudioButton } from '../../components/WordAudioButton'
import { speak } from '../../lib/speech'
import { IconButton, Popover } from '../../components/ui'
import { cx } from '../../lib/cx'
import { hasModifier } from '../../lib/keys'
import { flipFrom } from '../../motion'
import { deleteWord, gradeFromGrid, setStarred, updateWord } from '../../store/actions'
import { GradePicker } from './GradePicker'
import { describeCell } from './cellText'
import { StageMark } from './StageMark'

export interface GridRow {
  word: Word
  cells: CellState[]
}

export interface GridApi {
  focusLastRow: () => void
  /** 把焦点放到某个词所在行的单词格；这一页没有这个词时返回 false */
  focusWord: (wordId: string) => boolean
}

/** 可聚焦的列：0 单词、1 词义、2–7 六个节点 */
const COLS = 8
const STAGE_COL = 2

interface Pos {
  row: number
  col: number
}

function isGradable(cell: CellState): boolean {
  return cell.kind === 'due' || cell.kind === 'pending'
}

function meaningText(word: Word): string {
  return meaningInputText(word.pos, word.meaning)
}

// ---------------------------------------------------------------- 单元格编辑

function EditInput({
  initial,
  label,
  onCommit,
  onCancel
}: {
  initial: string
  label: string
  onCommit: (value: string) => void
  onCancel: () => void
}): ReactElement {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (commit: boolean): void => {
    if (done.current) return
    done.current = true
    if (commit) onCommit(value)
    else onCancel()
  }
  return (
    <input
      className="cell-input"
      aria-label={label}
      autoFocus
      value={value}
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
    />
  )
}

// ---------------------------------------------------------------- 网格

export function WordGrid({
  rows,
  pageLabel,
  dates,
  today,
  entryRow,
  onExitBottom,
  newRowId = null,
  apiRef
}: {
  rows: GridRow[]
  pageLabel: string
  dates: DateStr[] | null
  today: DateStr
  entryRow: ReactNode
  onExitBottom: () => void
  /** 刚录入的词：这一行被荧光笔划出后淡去 */
  newRowId?: string | null
  apiRef?: Ref<GridApi>
}): ReactElement {
  const [focus, setFocus] = useState<Pos>({ row: 0, col: 0 })
  const [editing, setEditing] = useState<Pos | null>(null)
  const [picker, setPicker] = useState<{ row: number; stage: number; anchor: HTMLElement } | null>(
    null
  )
  const [swept, setSwept] = useState<{ wordId: string; stage: number } | null>(null)
  const cellEls = useRef(new Map<string, HTMLElement>())
  const tbody = useRef<HTMLTableSectionElement>(null)
  const shown = useRef({ label: pageLabel, count: rows.length })

  // 录入新词：同一页多了一行时，下方的输入行和空白行从原位置 FLIP 下移 180
  useLayoutEffect(() => {
    const prev = shown.current
    shown.current = { label: pageLabel, count: rows.length }
    if (prev.label !== pageLabel || rows.length !== prev.count + 1 || !tbody.current) return
    const newRow = tbody.current.querySelectorAll<HTMLElement>('tr.grid-row')[rows.length - 1]
    const dy = newRow?.offsetHeight ?? 0
    for (const el of tbody.current.querySelectorAll('.entry-row, .entry-hint-row')) {
      flipFrom(el, 0, -dy)
    }
  }, [pageLabel, rows.length])

  // 行数变化（删除、翻页）后焦点位置自动收拢到有效范围
  const active: Pos = {
    row: Math.min(focus.row, Math.max(0, rows.length - 1)),
    col: Math.min(focus.col, COLS - 1)
  }

  const focusCell = (row: number, col: number): void => {
    const next = {
      row: Math.max(0, Math.min(row, rows.length - 1)),
      col: Math.max(0, Math.min(col, COLS - 1))
    }
    setFocus(next)
    requestAnimationFrame(() => cellEls.current.get(`${next.row}:${next.col}`)?.focus())
  }

  useImperativeHandle(apiRef, () => ({
    focusLastRow: () => focusCell(rows.length - 1, active.col),
    focusWord: (wordId) => {
      const row = rows.findIndex((r) => r.word.id === wordId)
      if (row < 0) return false
      focusCell(row, 0)
      return true
    }
  }))

  const grade = async (row: number, stage: number, g: Grade): Promise<void> => {
    const r = rows[row]
    if (!r || !isGradable(r.cells[stage])) return
    setPicker(null)
    setSwept({ wordId: r.word.id, stage })
    const res = await gradeFromGrid(r.word, g)
    if (!res) setSwept(null)
    focusCell(row, STAGE_COL + stage)
  }

  const openPicker = (row: number, stage: number, anchor: HTMLElement): void => {
    if (!isGradable(rows[row].cells[stage])) return
    setPicker({ row, stage, anchor })
  }

  const commitEdit = async (row: number, col: number, value: string): Promise<void> => {
    setEditing(null)
    const word = rows[row]?.word
    if (word) {
      if (col === 0) {
        const text = value.trim()
        if (text !== '' && text !== word.text) await updateWord(word.id, { text })
      } else {
        const next = splitMeaningInput(value)
        if (next.pos !== word.pos || next.meaning !== word.meaning) await updateWord(word.id, next)
      }
    }
    focusCell(row, col)
  }

  const onCellKeyDown = (e: KeyboardEvent<HTMLElement>, row: number, col: number): void => {
    if (editing) return
    const r = rows[row]
    const stage = col - STAGE_COL
    let handled = true
    switch (e.key) {
      case 'ArrowRight':
        focusCell(row, col + 1)
        break
      case 'ArrowLeft':
        focusCell(row, col - 1)
        break
      case 'ArrowUp':
        focusCell(row - 1, col)
        break
      case 'ArrowDown':
        if (row >= rows.length - 1) onExitBottom()
        else focusCell(row + 1, col)
        break
      case 'Home':
        focusCell(e.ctrlKey ? 0 : row, 0)
        break
      case 'End':
        focusCell(e.ctrlKey ? rows.length - 1 : row, COLS - 1)
        break
      case 'Enter':
        if (col < STAGE_COL) setEditing({ row, col })
        else openPicker(row, stage, e.currentTarget)
        break
      case ' ':
        if (col >= STAGE_COL) openPicker(row, stage, e.currentTarget)
        break
      case 'Delete':
        void deleteWord(r.word)
        break
      case 'r':
      case 'R':
        if (hasModifier(e)) handled = false
        else speak(r.word.text)
        break
      case 's':
      case 'S':
        if (hasModifier(e)) handled = false
        else void setStarred(r.word, !r.word.starred)
        break
      default: {
        const n = Number(e.key)
        if (col >= STAGE_COL && isGrade(n) && !hasModifier(e)) void grade(row, stage, n)
        else handled = false
      }
    }
    if (handled) e.preventDefault()
  }

  const cellProps = (row: number, col: number, label: string): Record<string, unknown> => ({
    role: 'gridcell',
    tabIndex: active.row === row && active.col === col ? 0 : -1,
    'aria-label': label,
    ref: (el: HTMLElement | null) => {
      const key = `${row}:${col}`
      if (el) cellEls.current.set(key, el)
      else cellEls.current.delete(key)
    },
    onFocus: () => {
      if (focus.row !== row || focus.col !== col) setFocus({ row, col })
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => onCellKeyDown(e, row, col)
  })

  return (
    <>
      <table className="word-grid" role="grid" aria-label={pageLabel} aria-rowcount={rows.length}>
        <colgroup>
          <col className="col-num" />
          <col className="col-word" />
          <col className="col-meaning" />
          {STAGE_LABELS.map((l) => (
            <col key={l} className="col-stage" />
          ))}
          <col className="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="th-num">
              #
            </th>
            <th scope="col">单词</th>
            <th scope="col">词义</th>
            {STAGE_LABELS.map((label, i) => {
              const isToday = dates?.[i] === today
              return (
                <th
                  key={label}
                  scope="col"
                  className={cx('th-stage', i === 0 && 'is-first', isToday && 'is-today')}
                >
                  <span className="stage-label">{label}</span>
                  {dates && (
                    <span className={cx('stage-date', 'num', isToday && 'is-today')}>
                      {isToday ? '今天' : formatMonthDot(dates[i])}
                    </span>
                  )}
                </th>
              )
            })}
            <th scope="col" className="th-actions">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody ref={tbody}>
          {rows.map((r, row) => (
            <tr
              key={r.word.id}
              className={cx(
                'grid-row',
                r.word.starred && 'is-starred',
                swept?.wordId === r.word.id && 'is-just-graded',
                newRowId === r.word.id && 'is-new-row'
              )}
            >
              <td className="cell-num">{row + 1}</td>

              <td
                className="cell-word"
                {...cellProps(row, 0, `单词 ${r.word.text}`)}
                onDoubleClick={() => setEditing({ row, col: 0 })}
              >
                {editing?.row === row && editing.col === 0 ? (
                  <EditInput
                    initial={r.word.text}
                    label="编辑单词"
                    onCommit={(v) => void commitEdit(row, 0, v)}
                    onCancel={() => {
                      setEditing(null)
                      focusCell(row, 0)
                    }}
                  />
                ) : (
                  <div className="word-with-audio">
                    <span className="word-text">
                      {r.word.text}
                      {r.word.starred && (
                        <Star size={12} className="star-badge" aria-label="难词" />
                      )}
                    </span>
                    <WordAudioButton word={r.word.text} shortcut="R" tabIndex={-1} />
                  </div>
                )}
              </td>

              <td
                className="cell-meaning"
                {...cellProps(row, 1, `词义 ${meaningText(r.word) || '空'}`)}
                onDoubleClick={() => setEditing({ row, col: 1 })}
              >
                {editing?.row === row && editing.col === 1 ? (
                  <EditInput
                    initial={meaningText(r.word)}
                    label="编辑词义"
                    onCommit={(v) => void commitEdit(row, 1, v)}
                    onCancel={() => {
                      setEditing(null)
                      focusCell(row, 1)
                    }}
                  />
                ) : (
                  <span className="meaning-text">
                    <MeaningText pos={r.word.pos} meaning={r.word.meaning} />
                  </span>
                )}
              </td>

              {r.cells.map((cell, stage) => {
                const gradable = isGradable(cell)
                const highlight =
                  cell.kind === 'due'
                    ? cell.overdue
                      ? 'is-overdue'
                      : 'is-due'
                    : cell.kind === 'pending' && cell.due
                      ? 'is-due'
                      : null
                return (
                  <td
                    key={stage}
                    data-mark-key={`${r.word.id}:${stage}`}
                    className={cx(
                      'cell-stage',
                      stage === 0 && 'is-first',
                      highlight,
                      gradable && 'is-gradable',
                      swept?.wordId === r.word.id && swept.stage === stage && 'is-just-graded'
                    )}
                    {...cellProps(
                      row,
                      STAGE_COL + stage,
                      `${STAGE_LABELS[stage]}：${describeCell(cell)}`
                    )}
                    onClick={(e: MouseEvent<HTMLElement>) =>
                      openPicker(row, stage, e.currentTarget)
                    }
                  >
                    <StageMark
                      cell={cell}
                      swept={swept?.wordId === r.word.id && swept.stage === stage}
                    />
                  </td>
                )
              })}

              <td className="cell-actions">
                <div className="row-actions">
                  <IconButton
                    icon={Star}
                    label={r.word.starred ? '取消难词' : '标记难词'}
                    shortcut="S"
                    size="sm"
                    iconSize={16}
                    tabIndex={-1}
                    active={r.word.starred}
                    className="star-toggle"
                    onClick={() => void setStarred(r.word, !r.word.starred)}
                  />
                  <IconButton
                    icon={Trash2}
                    label="删除"
                    shortcut="Delete"
                    size="sm"
                    iconSize={16}
                    tabIndex={-1}
                    onClick={() => void deleteWord(r.word)}
                  />
                </div>
              </td>
            </tr>
          ))}
          {entryRow}
        </tbody>
      </table>

      <Popover
        anchor={picker?.anchor ?? null}
        open={picker !== null}
        onClose={() => setPicker(null)}
        placement="bottom"
        label="评分"
      >
        {picker && <GradePicker onPick={(g) => void grade(picker.row, picker.stage, g)} />}
      </Popover>
    </>
  )
}
