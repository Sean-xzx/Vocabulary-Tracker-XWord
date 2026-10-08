/**
 * 读取 design.css 里的动效变量。时长和缓动只能来自这些变量；
 * “减少动态效果”时 design.css 会把时长改短或归零，这里读到的值也随之变化。
 */
export type DurationToken =
  | '--dur-micro'
  | '--dur-base'
  | '--dur-panel'
  | '--dur-panel-out'
  | '--dur-sweep'
  | '--dur-flash'
  | '--stagger'
  | '--dur-write'
  | '--dur-stroke'
  | '--dur-check'
  | '--dur-splash-out'

export type EasingToken = '--ease-in' | '--ease-out' | '--ease-stroke'

/** 变量读不到时的回退值（与 design.css 一致） */
const DURATION_FALLBACK: Record<DurationToken, number> = {
  '--dur-micro': 120,
  '--dur-base': 180,
  '--dur-panel': 240,
  '--dur-panel-out': 170,
  '--dur-sweep': 200,
  '--dur-flash': 600,
  '--stagger': 40,
  '--dur-write': 150,
  '--dur-stroke': 100,
  '--dur-check': 300,
  '--dur-splash-out': 130
}

const EASING_FALLBACK: Record<EasingToken, string> = {
  '--ease-in': 'cubic-bezier(0.2, 0, 0, 1)',
  '--ease-out': 'cubic-bezier(0.4, 0, 1, 1)',
  '--ease-stroke': 'cubic-bezier(0.65, 0, 0.35, 1)'
}

function readVar(name: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** 把 “120ms” / “0.2s” 解析成毫秒；解析不了返回 null */
export function parseDuration(raw: string): number | null {
  const v = raw.trim()
  if (v.endsWith('ms')) return Number.parseFloat(v)
  if (v.endsWith('s')) return Number.parseFloat(v) * 1000
  return null
}

export function duration(name: DurationToken): number {
  const parsed = parseDuration(readVar(name))
  return parsed !== null && Number.isFinite(parsed) ? parsed : DURATION_FALLBACK[name]
}

export function easing(name: EasingToken): string {
  return readVar(name) || EASING_FALLBACK[name]
}
