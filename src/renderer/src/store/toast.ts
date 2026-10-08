import { create } from 'zustand'
import { duration } from '../motion/tokens'

export const TOAST_DURATION = 5000
export const TOAST_MAX = 3

export interface ToastItem {
  id: number
  message: string
  tone: 'default' | 'error'
  /** 正在淡出（120ms 后移除） */
  leaving?: boolean
  action?: { label: string; run: () => void | Promise<void> }
}

interface ToastState {
  toasts: ToastItem[]
  push: (toast: Omit<ToastItem, 'id' | 'tone'> & { tone?: ToastItem['tone'] }) => number
  dismiss: (id: number) => void
}

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++
    const item: ToastItem = { tone: 'default', ...toast, id }
    const next = [...get().toasts.filter((t) => !t.leaving), item]
    // 同一时间最多 3 条：挤掉最早的
    for (const old of next.slice(0, Math.max(0, next.length - TOAST_MAX))) {
      clearTimeout(timers.get(old.id))
      timers.delete(old.id)
    }
    set({ toasts: next.slice(-TOAST_MAX) })
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), TOAST_DURATION)
    )
    return id
  },
  dismiss: (id) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    if (!get().toasts.some((t) => t.id === id && !t.leaving)) return
    // 先淡出 120，再移除
    set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) })
    setTimeout(
      () => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
      duration('--dur-micro')
    )
  }
}))

export function toast(message: string, action?: ToastItem['action']): number {
  return useToasts.getState().push({ message, action })
}

export function toastError(error: unknown): number {
  const raw = error instanceof Error ? error.message : String(error)
  // IPC 错误形如 “Error invoking remote method 'xxx': Error: 真正的消息”
  const message = raw.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
  return useToasts.getState().push({ message, tone: 'error' })
}
