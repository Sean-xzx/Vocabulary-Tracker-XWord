/**
 * 每天第一次启动时备份数据库：userData\backups\xword-YYYY-MM-DD.db，只保留最近 7 份。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DateStr } from '../../shared/domain/dates'

export const BACKUP_KEEP = 7
const BACKUP_RE = /^xword-\d{4}-\d{2}-\d{2}\.db$/

/** 返回新建的备份路径；今天已经备份过或数据库还不存在时返回 null。 */
export function backupDaily(dbPath: string, backupDir: string, today: DateStr): string | null {
  if (!existsSync(dbPath)) return null
  mkdirSync(backupDir, { recursive: true })
  const target = join(backupDir, `xword-${today}.db`)
  let created: string | null = null
  if (!existsSync(target)) {
    copyFileSync(dbPath, target)
    created = target
  }
  const backups = readdirSync(backupDir)
    .filter((name) => BACKUP_RE.test(name))
    .sort()
    .reverse()
  for (const old of backups.slice(BACKUP_KEEP)) rmSync(join(backupDir, old), { force: true })
  return created
}

/**
 * 升级表结构之前单独备份一次：userData\backups\xword-v{from}-before-v{to}-YYYY-MM-DD.db。
 * 文件名不符合每日备份的格式，不会被“保留 7 份”清理掉；同一天重复启动不重复备份。
 */
export function backupBeforeMigration(
  dbPath: string,
  backupDir: string,
  from: number,
  to: number,
  today: DateStr
): string | null {
  if (!existsSync(dbPath) || from === 0 || from >= to) return null
  mkdirSync(backupDir, { recursive: true })
  const target = join(backupDir, `xword-v${from}-before-v${to}-${today}.db`)
  if (existsSync(target)) return null
  copyFileSync(dbPath, target)
  return target
}
