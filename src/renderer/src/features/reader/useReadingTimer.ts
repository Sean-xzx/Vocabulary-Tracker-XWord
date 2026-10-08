/**
 * 阅读时长：只有窗口可见、并且最近 2 分钟内有过滚动或其他操作（按键、点击、滚轮）时，才把时间计入 reading_log。
 * 每 5 秒记一次，每 30 秒（以及离开阅读页时）写一次库。
 */
import { useEffect, type RefObject } from 'react'

export const IDLE_LIMIT_MS = 2 * 60 * 1000
const TICK_MS = 5000
const FLUSH_MS = 30_000

/** 这一刻算不算在读：窗口可见，且距上次操作不超过 2 分钟 */
export function isActivelyReading(visible: boolean, lastActivity: number, now: number): boolean {
  return visible && now - lastActivity <= IDLE_LIMIT_MS
}

export function useReadingTimer(
  bookId: string | null,
  scroller: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!bookId) return
    let last = performance.now()
    let pending = 0
    let sinceFlush = 0
    const touch = (): void => {
      last = performance.now()
    }
    const flush = (): void => {
      const seconds = Math.round(pending / 1000)
      if (seconds <= 0) return
      pending -= seconds * 1000
      void window.xword.logReading(bookId, seconds).catch(() => {})
    }
    const tick = window.setInterval(() => {
      if (isActivelyReading(document.visibilityState === 'visible', last, performance.now()))
        pending += TICK_MS
      sinceFlush += TICK_MS
      if (sinceFlush >= FLUSH_MS) {
        sinceFlush = 0
        flush()
      }
    }, TICK_MS)
    const sc = scroller.current
    const events = ['keydown', 'mousedown', 'wheel', 'pointermove'] as const
    for (const ev of events) window.addEventListener(ev, touch, { passive: true })
    sc?.addEventListener('scroll', touch, { passive: true })
    return () => {
      window.clearInterval(tick)
      for (const ev of events) window.removeEventListener(ev, touch)
      sc?.removeEventListener('scroll', touch)
      flush()
    }
  }, [bookId, scroller])
}
