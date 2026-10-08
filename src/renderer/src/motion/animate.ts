/**
 * 品牌动效的三个函数（Web Animations API）：
 * - sweep：划 / 写，scaleX 从 0 到 1，变换原点在左侧；
 * - draw：勾，stroke-dashoffset 从 1 到 0（元素需设 pathLength = 1）；reverse 为收回；
 * - fadeSlide：上浮 / 平移淡入淡出（只动 transform 和 opacity）。
 * 每个函数开始前都会取消同一元素上正在播放的动画，保证快速连按时新动画立即接管、不堆积。
 * “减少动态效果”时：划、写、勾直接显示最终状态（不播放，返回 null）；fadeSlide 去掉位移，只保留 ≤120ms 的淡入淡出。
 */
import { prefersReducedMotion } from './reduced'
import { duration, easing } from './tokens'

export interface MotionOptions {
  /** 毫秒；缺省用对应的动效变量 */
  duration?: number
  delay?: number
  easing?: string
  /** 反向播放（收回） */
  reverse?: boolean
}

/** 减少动态效果时保留的最长淡入淡出 */
export const REDUCED_FADE_MAX = 120

/** 取消元素上正在播放的所有动画。 */
export function cancelAnimations(el: Element): void {
  for (const a of el.getAnimations?.() ?? []) a.cancel()
}

/** 立即结束元素上正在播放的动画（跳到最终帧）。 */
export function finishAnimations(el: Element): void {
  for (const a of el.getAnimations?.() ?? []) {
    try {
      a.finish()
    } catch {
      a.cancel()
    }
  }
}

function run(el: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions): Animation {
  cancelAnimations(el)
  return el.animate(keyframes, { fill: 'backwards', ...opts })
}

/** 划 / 写：scaleX，原点在左 */
export function sweep(el: Element, opts: MotionOptions = {}): Animation | null {
  cancelAnimations(el)
  if (prefersReducedMotion()) return null
  const style = (el as HTMLElement | SVGElement).style
  style.transformOrigin = 'left center'
  style.transformBox = 'fill-box'
  const frames = [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }]
  return run(el, opts.reverse ? frames.reverse() : frames, {
    duration: opts.duration ?? duration('--dur-sweep'),
    delay: opts.delay ?? 0,
    easing: opts.easing ?? easing('--ease-stroke'),
    fill: opts.reverse ? 'forwards' : 'backwards'
  })
}

/** 勾：stroke-dashoffset，沿笔画写出（reverse 为按写出的反方向收回） */
export function draw(el: Element, opts: MotionOptions = {}): Animation | null {
  cancelAnimations(el)
  if (prefersReducedMotion()) return null
  const frames = [
    { strokeDasharray: '1', strokeDashoffset: '1' },
    { strokeDasharray: '1', strokeDashoffset: '0' }
  ]
  return run(el, opts.reverse ? frames.reverse() : frames, {
    duration: opts.duration ?? duration('--dur-sweep'),
    delay: opts.delay ?? 0,
    easing: opts.easing ?? easing('--ease-stroke'),
    fill: opts.reverse ? 'forwards' : 'backwards'
  })
}

export interface FadeSlideOptions extends MotionOptions {
  /** in：从偏移处淡入到原位；out：从原位淡出到偏移处 */
  direction?: 'in' | 'out'
  /** 偏移（px），例如 { x: 8 } 表示右侧 8px */
  x?: number
  y?: number
}

/** 上浮 / 平移 + 淡入淡出 */
export function fadeSlide(el: Element, opts: FadeSlideOptions = {}): Animation | null {
  const reduced = prefersReducedMotion()
  const dir = opts.direction ?? 'in'
  const x = reduced ? 0 : (opts.x ?? 0)
  const y = reduced ? 0 : (opts.y ?? 0)
  let ms = opts.duration ?? duration(dir === 'in' ? '--dur-base' : '--dur-micro')
  if (reduced) ms = Math.min(ms, REDUCED_FADE_MAX)
  const offset = { opacity: 0, transform: `translate(${x}px, ${y}px)` }
  const home = { opacity: 1, transform: 'translate(0px, 0px)' }
  return run(el, dir === 'in' ? [offset, home] : [home, offset], {
    duration: ms,
    delay: reduced ? 0 : (opts.delay ?? 0),
    easing: opts.easing ?? easing(dir === 'in' ? '--ease-in' : '--ease-out'),
    fill: dir === 'in' ? 'backwards' : 'forwards'
  })
}

/** FLIP：元素已经在新位置，从旧位置（相对偏移 dx / dy）平滑移回来。减少动态效果时不动。 */
export function flipFrom(
  el: Element,
  dx: number,
  dy: number,
  opts: MotionOptions = {}
): Animation | null {
  cancelAnimations(el)
  if (prefersReducedMotion() || (dx === 0 && dy === 0)) return null
  return run(
    el,
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
    {
      duration: opts.duration ?? duration('--dur-base'),
      delay: opts.delay ?? 0,
      easing: opts.easing ?? easing('--ease-in')
    }
  )
}
