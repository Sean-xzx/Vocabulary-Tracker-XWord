/**
 * 正文上的一次性动效（只动 transform 和 opacity）：在文字所在的每一行上放一个临时的块，
 * - underline：收词后荧光笔下划线从左往右划出（200ms）；
 * - highlight：新建高亮时荧光笔从左往右划出（200ms），划完再换成真正的高亮底色；
 * - flash：跳转到出处 / 高亮后，用选中色标出那段文字，随后淡去。
 * 多行时按行依次划出，总时长仍是 200ms。减少动态效果时不播放，直接显示最终状态。
 */
import type { HighlightColor } from '@shared/api'
import { duration, fadeSlide, sweep } from '../../motion'

export type FxKind = 'underline' | 'highlight' | 'flash'

function layerOf(page: HTMLElement): HTMLElement {
  let layer = page.querySelector<HTMLElement>(':scope > .reader-fx')
  if (!layer) {
    layer = document.createElement('div')
    layer.className = 'reader-fx'
    layer.setAttribute('aria-hidden', 'true')
    page.appendChild(layer)
  }
  return layer
}

/** 播放动效，全部结束后 resolve */
export async function playFx(
  page: HTMLElement,
  range: Range,
  kind: FxKind,
  color: HighlightColor = 'yellow',
  /** 只画在这个区域里（分页时别的页上的部分不画） */
  clip: DOMRect | null = null
): Promise<void> {
  const layer = layerOf(page)
  const base = page.getBoundingClientRect()
  const rects = Array.from(range.getClientRects()).filter(
    (r) =>
      r.width > 1 &&
      r.height > 1 &&
      (!clip ||
        (r.right > clip.left && r.left < clip.right && r.bottom > clip.top && r.top < clip.bottom))
  )
  if (rects.length === 0) return
  const total = duration('--dur-sweep')
  const each = total / rects.length
  const jobs = rects.map((r, i) => {
    const el = document.createElement('div')
    el.className = `fx fx-${kind} fx-${color}`
    const top = kind === 'underline' ? r.bottom - base.top - 3 : r.top - base.top
    el.style.left = `${r.left - base.left}px`
    el.style.top = `${top}px`
    el.style.width = `${r.width}px`
    el.style.height = kind === 'underline' ? '2px' : `${r.height}px`
    layer.appendChild(el)
    const anim =
      kind === 'flash'
        ? fadeSlide(el, { direction: 'out', delay: 1200, duration: duration('--dur-flash') })
        : sweep(el, { duration: Math.max(1, each), delay: i * each })
    const done = anim ? anim.finished.catch(() => undefined) : Promise.resolve()
    return done
      .then(async () => {
        // 下划线划出后慢慢淡去，留下单词本的虚线标记
        if (kind !== 'underline' || !anim) return
        const out = fadeSlide(el, { direction: 'out', duration: duration('--dur-flash') })
        await out?.finished.catch(() => undefined)
      })
      .then(() => el.remove())
  })
  await Promise.all(jobs)
}
