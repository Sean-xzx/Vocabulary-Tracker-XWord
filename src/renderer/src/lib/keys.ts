import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/** 焦点在可输入的元素里时，全局快捷键不触发。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type)
  }
  return false
}

/** 有对话框或弹层打开时，页面级快捷键也不触发。正在淡出的弹层（data-closing）不算打开。 */
export function isOverlayOpen(): boolean {
  return document.querySelector('.dialog, .popover:not([data-closing])') !== null
}

export function hasModifier(e: KeyboardEvent | ReactKeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey
}
