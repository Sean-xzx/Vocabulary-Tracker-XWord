import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REDUCED_FADE_MAX, draw, fadeSlide, flipFrom, sweep } from './animate'

/** 最小的假元素：记录 animate() 调用，getAnimations() 返回还没被取消的动画 */
class FakeAnimation {
  cancelled = false
  constructor(
    public keyframes: Keyframe[],
    public options: KeyframeAnimationOptions
  ) {}
  cancel(): void {
    this.cancelled = true
  }
  finish(): void {
    this.cancelled = false
  }
  finished = Promise.resolve()
}

class FakeElement {
  style: Record<string, string> = {}
  all: FakeAnimation[] = []
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): FakeAnimation {
    const a = new FakeAnimation(keyframes, options)
    this.all.push(a)
    return a
  }
  getAnimations(): FakeAnimation[] {
    return this.all.filter((a) => !a.cancelled)
  }
}

let reduced = false

beforeEach(() => {
  reduced = false
  vi.stubGlobal('window', {
    matchMedia: () => ({
      matches: reduced,
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const el = (): FakeElement & Element => new FakeElement() as unknown as FakeElement & Element

describe('动效工具', () => {
  it('新动画会取消同一元素上正在播放的旧动画（划、勾、淡入淡出、FLIP）', () => {
    for (const run of [
      (e: Element) => sweep(e),
      (e: Element) => draw(e),
      (e: Element) => fadeSlide(e, { x: 8 }),
      (e: Element) => flipFrom(e, 0, -46)
    ]) {
      const e = el()
      const first = run(e) as unknown as FakeAnimation
      const second = run(e) as unknown as FakeAnimation
      expect(first.cancelled).toBe(true)
      expect(second.cancelled).toBe(false)
      expect(e.getAnimations()).toEqual([second])
    }
  })

  it('划用 scaleX、原点在左；勾用 stroke-dashoffset；时长来自动效变量', () => {
    const e = el()
    const s = sweep(e) as unknown as FakeAnimation
    expect(s.keyframes).toEqual([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }])
    expect((e as unknown as FakeElement).style.transformOrigin).toBe('left center')
    expect(s.options.duration).toBe(200)
    const d = draw(el(), { reverse: true, duration: 120 }) as unknown as FakeAnimation
    expect(d.keyframes.map((k) => k.strokeDashoffset)).toEqual(['0', '1'])
    expect(d.options.duration).toBe(120)
  })

  it('减少动态效果：划、写、勾直接显示最终状态（不播放，并取消旧动画）；淡入淡出去掉位移、不超过 120ms', () => {
    const e = el()
    const old = sweep(e) as unknown as FakeAnimation
    reduced = true
    expect(sweep(e)).toBeNull()
    expect(old.cancelled).toBe(true)
    expect(draw(e)).toBeNull()
    expect(flipFrom(e, 0, -46)).toBeNull()
    expect((e as unknown as FakeElement).all).toHaveLength(1)

    const f = fadeSlide(el(), { x: 8, duration: 180, delay: 120 }) as unknown as FakeAnimation
    expect(f.keyframes[0]).toEqual({ opacity: 0, transform: 'translate(0px, 0px)' })
    expect(f.options.duration).toBe(REDUCED_FADE_MAX)
    expect(f.options.delay).toBe(0)
  })
})
