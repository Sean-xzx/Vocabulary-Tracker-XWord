/**
 * 网格最后一行：录入新词。
 * 单词框 Enter → 查词典，焦点到词义框，词义框下方弹出义项面板（见 features/dict/SensePanel）。
 * 点选义项实时生成词义文字；手动编辑词义框后停止同步，可“按所选重新生成”。
 * 词义框：↓ 进入面板，Enter 写入，Esc 关闭面板。写入后焦点回到单词框。
 * 查重：已有同样的词（不区分大小写，不算已删除的）时提示“已在第 N 页”，再按一次 Enter 才强制写入。
 * 没有词义：提示“还没有词义”，再按一次 Enter 才写入。
 */
import {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type Ref
} from 'react'
import type { NewWordInput } from '@shared/api'
import { composeMeaning, type DictEntry } from '@shared/domain/dict'
import { normalizeWord } from '@shared/domain/parse'
import { WordAudioButton } from '../../components/WordAudioButton'
import { SensePanel, type SensePanelApi } from '../dict/SensePanel'
import { useDictLookup } from '../dict/useDictLookup'

export interface EntryApi {
  focus: () => void
}

/** 义项面板大约需要的高度（px） */
const PANEL_ROOM = 260

/** 义项面板在词义框下方弹出：下方空间不够时先把页面往上滚；已经滚不动时由面板自动翻到上方。 */
function makeRoomBelow(el: HTMLElement | null): void {
  const scroller = el?.closest('.main')
  if (!el || !scroller) return
  const room = scroller.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom
  if (room < PANEL_ROOM) scroller.scrollTop += PANEL_ROOM - room
}

export function EntryRow({
  rowLabel,
  existing,
  onSubmit,
  onExitTop,
  autoFocus,
  apiRef
}: {
  rowLabel: string
  /** 规范化后的单词 → 所在页码 */
  existing: Map<string, number>
  onSubmit: (input: NewWordInput) => Promise<boolean>
  onExitTop: () => void
  autoFocus: boolean
  apiRef?: Ref<EntryApi>
}): ReactElement {
  const [text, setText] = useState('')
  const [meaning, setMeaning] = useState('')
  const [confirmDup, setConfirmDup] = useState(false)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [manual, setManual] = useState(false)
  const wordInput = useRef<HTMLInputElement>(null)
  const meaningInput = useRef<HTMLInputElement>(null)
  // 面板的定位锚点：用 state 保存元素，渲染时不读 ref
  const [meaningEl, setMeaningEl] = useState<HTMLInputElement | null>(null)
  const meaningRef = useCallback((el: HTMLInputElement | null) => {
    meaningInput.current = el
    setMeaningEl(el)
  }, [])
  const panelApi = useRef<SensePanelApi>(null)
  const dict = useDictLookup()

  useImperativeHandle(apiRef, () => ({ focus: () => wordInput.current?.focus() }))

  const dupPage = text.trim() ? existing.get(normalizeWord(text)) : undefined
  const entry: DictEntry | null =
    dict.result?.status === 'found' && dict.query === text.trim() ? dict.result.entry : null
  const fromDict = entry !== null && selected.size > 0 && !manual

  /** 换了词：丢掉上一个词的查询、选择和自动生成的词义 */
  const resetLookup = (): void => {
    if (dict.query === null && selected.size === 0) return
    dict.clear()
    // 只清掉由所选义项自动生成的词义，手动写的保留
    if (selected.size > 0 && !manual) setMeaning('')
    setSelected(new Set())
    setManual(false)
    setPanelOpen(false)
  }

  const reset = (): void => {
    setText('')
    setMeaning('')
    setConfirmDup(false)
    setConfirmEmpty(false)
    setSelected(new Set())
    setManual(false)
    setPanelOpen(false)
    dict.clear()
  }

  const lookup = (word: string): void => {
    makeRoomBelow(meaningInput.current)
    setPanelOpen(true)
    if (dict.query === word) return
    setSelected(new Set())
    setManual(false)
    void dict.run(word)
  }

  const submit = async (): Promise<void> => {
    if (busy) return
    const word = text.trim()
    if (word === '') {
      wordInput.current?.focus()
      return
    }
    if (dupPage !== undefined && !confirmDup) {
      setConfirmDup(true)
      return
    }
    if (meaning.trim() === '' && selected.size === 0 && !confirmEmpty) {
      setConfirmEmpty(true)
      return
    }
    const input: NewWordInput = { text: word, meaning: meaning.trim() }
    if (fromDict && entry) {
      // 从词典选出的词义：pos 存全部词性，meaning 存带词性全文，不再自动拆分
      const composed = composeMeaning(entry.groups, selected)
      input.meaning = composed.meaning
      input.pos = composed.pos
    }
    if (entry?.phonetic) input.phonetic = entry.phonetic
    setBusy(true)
    const ok = await onSubmit(input)
    setBusy(false)
    if (ok) {
      reset()
      wordInput.current?.focus()
    }
  }

  const toggle = (key: string): void => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelected(next)
    setConfirmEmpty(false)
    if (!manual && entry) setMeaning(composeMeaning(entry.groups, next).meaning)
  }

  const common = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      onExitTop()
      return true
    }
    if (e.key === 'Escape' && (text || meaning)) {
      e.preventDefault()
      reset()
      wordInput.current?.focus()
      return true
    }
    return false
  }

  const hint =
    dupPage !== undefined || confirmEmpty ? (
      <tr className="entry-hint-row" aria-live="polite">
        <td />
        <td colSpan={9} className="entry-hint">
          {dupPage !== undefined && (
            <>
              已在第 {dupPage} 页
              {confirmDup && <span className="entry-hint-confirm"> · 再按一次 Enter 仍然写入</span>}
            </>
          )}
          {confirmEmpty && (
            <span className="entry-hint-confirm">
              {dupPage !== undefined && ' · '}还没有词义，再按一次 Enter 仍然写入
            </span>
          )}
        </td>
      </tr>
    ) : null

  return (
    <>
      <tr className="entry-row" data-toast-avoid="">
        <td className="cell-num entry-num">{rowLabel}</td>
        <td className="entry-cell">
          <div className="word-with-audio">
            <input
              ref={wordInput}
              className="entry-input entry-word"
              aria-label="新单词"
              placeholder="写一个单词"
              spellCheck={false}
              autoFocus={autoFocus}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setConfirmDup(false)
                setConfirmEmpty(false)
                resetLookup()
              }}
              onKeyDown={(e) => {
                if (common(e)) return
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const word = text.trim()
                  if (!word) return
                  lookup(word)
                  meaningInput.current?.focus()
                }
              }}
            />
            <WordAudioButton word={text} tabIndex={-1} />
          </div>
        </td>
        <td className="entry-cell" colSpan={8}>
          <input
            ref={meaningRef}
            className="entry-input"
            aria-label="词义"
            placeholder="词义，按 Enter 写入"
            spellCheck={false}
            value={meaning}
            onChange={(e) => {
              setMeaning(e.target.value)
              setConfirmEmpty(false)
              if (entry) setManual(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && panelOpen) {
                e.preventDefault()
                panelApi.current?.focusFirst()
                return
              }
              if (e.key === 'Escape' && panelOpen) {
                e.preventDefault()
                setPanelOpen(false)
                return
              }
              if (common(e)) return
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
          />
        </td>
      </tr>
      {hint}
      <SensePanel
        anchor={meaningEl}
        open={panelOpen}
        word={text.trim()}
        result={dict.query === text.trim() ? dict.result : null}
        selected={selected}
        manual={manual && selected.size > 0}
        apiRef={panelApi}
        onToggle={toggle}
        onRegenerate={() => {
          if (!entry) return
          setManual(false)
          setMeaning(composeMeaning(entry.groups, selected).meaning)
        }}
        onUseLemma={(lemma) => {
          setText(lemma)
          setConfirmDup(false)
          setConfirmEmpty(false)
          if (selected.size > 0 && !manual) setMeaning('')
          lookup(lemma)
          meaningInput.current?.focus()
        }}
        onCommit={() => void submit()}
        onBack={() => meaningInput.current?.focus()}
        onClose={() => setPanelOpen(false)}
      />
    </>
  )
}
