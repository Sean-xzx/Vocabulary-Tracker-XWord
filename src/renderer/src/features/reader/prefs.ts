/**
 * 页面设置（每本书各记一份，存在本地）：字号 16–24px、行高 1.4–1.9、页边距（窄 / 中 / 宽）、单页 / 双页、
 * 原书版式 / 统一版式；PDF 另有缩放（适合宽度 / 适合页面 / 75%–200%）。深浅色跟随全局设置。
 */
import type { MarginSize } from '@shared/domain/pagination'
import { readLocal, writeLocal } from '../../lib/storage'

export type Spread = 'single' | 'double'
export type LayoutMode = 'original' | 'unified'
export type PdfZoom = 'width' | 'page' | number

export interface ReaderPrefs {
  fontSize: number
  lineHeight: number
  margin: MarginSize
  spread: Spread
  layout: LayoutMode
  zoom: PdfZoom
}

export const PREF_LIMITS = {
  fontSize: { min: 16, max: 24, step: 1 },
  lineHeight: { min: 1.4, max: 1.9, step: 0.05 }
} as const

export const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const

export const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: 19,
  lineHeight: 1.6,
  margin: 'medium',
  spread: 'double',
  layout: 'original',
  // PDF 默认适合页面：整页（双页时两页）都在窗口里，不用上下滚动
  zoom: 'page'
}

const KEY = 'xword.readerPrefs.'

function clamp(v: unknown, lim: { min: number; max: number }, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.round(Math.min(lim.max, Math.max(lim.min, v)) * 100) / 100
    : fallback
}

function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback
}

export function loadPrefs(bookId: string): ReaderPrefs {
  try {
    const raw = JSON.parse(readLocal(KEY + bookId) ?? '{}') as Partial<ReaderPrefs>
    const zoom =
      raw.zoom === 'width' || raw.zoom === 'page'
        ? raw.zoom
        : typeof raw.zoom === 'number'
          ? clamp(raw.zoom, { min: 0.75, max: 2 }, 1)
          : DEFAULT_PREFS.zoom
    return {
      fontSize: clamp(raw.fontSize, PREF_LIMITS.fontSize, DEFAULT_PREFS.fontSize),
      lineHeight: clamp(raw.lineHeight, PREF_LIMITS.lineHeight, DEFAULT_PREFS.lineHeight),
      margin: oneOf(raw.margin, ['narrow', 'medium', 'wide'], DEFAULT_PREFS.margin),
      spread: oneOf(raw.spread, ['single', 'double'], DEFAULT_PREFS.spread),
      layout: oneOf(raw.layout, ['original', 'unified'], DEFAULT_PREFS.layout),
      zoom
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(bookId: string, p: ReaderPrefs): void {
  writeLocal(KEY + bookId, JSON.stringify(p))
}
