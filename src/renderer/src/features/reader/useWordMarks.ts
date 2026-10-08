/**
 * “在书里遇见单词本里的词”：单词本里的词（包括通过原形匹配到的变形）在正文里加一条淡淡的荧光笔虚线，
 * 今天到期的更明显；熟词和它的所有变形不加任何标记。原形来自词典（lib/lemmas.ts 缓存）。
 */
import { useCallback, useEffect, useMemo } from 'react'
import type { Chapter } from '@shared/domain/book'
import { blockText } from '@shared/domain/book'
import { buildWordIndex, classifyWord, tokenize, type WordIndex } from '@shared/domain/tokenize'
import { ensureLemmas, lemmaOf, useLemmaVersion } from '../../lib/lemmas'
import { useApp, useTodayQueue } from '../../store/app'
import type { MarkKind } from './pieces'

export interface WordMarks {
  index: WordIndex
  classify: (word: string) => MarkKind | null
  /** 单词本里的词 id（没有为 null）；熟词返回 null */
  wordIdOf: (word: string) => string | null
}

export function useWordMarks(chapter: Chapter | null): WordMarks {
  const words = useApp((s) => s.snapshot?.words)
  const known = useApp((s) => s.snapshot?.known)
  const queue = useTodayQueue()
  const version = useLemmaVersion((s) => s.version)

  // 本章的词和单词本里的词都查一次原形
  useEffect(() => {
    const list: string[] = []
    for (const w of words ?? []) list.push(w.text)
    for (const b of chapter?.blocks ?? []) for (const t of tokenize(blockText(b))) list.push(t.text)
    void ensureLemmas(list)
  }, [chapter, words])

  const index = useMemo(
    () => buildWordIndex(words ?? [], known ?? [], lemmaOf),
    // version：原形缓存变了要重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words, known, version]
  )
  const due = useMemo(
    () => new Set(queue?.items.filter((i) => i.kind === 'review').map((i) => i.wordId) ?? []),
    [queue]
  )
  const classify = useCallback(
    (word: string): MarkKind | null => {
      const e = classifyWord(word, index, lemmaOf)
      if (e.known || !e.wordId) return null
      return due.has(e.wordId) ? 'due' : 'meet'
    },
    [index, due]
  )
  const wordIdOf = useCallback(
    (word: string): string | null => classifyWord(word, index, lemmaOf).wordId,
    [index]
  )
  return { index, classify, wordIdOf }
}
