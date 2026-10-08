/**
 * 版本 8（v0.4.0）：书页排版与 PDF。
 * - books.format：epub / txt / pdf（旧书按 meta.json 里的文件名判断，读不到按 epub）；
 * - books.parse_version：正文的解析版本。v0.3 导入的书是 1，v0.4 按原书结构重新解析后是 2。
 * 阅读位置、高亮、出处本来就存“章节 + 块 + 字符偏移”，但块的下标跟解析方式有关：书第一次用新解析器重新解析时，
 * 按原文逐条转换成新锚点（找不到的落到章首，条数写日志），见 src/main/books/reparse.ts。
 */
import type { SqlDb } from '../connection'
import type { MigrationEnv } from './index'

export function addBookFormat(db: SqlDb, env: MigrationEnv): string {
  db.exec(`
ALTER TABLE books ADD COLUMN format TEXT NOT NULL DEFAULT 'epub' CHECK (format IN ('epub', 'txt', 'pdf'));
ALTER TABLE books ADD COLUMN parse_version INTEGER NOT NULL DEFAULT 1;
`)
  const books = db.all<{ id: string }>('SELECT id FROM books')
  let txt = 0
  for (const b of books) {
    let name = ''
    try {
      name = env.bookFileName?.(b.id) ?? ''
    } catch {
      name = ''
    }
    if (/\.txt$/i.test(name)) {
      db.run(`UPDATE books SET format = 'txt' WHERE id = ?`, [b.id])
      txt++
    }
  }
  const count = (sql: string): number => db.get<{ n: number }>(sql)?.n ?? 0
  const highlights = count('SELECT COUNT(*) AS n FROM highlights')
  const sources = count('SELECT COUNT(*) AS n FROM word_sources')
  return (
    `${books.length} 本书（其中 TXT ${txt} 本）待按原书结构重新解析；` +
    `${books.length} 个阅读位置、${highlights} 条高亮、${sources} 条出处将在书第一次打开时转换成新锚点`
  )
}
