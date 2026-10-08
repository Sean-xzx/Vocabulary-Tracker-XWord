/**
 * 点已有的高亮：换颜色、写笔记（失焦或 Ctrl+Enter 保存）、删除（软删除，可撤销）；高亮里的单词还可以查词。
 */
import { BookText, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { Highlight, HighlightColor } from '@shared/api'
import { Button, Popover } from '../../components/ui'
import { HIGHLIGHT_NAMES } from './labels'
import { Swatches } from './SelectionToolbar'

export function HighlightMenu({
  anchor,
  highlight,
  focusNote,
  onColor,
  onNote,
  onDelete,
  onLookup,
  onClose
}: {
  anchor: Element
  highlight: Highlight
  focusNote: boolean
  onColor: (c: HighlightColor) => void
  onNote: (note: string) => void
  onDelete: () => void
  /** 点在单词上时可以查词 */
  onLookup: (() => void) | null
  onClose: () => void
}): ReactElement {
  const [note, setNote] = useState(highlight.note)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (focusNote) area.current?.focus()
  }, [focusNote])
  const save = (): void => {
    if (note !== highlight.note) onNote(note)
  }
  return (
    <Popover
      anchor={anchor}
      open
      onClose={() => (save(), onClose())}
      placement="bottom-start"
      label="高亮"
      className="highlight-menu"
    >
      <div className="highlight-menu-row">
        <Swatches current={highlight.color} onPick={onColor} />
        <span className="highlight-menu-name">{HIGHLIGHT_NAMES[highlight.color]}</span>
      </div>
      <textarea
        ref={area}
        className="text-input highlight-note"
        aria-label="笔记"
        placeholder="写点笔记（Ctrl+Enter 保存）"
        rows={3}
        maxLength={5000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault()
            save()
            onClose()
          }
        }}
      />
      <div className="highlight-menu-actions">
        {onLookup && (
          <Button size="sm" variant="ghost" icon={BookText} onClick={onLookup}>
            查词
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={Trash2} onClick={onDelete}>
          删除高亮
        </Button>
      </div>
    </Popover>
  )
}
