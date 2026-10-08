/**
 * 渲染进程的时钟。“今天”每次都用它实时计算，不做缓存。
 * 开发 / 测试可以把时钟拨到任意时刻（同时拨主进程的时钟）；打包后主进程拒绝这个调用，这里也就不会变。
 */
import { systemTimeZone } from '@shared/domain/dates'

let offsetMs = 0

export function clockNow(): Date {
  return new Date(Date.now() + offsetMs)
}

/** 当前时区：Chromium 会跟随系统时区的变化。 */
export function currentTimeZone(): string {
  return systemTimeZone()
}

/** 仅开发 / 测试：把主进程和渲染进程的时钟拨到指定时刻（null 恢复）。 */
export async function devSetNow(iso: string | null): Promise<void> {
  await window.xword.devSetNow(iso)
  offsetMs = iso === null ? 0 : new Date(iso).getTime() - Date.now()
}
