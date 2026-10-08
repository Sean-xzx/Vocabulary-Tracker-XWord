/**
 * 今日（首页，冷启动默认进入）：上方左右两张 raised 卡片——“继续阅读”和“今日复习”；下方是“今天从书里收的词”。
 * 每屏只有一个陶土色主按钮：有待复习的词时是“开始复习”，否则是“继续”。
 */
import { BookOpen, CalendarCheck, LibraryBig, PenLine } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { BookDetail } from '@shared/api'
import { formatMonthDay, formatWeekday, toLocalDate } from '@shared/domain/dates'
import { MeaningText } from '../../components/MeaningText'
import { WordAudioButton } from '../../components/WordAudioButton'
import { Button, PageHead } from '../../components/ui'
import { useApp, useTodayQueue } from '../../store/app'
import { BookCover, MarkerProgress } from '../shelf/BookCover'
import './home.css'

function ContinueCard({ primary }: { primary: boolean }): ReactElement {
  const books = useApp((s) => s.snapshot?.books ?? [])
  const openBook = useApp((s) => s.openBook)
  const setView = useApp((s) => s.setView)
  const book = books[0]
  const [detail, setDetail] = useState<BookDetail | null>(null)

  useEffect(() => {
    if (!book) return
    let alive = true
    window.xword
      .bookOpen(book.id, false)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null))
    return () => {
      alive = false
    }
  }, [book])

  if (!book) {
    return (
      <section className="home-card is-empty" aria-label="继续阅读">
        <div className="home-card-eyebrow">继续阅读</div>
        <BookOpen size={18} aria-hidden className="home-empty-icon" />
        <p className="home-empty-text">
          书架上还没有书。从 Project Gutenberg 找一本，或者把 EPUB 拖进窗口。
        </p>
        <Button
          variant={primary ? 'primary' : 'secondary'}
          icon={LibraryBig}
          onClick={() => setView('shelf')}
        >
          去书架找书
        </Button>
      </section>
    )
  }

  const chapter = detail?.meta.chapters[book.position.chapter]?.title
  return (
    <section className="home-card home-continue" aria-label="继续阅读">
      <BookCover title={book.title} author={book.author} size="sm" />
      <div className="home-continue-body">
        <div className="home-card-eyebrow">继续阅读</div>
        <h2 className="home-book-title">{book.title}</h2>
        <p className="home-book-chapter">{chapter ?? ' '}</p>
        <div className="home-book-progress">
          <MarkerProgress value={book.progress} label="阅读进度" />
          <span className="num">{Math.round(book.progress * 100)}%</span>
        </div>
        <Button variant={primary ? 'primary' : 'secondary'} onClick={() => openBook(book.id)}>
          继续
        </Button>
      </div>
    </section>
  )
}

function ReviewCard({ count, primary }: { count: number; primary: boolean }): ReactElement {
  const startReview = useApp((s) => s.startReview)
  const openWordbookPage = useApp((s) => s.openWordbookPage)
  if (count === 0) {
    return (
      <section className="home-card is-empty" aria-label="今日复习">
        <div className="home-card-eyebrow">今日复习</div>
        <CalendarCheck size={18} aria-hidden className="home-empty-icon" />
        <p className="home-empty-text">今天没有要复习的词。读书时点一个词，就能把它收进单词本。</p>
        <Button icon={PenLine} onClick={() => openWordbookPage(null)}>
          去录入新词
        </Button>
      </section>
    )
  }
  return (
    <section className="home-card home-review" aria-label="今日复习">
      <div className="home-card-eyebrow">今日复习</div>
      <div className="home-review-count">
        <span className="home-stat num">{count}</span>
        <span className="home-stat-label">个词待复习</span>
      </div>
      <Button variant={primary ? 'primary' : 'secondary'} size="lg" onClick={startReview}>
        开始复习
      </Button>
    </section>
  )
}

export function HomeView(): ReactElement | null {
  const snapshot = useApp((s) => s.snapshot)
  const openLibraryWord = useApp((s) => s.openLibraryWord)
  const queue = useTodayQueue()

  const collected = useMemo(() => {
    if (!snapshot) return []
    const words = new Map(snapshot.words.map((w) => [w.id, w]))
    const books = new Map(snapshot.books.map((b) => [b.id, b]))
    const seen = new Set<string>()
    const out: { id: string; text: string; pos: string; meaning: string; book: string }[] = []
    for (const s of snapshot.sources) {
      if (seen.has(s.wordId)) continue
      let day = ''
      try {
        day = toLocalDate(s.createdAt, snapshot.timeZone)
      } catch {
        continue
      }
      if (day !== snapshot.today) continue
      const w = words.get(s.wordId)
      if (!w) continue
      seen.add(s.wordId)
      out.push({
        id: w.id,
        text: w.text,
        pos: w.pos,
        meaning: w.meaning,
        book: books.get(s.bookId)?.title ?? '已删除的书'
      })
    }
    return out
  }, [snapshot])

  if (!snapshot || !queue) return null
  const count = queue.items.length

  return (
    <div className="home">
      <PageHead
        eyebrow={`${formatMonthDay(snapshot.today)} · ${formatWeekday(snapshot.today)}`}
        title="今日"
      />
      <div className="home-cards">
        <ContinueCard primary={count === 0} />
        <ReviewCard count={count} primary={count > 0} />
      </div>
      <section className="home-collected" aria-label="今天从书里收的词">
        <h2 className="home-section-title">今天从书里收的词</h2>
        {collected.length === 0 ? (
          <p className="home-collected-empty">还没有。读书时点一个词，选好义项就能收进单词本。</p>
        ) : (
          <ul className="home-collected-list">
            {collected.map((c) => (
              <li key={c.id}>
                <button type="button" className="home-word" onClick={() => openLibraryWord(c.id)}>
                  <span className="home-word-text">{c.text}</span>
                  <span className="home-word-meaning">
                    <MeaningText pos={c.pos} meaning={c.meaning} />
                  </span>
                  <span className="home-word-book">《{c.book}》</span>
                </button>
                <WordAudioButton word={c.text} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
