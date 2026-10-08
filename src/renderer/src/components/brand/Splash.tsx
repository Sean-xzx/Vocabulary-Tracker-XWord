/**
 * 冷启动开屏：本子淡入 120 → 荧光笔划过 200 → 单词墨线写出 150 → 勾写出 200 → 开屏淡出、主界面淡入 130（约 800ms）。
 * 与数据加载并行，不拖慢加载：主界面在数据就绪后就已经在下面渲染好。
 * 数据还没准备好就停在最终帧；超过 2 秒显示一行“正在打开单词本”。按任意键立即跳过。
 * 减少动态效果：直接显示静态 Logo，数据就绪立即进入。
 */
import { useEffect, useState, type ReactElement } from 'react'
import { cx } from '../../lib/cx'
import { markStartup } from '../../lib/startup'
import { duration, useReducedMotion } from '../../motion'
import { useApp } from '../../store/app'
import { Wordmark, XWordMark } from './XWordMark'

/** 超过这个时间数据还没就绪，显示“正在打开单词本” */
const SLOW_MS = 2000

/** 三笔画完（最终帧）的时刻 */
function animationMs(): number {
  return (
    duration('--dur-micro') +
    duration('--dur-sweep') +
    duration('--dur-write') +
    duration('--dur-sweep')
  )
}

export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }): ReactElement {
  const reduced = useReducedMotion()
  // 测试开关：停在最终帧（截图、测试“按任意键跳过”用）；打包后 isDev 为 false，一律无效
  const hold = useApp((s) => s.appInfo?.isDev ?? false) && window.__xwordSplashHold === true
  const [animDone, setAnimDone] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [slow, setSlow] = useState(false)
  const finalFrame = reduced || animDone || skipped
  const leaving = finalFrame && ready && !reduced && !skipped && !hold

  useEffect(() => {
    const anim = window.setTimeout(() => {
      setAnimDone(true)
      markStartup('splashFinal')
    }, animationMs())
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_MS)
    return () => {
      window.clearTimeout(anim)
      window.clearTimeout(slowTimer)
    }
  }, [])

  // 停在最终帧且数据就绪：淡出 130 后进入主界面（跳过或减少动态效果时立即进入）
  useEffect(() => {
    if (!finalFrame || !ready || hold) return
    const t = window.setTimeout(onDone, reduced || skipped ? 0 : duration('--dur-splash-out'))
    return () => window.clearTimeout(t)
  }, [finalFrame, ready, reduced, skipped, hold, onDone])

  // 任意键跳过；这个按键只用来跳过，不传给主界面
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (ready) onDone()
      else setSkipped(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ready, onDone])

  return (
    <div
      className={cx('splash', leaving && 'is-leaving')}
      role="status"
      aria-label="正在打开 XWord"
    >
      <div className="splash-mark">
        <XWordMark size={96} animate={finalFrame ? undefined : 'splash'} />
        <Wordmark className="splash-wordmark" />
      </div>
      {slow && !ready && <p className="splash-note">正在打开单词本</p>}
    </div>
  )
}
