/**
 * 选区工具条：选中文字后浮在选区上方。按钮依次为：翻译（T）、高亮（五种颜色，H 为黄）、笔记、
 * 收进单词本（只在选中单个词时出现，A）、复制。按下按钮不会让选区消失。
 */
import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react'
import { Copy, Languages, NotebookPen, StickyNote } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@shared/api'
import { IconButton, TipLabel, Tooltip } from '../../components/ui'
import { cx } from '../../lib/cx'
import { HIGHLIGHT_NAMES } from './labels'

export function Swatches({
  current,
  onPick
}: {
  current?: HighlightColor
  onPick: (c: HighlightColor) => void
}): ReactElement {
  return (
    <div className="swatches" role="group" aria-label="高亮颜色">
      {HIGHLIGHT_COLORS.map((c) => (
        <Tooltip
          key={c}
          content={
            <TipLabel
              label={`高亮 · ${HIGHLIGHT_NAMES[c]}`}
              shortcut={c === 'yellow' ? 'H' : undefined}
            />
          }
        >
          <button
            type="button"
            className={cx('swatch', `swatch-${c}`, current === c && 'is-current')}
            aria-label={`高亮：${HIGHLIGHT_NAMES[c]}`}
            aria-pressed={current === c}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
          />
        </Tooltip>
      ))}
    </div>
  )
}

export function SelectionToolbar({
  rect,
  singleWord,
  onTranslate,
  onHighlight,
  onNote,
  onCollect,
  onCopy
}: {
  /** 选区的外接矩形（视口坐标） */
  rect: DOMRect
  singleWord: boolean
  onTranslate: () => void
  onHighlight: (c: HighlightColor) => void
  onNote: () => void
  onCollect: () => void
  onCopy: () => void
}): ReactElement {
  // 选区是虚拟参照物：只提供外接矩形
  const reference = useMemo(
    // floating-ui 在运行时支持只有 getBoundingClientRect 的虚拟参照物
    () => ({ getBoundingClientRect: () => rect }) as unknown as Element,
    [rect]
  )
  const {
    refs: { setFloating },
    floatingStyles
  } = useFloating({
    placement: 'top',
    elements: { reference },
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate
  })

  const keep = (e: { preventDefault: () => void }): void => e.preventDefault()
  return (
    <FloatingPortal>
      <div
        ref={setFloating}
        style={floatingStyles}
        className="floating"
        role="toolbar"
        aria-label="选区工具条"
      >
        <div className="selection-toolbar" onMouseDown={keep}>
          <IconButton
            icon={Languages}
            label="翻译"
            shortcut="T"
            size="sm"
            iconSize={16}
            onClick={onTranslate}
          />
          <span className="toolbar-sep" aria-hidden />
          <Swatches onPick={onHighlight} />
          <span className="toolbar-sep" aria-hidden />
          <IconButton icon={StickyNote} label="笔记" size="sm" iconSize={16} onClick={onNote} />
          {singleWord && (
            <IconButton
              icon={NotebookPen}
              label="收进单词本"
              shortcut="A"
              size="sm"
              iconSize={16}
              onClick={onCollect}
            />
          )}
          <IconButton
            icon={Copy}
            label="复制"
            shortcut="Ctrl C"
            size="sm"
            iconSize={16}
            onClick={onCopy}
          />
        </div>
      </div>
    </FloatingPortal>
  )
}
