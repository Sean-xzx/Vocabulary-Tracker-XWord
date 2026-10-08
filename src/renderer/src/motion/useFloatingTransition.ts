/**
 * 浮层（Popover、义项面板）的进出场：从锚点方向偏移 4px 淡入 180，关闭时淡出 120；
 * 减少动态效果时只淡入淡出。
 */
import { useTransitionStyles, type FloatingContext } from '@floating-ui/react'
import { prefersReducedMotion } from './reduced'
import { duration } from './tokens'

const TOWARD_ANCHOR: Record<string, string> = {
  top: 'translateY(4px)',
  bottom: 'translateY(-4px)',
  left: 'translateX(4px)',
  right: 'translateX(-4px)'
}

/** 浮层：从锚点方向偏移 4px 淡入 180，关闭时淡出 120（减少动态效果时只淡入淡出） */
export function useFloatingTransition(
  context: FloatingContext
): ReturnType<typeof useTransitionStyles> {
  return useTransitionStyles(context, {
    duration: { open: duration('--dur-base'), close: duration('--dur-micro') },
    initial: ({ side }) => ({
      opacity: 0,
      transform: prefersReducedMotion() ? 'none' : (TOWARD_ANCHOR[side] ?? 'none')
    }),
    open: { opacity: 1, transform: 'none' },
    close: { opacity: 0 },
    common: { transitionTimingFunction: 'var(--ease-in)' }
  })
}
