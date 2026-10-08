import { describe, expect, it } from 'vitest'
import {
  addDays,
  compareDates,
  diffDays,
  formatMonthDay,
  formatMonthDot,
  isAfter,
  isBefore,
  isSameOrBefore,
  isValidDate,
  isValidTimeZone,
  nowIso,
  toLocalDate,
  today
} from './dates'

describe('dates', () => {
  it('today() 取指定时区的本地日历日', () => {
    // UTC 2024-02-29 16:30 = 上海 3 月 1 日 00:30 = 洛杉矶 2 月 29 日 08:30
    expect(today(new Date('2024-02-29T16:30:00Z'), 'Asia/Shanghai')).toBe('2024-03-01')
    expect(today(new Date('2024-02-29T16:30:00Z'), 'America/Los_Angeles')).toBe('2024-02-29')
    expect(today(new Date('2024-12-31T15:59:59Z'), 'Asia/Shanghai')).toBe('2024-12-31')
    expect(toLocalDate('2024-12-31T23:30:00-08:00', 'UTC')).toBe('2025-01-01')
  })

  it('回归（v0.2.0 早上仍显示前一天）：UTC+8 本地 07:30，今天是本地日期，而不是 UTC 日期', () => {
    const morning = new Date('2026-09-24T07:30:00+08:00')
    expect(today(morning, 'Asia/Shanghai')).toBe('2026-09-24')
    // 同一时刻的 UTC 日期还是 23 日——任何“先转成 UTC 再截取日期”的写法都会得到错误的前一天
    expect(morning.toJSON().startsWith('2026-09-23')).toBe(true)
    // 缺省时区 = 系统当前时区
    const old = process.env.TZ
    process.env.TZ = 'Asia/Shanghai'
    try {
      expect(today(morning)).toBe('2026-09-24')
      expect(nowIso(morning)).toBe('2026-09-24T07:30:00.000+08:00')
    } finally {
      if (old === undefined) delete process.env.TZ
      else process.env.TZ = old
    }
  })

  it('时区名校验', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(8)).toBe(false)
    expect(isValidTimeZone('../etc')).toBe(false)
  })

  it('跨月末', () => {
    expect(addDays('2024-01-31', 1)).toBe('2024-02-01')
    expect(addDays('2024-04-30', 1)).toBe('2024-05-01')
    expect(addDays('2023-01-31', 30)).toBe('2023-03-02')
    expect(diffDays('2024-01-31', '2024-03-01')).toBe(30)
  })

  it('跨年', () => {
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01')
    expect(addDays('2024-12-20', 14)).toBe('2025-01-03')
    expect(addDays('2025-01-01', -1)).toBe('2024-12-31')
    expect(diffDays('2024-12-25', '2025-01-24')).toBe(30)
  })

  it('闰年 2 月 29 日', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01')
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01')
    expect(addDays('2024-02-29', 365)).toBe('2025-02-28')
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29')
    expect(addDays('1900-02-28', 1)).toBe('1900-03-01')
    expect(diffDays('2024-02-01', '2024-03-01')).toBe(29)
    expect(diffDays('2023-02-01', '2023-03-01')).toBe(28)
  })

  it('比较函数', () => {
    expect(compareDates('2024-01-01', '2024-01-02')).toBe(-1)
    expect(compareDates('2024-01-02', '2024-01-02')).toBe(0)
    expect(compareDates('2025-01-01', '2024-12-31')).toBe(1)
    expect(isBefore('2024-01-01', '2024-01-02')).toBe(true)
    expect(isAfter('2024-01-01', '2024-01-02')).toBe(false)
    expect(isSameOrBefore('2024-01-02', '2024-01-02')).toBe(true)
  })

  it('校验与格式化', () => {
    expect(isValidDate('2024-02-29')).toBe(true)
    expect(isValidDate('2023-02-29')).toBe(false)
    expect(isValidDate('2024-13-01')).toBe(false)
    expect(isValidDate('2024-1-01')).toBe(false)
    expect(isValidDate(20240101)).toBe(false)
    expect(() => addDays('2024-02-30', 1)).toThrow()
    expect(() => addDays('2024-02-01', 1.5)).toThrow()
    expect(formatMonthDot('2024-09-03')).toBe('9.3')
    expect(formatMonthDay('2024-12-25')).toBe('12月25日')
  })

  it('长距离加减来回一致', () => {
    let d = '2019-06-15'
    for (let i = 0; i < 3000; i += 37) {
      expect(addDays(addDays(d, i), -i)).toBe(d)
      expect(diffDays(d, addDays(d, i))).toBe(i)
    }
    d = addDays(d, 1)
    expect(d).toBe('2019-06-16')
  })
})
