/** 版本 7（v0.3.0）：DeepSeek 翻译 / 解释的缓存。hash 是原文的 SHA-256。 */
export const sql = /* sql */ `
CREATE TABLE translations (
  hash        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('translate', 'explain')),
  result      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (hash, kind)
);
`
