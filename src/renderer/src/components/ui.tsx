/**
 * 通用组件。样式见 ui.css；颜色、尺寸、动效全部来自 design.css 的变量。
 */
import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  type Placement
} from '@floating-ui/react'
import { X, type LucideIcon } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref
} from 'react'
import { cx } from '../lib/cx'
import { useFloatingTransition } from '../motion/useFloatingTransition'
import { useToasts } from '../store/toast'
import './ui.css'

const COLLISION = [offset(6), flip({ padding: 8 }), shift({ padding: 8 })]

// ---------------------------------------------------------------- Button

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  /** lg：页面级主操作（高 48、圆角 12） */
  size?: 'md' | 'sm' | 'lg'
  icon?: LucideIcon
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, className)}
      {...rest}
    >
      {Icon && <Icon size={16} aria-hidden />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- PageHead

/** 页面头部：左边小标题（eyebrow）+ 标题 + 一行 meta，右边操作按钮。 */
export function PageHead({
  eyebrow,
  title,
  meta,
  actions
}: {
  eyebrow: ReactNode
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}): ReactElement {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <div>
          <div className="page-eyebrow">{eyebrow}</div>
          <h1 className="page-title">{title}</h1>
        </div>
        {meta && <div className="page-meta">{meta}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

// ---------------------------------------------------------------- Tooltip

export function Tooltip({
  content,
  children,
  placement = 'top'
}: {
  content: ReactNode
  children: ReactNode
  placement?: Placement
}): ReactElement {
  const [open, setOpen] = useState(false)
  const {
    refs: { setReference, setFloating },
    floatingStyles,
    context
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: COLLISION,
    whileElementsMounted: autoUpdate
  })
  // 悬停 400ms 出现，移开立即消失；键盘聚焦时也显示
  const hover = useHover(context, { delay: { open: 400, close: 0 }, move: false })
  const focus = useFocus(context, { visibleOnly: true })
  // Esc 关掉提示的同时照常交给页面（提示不能吞掉快捷键：例如关掉页面设置后焦点回到按钮上，再按 Esc 仍要退出阅读）
  const dismiss = useDismiss(context, { bubbles: { escapeKey: true } })
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role])

  return (
    <>
      <span className="tooltip-anchor" ref={setReference} {...getReferenceProps()}>
        {children}
      </span>
      {open && content && (
        <FloatingPortal>
          <div ref={setFloating} style={floatingStyles} className="tooltip" {...getFloatingProps()}>
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}

/** 提示内容：“名称 + 快捷键” */
export function TipLabel({ label, shortcut }: { label: string; shortcut?: string }): ReactElement {
  return (
    <span className="tip-label">
      {label}
      {shortcut && <kbd>{shortcut}</kbd>}
    </span>
  )
}

// ---------------------------------------------------------------- IconButton

export type IconButtonProps = Omit<ButtonProps, 'children' | 'icon'> & {
  icon: LucideIcon
  /** 必填：用作提示与无障碍名称 */
  label: string
  shortcut?: string
  active?: boolean
  iconSize?: 16 | 18
}

export function IconButton({
  icon: Icon,
  label,
  shortcut,
  variant = 'ghost',
  size = 'md',
  active,
  iconSize = 18,
  className,
  type = 'button',
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <Tooltip content={<TipLabel label={label} shortcut={shortcut} />}>
      <button
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={cx(
          'btn',
          `btn-${variant}`,
          'btn-icon',
          size === 'sm' && 'btn-sm',
          active && 'is-active',
          className
        )}
        {...rest}
      >
        <Icon size={iconSize} aria-hidden />
      </button>
    </Tooltip>
  )
}

// ---------------------------------------------------------------- Popover

export function Popover({
  anchor,
  open,
  onClose,
  children,
  placement = 'bottom',
  label,
  className
}: {
  anchor: Element | null
  open: boolean
  onClose: () => void
  children: ReactNode
  placement?: Placement
  label?: string
  className?: string
}): ReactElement | null {
  const {
    refs: { setFloating },
    floatingStyles,
    context
  } = useFloating({
    open,
    onOpenChange: (next) => {
      if (!next) onClose()
    },
    elements: { reference: anchor },
    placement,
    middleware: COLLISION,
    whileElementsMounted: autoUpdate
  })
  // Esc 或点击外部关闭
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'dialog' })
  const { getFloatingProps } = useInteractions([dismiss, role])
  const { isMounted, styles } = useFloatingTransition(context)

  if (!isMounted || !anchor) return null
  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={0} returnFocus>
        <div
          ref={setFloating}
          style={floatingStyles}
          className="floating"
          aria-label={label}
          {...getFloatingProps()}
        >
          <div
            className={cx('popover', className)}
            style={styles}
            data-closing={open ? undefined : ''}
          >
            {children}
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  )
}

// ---------------------------------------------------------------- Dialog

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 560
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  width?: number
}): ReactElement | null {
  const {
    refs: { setFloating },
    context
  } = useFloating({
    open,
    onOpenChange: (next) => {
      if (!next) onClose()
    }
  })
  // 只有 Esc 和关闭按钮能关掉，避免误点外部丢失输入
  const dismiss = useDismiss(context, { outsidePress: false })
  const role = useRole(context, { role: 'dialog' })
  const { getFloatingProps } = useInteractions([dismiss, role])
  const titleId = useId()

  if (!open) return null
  return (
    <FloatingPortal>
      <FloatingOverlay className="dialog-overlay" lockScroll>
        <FloatingFocusManager context={context} modal initialFocus={1}>
          <div
            ref={setFloating}
            className="dialog"
            style={{ width }}
            aria-labelledby={titleId}
            aria-modal="true"
            {...getFloatingProps()}
          >
            <header className="dialog-header">
              <h2 id={titleId}>{title}</h2>
              <IconButton
                icon={X}
                label="关闭"
                shortcut="Esc"
                size="sm"
                iconSize={16}
                onClick={onClose}
              />
            </header>
            <div className="dialog-body">{children}</div>
            {footer && <footer className="dialog-footer">{footer}</footer>}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确定',
  onConfirm,
  onClose
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}): ReactElement | null {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose()
              onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- EmptyState

export function EmptyState({
  icon: Icon,
  text,
  children
}: {
  icon: LucideIcon
  text: string
  children?: ReactNode
}): ReactElement {
  return (
    <div className="empty-state">
      <Icon size={18} aria-hidden className="empty-state-icon" />
      <p>{text}</p>
      {children && <div className="empty-state-actions">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- SegmentedControl

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}): ReactElement {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={cx('segmented-item', o.value === value && 'is-selected')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Toast

/** 与 Toast 保持的间距（px） */
const TOAST_GAP = 8

/**
 * Toast 不遮挡单词页的输入行、义项面板和复习页的底部状态栏（带 data-toast-avoid 的元素）：
 * 它们落在 Toast 所在的底部区域时，Toast 移到它们上方。
 */
function useToastLift(
  count: number,
  viewport: React.RefObject<HTMLDivElement | null>
): number | null {
  const active = count > 0
  const [bottom, setBottom] = useState<number | null>(null)
  useEffect(() => {
    if (!active) return
    let frame = 0
    const update = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = viewport.current
        if (!el) return
        const base = Number.parseFloat(getComputedStyle(el).bottom) || 0
        const height = window.innerHeight
        const zoneTop = height - base - el.offsetHeight - TOAST_GAP
        let lift = 0
        for (const target of document.querySelectorAll('[data-toast-avoid]')) {
          const r = target.getBoundingClientRect()
          if (r.height === 0 || r.bottom <= zoneTop || r.top >= height) continue
          lift = Math.max(lift, height - r.top + TOAST_GAP)
        }
        setBottom(lift > base ? lift : null)
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [active, count, viewport])
  return active ? bottom : null
}

export function ToastViewport(): ReactElement {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  const viewport = useRef<HTMLDivElement>(null)
  const lifted = useToastLift(toasts.length, viewport)
  return (
    <div
      ref={viewport}
      className="toast-viewport"
      role="status"
      aria-live="polite"
      style={lifted !== null ? { bottom: lifted } : undefined}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx('toast', t.tone === 'error' && 'toast-error', t.leaving && 'is-leaving')}
          aria-hidden={t.leaving || undefined}
        >
          <span className="toast-message">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismiss(t.id)
                void t.action?.run()
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
