import { describe, expect, it } from 'vitest'
import { AnchorMapper } from './anchors'
import { blockText, type Chapter } from './book'

const p = (t: string): { k: 'p'; c: { t: string }[] } => ({ k: 'p', c: [{ t }] })

/** v0.3 导入的旧结构：一个大章节，首字母被拆开，没有图片 */
const OLD: Chapter[] = [
  {
    title: 'F OREWORD',
    blocks: [
      p('Copyright 1989.'),
      p('F OREWORD'),
      p('Twenty years ago when I wrote this book, I had no idea.'),
      { k: 'hr', c: [] },
      p('PART ONE'),
      p('There is no real excellence in all this world.'),
      p('There is no real excellence in all this world.')
    ]
  }
]

/** v0.4 重新解析：拆成三章、首字母合并、多了一张图片 */
const NEW: Chapter[] = [
  { title: 'Copyright', blocks: [p('Copyright 1989.')] },
  {
    title: 'FOREWORD',
    blocks: [
      { k: 'h', lv: 1, c: [{ t: 'FOREWORD' }] },
      { k: 'img', c: [], src: 'x.png' },
      p('Twenty years ago when I wrote this book, I had no idea.')
    ]
  },
  {
    title: 'PART ONE',
    blocks: [
      { k: 'h', lv: 1, c: [{ t: 'PART ONE' }] },
      p('There is no real excellence in all this world.'),
      p('There is no real excellence in all this world.')
    ]
  }
]

function textAt(
  chapters: Chapter[],
  a: { chapter: number; block: number; offset: number }
): string {
  return blockText(chapters[a.chapter].blocks[a.block]).slice(a.offset, a.offset + 12)
}

describe('旧锚点转换成新锚点（迁移）', () => {
  const m = new AnchorMapper(OLD, NEW)

  it('阅读位置、高亮端点按原文定位到新的章节 + 块 + 偏移', () => {
    const pos = { chapter: 0, block: 2, offset: 13 }
    const out = m.map(pos)!
    expect(out).toEqual({ chapter: 1, block: 2, offset: 13 })
    expect(textAt(NEW, out)).toBe(textAt(OLD, pos))
    // 块首、被拆开的标题、块尾
    expect(m.map({ chapter: 0, block: 1, offset: 0 })).toEqual({ chapter: 1, block: 0, offset: 0 })
    expect(m.map({ chapter: 0, block: 0, offset: 15 })).toEqual({
      chapter: 0,
      block: 0,
      offset: 15
    })
  })

  it('分隔线上的锚点落到后面第一段；重复出现的句子按全书位置区分', () => {
    expect(m.map({ chapter: 0, block: 3, offset: 0 })).toEqual({ chapter: 2, block: 0, offset: 0 })
    expect(m.map({ chapter: 0, block: 6, offset: 9 })).toEqual({ chapter: 2, block: 2, offset: 9 })
    expect(m.map({ chapter: 0, block: 5, offset: 9 })).toEqual({ chapter: 2, block: 1, offset: 9 })
  })

  it('原文里找不到时返回 null（调用方落到章首并计数）', () => {
    const other = new AnchorMapper(
      [{ title: 'x', blocks: [p('Completely different text here.')] }],
      NEW
    )
    expect(other.map({ chapter: 0, block: 0, offset: 3 })).toBeNull()
    expect(m.map({ chapter: 9, block: 0, offset: 0 })).toBeNull()
  })
})
