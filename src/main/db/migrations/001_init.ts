/** 版本 1：五张基础表。 */
export const sql = /* sql */ `
CREATE TABLE pages (
  id          TEXT PRIMARY KEY,
  number      INTEGER NOT NULL UNIQUE,
  started_on  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE words (
  id          TEXT PRIMARY KEY,
  page_id     TEXT NOT NULL REFERENCES pages(id),
  row_no      INTEGER NOT NULL,
  text        TEXT NOT NULL,
  meaning     TEXT NOT NULL DEFAULT '',
  pos         TEXT NOT NULL DEFAULT '',
  example     TEXT NOT NULL DEFAULT '',
  mnemonic    TEXT NOT NULL DEFAULT '',
  learned_on  TEXT,
  status      TEXT NOT NULL DEFAULT 'new'
              CHECK (status IN ('new', 'learning', 'mastered', 'lapsed')),
  lapses      INTEGER NOT NULL DEFAULT 0,
  starred     INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX idx_words_page_row ON words(page_id, row_no);

CREATE TABLE checks (
  word_id  TEXT NOT NULL REFERENCES words(id),
  stage    INTEGER NOT NULL CHECK (stage BETWEEN 0 AND 5),
  result   TEXT NOT NULL CHECK (result IN ('ok', 'fail', 'missed')),
  grade    INTEGER CHECK (grade BETWEEN 1 AND 4),
  done_on  TEXT NOT NULL,
  PRIMARY KEY (word_id, stage),
  CHECK ((result = 'missed') = (grade IS NULL))
);

CREATE TABLE review_log (
  id           TEXT PRIMARY KEY,
  word_id      TEXT NOT NULL REFERENCES words(id),
  stage        INTEGER NOT NULL CHECK (stage BETWEEN 0 AND 5),
  grade        INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 4),
  is_retry     INTEGER NOT NULL DEFAULT 0 CHECK (is_retry IN (0, 1)),
  reviewed_at  TEXT NOT NULL
);
CREATE INDEX idx_review_log_word ON review_log(word_id);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`
