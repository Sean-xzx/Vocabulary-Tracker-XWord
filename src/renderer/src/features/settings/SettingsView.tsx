/**
 * 设置：主题、每日新词上限、数据文件夹、词典来源、版本号；开发模式下可载入示例数据。
 */
import { FolderOpen } from 'lucide-react'
import { useState, type ReactElement, type ReactNode } from 'react'
import type { ThemeSetting } from '@shared/api'
import { MAX_DAILY_NEW_LIMIT, MIN_DAILY_NEW_LIMIT } from '@shared/domain/queue'
import { Button, PageHead, SegmentedControl } from '../../components/ui'
import { useApp } from '../../store/app'
import { toast, toastError } from '../../store/toast'
import { DevSampleButton } from '../DevSampleButton'
import { AiSettings } from './AiSettings'
import './settings.css'
import './ai.css'

function Row({
  title,
  hint,
  children
}: {
  title: string
  hint?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <h2>{title}</h2>
        {hint && <p>{hint}</p>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  )
}

function LimitInput({ value }: { value: number }): ReactElement {
  const refresh = useApp((s) => s.refresh)
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    const n = Number(draft)
    if (!Number.isInteger(n) || n < MIN_DAILY_NEW_LIMIT || n > MAX_DAILY_NEW_LIMIT) {
      setError(`请输入 ${MIN_DAILY_NEW_LIMIT}–${MAX_DAILY_NEW_LIMIT} 之间的整数`)
      setDraft(String(value))
      return
    }
    setError(null)
    if (n === value) return
    try {
      await window.xword.setDailyNewLimit(n)
      await refresh()
      toast(`每日新词上限已改为 ${n}`)
    } catch (e) {
      toastError(e)
      setDraft(String(value))
    }
  }

  return (
    <div className="limit">
      <input
        className="limit-input"
        type="number"
        inputMode="numeric"
        min={MIN_DAILY_NEW_LIMIT}
        max={MAX_DAILY_NEW_LIMIT}
        step={1}
        aria-label="每日新词上限"
        aria-invalid={error !== null}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void save()
          } else if (e.key === 'Escape') {
            setDraft(String(value))
            setError(null)
          }
        }}
      />
      <span className="muted">个 / 天</span>
      {error && (
        <p className="limit-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function SettingsView(): ReactElement | null {
  const snapshot = useApp((s) => s.snapshot)
  const appInfo = useApp((s) => s.appInfo)
  const refresh = useApp((s) => s.refresh)
  if (!snapshot) return null

  const setTheme = async (theme: ThemeSetting): Promise<void> => {
    try {
      await window.xword.setTheme(theme)
      await refresh()
    } catch (e) {
      toastError(e)
    }
  }

  const openFolder = async (): Promise<void> => {
    try {
      await window.xword.openDataFolder()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="settings">
      <PageHead eyebrow="XWord" title="设置" />
      <div className="settings-card">
        <Row title="主题" hint="跟随系统时，会随 Windows 的深浅色设置一起变化。">
          <SegmentedControl<ThemeSetting>
            label="主题"
            value={snapshot.settings.theme}
            onChange={(t) => void setTheme(t)}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' }
            ]}
          />
        </Row>

        <Row
          title="每日新词上限"
          hint={`今天已学的新词加上队列里的新词不超过这个数，超出的留到之后。范围 ${MIN_DAILY_NEW_LIMIT}–${MAX_DAILY_NEW_LIMIT}。`}
        >
          {/* key：上限在别处被改动时重置输入框 */}
          <LimitInput
            key={snapshot.settings.dailyNewLimit}
            value={snapshot.settings.dailyNewLimit}
          />
        </Row>

        <Row title="数据文件夹" hint="单词和复习记录都保存在这里，每天第一次启动时自动备份。">
          <div className="data-path">
            <code className="path" title={appInfo?.dataDir}>
              {appInfo?.dataDir ?? '…'}
            </code>
            <Button
              variant="secondary"
              size="sm"
              icon={FolderOpen}
              onClick={() => void openFolder()}
            >
              打开所在文件夹
            </Button>
          </div>
        </Row>

        <Row
          title="AI 翻译"
          hint="阅读时选中句子按 T，用 DeepSeek 译成中文或讲解句子。key 加密保存在这台电脑上，只用于请求 DeepSeek。"
        >
          <AiSettings />
        </Row>

        <Row title="词典" hint="录入单词时用来查音标和词义，已随软件安装，不需要联网。">
          <span className="dict-credit">词典数据：ECDICT（MIT License）</span>
        </Row>

        <Row title="版本">
          <span className="version">XWord {appInfo?.version ?? ''}</span>
        </Row>

        {import.meta.env.DEV && appInfo?.isDev && (
          <Row title="开发" hint="只在开发模式下出现。">
            <DevSampleButton />
          </Row>
        )}
      </div>
    </div>
  )
}
