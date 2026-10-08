import { describe, expect, it } from 'vitest'
import { activeDays, streakDays } from './streak'

describe('连续打卡（本地日期）', () => {
  it('从今天往回数；今天还没打卡时从昨天数；断了就停', () => {
    const logs = [
      '2024-03-01T01:00:00+08:00',
      '2024-02-29T15:59:00Z', // 上海 2 月 29 日 23:59
      '2024-02-28T16:00:00Z', // 上海 2 月 29 日 00:00
      '2024-02-28T08:00:00Z', // 上海 2 月 28 日
      '2024-02-26T08:00:00Z'
    ]
    const days = activeDays(logs, [], 'Asia/Shanghai')
    expect(streakDays(days, '2024-03-01')).toBe(3)
    expect(streakDays(days, '2024-03-02')).toBe(3)
    expect(streakDays(days, '2024-03-03')).toBe(0)
    expect(streakDays(activeDays([], []), '2024-03-01')).toBe(0)
    expect(streakDays(activeDays(['坏值'], []), '2024-03-01')).toBe(0)
  })

  it('同一时刻在不同时区可能是不同的日期', () => {
    const at = ['2024-02-29T20:00:00Z']
    expect([...activeDays(at, [], 'Asia/Shanghai')]).toEqual(['2024-03-01'])
    expect([...activeDays(at, [], 'America/Los_Angeles')]).toEqual(['2024-02-29'])
  })

  it('当天累计阅读满 5 分钟也算打卡（多本书的时长相加），不满不算', () => {
    const days = activeDays(
      ['2024-03-01T09:00:00+08:00'],
      [
        { date: '2024-02-29', seconds: 200 },
        { date: '2024-02-29', seconds: 100 },
        { date: '2024-02-28', seconds: 299 }
      ],
      'Asia/Shanghai'
    )
    expect(days.has('2024-02-29')).toBe(true)
    expect(days.has('2024-02-28')).toBe(false)
    expect(streakDays(days, '2024-03-01')).toBe(2)
  })
})
