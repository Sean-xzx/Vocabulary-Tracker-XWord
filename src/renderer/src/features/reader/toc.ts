/**
 * 目录：当前位置对应的目录项、按“前言部分 / 正文 / 附录”分组。
 */
import type { TocEntry, TocGroup } from '@shared/domain/book'

/** 当前位置对应的目录项：位置之前（含）的最后一项 */
export function currentTocIndex(toc: readonly TocEntry[], chapter: number, block: number): number {
  let found = -1
  toc.forEach((e, i) => {
    if (e.chapter < chapter || (e.chapter === chapter && e.block <= block)) found = i
  })
  return found
}

export const TOC_GROUP_NAMES: Record<TocGroup, string> = {
  front: '前言部分',
  body: '正文',
  back: '附录'
}

/** 按分组切开（保持原顺序）；只有正文一组时不显示组名 */
export function groupToc(
  toc: readonly TocEntry[]
): { group: TocGroup; items: { entry: TocEntry; index: number }[] }[] {
  const out: { group: TocGroup; items: { entry: TocEntry; index: number }[] }[] = []
  toc.forEach((entry, index) => {
    const group = entry.group ?? 'body'
    const last = out[out.length - 1]
    if (last && last.group === group) last.items.push({ entry, index })
    else out.push({ group, items: [{ entry, index }] })
  })
  return out
}
