/**
 * 版本 3（v0.2.1）：业务时区统一为北京时间。按北京时间重新换算已有的日期字段
 * （版本 4 用同一算法按本地时区再换算一次，见 004_local_time.ts）：
 * - checks.done_on：取同一词、同一节点、is_retry = 0 的 review_log.reviewed_at（有多条时取最晚的一条）；
 * - words.learned_on：等于 stage 0 那条检查记录的 done_on；
 * - pages.started_on：依据 created_at。
 * 找不到对应时间戳（或时间戳无法解析）的记录保持原值。只依赖不变的时间戳，重复执行结果不变；
 * 旧数据本来就是在北京时间下写入的，就是零改动。返回改动的记录条数。
 */
import { isValidInstant, toLocalDate } from '../../../shared/domain/dates'
import type { SqlDb } from '../connection'

export function fixTimeZone(db: SqlDb, timeZone = 'Asia/Shanghai'): number {
  let changed = 0

  const latest = new Map<string, { at: number; iso: string }>()
  for (const r of db.all<{ word_id: string; stage: number; reviewed_at: string }>(
    'SELECT word_id, stage, reviewed_at FROM review_log WHERE is_retry = 0'
  )) {
    if (!isValidInstant(r.reviewed_at)) continue
    const key = `${r.word_id}:${r.stage}`
    const at = new Date(r.reviewed_at).getTime()
    const prev = latest.get(key)
    if (!prev || at > prev.at) latest.set(key, { at, iso: r.reviewed_at })
  }

  for (const c of db.all<{ word_id: string; stage: number; done_on: string }>(
    'SELECT word_id, stage, done_on FROM checks'
  )) {
    const log = latest.get(`${c.word_id}:${c.stage}`)
    if (!log) continue
    const doneOn = toLocalDate(log.iso, timeZone)
    if (doneOn === c.done_on) continue
    db.run('UPDATE checks SET done_on = ? WHERE word_id = ? AND stage = ?', [
      doneOn,
      c.word_id,
      c.stage
    ])
    changed++
  }

  for (const w of db.all<{ id: string; learned_on: string | null; done_on: string }>(
    `SELECT w.id, w.learned_on, c.done_on FROM words w
     JOIN checks c ON c.word_id = w.id AND c.stage = 0`
  )) {
    if (w.learned_on === w.done_on) continue
    db.run('UPDATE words SET learned_on = ? WHERE id = ?', [w.done_on, w.id])
    changed++
  }

  for (const p of db.all<{ id: string; started_on: string; created_at: string }>(
    'SELECT id, started_on, created_at FROM pages'
  )) {
    if (!isValidInstant(p.created_at)) continue
    const startedOn = toLocalDate(p.created_at, timeZone)
    if (startedOn === p.started_on) continue
    db.run('UPDATE pages SET started_on = ? WHERE id = ?', [startedOn, p.id])
    changed++
  }

  return changed
}
