/**
 * 回归（v0.2.0：9 月 24 日早上仍显示 23 日）：渲染进程只在窗口 focus 时刷新快照，
 * 睡眠跨午夜后窗口一直有焦点，“今天”停在前一天。现在由日期检查兜底：唤醒 / 解锁事件立即检查，
 * 没有任何事件时每 60 秒也会检查一次。
 */
import { describe, expect, it } from 'vitest'
import { DAY_CHECK_INTERVAL_MS, dayChanged, startDayWatch, type DayState } from './dayWatch'

interface Harness {
  calls: string[]
  stop: () => void
  setNow: (iso: string) => void
  setZone: (z: string) => void
  tick: () => void
  fire: () => void
}

function harness(state: DayState, start: string, tz = 'Asia/Shanghai'): Harness {
  let now = new Date(start)
  let zone = tz
  let tick: (() => void) | null = null
  let fire: (() => void) | null = null
  const calls: string[] = []
  const stop = startDayWatch({
    now: () => now,
    timeZone: () => zone,
    current: () => state,
    refresh: () => calls.push('refresh'),
    triggers: [
      (check) => {
        fire = check
        return () => (fire = null)
      }
    ],
    setInterval: (fn) => {
      tick = fn
      return 1
    },
    clearInterval: () => (tick = null)
  })
  return {
    calls,
    stop,
    setNow: (iso: string) => {
      now = new Date(iso)
    },
    setZone: (z: string) => {
      zone = z
    },
    tick: () => tick?.(),
    fire: () => fire?.()
  }
}

describe('日期检查', () => {
  it('本地 07:30（UTC+8）：快照是本地的今天时不刷新，是前一天时刷新', () => {
    const morning = new Date('2026-09-24T07:30:00+08:00')
    expect(
      dayChanged({ today: '2026-09-24', timeZone: 'Asia/Shanghai' }, morning, 'Asia/Shanghai')
    ).toBe(false)
    expect(
      dayChanged({ today: '2026-09-23', timeZone: 'Asia/Shanghai' }, morning, 'Asia/Shanghai')
    ).toBe(true)
  })

  it('睡眠跨午夜后唤醒：没有 focus 事件，唤醒事件立即刷新', () => {
    const h = harness(
      { today: '2026-09-23', timeZone: 'Asia/Shanghai' },
      '2026-09-23T23:50:00+08:00'
    )
    h.fire()
    expect(h.calls).toEqual([])
    h.setNow('2026-09-24T07:30:00+08:00') // 系统睡眠了一夜，定时器没有跑
    h.fire() // powerMonitor resume
    expect(h.calls).toEqual(['refresh'])
  })

  it('睡眠跨午夜后连唤醒事件也没有：60 秒内的定时检查也会刷新', () => {
    const h = harness(
      { today: '2026-09-23', timeZone: 'Asia/Shanghai' },
      '2026-09-23T23:59:30+08:00'
    )
    expect(DAY_CHECK_INTERVAL_MS).toBeLessThanOrEqual(60_000)
    h.tick()
    expect(h.calls).toEqual([])
    h.setNow('2026-09-24T00:00:30+08:00')
    h.tick()
    expect(h.calls).toEqual(['refresh'])
  })

  it('运行中修改系统时区：日期没变也要刷新（时区不同）', () => {
    const h = harness(
      { today: '2026-09-24', timeZone: 'Asia/Shanghai' },
      '2026-09-24T12:00:00+08:00'
    )
    h.setZone('Asia/Tokyo')
    h.tick()
    expect(h.calls).toEqual(['refresh'])
  })

  it('停止后不再检查', () => {
    const h = harness({ today: '2026-09-23', timeZone: 'UTC' }, '2026-09-24T00:00:00Z', 'UTC')
    h.stop()
    h.tick()
    h.fire()
    expect(h.calls).toEqual([])
  })
})
