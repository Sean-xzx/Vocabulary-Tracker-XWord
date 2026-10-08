/**
 * 原形缓存（渲染进程）：一批词的原形向主进程的词典查询一次，结果缓存起来，同步地给分词和标记使用。
 * 词典还在后台加载时稍后重试。缓存有变化时 version 递增，订阅它的组件重新计算标记。
 */
import { create } from 'zustand'
import { normalizeWord, type LemmaOf } from '@shared/domain/tokenize'

const cache = new Map<string, string>()
const BATCH = 5000
const RETRY_MS = 500
const MAX_TRIES = 60

export const useLemmaVersion = create<{ version: number }>(() => ({ version: 0 }))

export const lemmaOf: LemmaOf = (normalized) => cache.get(normalized)

/** 保证这些词（任意大小写）的原形已在缓存里；返回是否全部就绪 */
export async function ensureLemmas(words: Iterable<string>): Promise<boolean> {
  const missing = new Set<string>()
  for (const w of words) {
    const n = normalizeWord(w)
    if (n && !cache.has(n)) missing.add(n)
    const bare = n.replace(/'s$/, '')
    if (bare !== n && !cache.has(bare)) missing.add(bare)
  }
  if (missing.size === 0) return true
  const list = [...missing]
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH)
    let result: Record<string, string> | null = null
    for (let tries = 0; tries < MAX_TRIES && !result; tries++) {
      try {
        result = await window.xword.dictLemmas(batch)
      } catch {
        return false
      }
      if (!result) await new Promise((r) => setTimeout(r, RETRY_MS))
    }
    if (!result) return false
    for (const [w, l] of Object.entries(result)) cache.set(w, l)
  }
  useLemmaVersion.setState((s) => ({ version: s.version + 1 }))
  return true
}
