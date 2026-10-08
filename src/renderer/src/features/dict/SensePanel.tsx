/**
 * 义项面板：从词典（ECDICT）点选词义。录入行和词库详情共用。
 * 顶部：音标、考试标签、牛津核心词、屈折形式提示（改录原形）；主体：按词性分组、可切换选中的义项，前 9 个标 1–9。
 * 键盘（焦点在面板里时）：方向键移动；空格或 1–9 切换；Enter 写入；Esc 回去；直接打字回到输入框。
 * 面板不抢焦点：打开后焦点仍在调用方（词义框），由调用方决定何时进入面板（focusFirst）。
 */
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions
} from '@floating-ui/react'
import {
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type Ref
} from 'react'
import type { DictLookupResult } from '@shared/api'
import { describeLemma, flatSenses, type DictEntry } from '@shared/domain/dict'
import { Button } from '../../components/ui'
import { WordAudioButton } from '../../components/WordAudioButton'
import { useFloatingTransition } from '../../motion/useFloatingTransition'
import { cx } from '../../lib/cx'
import './dict.css'

export interface SensePanelApi {
  /** 焦点移到面板里（上次的位置或第一个义项）。没有义项时返回 false。 */
  focusFirst: () => boolean
}

const NUMBERED = 9

// 义项与朗读按钮出现时会改变面板尺寸；下一帧定位，避免在尺寸观察回调中再次改布局。
const updateSensePosition: typeof autoUpdate = (reference, floating, update) => {
  let frame = 0
  const stop = autoUpdate(reference, floating, () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(update)
  })
  return () => {
    cancelAnimationFrame(frame)
    stop()
  }
}

export function SensePanel({
  anchor,
  open,
  word,
  result,
  selected,
  manual = false,
  preview,
  onToggle,
  onRegenerate,
  onUseLemma,
  onCommit,
  onBack,
  onClose,
  apiRef
}: {
  anchor: Element | null
  open: boolean
  /** 查询的词（显示“went 是 go 的过去式”用） */
  word: string
  result: DictLookupResult | null
  selected: ReadonlySet<string>
  /** 词义框被手动编辑过：停止自动同步 */
  manual?: boolean
  /** 没有词义框的场合（词库详情）显示将要写入的文字 */
  preview?: string
  onToggle: (key: string) => void
  onRegenerate?: () => void
  onUseLemma?: (lemma: string) => void
  onCommit: () => void
  /** Esc、在第一行按 ↑、直接打字：回到输入框（或关闭） */
  onBack: () => void
  /** 点击面板外部 */
  onClose: () => void
  apiRef?: Ref<SensePanelApi>
}): ReactElement | null {
  const {
    refs: { setFloating },
    floatingStyles,
    context
  } = useFloating({
    open,
    onOpenChange: (next) => {
      if (!next) onClose()
    },
    elements: { reference: anchor },
    placement: 'bottom-start',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: updateSensePosition
  })
  // Esc 由面板和输入框自己处理（先回到词义框，再关闭）；点击外部关闭
  const dismiss = useDismiss(context, { escapeKey: false })
  const { getFloatingProps } = useInteractions([dismiss])
  const { isMounted, styles } = useFloatingTransition(context)

  const entry: DictEntry | null = result?.status === 'found' ? result.entry : null
  const flat = entry ? flatSenses(entry.groups) : []
  const [active, setActive] = useState(0)
  const chips = useRef<(HTMLElement | null)[]>([])
  const current = Math.min(active, Math.max(0, flat.length - 1))

  const focusAt = (i: number): void => {
    const next = Math.max(0, Math.min(i, flat.length - 1))
    setActive(next)
    chips.current[next]?.focus()
  }

  useImperativeHandle(apiRef, () => ({
    focusFirst: () => {
      if (flat.length === 0) return false
      focusAt(current)
      return true
    }
  }))

  if (!isMounted || !anchor) return null

  /** 同组内的位置 → 上 / 下一组的同一位置（超出时取最后一个） */
  const moveGroup = (delta: number): void => {
    if (!entry) return
    const here = flat[current]
    const gi = entry.groups.indexOf(here.group)
    const target = entry.groups[gi + delta]
    if (!target) {
      if (delta < 0) onBack()
      return
    }
    const offsetInGroup = flat.filter((f, i) => f.group === here.group && i < current).length
    const start = flat.findIndex((f) => f.group === target)
    focusAt(start + Math.min(offsetInGroup, target.senses.length - 1))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const onButton = e.target instanceof HTMLButtonElement
    if (e.ctrlKey || e.altKey || e.metaKey) return
    const n = Number(e.key)
    let handled = true
    if (e.key === 'ArrowRight') focusAt(current + 1)
    else if (e.key === 'ArrowLeft') focusAt(current - 1)
    else if (e.key === 'ArrowDown') moveGroup(1)
    else if (e.key === 'ArrowUp') moveGroup(-1)
    else if (e.key === ' ' && !onButton && flat[current]) onToggle(flat[current].key)
    else if (Number.isInteger(n) && n >= 1 && n <= Math.min(NUMBERED, flat.length))
      onToggle(flat[n - 1].key)
    else if (e.key === 'Enter' && !onButton) onCommit()
    else if (e.key === 'Escape') onBack()
    else if (e.key.length === 1 && e.key !== ' ' && !/[0-9]/.test(e.key)) {
      // 直接打字：焦点回到输入框，这个字符也跟着输入进去
      handled = false
      onBack()
    } else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  let body: ReactElement
  if (!result || result.status === 'loading') {
    body = <p className="sense-note">词典加载中…</p>
  } else if (result.status === 'unavailable') {
    body = <p className="sense-note">词典暂时不可用，请直接输入词义</p>
  } else if (result.status === 'notFound' || !entry || flat.length === 0) {
    body = <p className="sense-note">词典里没有这个词，请直接输入词义</p>
  } else {
    let index = 0
    body = (
      <>
        <header className="sense-head">
          <span className="sense-word">{entry.word}</span>
          <WordAudioButton word={entry.word} />
          {entry.phonetic && <span className="sense-phonetic">/{entry.phonetic}/</span>}
          <span className="sense-tags">
            {entry.tags.map((t) => (
              <span key={t} className="sense-tag">
                {t}
              </span>
            ))}
            {entry.oxford && <span className="sense-tag">牛津核心词</span>}
          </span>
        </header>
        {entry.lemma && (
          <div className="sense-lemma">
            <span>{describeLemma(word, entry.lemma)}</span>
            <WordAudioButton word={entry.lemma.word} />
            {onUseLemma && (
              <Button size="sm" variant="secondary" onClick={() => onUseLemma(entry.lemma!.word)}>
                改录 {entry.lemma.word}
              </Button>
            )}
          </div>
        )}
        <div className="sense-groups" role="group" aria-label="词典义项">
          {entry.groups.map((g) => (
            <div key={g.index} className="sense-group">
              <span className={cx('sense-label', !g.pos && 'is-domain')}>{g.pos || g.domain}</span>
              <div className="sense-chips">
                {g.senses.map((s, si) => {
                  const i = index++
                  const key = flat[i].key
                  const on = selected.has(key)
                  return (
                    <span
                      key={si}
                      ref={(el) => {
                        chips.current[i] = el
                      }}
                      role="checkbox"
                      aria-checked={on}
                      tabIndex={i === current ? 0 : -1}
                      className={cx('sense-chip', on && 'is-selected')}
                      onFocus={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onToggle(key)}
                    >
                      {i < NUMBERED && <span className="sense-num">{i + 1}</span>}
                      {s.domain && <span className="sense-domain">[{s.domain}]</span>}
                      {s.text}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        {manual ? (
          <footer className="sense-foot">
            <span className="sense-manual">已手动编辑</span>
            {onRegenerate && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onRegenerate}
                disabled={selected.size === 0}
              >
                按所选重新生成
              </Button>
            )}
          </footer>
        ) : preview !== undefined ? (
          <footer className="sense-foot">
            <span className="sense-preview">{preview || '还没有选择义项'}</span>
          </footer>
        ) : null}
        <p className="sense-keys">
          {preview === undefined && (
            <>
              <kbd>↓</kbd> 进入 ·{' '}
            </>
          )}
          <kbd>1</kbd>–<kbd>9</kbd> 切换 · <kbd>Enter</kbd> 写入 · <kbd>Esc</kbd>{' '}
          {preview === undefined ? '返回' : '关闭'}
        </p>
      </>
    )
  }

  return (
    <FloatingPortal>
      <div ref={setFloating} style={floatingStyles} className="floating" {...getFloatingProps()}>
        <div
          className="popover sense-panel"
          data-closing={open ? undefined : ''}
          data-toast-avoid=""
          role="dialog"
          aria-label="词典义项"
          style={styles}
          onKeyDown={onKeyDown}
        >
          {body}
          {!entry && <WordAudioButton word={word} />}
        </div>
      </div>
    </FloatingPortal>
  )
}
