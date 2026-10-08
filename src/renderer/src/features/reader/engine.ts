/**
 * 阅读外壳（ReaderView）和两种书页引擎（EPUB / TXT 的书页排版、PDF 的原版页面）之间的接口。
 * 外壳负责顶栏、底栏、目录、页面设置、查词、收词、高亮、翻译；引擎负责排版、翻页、锚点和 DOM 之间的换算。
 */
import type { BookPosition } from '@shared/api'
import type { Chapter } from '@shared/domain/book'

export interface PagesStatus {
  /** 当前章节（PDF：当前页所在的书签章节，没有书签时为 -1） */
  chapter: number
  chapterTitle: string
  /** 当前这一屏开头的锚点（保存阅读位置用） */
  anchor: BookPosition
  /** 全书页码（从 1 开始）；还没算出来为 null */
  page: number | null
  total: number | null
  /** 本章剩余页数；未知为 null */
  chapterLeft: number | null
  /** 全书进度 0–1 */
  progress: number
  /** 每个目录项的全书页码（未知为 null） */
  tocPages: readonly (number | null)[]
  /** 正文开始的章节（前面是封面、书名页、目录、前言）；没有分类时为 null */
  bodyStart: number | null
  /** 正文之前一共几页；还没算出来为 null */
  frontPages: number | null
  /** 当前章节的数据（EPUB / TXT；PDF 为 null） */
  data: Chapter | null
  /** 这一屏的文字已经排好，可以点词、选中 */
  ready: boolean
}

export interface PagesApi {
  next(): void
  prev(): void
  chapterStart(): void
  chapterEnd(): void
  /** 上一章 / 下一章 */
  chapter(delta: -1 | 1): void
  /** 跳到锚点所在的页；flashEnd 给出时，标出 [pos, flashEnd) 这段文字 */
  goTo(pos: BookPosition, flashEnd?: BookPosition): void
  /** 跳到全书第 n 页；页数还不知道时返回 false */
  goToPage(n: number): boolean
  /** DOM 位置 → 锚点；不在正文里返回 null */
  positionOf(node: Node, offset: number): BookPosition | null
  /** 锚点所在的文字单元（EPUB：块；PDF：页的文字层）。lines 为 true 时按行拼接（PDF） */
  unitText(pos: BookPosition): { text: string; lines: boolean } | null
  /** 两个锚点之间的 DOM Range（只在当前渲染的内容里） */
  rangeOf(start: BookPosition, end: BookPosition): Range | null
  /** 动效层所在的元素（playFx 的 page）和可见的正文区域（动效只画在这里面） */
  fxHost(): HTMLElement | null
  visibleRect(): DOMRect | null
}
