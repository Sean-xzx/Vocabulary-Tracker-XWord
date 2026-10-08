/**
 * sql.js 连接：整个数据库在内存中，每次事务提交后导出并原子地写回磁盘。
 * 只有主进程使用。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs, { type BindParams, type Database, type SqlJsStatic, type SqlValue } from 'sql.js'

export type Row = Record<string, SqlValue>

let sqlPromise: Promise<SqlJsStatic> | null = null

/** 加载 sql.js 的 wasm。wasm 与 sql-wasm.js 同目录，开发模式和打包后（asar 内）都能读取。 */
export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    const wasmPath = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm')
    const bytes = readFileSync(wasmPath)
    const wasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    sqlPromise = initSqlJs({ wasmBinary: wasmBinary as ArrayBuffer })
  }
  return sqlPromise
}

/** 先写 .tmp 再重命名替换，避免写到一半断电导致数据库损坏。 */
export function writeFileAtomic(filePath: string, data: Uint8Array): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, filePath)
}

export class SqlDb {
  private inTransaction = false

  private constructor(
    private readonly db: Database,
    private readonly filePath: string | null
  ) {
    this.configure()
  }

  /** 从已有的数据库内容建立纯内存数据库，不写回任何文件（测试用）。 */
  static async fromBytes(data: Uint8Array): Promise<SqlDb> {
    const SQL = await loadSqlJs()
    return new SqlDb(new SQL.Database(data), null)
  }

  /** filePath 为 null 时是纯内存数据库（测试用）。 */
  static async open(filePath: string | null): Promise<SqlDb> {
    const SQL = await loadSqlJs()
    const data = filePath && existsSync(filePath) ? readFileSync(filePath) : undefined
    return new SqlDb(new SQL.Database(data), filePath)
  }

  get path(): string | null {
    return this.filePath
  }

  private configure(): void {
    this.db.exec('PRAGMA foreign_keys = ON')
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  run(sql: string, params: BindParams = []): void {
    this.db.run(sql, params)
  }

  all<T = Row>(sql: string, params: BindParams = []): T[] {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      return rows
    } finally {
      stmt.free()
    }
  }

  get<T = Row>(sql: string, params: BindParams = []): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  /** 在一个事务里执行 fn；成功则提交并落盘，失败则回滚。 */
  transaction<T>(fn: () => T): T {
    if (this.inTransaction) throw new Error('不支持嵌套事务')
    this.inTransaction = true
    this.db.exec('BEGIN IMMEDIATE')
    let result: T
    try {
      result = fn()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.inTransaction = false
    }
    this.persist()
    return result
  }

  get userVersion(): number {
    const row = this.get<{ user_version: number }>('PRAGMA user_version')
    return Number(row?.user_version ?? 0)
  }

  /** 导出整个数据库写回磁盘。sql.js 的 export 会重新打开连接，所以之后要重新设置 PRAGMA。 */
  persist(): void {
    if (!this.filePath) return
    const data = this.db.export()
    this.configure()
    writeFileAtomic(this.filePath, data)
  }

  close(): void {
    this.db.close()
  }
}
