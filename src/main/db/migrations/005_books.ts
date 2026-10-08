/**
 * 版本 5（v0.3.0）：阅读器。书的正文放在 userData/books/<id>/，不进数据库；这里只记书目、阅读位置和阅读时长。
 * position 是“章节 + 块 + 字符偏移”三列；progress 0–1；file_hash 用来去重。
 */
export const sql = /* sql */ `
CREATE TABLE books (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  author          TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL CHECK (source IN ('gutenberg', 'import')),
  source_id       TEXT NOT NULL DEFAULT '',
  file_hash       TEXT NOT NULL,
  added_at        TEXT NOT NULL,
  last_opened_at  TEXT,
  pos_chapter     INTEGER NOT NULL DEFAULT 0,
  pos_block       INTEGER NOT NULL DEFAULT 0,
  pos_offset      INTEGER NOT NULL DEFAULT 0,
  progress        REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  deleted_at      TEXT
);
CREATE INDEX idx_books_hash ON books(file_hash);

CREATE TABLE reading_log (
  date     TEXT NOT NULL,
  book_id  TEXT NOT NULL REFERENCES books(id),
  seconds  INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  PRIMARY KEY (date, book_id)
);
`
