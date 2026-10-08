/** Publication checks: resource integrity, portable links, bilingual commands and private-file exclusion. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'

const root = process.cwd()
const problems = []
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
const forbidden =
  /^(?:node_modules|out|dist|release|vendor|\.test-tmp|\.claude|coverage|docs\/chatgpt-context)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:log|tsbuildinfo)$/

for (const path of tracked) {
  if (forbidden.test(path)) problems.push(`Private/generated file is tracked: ${path}`)
  if (existsSync(path) && statSync(path).size > 50 * 1024 * 1024)
    problems.push(`Review oversized public file: ${path}`)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const manifest = JSON.parse(readFileSync('docs/resources.json', 'utf8'))
if (pkg.version !== manifest.applicationVersion || pkg.version !== lock.version)
  problems.push('Application, lockfile and resource manifest versions differ')

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

for (const resource of [manifest.dictionary, manifest.icon]) {
  if (!existsSync(resource.path)) problems.push(`Missing resource: ${resource.path}`)
  else if (hash(resource.path) !== resource.sha256)
    problems.push(`Resource checksum mismatch: ${resource.path}`)
}
if (!existsSync(manifest.dictionary.licensePath)) problems.push('Missing ECDICT license')
if (existsSync(manifest.dictionary.path)) {
  try {
    const dictionary = JSON.parse(gunzipSync(readFileSync(manifest.dictionary.path)))
    if (dictionary.entries.length !== manifest.dictionary.entries)
      problems.push('Dictionary entry count differs from manifest')
  } catch {
    problems.push('Dictionary cannot be decompressed/parsed')
  }
}
if (hash(manifest.icon.path) !== hash(manifest.icon.sourcePath))
  problems.push('Build icon differs from the original design ICO')

const readmes = ['README.md', 'README.zh-CN.md'].map((path) => readFileSync(path, 'utf8'))
const commands = (text) =>
  [...text.matchAll(/```powershell\s*\n([\s\S]*?)```/g)].map((m) => m[1].trim())
if (JSON.stringify(commands(readmes[0])) !== JSON.stringify(commands(readmes[1])))
  problems.push('English and Chinese README commands differ')
if (!readmes[0].includes('(README.zh-CN.md)') || !readmes[1].includes('(README.md)'))
  problems.push('README language links are missing')
for (const text of readmes) {
  if (!text.includes(pkg.version) || !text.includes('Vocabulary-Tracker-XWord'))
    problems.push('README project name/version missing')
}
if (!existsSync('NOTICE.md') || existsSync('LICENSE') || existsSync('LICENSE.md'))
  problems.push('Expected rights notice without a root project license')

const secret =
  /github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[A-Za-z0-9]{32,}/
const personal = /[A-Z]:[\\/]+Users[\\/]+|[A-Za-z0-9._%+-]+@(qq\.com|163\.com|gmail\.com)/
for (const path of tracked.filter((p) =>
  /\.(?:md|ts|tsx|js|mjs|json|yml|yaml|html|css|txt)$/.test(p)
)) {
  const text = readFileSync(path, 'utf8')
  if (secret.test(text)) problems.push(`Possible credential in public file: ${path}`)
  if (personal.test(text)) problems.push(`Private path/email in public file: ${path}`)
  if (!path.endsWith('.md')) continue
  const prose = text.replace(/```[\s\S]*?```/g, '')
  for (const match of prose.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|#)/.test(target)) continue
    const file = decodeURIComponent(target.split('#')[0])
    if (!file) continue
    const full = resolve(dirname(path), file)
    if (!full.startsWith(root + sep) || !existsSync(full))
      problems.push(`Missing/nonportable link in ${path}: ${target}`)
  }
}

if (problems.length) {
  console.error(`Repository checks failed (${problems.length}):`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(
  `Repository checks passed: ${tracked.length} public files; bilingual commands, links and resource hashes verified.`
)
