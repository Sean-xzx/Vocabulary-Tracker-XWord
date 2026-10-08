/**
 * 日期检查：系统唤醒、屏幕解锁、窗口获得焦点、页面重新可见、每 60 秒一次，都重新算一遍“今天”和时区；
 * 只要和快照里的不同，就刷新（今日队列、导航数量、单词页、首页都从快照派生，随之更新）。
 * 不依赖午夜定时器：系统睡眠时它不会触发。
 */
import { today } from '@shared/domain/dates'

export const DAY_CHECK_INTERVAL_MS = 60_000

export interface DayState {
  today: string
  timeZone: string
}

/** 按当前时刻和时区算出的日期是否与快照不同。 */
export function dayChanged(current: DayState, now: Date, timeZone: string): boolean {
  return current.timeZone !== timeZone || current.today !== today(now, timeZone)
}

export interface DayWatchDeps {
  now: () => Date
  timeZone: () => string
  /** 快照里的日期和时区；还没有快照时为 null */
  current: () => DayState | null
  refresh: () => void
  /** 注册触发检查的事件源，返回取消函数 */
  triggers: ((check: () => void) => () => void)[]
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (id: unknown) => void
}

export function startDayWatch(deps: DayWatchDeps): () => void {
  const check = (): void => {
    const current = deps.current()
    if (current && dayChanged(current, deps.now(), deps.timeZone())) deps.refresh()
  }
  const setI = deps.setInterval ?? ((fn: () => void, ms: number) => globalThis.setInterval(fn, ms))
  const clearI =
    deps.clearInterval ??
    ((id: unknown) => globalThis.clearInterval(id as ReturnType<typeof setInterval>))
  const timer = setI(check, DAY_CHECK_INTERVAL_MS)
  const offs = deps.triggers.map((t) => t(check))
  return () => {
    clearI(timer)
    for (const off of offs) off()
  }
}
