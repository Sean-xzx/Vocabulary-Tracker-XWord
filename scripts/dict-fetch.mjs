/**
 * 下载 ECDICT（MIT License）的 CSV 与 LICENSE 到 vendor/ecdict/（不进 git）。
 * 依次尝试：GitHub 官方 → jsDelivr → 国内 Git 镜像。
 * 无论从哪里下载，都用 GitHub API 给出的 git blob SHA 核对，并比对表头、抽查词条。
 *
 * 用法：npm run dict:fetch
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const outDir = join(root, 'vendor', 'ecdict')
const REPO = 'skywind3000/ECDICT'
const FILES = ['ecdict.csv', 'LICENSE']
const HEADER =
  'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio'
/** 单个来源超过这么久没有收到新数据，就换下一个来源 */
const STALL_MS = 120_000

const sources = (file, sha) => [
  `https://raw.githubusercontent.com/${REPO}/master/${file}`,
  ...(sha ? [`https://api.github.com/repos/${REPO}/git/blobs/${sha}`] : []),
  `https://github.com/${REPO}/raw/master/${file}`,
  `https://cdn.jsdelivr.net/gh/${REPO}@master/${file}`,
  `https://fastly.jsdelivr.net/gh/${REPO}@master/${file}`,
  `https://gitee.com/mirrors/ECDICT/raw/master/${file}`
]

function blobSha(buf) {
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

async function officialShas() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/`, {
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const list = await res.json()
  return new Map(list.map((f) => [f.name, { sha: f.sha, size: f.size }]))
}

async function download(url) {
  const ctrl = new AbortController()
  let timer = setTimeout(() => ctrl.abort(), STALL_MS)
  const res = await fetch(url, {
    signal: ctrl.signal,
    redirect: 'follow',
    headers: { Accept: 'application/vnd.github.raw' }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const chunks = []
  let got = 0
  let lastLog = 0
  for await (const chunk of res.body) {
    clearTimeout(timer)
    timer = setTimeout(() => ctrl.abort(), STALL_MS)
    chunks.push(chunk)
    got += chunk.length
    if (got - lastLog > 8 * 1024 * 1024) {
      lastLog = got
      console.log(`    ${(got / 1024 / 1024).toFixed(1)} MB`)
    }
  }
  clearTimeout(timer)
  return Buffer.concat(chunks)
}

function spotCheck(buf) {
  const text = buf.toString('utf8')
  const firstLine = text.slice(0, text.indexOf('\n')).replace(/\r$/, '')
  if (firstLine !== HEADER) throw new Error(`表头不一致：${firstLine}`)
  for (const word of ['ability', 'go', 'went', 'abandon']) {
    if (!new RegExp(`\\n${word},`).test(text)) throw new Error(`抽查失败：缺少 ${word}`)
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  let expected = null
  try {
    expected = await officialShas()
  } catch (e) {
    console.warn(`无法读取官方仓库的文件校验值（${e.message}），只做表头和词条抽查`)
  }

  for (const file of FILES) {
    const target = join(outDir, file)
    const want = expected?.get(file)
    if (existsSync(target) && want && blobSha(readFileSync(target)) === want.sha) {
      console.log(`${file} 已存在且与官方一致，跳过`)
      continue
    }
    let ok = false
    for (const url of sources(file, want?.sha)) {
      console.log(`下载 ${file}：${url}`)
      try {
        const buf = await download(url)
        if (want && blobSha(buf) !== want.sha) {
          throw new Error(`内容与官方仓库不一致（${buf.length} 字节，期望 ${want.size}）`)
        }
        if (file === 'ecdict.csv') spotCheck(buf)
        writeFileSync(`${target}.tmp`, buf)
        renameSync(`${target}.tmp`, target)
        console.log(`  完成：${buf.length} 字节${want ? '，git blob SHA 与官方一致' : ''}`)
        ok = true
        break
      } catch (e) {
        console.warn(`  失败：${e.message}${e.cause?.code ? `（${e.cause.code}）` : ''}`)
      }
    }
    if (!ok) {
      console.error(`${file} 在所有来源上都下载失败`)
      process.exit(1)
    }
  }
}

main()
