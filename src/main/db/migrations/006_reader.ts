/**
 * 版本 6（v0.3.0）：阅读器与单词本打通——出处、熟词、高亮与笔记。
 * 位置都是“章节 + 块 + 字符偏移”，与排版无关。offset 是 SQL 关键字，建表时加引号。
 */
export const sql = /* sql */ `
CREATE TABLE word_sources (
  id          TEXT PRIMARY KEY,
  word_id     TEXT NOT NULL REFERENCES words(id),
  book_id     TEXT NOT NULL REFERENCES books(id),
  chapter     INTEGER NOT NULL,
  block       INTEGER NOT NULL,
  "offset"    INTEGER NOT NULL,
  sentence    TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_word_sources_word ON word_sources(word_id);

CREATE TABLE known_words (
  lemma       TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

CREATE TABLE highlights (
  id             TEXT PRIMARY KEY,
  book_id        TEXT NOT NULL REFERENCES books(id),
  start_chapter  INTEGER NOT NULL,
  start_block    INTEGER NOT NULL,
  start_offset   INTEGER NOT NULL,
  end_chapter    INTEGER NOT NULL,
  end_block      INTEGER NOT NULL,
  end_offset     INTEGER NOT NULL,
  text           TEXT NOT NULL,
  color          TEXT NOT NULL CHECK (color IN ('yellow', 'green', 'red', 'blue', 'purple')),
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX idx_highlights_book ON highlights(book_id);
`
