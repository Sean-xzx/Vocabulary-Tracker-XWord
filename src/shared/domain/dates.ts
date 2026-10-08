/**
 * 日期与时刻工具——全软件唯一处理日期的地方。
 * 所有日期都按电脑系统当前的本地时区计算；一天的分界是本地时间 00:00。
 * 每个函数都接收 now / instant，以及可选的 timeZone（IANA 时区名，缺省取系统当前时区）；纯函数不读取系统时钟。
 * 调度日期都是 YYYY-MM-DD 字符串；日期加减用纯整数的“公历日序号”换算完成，不经过毫秒时间戳。
 * 时刻字段用 ISO 8601 存储，新写入的带本地偏移（例如 +08:00）；旧值（Z 或其它偏移）按真实时刻换算。
 */

export type DateStr = string

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28
  return [4, 6, 9, 11].includes(m) ? 30 : 31
}

interface Ymd {
  y: number
  m: number
  d: number
}

function parse(date: DateStr): Ymd {
  const match = DATE_RE.exec(date)
  if (!match) throw new Error(`无效日期：${date}`)
  const ymd = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
  if (ymd.m < 1 || ymd.m > 12 || ymd.d < 1 || ymd.d > daysInMonth(ymd.y, ymd.m)) {
    throw new Error(`无效日期：${date}`)
  }
  return ymd
}

function format({ y, m, d }: Ymd): DateStr {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`
}

// Howard Hinnant 的 days_from_civil / civil_from_days 算法：公历日期 <-> 自 1970-01-01 起的天数。
function toDayNumber({ y, m, d }: Ymd): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const mp = (m + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function fromDayNumber(z: number): Ymd {
  const zz = z + 719468
  const era = Math.floor(zz / 146097)
  const doe = zz - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  )
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return { y, m, d }
}

/** 是否是合法的 YYYY-MM-DD 日期。 */
export function isValidDate(value: unknown): value is DateStr {
  if (typeof value !== 'string') return false
  try {
    parse(value)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 时区

/** 系统当前的 IANA 时区名（Chromium / Node 在系统时区变更后会更新它；主进程见 DECISIONS）。 */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

const TZ_NAME_RE = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** 是否是合法的 IANA 时区名（主进程校验渲染进程传来的时区用）。 */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !TZ_NAME_RE.test(value)) return false
  try {
    formatter(value)
    return true
  } catch {
    return false
  }
}

function toInstant(instant: Date | string): Date {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  if (Number.isNaN(d.getTime())) throw new Error(`无效时刻：${String(instant)}`)
  return d
}

/** 某个时刻在指定时区的“墙上时间”。 */
interface LocalParts extends Ymd {
  hh: number
  mi: number
  ss: number
  ms: number
  /** 相对 UTC 的偏移（分钟，东边为正） */
  offset: number
}

function localParts(instant: Date | string, timeZone: string): LocalParts {
  const t = toInstant(instant)
  const fields: Record<string, number> = {}
  for (const p of formatter(timeZone).formatToParts(t)) {
    if (p.type !== 'literal') fields[p.type] = Number(p.value)
  }
  const ms = ((t.getTime() % 1000) + 1000) % 1000
  const parts = {
    y: fields.year,
    m: fields.month,
    d: fields.day,
    hh: fields.hour === 24 ? 0 : fields.hour,
    mi: fields.minute,
    ss: fields.second,
    ms
  }
  const wall = Date.UTC(parts.y, parts.m - 1, parts.d, parts.hh, parts.mi, parts.ss, ms)
  return { ...parts, offset: Math.round((wall - t.getTime()) / 60000) }
}

/** 某个时刻在本地时区是哪一天。旧数据里带 Z 或其它偏移的时刻也按真实时刻换算。 */
export function toLocalDate(instant: Date | string, timeZone: string = systemTimeZone()): DateStr {
  return format(localParts(instant, timeZone))
}

/** 能否解析为时刻（迁移旧数据时用来跳过坏值）。 */
export function isValidInstant(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !Number.isNaN(new Date(value).getTime())
}

/** 本地的“今天”。每次都按传入的 now 实时计算，不做缓存。 */
export function today(now: Date, timeZone: string = systemTimeZone()): DateStr {
  return toLocalDate(now, timeZone)
}

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

/** 带本地偏移的 ISO 8601 时刻，例如 2026-09-24T08:05:03.120+08:00。 */
export function nowIso(now: Date, timeZone: string = systemTimeZone()): string {
  const p = localParts(now, timeZone)
  return `${format(p)}T${pad2(p.hh)}:${pad2(p.mi)}:${pad2(p.ss)}.${String(p.ms).padStart(3, '0')}${offsetText(p.offset)}`
}

/** 界面显示：某个时刻的本地日期，“9月24日”。 */
export function formatDate(instant: Date | string, timeZone: string = systemTimeZone()): string {
  const p = localParts(instant, timeZone)
  return `${p.m}月${p.d}日`
}

/** 界面显示：某个时刻的本地时间，“08:05”。 */
export function formatClock(instant: Date | string, timeZone: string = systemTimeZone()): string {
  const p = localParts(instant, timeZone)
  return `${pad2(p.hh)}:${pad2(p.mi)}`
}

/** 界面显示：某个时刻的本地日期和时间，“9月24日 08:05”。 */
export function formatDateTime(
  instant: Date | string,
  timeZone: string = systemTimeZone()
): string {
  const p = localParts(instant, timeZone)
  return `${p.m}月${p.d}日 ${pad2(p.hh)}:${pad2(p.mi)}`
}

// ---------------------------------------------------------------- 日期运算（与时区无关）

export function addDays(date: DateStr, days: number): DateStr {
  if (!Number.isInteger(days)) throw new Error(`天数必须是整数：${days}`)
  return format(fromDayNumber(toDayNumber(parse(date)) + days))
}

/** to - from 的天数差。diffDays('2024-02-28', '2024-03-01') === 2 */
export function diffDays(from: DateStr, to: DateStr): number {
  return toDayNumber(parse(to)) - toDayNumber(parse(from))
}

/** 负数：a 早于 b；0：同一天；正数：a 晚于 b。 */
export function compareDates(a: DateStr, b: DateStr): number {
  return Math.sign(diffDays(b, a))
}

export function isBefore(a: DateStr, b: DateStr): boolean {
  return compareDates(a, b) < 0
}

export function isAfter(a: DateStr, b: DateStr): boolean {
  return compareDates(a, b) > 0
}

export function isSameOrBefore(a: DateStr, b: DateStr): boolean {
  return compareDates(a, b) <= 0
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** “星期四”。1970-01-01 是星期四。 */
export function formatWeekday(date: DateStr): string {
  const n = (((toDayNumber(parse(date)) + 4) % 7) + 7) % 7
  return `星期${WEEKDAYS[n]}`
}

/** “9.23”——网格表头用。 */
export function formatMonthDot(date: DateStr): string {
  const { m, d } = parse(date)
  return `${m}.${d}`
}

/** “9月23日”——页头用。 */
export function formatMonthDay(date: DateStr): string {
  const { m, d } = parse(date)
  return `${m}月${d}日`
}
