/**
 * 表结构迁移：用 PRAGMA user_version 记录当前版本，版本号从 1 开始递增。
 * 新增迁移：新建 00N_xxx.ts 导出 sql（或 run 函数），并追加到 MIGRATIONS 末尾。已发布的迁移不要再修改。
 */
import type { SqlDb } from '../connection'
import { sql as v1 } from './001_init'
import { sql as v2 } from './002_phonetic'
import { fixTimeZone } from './003_timezone'
import { toLocalTime } from './004_local_time'
import { sql as v5 } from './005_books'
import { sql as v6 } from './006_reader'
import { sql as v7 } from './007_translations'
import { addBookFormat } from './008_book_format'
import { systemTimeZone } from '../../../shared/domain/dates'

export interface Migration {
  version: number
  /** 纯 SQL 的迁移 */
  sql?: string
  /** 需要计算的迁移；返回一行说明，写进日志 */
  run?: (db: SqlDb, env: MigrationEnv) => string
}

export interface MigrationEnv {
  /** 本地时区（IANA 名）：换算日期字段用 */
  timeZone: string
  /** 书的原始文件名（meta.json 里的 fileName）；读不到返回 null */
  bookFileName?: (bookId: string) => string | null
}

export const MIGRATIONS: Migration[] = [
  { version: 1, sql: v1 },
  { version: 2, sql: v2 },
  {
    version: 3,
    run: (db) => `时区校正（北京时间）：改动了 ${fixTimeZone(db)} 条记录`
  },
  {
    version: 4,
    run: (db, env) =>
      `日期改为本地时间（${env.timeZone}）：改动了 ${toLocalTime(db, env.timeZone)} 条记录`
  },
  { version: 5, sql: v5 },
  { version: 6, sql: v6 },
  { version: 7, sql: v7 },
  { version: 8, run: (db, env) => addBookFormat(db, env) }
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

/** 依次执行尚未执行的迁移。每个版本一个事务。返回迁移前的版本号；log 收到每个计算型迁移的说明。 */
export function migrate(
  db: SqlDb,
  log?: (message: string) => void,
  env: MigrationEnv = { timeZone: systemTimeZone() }
): number {
  const from = db.userVersion
  if (from > LATEST_VERSION) {
    throw new Error(`数据库版本 ${from} 比程序支持的 ${LATEST_VERSION} 新，请升级 XWord`)
  }
  for (const m of MIGRATIONS) {
    if (m.version <= db.userVersion) continue
    let message: string | undefined
    db.transaction(() => {
      if (m.sql) db.exec(m.sql)
      if (m.run) message = m.run(db, env)
      db.exec(`PRAGMA user_version = ${m.version}`)
    })
    if (message) log?.(`迁移到版本 ${m.version}：${message}`)
  }
  return from
}
