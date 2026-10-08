/** 版本 2（v0.2.0）：单词增加音标，录入时从词典带入。 */
export const sql = /* sql */ `
ALTER TABLE words ADD COLUMN phonetic TEXT NOT NULL DEFAULT '';
`
