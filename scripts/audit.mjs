/**
 * 设计规范检查（npm run lint 的一部分）：
 * 1. src/ 下不许出现十六进制色值。例外：design.css 和主进程窗口模块 src/main/window.ts。
 * 2. src/ 下不许出现 emoji，也不许用文字字符画勾叉（网格里的勾叉必须用 SVG）。
 * 3. 时区：日期只能经 src/shared/domain/dates.ts 处理（按系统本地时区）。其它文件不许用
 *    getDate / getDay / getHours / getMinutes / getMonth / getFullYear 及对应的 set 方法、
 *    不传 timeZone 的 toLocaleDateString / toLocaleTimeString / toLocaleString，
 *    也不许“先转成 UTC 再截取日期”：toISOString() / toJSON() 截取、getUTCDate 之类、toUTCString。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = process.cwd()
const HEX_ALLOWED = new Set(['src/renderer/src/styles/design.css', 'src/main/window.ts'])
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g

// 文字勾叉（check mark / heavy check mark / ballot x / heavy ballot x）与 emoji 变体选择符。
// 用码点构造，避免这个脚本自己包含这些字符。
const EXTRA_CODEPOINTS = [0x2713, 0x2714, 0x2717, 0x2718, 0xfe0f]
const EMOJI_RE = new RegExp(
  `[\\p{Extended_Pictographic}${EXTRA_CODEPOINTS.map((c) => String.fromCodePoint(c)).join('')}]`,
  'gu'
)
const TEXT_EXT = /\.(ts|tsx|css|html|mjs|js|json|md)$/

const DATES_FILE = 'src/shared/domain/dates.ts'
const TZ_RULES = [
  [/\.(get|set)(Date|Day|Hours|Minutes|Month|FullYear)\s*\(/, '读写系统时区的日期字段'],
  [/\.to(ISOString|JSON)\(\)\s*\.(slice|substring|substr|split)\(/, '截取 UTC 的 ISO 字符串当日期'],
  [/\.getUTC(Date|Day|Hours|Minutes|Month|FullYear)\s*\(/, '先转成 UTC 再取日期字段'],
  [/\.toUTCString\s*\(/, '先转成 UTC 再取日期']
]
const LOCALE_RE = /\.toLocale(Date|Time)?String\s*\(/

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (TEXT_EXT.test(name)) out.push(full)
  }
  return out
}

const problems = []

for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file).split(sep).join('/')
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    if (!HEX_ALLOWED.has(rel)) {
      for (const m of line.matchAll(HEX_RE)) problems.push(`${rel}:${i + 1}  十六进制色值 ${m[0]}`)
    }
    if (rel !== DATES_FILE && /\.(ts|tsx|mjs|js)$/.test(rel)) {
      for (const [re, what] of TZ_RULES) {
        if (re.test(line)) problems.push(`${rel}:${i + 1}  时区：${what}，请改用 dates.ts`)
      }
      if (LOCALE_RE.test(line) && !line.includes('timeZone'))
        problems.push(`${rel}:${i + 1}  时区：toLocale*String 没有传 timeZone，请改用 dates.ts`)
    }
    for (const m of line.matchAll(EMOJI_RE)) {
      const code = m[0].codePointAt(0).toString(16).toUpperCase()
      problems.push(`${rel}:${i + 1}  emoji 或文字勾叉 U+${code}`)
    }
  })
}

if (problems.length > 0) {
  console.error(`设计规范检查未通过（${problems.length} 处）：`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log('设计规范检查通过：src/ 无越界的十六进制色值、无 emoji，日期都经 dates.ts 处理。')
