/**
 * 词库列表：自己实现窗口化渲染（固定行高，只渲染可见的行和上下各几行）。
 * 每行：左边单词（衬线）和一行词义（超出省略），右边状态（难词）和下次复习日期（衬线 M.D）。
 * 选中项由父组件管理；键盘在父组件统一处理（↑↓ / Enter / Delete）。
 */
import { Star } from 'lucide-react'
import { WordAudioButton } from '../../components/WordAudioButton'
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
  type Ref
} from 'react'
import type { Word } from '@shared/api'
import { formatMonthDot } from '@shared/domain/dates'
import { STATUS_LABELS, type LibraryItem } from '@shared/domain/library'
import { MeaningText } from '../../components/MeaningText'
import { cx } from '../../lib/cx'

export const ROW_HEIGHT = 56
/** 列表上方的留白（行绝对定位，留白算进位移里） */
const LIST_PAD = 12
const OVERSCAN = 6

export interface WordListApi {
  /** 让第 index 行完整地出现在可见区域里 */
  reveal: (index: number) => void
}

export function WordList({
  items,
  words,
  selectedId,
  today,
  reflow = false,
  onSelect,
  apiRef
}: {
  items: LibraryItem[]
  today: string
  /** 删除一行后，下方的行平滑上移 */
  reflow?: boolean
  words: Map<string, Word>
  selectedId: string | null
  onSelect: (id: string) => void
  apiRef?: Ref<WordListApi>
}): ReactElement {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    // 下一帧再更新，避免在 ResizeObserver 回调里改布局引起“loop completed”警告
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setHeight(el.clientHeight))
    })
    observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  useImperativeHandle(apiRef, () => ({
    reveal: (index) => {
      const el = scroller.current
      if (!el) return
      const top = index * ROW_HEIGHT + LIST_PAD
      if (top < el.scrollTop) el.scrollTop = top - LIST_PAD
      else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight)
        el.scrollTop = top + ROW_HEIGHT + LIST_PAD - el.clientHeight
    }
  }))

  // 条目变少（筛选、搜索）后滚动位置可能超出范围，按实际范围取可见区
  const maxTop = Math.max(0, items.length * ROW_HEIGHT - height)
  const top = Math.min(scrollTop, maxTop)
  const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(items.length, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN)
  const visible = items.slice(first, last)
  const activeIndex = items.findIndex((i) => i.id === selectedId)

  return (
    <div
      ref={scroller}
      className={cx('word-list', reflow && 'is-reflowing')}
      role="listbox"
      aria-label="单词列表"
      tabIndex={0}
      aria-activedescendant={activeIndex >= 0 ? `lib-${selectedId}` : undefined}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="word-list-inner" style={{ height: items.length * ROW_HEIGHT }}>
        {visible.map((item, i) => {
          const index = first + i
          const word = words.get(item.id)
          const selected = item.id === selectedId
          return (
            <div
              key={item.id}
              id={`lib-${item.id}`}
              role="option"
              aria-selected={selected}
              className={cx('word-row', selected && 'is-selected')}
              style={{ transform: `translateY(${index * ROW_HEIGHT + LIST_PAD}px)` }}
              onMouseDown={(e) => {
                // 点击行时把焦点留在列表上，方向键可以接着用
                e.preventDefault()
                scroller.current?.focus()
              }}
              onClick={() => onSelect(item.id)}
            >
              <div className="word-row-main">
                <span className="word-row-text">{item.text}</span>
                <div className="word-row-meaning">
                  {word && (
                    <MeaningText
                      pos={word.pos}
                      meaning={word.meaning}
                      empty={<span className="muted">没有词义</span>}
                    />
                  )}
                </div>
              </div>
              <WordAudioButton word={item.text} tabIndex={-1} />
              <span className={cx('word-row-status', item.starred && 'is-starred')}>
                {item.starred && <Star size={12} className="star-badge" aria-hidden />}
                {item.starred ? '难词' : STATUS_LABELS[item.status]}
              </span>
              <span
                className={cx('word-row-due', 'num', item.isOverdue && 'is-overdue')}
                title={item.dueOn ? `下次复习 ${item.dueOn}` : undefined}
              >
                {item.dueOn ? (item.dueOn === today ? '今天' : formatMonthDot(item.dueOn)) : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
