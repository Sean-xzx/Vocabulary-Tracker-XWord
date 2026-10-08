import { Volume2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { cx } from '../lib/cx'
import { speak } from '../lib/speech'
import { IconButton } from './ui'

/** 不把点击、Enter 和空格传给单词行/评分器，表格仍保留一个 Tab 入口。 */
export function WordAudioButton({
  word,
  shortcut,
  tabIndex,
  className
}: {
  word: string
  shortcut?: string
  tabIndex?: number
  className?: string
}): ReactElement {
  return (
    <IconButton
      icon={Volume2}
      label={`朗读 ${word.trim() || '单词'}`}
      shortcut={shortcut}
      size="sm"
      iconSize={16}
      className={cx('word-audio', className)}
      tabIndex={tabIndex}
      disabled={!word.trim()}
      onMouseDown={(e) => {
        // 不触发词库选行或输入框的失焦保存。
        e.preventDefault()
        e.stopPropagation()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
      }}
      onClick={(e) => {
        e.stopPropagation()
        speak(word)
      }}
    />
  )
}
