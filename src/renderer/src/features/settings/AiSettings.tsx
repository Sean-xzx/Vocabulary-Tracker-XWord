/**
 * 设置 · AI 翻译：DeepSeek API key（遮盖显示；保存后不回传，只显示“已设置 / 未设置”）、保存 / 测试连接 / 清除、
 * 模型名称（默认 deepseek-chat）、去 DeepSeek 开放平台获取 key 的链接（系统浏览器打开）。
 */
import { ExternalLink, KeyRound, Plug, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { AiStatus } from '@shared/api'
import { Button } from '../../components/ui'
import { cx } from '../../lib/cx'
import { toast, toastError } from '../../store/toast'

const DEEPSEEK_PLATFORM_URL = 'https://platform.deepseek.com/api_keys'

export function AiSettings(): ReactElement {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    window.xword
      .aiStatus()
      .then((s) => {
        if (!alive) return
        setStatus(s)
        setModel(s.model)
      })
      .catch(toastError)
    return () => {
      alive = false
    }
  }, [])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const save = (): Promise<void> =>
    run(async () => {
      const s = await window.xword.aiSaveKey(key)
      setStatus(s)
      setKey('')
      setTestResult(null)
      toast('API key 已加密保存')
    })

  const test = (): Promise<void> =>
    run(async () => {
      setTestResult(null)
      const err = await window.xword.aiTest()
      setTestResult(err ? { ok: false, text: err.message } : { ok: true, text: '连接成功' })
    })

  const clear = (): Promise<void> =>
    run(async () => {
      setStatus(await window.xword.aiClearKey())
      setTestResult(null)
      toast('API key 已清除')
    })

  const saveModel = (): void => {
    if (!status || model.trim() === status.model) return
    void run(async () => {
      const s = await window.xword.aiSetModel(model)
      setStatus(s)
      setModel(s.model)
      toast(`模型改为 ${s.model}`)
    })
  }

  return (
    <div className="ai-settings">
      <div className="ai-line">
        <input
          type="password"
          className="text-input ai-key"
          aria-label="DeepSeek API key"
          placeholder={status?.hasKey ? '已设置（输入新的 key 可替换）' : '粘贴 DeepSeek API key'}
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && key.trim()) void save()
          }}
        />
        <Button
          variant="primary"
          size="sm"
          icon={KeyRound}
          disabled={busy || !key.trim()}
          onClick={() => void save()}
        >
          保存
        </Button>
        <Button
          size="sm"
          icon={Plug}
          disabled={busy || !status?.hasKey}
          onClick={() => void test()}
        >
          测试连接
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          disabled={busy || !status?.hasKey}
          onClick={() => void clear()}
        >
          清除
        </Button>
      </div>
      <p className="ai-state" aria-live="polite">
        <span className={cx('ai-dot', status?.hasKey && 'is-on')} aria-hidden />
        {status ? (status.hasKey ? '已设置' : '未设置') : '…'}
        {status && !status.canEncrypt && '（这台电脑不支持加密保存，无法保存 key）'}
        {testResult && (
          <span className={cx('ai-test', testResult.ok ? 'is-ok' : 'is-error')}>
            {testResult.text}
          </span>
        )}
      </p>
      <label className="ai-line">
        <span className="ai-label">模型</span>
        <input
          className="text-input ai-model"
          aria-label="模型名称"
          value={model}
          spellCheck={false}
          onChange={(e) => setModel(e.target.value)}
          onBlur={saveModel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveModel()
          }}
        />
      </label>
      <Button
        variant="ghost"
        size="sm"
        icon={ExternalLink}
        className="ai-link"
        onClick={() => void window.xword.openExternal(DEEPSEEK_PLATFORM_URL).catch(toastError)}
      >
        去 DeepSeek 开放平台获取 key
      </Button>
    </div>
  )
}
