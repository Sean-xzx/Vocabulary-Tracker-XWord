/**
 * 从 vendor/ecdict/ecdict.csv 生成打包用的精简词典 resources/dict/ecdict-lite.json.gz（只用 Node 自带的 zlib）。
 *
 * 裁剪规则：
 * 1. 只保留有中文释义（translation）的词条；
 * 2. 必须保留：带任何考试标签（tag）的词、牛津 3000 核心词（oxford = 1）、柯林斯星级词（collins >= 1）；
 * 3. 在此基础上按词频（frq，其次 bnc，数字越小越常用）补充常用词；有词频的词用完后，
 *    再按“单个英文单词且有音标 → 单个英文单词 → 词组”、同一档内词越短越优先的顺序补充没有词频的词条，
 *    直到压缩后接近但不超过 15 MB。
 * 每个词条只保留 word、phonetic、translation、tag、oxford、collins、exchange。
 *
 * 用法：npm run dict:build（先 npm run dict:fetch 下载 CSV）
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = process.cwd()
const csvPath = join(root, 'vendor', 'ecdict', 'ecdict.csv')
const licensePath = join(root, 'vendor', 'ecdict', 'LICENSE')
const outDir = join(root, 'resources', 'dict')
const outFile = join(outDir, 'ecdict-lite.json.gz')
/** 不超过 15 MB（按 15,000,000 字节算，两种“MB”口径都满足） */
const MAX_BYTES = 15_000_000
const FIELDS = ['word', 'phonetic', 'translation', 'tag', 'oxford', 'collins', 'exchange']
const EXAM_TAGS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre']

if (!existsSync(csvPath)) {
  console.error('找不到 vendor/ecdict/ecdict.csv，请先运行 npm run dict:fetch')
  process.exit(1)
}

/** 逐字符解析 CSV（支持引号、引号内的逗号与换行、"" 转义）。 */
function* parseCsv(text) {
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      yield row
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    yield row
  }
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'))
const header = rows.next().value
const col = Object.fromEntries(header.map((name, i) => [name, i]))

let total = 0
const all = []
for (const r of rows) {
  if (r.length < header.length) continue
  total++
  // CSV 里的换行写成字面的 \n
  const translation = r[col.translation].replace(/\\n/g, '\n').replace(/\\r/g, '').trim()
  if (translation === '') continue
  const tags = r[col.tag].split(/\s+/).filter(Boolean)
  all.push({
    word: r[col.word],
    phonetic: r[col.phonetic],
    translation,
    tag: tags.join(' '),
    oxford: r[col.oxford] === '1' ? 1 : 0,
    collins: Number(r[col.collins]) || 0,
    exchange: r[col.exchange],
    frq: Number(r[col.frq]) || 0,
    bnc: Number(r[col.bnc]) || 0,
    exam: tags.some((t) => EXAM_TAGS.includes(t))
  })
}

const unknownTags = new Set(all.flatMap((e) => e.tag.split(' ').filter(Boolean)))
for (const t of EXAM_TAGS) unknownTags.delete(t)

const must = all.filter((e) => e.tag !== '' || e.oxford === 1 || e.collins >= 1)
const mustSet = new Set(must)
const SINGLE_WORD = /^[a-z][a-z'-]*$/i
/** 只有 [网络] 之类领域释义、没有词性释义的词条排在同档的后面 */
const hasPos = (e) => e.translation.split('\n').some((l) => !l.startsWith('['))
function tier(e) {
  if (e.frq > 0) return 0
  if (e.bnc > 0) return 1
  const single = SINGLE_WORD.test(e.word)
  if (single && e.phonetic && hasPos(e)) return 2
  if (single && hasPos(e)) return 3
  if (single) return 4
  if (hasPos(e)) return 5
  return 6
}
const withTier = all.filter((e) => !mustSet.has(e)).map((e) => ({ e, t: tier(e) }))
withTier.sort(
  (a, b) =>
    a.t - b.t ||
    (a.t === 0
      ? a.e.frq - b.e.frq
      : a.t === 1
        ? a.e.bnc - b.e.bnc
        : a.e.word.length - b.e.word.length)
)
const extra = withTier.map((x) => x.e)
const tierOf = new Map(withTier.map((x) => [x.e, x.t]))

function pack(entries) {
  const sorted = [...entries].sort((a, b) => {
    const x = a.word.toLowerCase()
    const y = b.word.toLowerCase()
    return x < y ? -1 : x > y ? 1 : a.word < b.word ? -1 : a.word > b.word ? 1 : 0
  })
  // 合法的 JSON，同时每个词条独占一行：运行时不必整体解析，按行二分查找即可
  const head = JSON.stringify({
    format: 1,
    source: 'ECDICT https://github.com/skywind3000/ECDICT',
    license: 'MIT',
    fields: FIELDS
  }).slice(0, -1)
  const lines = sorted.map((e) => JSON.stringify(FIELDS.map((f) => e[f])))
  const json = `${head},"entries":[\n${lines.join(',\n')}\n]}\n`
  return gzipSync(json, { level: 9 })
}

const base = pack(must)
if (base.length > MAX_BYTES) {
  console.error(`必须保留的词条压缩后已有 ${base.length} 字节，超过上限`)
  process.exit(1)
}

// 二分查找能补充的最多词数。先从上次结果附近开始，省时间；环境变量 DICT_FULL_SEARCH=1 时从头二分
let lo = 0
let hi = extra.length
let best = base
if (!process.env.DICT_FULL_SEARCH) {
  const guess = Math.min(640_000, extra.length)
  const buf = pack([...must, ...extra.slice(0, guess)])
  if (buf.length <= MAX_BYTES) {
    lo = guess
    best = buf
  }
}
while (lo < hi) {
  const mid = Math.ceil((lo + hi) / 2)
  const buf = pack([...must, ...extra.slice(0, mid)])
  if (buf.length <= MAX_BYTES) {
    lo = mid
    best = buf
  } else hi = mid - 1
  console.log(`  补充 ${mid} 个词 → ${(buf.length / 1e6).toFixed(2)} MB`)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, best)
copyFileSync(licensePath, join(outDir, 'ECDICT-LICENSE.txt'))

const stats = {
  csvRows: total,
  withTranslation: all.length,
  examTag: all.filter((e) => e.exam).length,
  anyTag: all.filter((e) => e.tag !== '').length,
  oxford: all.filter((e) => e.oxford === 1).length,
  collins: all.filter((e) => e.collins >= 1).length,
  mustKeep: must.length,
  supplemented: lo,
  supplementedByTier: extra
    .slice(0, lo)
    .reduce((acc, e) => ((acc[tierOf.get(e)] = (acc[tierOf.get(e)] ?? 0) + 1), acc), {}),
  tierSizes: withTier.reduce((acc, x) => ((acc[x.t] = (acc[x.t] ?? 0) + 1), acc), {}),
  total: must.length + lo,
  bytes: best.length,
  otherTags: [...unknownTags]
}
console.log(JSON.stringify(stats, null, 2))
