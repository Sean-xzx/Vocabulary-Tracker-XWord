import { describe, expect, it } from 'vitest'
import { IDLE_LIMIT_MS, isActivelyReading } from './useReadingTimer'

describe('阅读时长', () => {
  it('只有窗口可见、并且 2 分钟内有过操作时才计时', () => {
    expect(isActivelyReading(true, 0, 1000)).toBe(true)
    expect(isActivelyReading(true, 0, IDLE_LIMIT_MS)).toBe(true)
    expect(isActivelyReading(true, 0, IDLE_LIMIT_MS + 1)).toBe(false)
    expect(isActivelyReading(false, 0, 1000)).toBe(false)
  })
})
