import { describe, expect, it } from 'vitest'
import {
  filterCounts,
  matchesQuery,
  queryItems,
  toLibraryItems,
  type LibraryWordInput
} from './library'
import type { CheckRecord } from './scheduler'

const TODAY = '2024-06-10'

function word(id: string, over: Partial<LibraryWordInput> = {}): LibraryWordInput {
  return {
    id,
    text: id,
    meaning: '',
    pos: '',
    pageNumber: 1,
    rowNo: 1,
    checks: [],
    deleted: false,
    status: 'new',
    learnedOn: null,
    lapses: 0,
    starred: false,
    ...over
  }
}

const ok = (stage: number, doneOn: string): CheckRecord => ({
  stage,
  result: 'ok',
  grade: 3,
  doneOn
})

const WORDS: LibraryWordInput[] = [
  word('zebra', { rowNo: 1, meaning: '斑马', pos: 'n.' }),
  // learned_on 6-09：1天节点今天到期
  word('Apple', {
    rowNo: 2,
    status: 'learning',
    learnedOn: '2024-06-09',
    checks: [ok(0, '2024-06-09')],
    meaning: '苹果'
  }),
  // learned_on 6-06：2天节点 6-08 已拖欠（6天节点 6-12 还没到）
  word('mango', {
    rowNo: 3,
    status: 'learning',
    learnedOn: '2024-06-06',
    checks: [ok(0, '2024-06-06'), ok(1, '2024-06-07')],
    lapses: 3,
    starred: true
  }),
  // 下一节点在未来
  word('banana', {
    rowNo: 4,
    status: 'learning',
    learnedOn: '2024-06-10',
    checks: [ok(0, '2024-06-10')],
    lapses: 1
  }),
  word('kiwi', { rowNo: 5, status: 'mastered', learnedOn: '2024-01-01' }),
  word('lime', { rowNo: 6, status: 'lapsed', learnedOn: '2024-01-01', lapses: 2 }),
  word('pear', { pageNumber: 2, rowNo: 1, deleted: true, meaning: '梨' })
]

describe('词库列表', () => {
  const items = toLibraryItems(WORDS, TODAY)

  it('各筛选项的数量；回收站只含已删除的词，其它筛选不含', () => {
    expect(filterCounts(items)).toEqual({
      all: 6,
      due: 2,
      overdue: 1,
      starred: 1,
      new: 1,
      learning: 3,
      mastered: 1,
      lapsed: 1,
      trash: 1
    })
  })

  it('搜索同时匹配单词和词义，不区分大小写', () => {
    const apple = items.find((i) => i.id === 'Apple')!
    expect(matchesQuery(apple, 'APP')).toBe(true)
    expect(matchesQuery(apple, '苹果')).toBe(true)
    expect(matchesQuery(apple, 'app 苹')).toBe(true)
    expect(matchesQuery(apple, '梨')).toBe(false)
    expect(queryItems(items, 'trash', '梨', 'entry').map((i) => i.id)).toEqual(['pear'])
    expect(queryItems(items, 'all', 'n.', 'entry').map((i) => i.id)).toEqual(['zebra'])
  })

  it('四种排序', () => {
    const ids = (sort: Parameters<typeof queryItems>[3]): string[] =>
      queryItems(items, 'all', '', sort).map((i) => i.id)
    expect(ids('entry')).toEqual(['zebra', 'Apple', 'mango', 'banana', 'kiwi', 'lime'])
    expect(ids('alpha')).toEqual(['Apple', 'banana', 'kiwi', 'lime', 'mango', 'zebra'])
    // mango 6-08（拖欠）→ Apple 6-10 → banana 6-11；没有日期的按录入顺序排在后面
    expect(ids('due')).toEqual(['mango', 'Apple', 'banana', 'zebra', 'kiwi', 'lime'])
    expect(ids('lapses')).toEqual(['mango', 'lime', 'banana', 'zebra', 'Apple', 'kiwi'])
  })
})
