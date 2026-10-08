/**
 * 查词卡片（overlay 层的 Popover）：单词、音标、原形提示（went → go）、按词性分组的前几条义项、考试标签；
 * 这个词在单词本里时，顶部显示它的状态和下次复习日期。
 * 底部三个按钮：「收进单词本」（A）「我认识」「发音」（系统 TTS）。
 * 收词：已经在单词本里 → 不新增，只追加一条出处；否则打开义项面板，选好义项后按手动录入的规则写进今天的页。
 */
import { Check } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { CollectRequest, DictLookupResult } from '@shared/api'
import { formatMonthDay } from '@shared/domain/dates'
import { composeMeaning, describeLemma, type DictEntry } from '@shared/domain/dict'
import { STAGE_LABELS, getSchedule } from '@shared/domain/scheduler'
import { lemmaFor, normalizeWord } from '@shared/domain/tokenize'
import { checksByWord } from '@shared/snapshot'
import { Button, Popover } from '../../components/ui'
import { WordAudioButton } from '../../components/WordAudioButton'
import { lemmaOf } from '../../lib/lemmas'
import { useApp } from '../../store/app'
import { toast, toastError } from '../../store/toast'
import { SensePanel, type SensePanelApi } from '../dict/SensePanel'
import { lookupOnce } from '../dict/useDictLookup'

export interface LookupTarget {
  word: string
  chapter: number
  block: number
  /** 单词在块里的起止偏移 */
  start: number
  end: number
  sentence: string
  anchor: HTMLElement
}

const SHOW_GROUPS = 4
const SHOW_SENSES = 4

const STATUS_LABELS = {
  new: '新词，还没学',
  learning: '学习中',
  mastered: '已掌握',
  lapsed: '需要重学'
} as const

async function lookup(word: string): Promise<DictLookupResult> {
  for (let i = 0; i < 40; i++) {
    const r = await lookupOnce(word)
    if (r.status !== 'loading') return r
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return { status: 'unavailable' }
}

export function LookupCard({
  target,
  bookId,
  wordId,
  onClose,
  onCollected,
  collectRef,
  autoCollect = false
}: {
  target: LookupTarget
  bookId: string
  /** 打开后直接进入收词（选区里按 A） */
  autoCollect?: boolean
  /** 单词本里匹配到的词（含变形）；没有为 null */
  wordId: string | null
  onClose: () => void
  /** 收词成功（新词或追加出处）后调用，用来播放下划线动效 */
  onCollected: (target: LookupTarget) => void
  /** 让阅读页的 A 键触发收词 */
  collectRef?: { current: (() => void) | null }
}): ReactElement {
  const snapshot = useApp((s) => s.snapshot)
  const [result, setResult] = useState<DictLookupResult | null>(null)
  const [mode, setMode] = useState<'card' | 'senses'>('card')
  const [lemmaResult, setLemmaResult] = useState<DictLookupResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const panelApi = useRef<SensePanelApi>(null)
  const busy = useRef(false)

  // 变化形式（went）显示原形（go）的义项：词条自己的释义往往只有“go的过去式”
  const [baseEntry, setBaseEntry] = useState<DictEntry | null>(null)
  useEffect(() => {
    let alive = true
    void lookup(target.word).then(async (r) => {
      if (!alive) return
      setResult(r)
      const lemma = r.status === 'found' ? r.entry.lemma?.word : undefined
      if (!lemma) return
      const base = await lookup(lemma)
      if (alive && base.status === 'found') setBaseEntry(base.entry)
    })
    return () => {
      alive = false
    }
  }, [target.word])

  const entry: DictEntry | null = result?.status === 'found' ? result.entry : null
  /** 收词时写进单词本的形式：有原形用原形（went → go），否则用词典词头或小写 */
  const collectText = entry?.lemma?.word ?? entry?.word ?? normalizeWord(target.word)

  const inBook = useMemo(() => {
    if (!snapshot || !wordId) return null
    const word = snapshot.words.find((w) => w.id === wordId)
    if (!word) return null
    const page = snapshot.pages.find((p) => p.id === word.pageId)?.number ?? 0
    let next = ''
    if (word.status === 'learning') {
      const s = getSchedule(word, checksByWord(snapshot.checks).get(word.id) ?? [], snapshot.today)
      if (s.dueOn && s.nextStage !== null)
        next = `下次复习 ${s.dueOn <= snapshot.today ? '今天' : formatMonthDay(s.dueOn)}（${STAGE_LABELS[s.nextStage]}）`
    }
    return { word, page, next }
  }, [snapshot, wordId])

  const source = (): CollectRequest['source'] => ({
    bookId,
    chapter: target.chapter,
    block: target.block,
    offset: target.start,
    sentence: target.sentence
  })

  /** 写入：选好的义项（词典里没有这个词时不带词义），按手动录入的规则写进今天的页 */
  const commit = async (lemmaEntry: DictEntry | null): Promise<void> => {
    if (busy.current) return
    if (lemmaEntry && selected.size === 0) {
      toast('先选一个义项（按 1–9 或点选）')
      return
    }
    busy.current = true
    const composed = lemmaEntry ? composeMeaning(lemmaEntry.groups, selected) : null
    try {
      const res = await window.xword.collectWord({
        word: {
          text: lemmaEntry?.word ?? collectText,
          meaning: composed?.meaning ?? '',
          ...(composed ? { pos: composed.pos } : {}),
          phonetic: lemmaEntry?.phonetic ?? ''
        },
        source: source()
      })
      await useApp.getState().refresh()
      toast(
        res.created
          ? `已收进单词本第 ${res.pageNumber} 页`
          : `已在第 ${res.pageNumber} 页，已添加出处`
      )
      onClose()
      onCollected(target)
    } catch (e) {
      toastError(e)
    } finally {
      busy.current = false
    }
  }

  const collect = async (): Promise<void> => {
    if (busy.current) return
    if (inBook) {
      busy.current = true
      try {
        const res = await window.xword.collectWord({
          word: { text: inBook.word.text, meaning: inBook.word.meaning },
          source: source()
        })
        await useApp.getState().refresh()
        toast(`已在第 ${res.pageNumber} 页，已添加出处`)
        onClose()
        onCollected(target)
      } catch (e) {
        toastError(e)
      } finally {
        busy.current = false
      }
      return
    }
    const r = collectText === entry?.word && result ? result : await lookup(collectText)
    // 词典里查不到：像手动录入一样，不带词义直接收进去
    if (r.status !== 'found') {
      await commit(null)
      return
    }
    setSelected(new Set())
    setLemmaResult(r)
    setMode('senses')
  }

  useEffect(() => {
    if (!collectRef) return
    collectRef.current = () => void collect()
    return () => {
      collectRef.current = null
    }
  })

  // 选区里按 A：查到词典结果后直接进入收词
  const autoDone = useRef(false)
  useEffect(() => {
    if (!autoCollect || autoDone.current || !result || result.status === 'loading') return
    autoDone.current = true
    void collect()
  })

  const lemmaEntry = lemmaResult?.status === 'found' ? lemmaResult.entry : null
  useEffect(() => {
    // 查词卡片关闭时会把焦点还回去；下一帧再把焦点放进义项面板
    if (mode !== 'senses' || !lemmaEntry) return
    const frame = requestAnimationFrame(() => panelApi.current?.focusFirst())
    return () => cancelAnimationFrame(frame)
  }, [mode, lemmaEntry])

  const markKnown = async (): Promise<void> => {
    const lemma = lemmaFor(target.word, lemmaOf)
    try {
      await window.xword.addKnown(lemma)
      await useApp.getState().refresh()
      onClose()
      toast(`已标为熟词：${lemma}`, {
        label: '撤销',
        run: async () => {
          try {
            await window.xword.removeKnown(lemma)
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

  if (mode === 'senses') {
    return (
      <SensePanel
        anchor={target.anchor}
        open
        word={target.word}
        result={lemmaResult ?? { status: 'loading' }}
        selected={selected}
        preview={lemmaEntry ? composeMeaning(lemmaEntry.groups, selected).meaning : ''}
        apiRef={panelApi}
        onToggle={(key) => {
          const next = new Set(selected)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          setSelected(next)
        }}
        onCommit={() => void commit(lemmaEntry)}
        onBack={onClose}
        onClose={onClose}
      />
    )
  }

  let body: ReactElement
  if (!result || result.status === 'loading') body = <p className="lookup-note">词典加载中…</p>
  else if (result.status === 'unavailable') body = <p className="lookup-note">词典暂时不可用</p>
  else if (!entry) body = <p className="lookup-note">词典里没有这个词</p>
  else
    body = (
      <>
        {entry.lemma && <p className="lookup-lemma">{describeLemma(target.word, entry.lemma)}</p>}
        <div className="lookup-groups">
          {(baseEntry ?? entry).groups.slice(0, SHOW_GROUPS).map((g) => (
            <p key={g.index} className="lookup-group">
              <span className="pos">{g.pos || (g.domain ? `[${g.domain}]` : '')}</span>
              {g.senses
                .slice(0, SHOW_SENSES)
                .map((s) => (s.domain ? `[${s.domain}] ${s.text}` : s.text))
                .join('；')}
            </p>
          ))}
        </div>
      </>
    )

  return (
    <Popover
      anchor={target.anchor}
      open
      onClose={onClose}
      placement="bottom-start"
      label="查词"
      className="lookup-card"
    >
      <div
        onKeyDown={(e) => {
          if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault()
            void collect()
          }
        }}
      >
        {inBook && (
          <p className="lookup-status">
            <Check size={14} aria-hidden />
            已在单词本 · 第 {inBook.page} 页 · {STATUS_LABELS[inBook.word.status]}
            {inBook.next && ` · ${inBook.next}`}
          </p>
        )}
        <header className="lookup-head">
          <span className="lookup-word">{entry?.word ?? target.word}</span>
          {entry?.phonetic && <span className="lookup-phonetic">/{entry.phonetic}/</span>}
        </header>
        {entry && (entry.tags.length > 0 || entry.oxford) && (
          <div className="lookup-tags">
            {entry.tags.map((t) => (
              <span key={t} className="sense-tag">
                {t}
              </span>
            ))}
            {entry.oxford && <span className="sense-tag">牛津核心词</span>}
          </div>
        )}
        {body}
        <footer className="lookup-actions">
          <Button variant="primary" size="sm" onClick={() => void collect()}>
            收进单词本 <kbd>A</kbd>
          </Button>
          <Button size="sm" onClick={() => void markKnown()}>
            我认识
          </Button>
          <WordAudioButton word={target.word} />
        </footer>
      </div>
    </Popover>
  )
}
