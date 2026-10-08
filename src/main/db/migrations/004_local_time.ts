/**
 * 版本 4（v0.3.0）：日期改为跟随电脑的本地时区。按真实时刻和本地时区重新换算
 * checks.done_on、words.learned_on、pages.started_on（算法与版本 3 相同，只换时区）。
 * 只依赖不变的时间戳，重复执行结果不变。返回改动的记录条数。
 */
import type { SqlDb } from '../connection'
import { fixTimeZone } from './003_timezone'

export function toLocalTime(db: SqlDb, timeZone: string): number {
  return fixTimeZone(db, timeZone)
}
