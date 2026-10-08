import type { HighlightColor } from '@shared/api'

/** 高亮颜色沿用 XNote 的语义 */
export const HIGHLIGHT_NAMES: Record<HighlightColor, string> = {
  yellow: '重点',
  green: '已懂',
  red: '疑问',
  blue: '待查',
  purple: '灵感'
}
