/**
 * 开发用示例数据。检查记录通过调度核心按天“模拟评分”生成，保证与规则一致。
 *
 * 设今天为 T：
 * - 第 1 页（T-6 开始）12 个词：T-6 完成第1遍，T-5 完成 1天，T-4 完成 2天（有几个 fail）；今天轮到 6天节点。
 * - 第 2 页（T-1 开始）8 个词：昨天完成第1遍；今天轮到 1天节点。
 * - 第 3 页（T-10 开始）3 个词：只完成了第1遍和 1天；2天、6天都已逾期，今天考 6天，2天记为漏。
 * - 第 4 页（今天开始）5 个新词。
 * 今日队列 = 12 + 8 + 3 个复习词 + 5 个新词 = 28。
 */
import { addDays, type DateStr } from '../../shared/domain/dates'
import {
  STAGES,
  applyOutcome,
  gradeWord,
  type Grade,
  type GradeSnapshot
} from '../../shared/domain/scheduler'
import type { SqlDb } from './connection'

interface SampleWord {
  text: string
  pos: string
  meaning: string
  example?: string
  mnemonic?: string
  /** 依次对 stage 0、1、2… 的评分。 */
  grades?: Grade[]
}

interface SamplePage {
  offset: number
  words: SampleWord[]
}

const PAGES: SamplePage[] = [
  {
    offset: -6,
    words: [
      {
        text: 'abandon',
        pos: 'vt.',
        meaning: '放弃；抛弃',
        example: 'They had to abandon the car in the snow.',
        mnemonic: 'a + band（乐队）+ on：乐队散了，只好放弃',
        grades: [3, 3, 4]
      },
      { text: 'ability', pos: 'n.', meaning: '能力；才能', grades: [4, 4, 4] },
      { text: 'absorb', pos: 'vt.', meaning: '吸收；使专心', grades: [3, 2, 3] },
      { text: 'abstract', pos: 'adj.', meaning: '抽象的；n. 摘要', grades: [2, 1, 3] },
      { text: 'academic', pos: 'adj.', meaning: '学术的；学院的', grades: [3, 3, 3] },
      {
        text: 'accelerate',
        pos: 'v.',
        meaning: '加速；促进',
        example: 'The car accelerated away from the lights.',
        grades: [3, 1, 3]
      },
      { text: 'access', pos: 'n.', meaning: '通道；接近；v. 访问', grades: [3, 3, 2] },
      {
        text: 'accommodate',
        pos: 'vt.',
        meaning: '容纳；为……提供住宿',
        mnemonic: '双 c 双 m：房间够大，容得下两个 c 和两个 m',
        grades: [2, 1, 1]
      },
      { text: 'accompany', pos: 'vt.', meaning: '陪伴；伴随', grades: [3, 4, 3] },
      { text: 'accomplish', pos: 'vt.', meaning: '完成；实现', grades: [3, 3, 3] },
      { text: 'accurate', pos: 'adj.', meaning: '准确的；精确的', grades: [3, 2, 1] },
      { text: 'achieve', pos: 'vt.', meaning: '达到；取得', grades: [4, 3, 4] }
    ]
  },
  {
    offset: -1,
    words: [
      { text: 'adapt', pos: 'v.', meaning: '适应；改编', grades: [3] },
      { text: 'adequate', pos: 'adj.', meaning: '足够的；适当的', grades: [3] },
      { text: 'adjust', pos: 'v.', meaning: '调整；适应', grades: [4] },
      { text: 'admire', pos: 'vt.', meaning: '钦佩；欣赏', grades: [3] },
      { text: 'adopt', pos: 'vt.', meaning: '采用；收养', grades: [3] },
      { text: 'advocate', pos: 'vt.', meaning: '提倡；n. 拥护者', grades: [2] },
      { text: 'affection', pos: 'n.', meaning: '喜爱；感情', grades: [3] },
      {
        text: 'aggressive',
        pos: 'adj.',
        meaning: '好斗的；有进取心的',
        example: 'He is an aggressive salesman.',
        grades: [1]
      }
    ]
  },
  {
    offset: -10,
    words: [
      { text: 'allocate', pos: 'vt.', meaning: '分配；拨给', grades: [3, 3] },
      { text: 'ambiguous', pos: 'adj.', meaning: '模棱两可的；含糊的', grades: [3, 2] },
      { text: 'anticipate', pos: 'vt.', meaning: '预期；期望', grades: [2, 1] }
    ]
  },
  {
    offset: 0,
    words: [
      { text: 'apparent', pos: 'adj.', meaning: '明显的；表面上的' },
      { text: 'appreciate', pos: 'vt.', meaning: '欣赏；感激；理解' },
      { text: 'approach', pos: 'n.', meaning: '方法；途径；v. 接近' },
      { text: 'appropriate', pos: 'adj.', meaning: '适当的；恰当的' },
      { text: 'approve', pos: 'v.', meaning: '批准；赞成' }
    ]
  }
]

/** 当天北京时间 09:00 */
function moment(day: DateStr): string {
  return `${day}T09:00:00.000+08:00`
}

export function fillSampleData(db: SqlDb, today: DateStr): void {
  PAGES.forEach((page, pageIndex) => {
    const startedOn = addDays(today, page.offset)
    const pageId = globalThis.crypto.randomUUID()
    db.run('INSERT INTO pages (id, number, started_on, created_at) VALUES (?, ?, ?, ?)', [
      pageId,
      pageIndex + 1,
      startedOn,
      moment(startedOn)
    ])

    page.words.forEach((w, i) => {
      const wordId = globalThis.crypto.randomUUID()
      let state: GradeSnapshot = {
        word: { status: 'new', learnedOn: null, lapses: 0, starred: false },
        checks: []
      }
      const logs: { stage: number; grade: Grade; day: DateStr }[] = []
      ;(w.grades ?? []).forEach((grade, stage) => {
        const day = addDays(startedOn, STAGES[stage])
        const outcome = gradeWord(state.word, state.checks, day, grade)
        state = applyOutcome(state, outcome)
        logs.push({ stage: outcome.stage, grade, day })
      })

      const lastDay = logs.length > 0 ? logs[logs.length - 1].day : startedOn
      db.run(
        `INSERT INTO words (id, page_id, row_no, text, meaning, pos, example, mnemonic, learned_on, status,
                            lapses, starred, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          wordId,
          pageId,
          i + 1,
          w.text,
          w.meaning,
          w.pos,
          w.example ?? '',
          w.mnemonic ?? '',
          state.word.learnedOn,
          state.word.status,
          state.word.lapses,
          state.word.starred ? 1 : 0,
          moment(startedOn),
          moment(lastDay)
        ]
      )
      for (const c of state.checks) {
        db.run(
          'INSERT INTO checks (word_id, stage, result, grade, done_on) VALUES (?, ?, ?, ?, ?)',
          [wordId, c.stage, c.result, c.grade, c.doneOn]
        )
      }
      for (const log of logs) {
        db.run(
          'INSERT INTO review_log (id, word_id, stage, grade, is_retry, reviewed_at) VALUES (?, ?, ?, ?, 0, ?)',
          [globalThis.crypto.randomUUID(), wordId, log.stage, log.grade, moment(log.day)]
        )
      }
    })
  })
}

/** 手算的今日队列数量，测试用来核对。 */
export const SAMPLE_EXPECTED_QUEUE = { review: 23, overdue: 3, new: 5, total: 28 }
