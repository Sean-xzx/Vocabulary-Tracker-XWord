/**
 * 翻译面板（overlay，选区下方）：DeepSeek 流式输出译文；等第一个字的时候播放“AI 等待”的荧光笔循环动效，
 * 第一个字出现后立刻停止（全软件唯一允许循环的动效）。「解释这句」用中文讲解句子结构、难点词和语气。
 * 同一段文字再次请求直接读缓存。失败时给出中文原因，断网、超时等可以重试；翻译失败不影响阅读器的其他功能。
 */
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions
} from '@floating-ui/react'
import { MessageSquareText, RotateCcw, Settings } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import type { AiError, AiKind } from '@shared/api'
import { Button } from '../../components/ui'
import { useApp } from '../../store/app'
import './translate.css'

interface Stream {
  text: string
  /** 还在等第一个字 */
  waiting: boolean
  done: boolean
  error: AiError | null
  cached: boolean
}

const EMPTY: Stream = { text: '', waiting: true, done: false, error: null, cached: false }

/** 发起一次翻译 / 解释，订阅流式结果 */
function useAiStream(): {
  streams: Record<AiKind, Stream | null>
  start: (kind: AiKind, text: string) => void
  cancelAll: () => void
} {
  const [streams, setStreams] = useState<Record<AiKind, Stream | null>>({
    translate: null,
    explain: null
  })
  const running = useRef<Record<AiKind, string | null>>({ translate: null, explain: null })

  useEffect(
    () =>
      window.xword.on('ai', (chunk) => {
        const kind = (Object.keys(running.current) as AiKind[]).find(
          (k) => running.current[k] === chunk.requestId
        )
        if (!kind) return
        setStreams((s) => {
          const cur = s[kind] ?? EMPTY
          if (chunk.error) return { ...s, [kind]: { ...cur, waiting: false, error: chunk.error } }
          if (chunk.done) return { ...s, [kind]: { ...cur, waiting: false, done: true } }
          return { ...s, [kind]: { ...cur, waiting: false, text: cur.text + (chunk.delta ?? '') } }
        })
        if (chunk.error || chunk.done) running.current[kind] = null
      }),
    []
  )

  const start = useCallback((kind: AiKind, text: string) => {
    const prev = running.current[kind]
    if (prev) void window.xword.aiCancel(prev)
    running.current[kind] = null
    setStreams((s) => ({ ...s, [kind]: { ...EMPTY } }))
    window.xword
      .aiStart(kind, text)
      .then((r) => {
        if (r.status === 'cached')
          setStreams((s) => ({
            ...s,
            [kind]: { text: r.result, waiting: false, done: true, error: null, cached: true }
          }))
        else if (r.status === 'error')
          setStreams((s) => ({ ...s, [kind]: { ...EMPTY, waiting: false, error: r.error } }))
        else running.current[kind] = r.requestId
      })
      .catch(() =>
        setStreams((s) => ({
          ...s,
          [kind]: {
            ...EMPTY,
            waiting: false,
            error: { code: 'server', message: '翻译出错了，请重试', retryable: true }
          }
        }))
      )
  }, [])

  const cancelAll = useCallback(() => {
    for (const k of Object.keys(running.current) as AiKind[]) {
      const id = running.current[k]
      if (id) void window.xword.aiCancel(id)
      running.current[k] = null
    }
  }, [])

  useEffect(() => cancelAll, [cancelAll])
  return { streams, start, cancelAll }
}

function Output({ stream, onRetry }: { stream: Stream; onRetry: () => void }): ReactElement {
  const setView = useApp((s) => s.setView)
  if (stream.error) {
    return (
      <div className="ai-error" role="alert">
        <span>{stream.error.message}</span>
        {stream.error.retryable && (
          <Button size="sm" icon={RotateCcw} onClick={onRetry}>
            重试
          </Button>
        )}
        {(stream.error.code === 'noKey' || stream.error.code === 'unauthorized') && (
          <Button size="sm" icon={Settings} onClick={() => setView('settings')}>
            去设置
          </Button>
        )}
      </div>
    )
  }
  if (stream.waiting)
    return (
      <div className="ai-wait" role="status" aria-label="正在等 DeepSeek 回复">
        <span className="ai-wait-bar" />
      </div>
    )
  return (
    <p className="ai-text" aria-live="polite" data-done={stream.done || undefined}>
      {stream.text}
    </p>
  )
}

export function TranslatePanel({
  text,
  rect,
  onClose
}: {
  text: string
  rect: DOMRect
  onClose: () => void
}): ReactElement {
  const { streams, start, cancelAll } = useAiStream()
  // 选区是虚拟参照物：只提供外接矩形
  const reference = useMemo(() => ({ getBoundingClientRect: () => rect }), [rect])
  const {
    refs: { setFloating, setPositionReference },
    floatingStyles,
    context
  } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) {
        cancelAll()
        onClose()
      }
    },
    placement: 'bottom',
    middleware: [offset(10), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate
  })
  // 虚拟参照物只用于定位（交互逻辑会把 reference 当 DOM 元素用）
  useLayoutEffect(() => setPositionReference(reference), [reference, setPositionReference])
  const dismiss = useDismiss(context)
  const { getFloatingProps } = useInteractions([dismiss])

  useEffect(() => {
    start('translate', text)
  }, [start, text])

  const translate = streams.translate ?? EMPTY
  const explain = streams.explain
  return (
    <FloatingPortal>
      <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus={false}>
        <div ref={setFloating} style={floatingStyles} className="floating" {...getFloatingProps()}>
          <section className="popover translate-panel" aria-label="翻译">
            <header className="translate-head">
              <span>
                译文{translate.cached && <span className="translate-cached">· 来自缓存</span>}
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={MessageSquareText}
                disabled={explain !== null && !explain.error && !explain.done}
                onClick={() => start('explain', text)}
              >
                解释这句
              </Button>
            </header>
            <Output stream={translate} onRetry={() => start('translate', text)} />
            {explain && (
              <div className="translate-explain">
                <div className="translate-sub">
                  讲解{explain.cached && <span className="translate-cached">· 来自缓存</span>}
                </div>
                <Output stream={explain} onRetry={() => start('explain', text)} />
              </div>
            )}
          </section>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  )
}
