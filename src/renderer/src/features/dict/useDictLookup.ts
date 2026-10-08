/**
 * 查词典（IPC dictLookup）。词典还在后台加载时每 300ms 重试一次，直到有结果。
 * 只保留最后一次查询的结果，过时的回应直接丢弃。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DictLookupResult } from '@shared/api'

const RETRY_MS = 300

export interface DictLookup {
  /** 正在查 / 查过的词；null 表示没有查询 */
  query: string | null
  result: DictLookupResult | null
  run: (word: string) => Promise<DictLookupResult | null>
  clear: () => void
}

export async function lookupOnce(word: string): Promise<DictLookupResult> {
  try {
    return await window.xword.dictLookup(word)
  } catch {
    return { status: 'unavailable' }
  }
}

export function useDictLookup(): DictLookup {
  const [query, setQuery] = useState<string | null>(null)
  const [result, setResult] = useState<DictLookupResult | null>(null)
  const request = useRef(0)

  useEffect(
    () => () => {
      request.current++
    },
    []
  )

  const run = useCallback(async (word: string): Promise<DictLookupResult | null> => {
    const id = ++request.current
    setQuery(word)
    setResult({ status: 'loading' })
    for (;;) {
      const r = await lookupOnce(word)
      if (id !== request.current) return null
      setResult(r)
      if (r.status !== 'loading') return r
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
      if (id !== request.current) return null
    }
  }, [])

  const clear = useCallback(() => {
    request.current++
    setQuery(null)
    setResult(null)
  }, [])

  return { query, result, run, clear }
}
