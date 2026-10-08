/**
 * 主进程的时钟与时区。
 * 主进程（Node）在系统时区变更后不会更新自己的本地时区（V8 只在启动时读一次，Chromium 只通知渲染进程），
 * 所以“今天”用的时区由渲染进程在每次 IPC 调用时带过来（src/preload），这里校验后记下；启动时先用系统时区。
 * 开发 / 测试可以把时钟拨到任意时刻（只在未打包时生效，由 ipc.ts 把关）。
 */
import { isValidTimeZone, systemTimeZone } from '../shared/domain/dates'

export interface Clock {
  now(): Date
  /** IANA 时区名；缺省为系统当前时区 */
  timeZone?(): string
}

let zone = systemTimeZone()
let offsetMs = 0

export const appClock: Required<Clock> = {
  now: () => new Date(Date.now() + offsetMs),
  timeZone: () => zone
}

/** 记下渲染进程报告的时区；不合法的时区名直接拒绝。返回时区是否变了。 */
export function setTimeZone(timeZone: string): boolean {
  if (!isValidTimeZone(timeZone)) throw new Error('无效的时区')
  const changed = timeZone !== zone
  zone = timeZone
  return changed
}

/** 仅开发 / 测试：把时钟拨到指定时刻（null 恢复为系统时钟）。 */
export function setDevNow(iso: string | null): void {
  offsetMs = iso === null ? 0 : new Date(iso).getTime() - Date.now()
}
