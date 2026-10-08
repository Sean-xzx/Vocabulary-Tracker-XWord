/**
 * 连续打卡：某个本地日期有过一次“第一次作答”（review_log 里 is_retry = 0），或者当天累计阅读满 5 分钟，就算打卡。
 * 从今天（今天还没打卡时从昨天）往回数连续的天数。
 */
import { addDays, toLocalDate, type DateStr } from './dates'

/** 当天累计阅读满这么多秒算打卡 */
export const READING_STREAK_SECONDS = 5 * 60

export interface ReadingDay {
  date: DateStr
  seconds: number
}

/** 打卡的日期：第一次作答的时刻按本地时区换算成日期；阅读按日期累计秒数。坏的时间戳不计。 */
export function activeDays(
  firstAnswers: Iterable<string>,
  reading: Iterable<ReadingDay>,
  timeZone?: string
): Set<DateStr> {
  const days = new Set<DateStr>()
  for (const at of firstAnswers) {
    try {
      days.add(toLocalDate(at, timeZone))
    } catch {
      // 坏的时间戳不计
    }
  }
  const totals = new Map<DateStr, number>()
  for (const r of reading) totals.set(r.date, (totals.get(r.date) ?? 0) + r.seconds)
  for (const [date, seconds] of totals) if (seconds >= READING_STREAK_SECONDS) days.add(date)
  return days
}

export function streakDays(days: ReadonlySet<DateStr>, today: DateStr): number {
  let day = days.has(today) ? today : addDays(today, -1)
  let n = 0
  while (days.has(day)) {
    n++
    day = addDays(day, -1)
  }
  return n
}
