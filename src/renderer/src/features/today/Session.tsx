/**
 * 复习中：只显示一张居中的卡片。
 * 空格翻面；1–4 选择评分（可改选），Enter 确认；鼠标点评分按钮直接确认；
 * S 跳过（本次不再出现，保持到期）；Esc 结束；Ctrl+Z 撤销上一次“第一次作答”。
 *
 * 键盘高频操作不等动画、不丢键：
 * - 会话状态放在 ref 里，按键处理函数同步读写，永远拿到最新状态，再触发重新渲染；
 * - 评分立即换到下一张卡，写库（IPC）按顺序排队在后台执行，记录的 id 稍后补齐；
 * - 换卡动画（旧卡左移 8px 淡出 120，新卡自右 8px 淡入 180）可以随时被下一次按键立即结束。
 * 本轮重现只写 review_log。
 */
import { Star } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import type { Word, WordSource } from '@shared/api'
import { findWordInText, tokenize } from '@shared/domain/tokenize'
import {
  answerCard,
  currentCard,
  firstAnsweredCount,
  firstTargetCount,
  isSessionFinished,
  skipCard,
  startSession,
  undoLastFirstAnswer,
  type SessionState
} from '@shared/domain/queue'
import {
  GRADE_LABELS,
  STAGE_LABELS,
  getSchedule,
  isGrade,
  type Grade
} from '@shared/domain/scheduler'
import { checksByWord, pageById } from '@shared/snapshot'
import { XWordMark } from '../../components/brand/XWordMark'
import { MeaningText } from '../../components/MeaningText'
import { Button } from '../../components/ui'
import { WordAudioButton } from '../../components/WordAudioButton'
import { speak, stopSpeaking } from '../../lib/speech'
import { cx } from '../../lib/cx'
import { ensureLemmas, lemmaOf, useLemmaVersion } from '../../lib/lemmas'
import { hasModifier, isOverlayOpen, isTypingTarget } from '../../lib/keys'
import { duration, fadeSlide, finishAnimations } from '../../motion'
import { useApp } from '../../store/app'
import { toast, toastError } from '../../store/toast'
import type { Direction } from './Overview'
import './source.css'

const GRADES: Grade[] = [1, 2, 3, 4]

export interface SessionSummary {
  /** 本轮第一次作答的词数 */
  answered: number
  /** 本轮队列是否全部完成（不是中途结束） */
  completed: boolean
}

interface Model {
  session: SessionState
  history: SessionState[]
  flipped: boolean
  selected: Grade | null
  /** 本轮第一次作答时考的节点（重现时写 review_log 用） */
  gradedStage: Map<string, number>
  ended: boolean
}

function Meaning({ word, large }: { word: Word; large?: boolean }): ReactElement {
  return (
    <p className={cx('card-meaning', large && 'is-large')}>
      <MeaningText
        pos={word.pos}
        meaning={word.meaning}
        empty={<span className="muted">（还没有写词义）</span>}
      />
    </p>
  )
}

/**
 * 出处：句子里的目标词用荧光笔底色标出；下方一行小字“《书名》第 N 章”，点击关闭复习、跳到书里对应的位置。
 */
function SourceLine({
  source,
  word,
  bookTitle,
  style,
  onJump
}: {
  source: WordSource
  word: string
  bookTitle: string | null
  style: CSSProperties
  onJump: () => void
}): ReactElement {
  const version = useLemmaVersion((s) => s.version)
  useEffect(() => {
    void ensureLemmas([word, ...tokenize(source.sentence).map((t) => t.text)])
  }, [word, source.sentence])
  const hit = useMemo(
    () => findWordInText(source.sentence, word, lemmaOf),
    // version：原形缓存变了要重新找
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source.sentence, word, version]
  )
  const s = source.sentence
  return (
    <div className="card-source reveal" style={style}>
      <p className="card-source-sentence">
        {hit ? (
          <>
            {s.slice(0, hit.start)}
            <mark className="card-source-word">{s.slice(hit.start, hit.end)}</mark>
            {s.slice(hit.end)}
          </>
        ) : (
          s
        )}
      </p>
      {bookTitle ? (
        <button
          type="button"
          className="card-source-link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onJump}
        >
          《{bookTitle}》第 <span className="num">{source.chapter + 1}</span> 章
        </button>
      ) : (
        <span className="card-source-link is-gone">这本书已从书架移除</span>
      )}
    </div>
  )
}

/** 翻面后依次上浮淡入：第 i 项延迟 i × --stagger */
function revealStyle(i: number): { animationDelay: string } {
  return { animationDelay: `calc(var(--stagger) * ${i})` }
}

export function Session({
  wordIds,
  direction,
  autoSpeak,
  onAutoSpeak,
  onFinish
}: {
  wordIds: string[]
  direction: Direction
  autoSpeak: boolean
  onAutoSpeak: (enabled: boolean) => void
  onFinish: (summary: SessionSummary) => void
}): ReactElement | null {
  const snapshot = useApp((s) => s.snapshot)
  const refresh = useApp((s) => s.refresh)
  // 会话状态：处理函数同步读写 model.current（永远是最新的），渲染用 view（每次变化后同步一份）
  const [initial] = useState<Model>(() => ({
    session: startSession(wordIds),
    history: [],
    flipped: false,
    selected: null,
    gradedStage: new Map(),
    ended: false
  }))
  const model = useRef<Model>(initial)
  const [view, setView] = useState<Model>(initial)
  /** 写库队列：按作答顺序依次执行 */
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  /** 占位 id → 真正的 review_log id */
  const logIds = useRef(new Map<string, Promise<string>>())
  const nextPlaceholder = useRef(0)
  const cardEl = useRef<HTMLElement>(null)
  const ghostLayer = useRef<HTMLDivElement>(null)
  const shownKey = useRef<number | null>(null)

  const lookup = useMemo(() => {
    if (!snapshot) return null
    // 每个词最近的一条出处（sources 已按时间倒序）
    const sources = new Map<string, WordSource>()
    for (const s of snapshot.sources) if (!sources.has(s.wordId)) sources.set(s.wordId, s)
    return {
      today: snapshot.today,
      words: new Map(snapshot.words.map((w) => [w.id, w])),
      checks: checksByWord(snapshot.checks),
      pages: pageById(snapshot.pages),
      sources,
      books: new Map(snapshot.books.map((b) => [b.id, b]))
    }
  }, [snapshot])
  const lookupRef = useRef(lookup)
  useLayoutEffect(() => {
    lookupRef.current = lookup
  })

  const { session, flipped, selected } = view
  const card = currentCard(session)
  const word = card && lookup ? lookup.words.get(card.wordId) : undefined
  const speechText = word?.text
  const englishVisible = direction === 'en-zh' || flipped
  useEffect(() => {
    if (autoSpeak && englishVisible && speechText) speak(speechText, { automatic: true })
    return stopSpeaking
  }, [autoSpeak, englishVisible, speechText, card?.key])

  const stageOf = (m: Model, l: typeof lookup): number => {
    const c = currentCard(m.session)
    if (!c || !l) return 0
    if (c.isRetry) return m.gradedStage.get(c.wordId) ?? 0
    const w = l.words.get(c.wordId)
    return w ? (getSchedule(w, l.checks.get(w.id) ?? [], l.today).nextStage ?? 0) : 0
  }

  // ---------------------------------------------------------------- 动画

  /** 立即结束换卡动画：移除旧卡，新卡直接显示 */
  const finishTransitions = (): void => {
    const layer = ghostLayer.current
    if (layer) {
      for (const g of Array.from(layer.children)) {
        finishAnimations(g)
        g.remove()
      }
    }
    if (cardEl.current) finishAnimations(cardEl.current)
  }

  /** 旧卡：复制一份留在原处，左移 8px 淡出 */
  const spawnGhost = (): void => {
    const el = cardEl.current
    const layer = ghostLayer.current
    if (!el || !layer) return
    const ghost = el.cloneNode(true) as HTMLElement
    ghost.classList.add('is-ghost')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.removeAttribute('aria-live')
    layer.appendChild(ghost)
    const anim = fadeSlide(ghost, { direction: 'out', x: -8, duration: duration('--dur-micro') })
    if (anim)
      void anim.finished.then(
        () => ghost.remove(),
        () => ghost.remove()
      )
    else ghost.remove()
  }

  // 新卡：自右 8px 淡入 180（在旧卡淡出之后）
  useLayoutEffect(() => {
    const key = card?.key ?? null
    if (key === shownKey.current) return
    const first = shownKey.current === null
    shownKey.current = key
    if (!first && cardEl.current) {
      fadeSlide(cardEl.current, {
        direction: 'in',
        x: 8,
        duration: duration('--dur-base'),
        delay: duration('--dur-micro')
      })
    }
  })

  // ---------------------------------------------------------------- 状态变化（同步）

  const update = (patch: Partial<Model>): void => {
    model.current = { ...model.current, ...patch }
    setView(model.current)
  }

  const finish = (completed: boolean): void => {
    const m = model.current
    stopSpeaking()
    if (m.ended) return
    m.ended = true
    const answered = firstAnsweredCount(m.session)
    // 等排队中的写库全部完成，再进入完成页（完成页的统计以数据库为准）
    void chain.current.finally(() => onFinish({ answered, completed }))
  }

  const advance = (next: SessionState): void => {
    stopSpeaking()
    finishTransitions()
    spawnGhost()
    const m = model.current
    update({ history: [...m.history, m.session], session: next, flipped: false, selected: null })
    if (isSessionFinished(next)) finish(true)
  }

  const confirm = (grade: Grade): void => {
    const m = model.current
    const c = currentCard(m.session)
    if (!c || !m.flipped || m.ended) return
    const l = lookupRef.current
    if (!l?.words.has(c.wordId)) return
    const stage = stageOf(m, l)
    if (!c.isRetry) m.gradedStage.set(c.wordId, stage)
    const placeholder = `pending-${nextPlaceholder.current++}`
    const job = chain.current.then(async () => {
      if (c.isRetry) return window.xword.logRetry({ wordId: c.wordId, stage, grade })
      const res = await window.xword.gradeWord({ wordId: c.wordId, grade })
      return res.logId
    })
    chain.current = job.then(
      () => void refresh(),
      (error: unknown) => toastError(error)
    )
    logIds.current.set(placeholder, job)
    advance(answerCard(m.session, grade, placeholder))
  }

  const skip = (): void => {
    const m = model.current
    if (!currentCard(m.session) || m.ended) return
    advance(skipCard(m.session))
  }

  const undo = (): void => {
    const m = model.current
    if (m.ended) return
    const u = undoLastFirstAnswer(m.history, m.session)
    if (!u) {
      toast('还没有可以撤销的评分')
      return
    }
    finishTransitions()
    spawnGhost()
    update({ session: u.state, history: u.history, flipped: false, selected: null })
    const text = lookupRef.current?.words.get(u.first.wordId)?.text ?? ''
    const resolve = (id: string): Promise<string> => logIds.current.get(id) ?? Promise.resolve(id)
    chain.current = chain.current
      .then(async () => {
        const logId = await resolve(u.first.logId)
        const retryLogIds = await Promise.all(u.laterRetries.map((a) => resolve(a.logId)))
        await window.xword.undoGrade({ logId, retryLogIds })
        void refresh()
        toast(`已撤销 ${text} 的评分`)
      })
      .catch((error: unknown) => toastError(error))
  }

  /** 点出处：关闭复习（等排队中的写库完成），跳到书里对应的位置 */
  const jumpToSource = (s: WordSource): void => {
    const m = model.current
    if (m.ended) return
    m.ended = true
    const len = findWordInText(s.sentence, word?.text ?? '', lemmaOf)?.text.length ?? 1
    void chain.current.finally(() =>
      useApp
        .getState()
        .openBook(
          s.bookId,
          { chapter: s.chapter, block: s.block, offset: s.offset },
          { chapter: s.chapter, block: s.block, offset: s.offset + len }
        )
    )
  }

  const flip = (): void => {
    if (model.current.flipped) return
    finishTransitions()
    update({ flipped: true })
  }

  // 键盘：只注册一次，处理函数通过 ref 读取最新状态
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  const onKey = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target) || isOverlayOpen()) return
    if (e.ctrlKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      undo()
      return
    }
    if (hasModifier(e)) return
    // 焦点在按钮上时，Enter / 空格交给按钮自己
    const onButton =
      e.target instanceof HTMLButtonElement ||
      (e.target instanceof HTMLInputElement && e.target.type === 'checkbox')
    const m = model.current
    if (e.key.toLowerCase() === 'r') {
      const c = currentCard(m.session)
      const w = c && lookupRef.current?.words.get(c.wordId)
      if (w && (direction === 'en-zh' || m.flipped)) {
        e.preventDefault()
        speak(w.text)
      }
      return
    }
    switch (e.key) {
      case ' ':
        if (onButton) return
        e.preventDefault()
        flip()
        return
      case 'Enter':
        if (onButton) return
        e.preventDefault()
        if (!m.flipped) flip()
        else if (m.selected) confirm(m.selected)
        return
      case 's':
      case 'S':
        e.preventDefault()
        skip()
        return
      case 'Escape':
        e.preventDefault()
        finishTransitions()
        finish(false)
        return
      default: {
        const n = Number(e.key)
        if (isGrade(n) && m.flipped) {
          e.preventDefault()
          // 换卡动画进行中按下评分键：立即结束动画
          finishTransitions()
          update({ selected: n })
        }
      }
    }
  }
  useLayoutEffect(() => {
    onKeyRef.current = onKey
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent): void => onKeyRef.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  if (!lookup || !card) return null

  const done = firstAnsweredCount(session)
  const target = Math.max(firstTargetCount(session), 1)
  const progress = Math.min(1, done / target)
  const stage = stageOf(view, lookup)
  const pageNumber = word ? lookup.pages.get(word.pageId)?.number : undefined
  const source = word ? (lookup.sources.get(word.id) ?? null) : null
  const phonetic = word?.phonetic ? <p className="card-phonetic">/{word.phonetic}/</p> : null

  return (
    <div className="session">
      <header className="session-top">
        <XWordMark size={20} />
        <span>今日复习</span>
        <label className="review-audio-toggle">
          <input
            type="checkbox"
            checked={autoSpeak}
            onChange={(e) => onAutoSpeak(e.target.checked)}
          />
          自动朗读
        </label>
      </header>

      <div className="session-stage">
        <div className="card-slot">
          <div ref={ghostLayer} className="ghost-layer" />
          <article ref={cardEl} key={card.key} className="card" aria-live="polite">
            <header className="card-meta">
              <span>
                第 {pageNumber ?? '?'} 页 · {STAGE_LABELS[stage]}
              </span>
              {word?.starred && (
                <>
                  <Star size={12} className="star-badge" aria-hidden />
                  <span>难词</span>
                </>
              )}
              {card.isRetry && <span className="card-retry">再来一次</span>}
              {word && englishVisible && <WordAudioButton word={word.text} shortcut="R" />}
            </header>

            {!word ? (
              <div className="card-body">
                <p className="muted">这个词已经不存在了，按 S 跳过</p>
              </div>
            ) : (
              <div className="card-body">
                <div className="card-front">
                  {direction === 'en-zh' ? (
                    <>
                      <span className="card-word">{word.text}</span>
                      {/* 翻面后在单词下方显示音标 */}
                      {flipped && phonetic && (
                        <div className="reveal" style={revealStyle(1)}>
                          {phonetic}
                        </div>
                      )}
                    </>
                  ) : (
                    <Meaning word={word} large />
                  )}
                </div>
                {flipped ? (
                  <div className="card-back">
                    {direction === 'en-zh' ? (
                      <div className="reveal" style={revealStyle(0)}>
                        <Meaning word={word} />
                      </div>
                    ) : (
                      <div className="reveal" style={revealStyle(0)}>
                        <span className="card-word is-answer">{word.text}</span>
                        {phonetic}
                      </div>
                    )}
                    {source ? (
                      <SourceLine
                        source={source}
                        word={word.text}
                        bookTitle={lookup.books.get(source.bookId)?.title ?? null}
                        style={revealStyle(2)}
                        onJump={() => jumpToSource(source)}
                      />
                    ) : (
                      word.example && (
                        <p className="card-example reveal" style={revealStyle(2)}>
                          {word.example}
                        </p>
                      )
                    )}
                    {word.mnemonic && (
                      <p className="card-mnemonic reveal" style={revealStyle(3)}>
                        {word.mnemonic}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="card-hint">
                    <kbd>空格</kbd> 翻面
                  </p>
                )}
              </div>
            )}
          </article>
        </div>

        {/* 评分按钮固定在卡片下方同一位置；翻面前占位但不可见 */}
        <div className={cx('grade-bar', !flipped && 'is-hidden')} role="group" aria-label="评分">
          {GRADES.map((g) => (
            <button
              key={g}
              type="button"
              className={cx('grade-btn', selected === g && 'is-selected')}
              disabled={!flipped}
              aria-pressed={selected === g}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => confirm(g)}
            >
              <span>{GRADE_LABELS[g]}</span>
              <kbd>{g}</kbd>
            </button>
          ))}
        </div>
        <p className={cx('grade-tip', !flipped && 'is-hidden')}>按 1–4 选择，Enter 确认</p>
      </div>

      <footer className="statusbar" data-toast-avoid="">
        <div
          className="progress"
          role="progressbar"
          aria-label="进度"
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={done}
        >
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="progress-count">
          {done} <span className="progress-total">/ {target}</span>
        </span>
        <div className="statusbar-actions">
          <Button variant="ghost" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={skip}>
            跳过 <kbd>S</kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => finish(false)}
          >
            结束 <kbd>Esc</kbd>
          </Button>
        </div>
      </footer>
    </div>
  )
}
