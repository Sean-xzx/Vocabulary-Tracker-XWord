import { FlaskConical } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { Button, ConfirmDialog } from '../components/ui'
import { useApp } from '../store/app'
import { toast, toastError } from '../store/toast'

/** 开发模式专用：清空现有数据并载入示例数据（载入前确认）。 */
export function DevSampleButton(): ReactElement | null {
  const appInfo = useApp((s) => s.appInfo)
  const refresh = useApp((s) => s.refresh)
  const [confirming, setConfirming] = useState(false)
  if (!import.meta.env.DEV || !appInfo?.isDev) return null

  const load = async (): Promise<void> => {
    try {
      await window.xword.loadSampleData()
      await refresh()
      toast('已载入示例数据')
    } catch (error) {
      toastError(error)
    }
  }

  return (
    <>
      <Button icon={FlaskConical} onClick={() => setConfirming(true)}>
        载入示例数据
      </Button>
      <ConfirmDialog
        open={confirming}
        title="载入示例数据"
        confirmLabel="清空并载入"
        message={
          <>
            会先清空现有的全部单词、检查记录和复习记录（设置保留），再载入示例数据。
            <br />
            数据库：{appInfo.dbPath}
          </>
        }
        onConfirm={() => void load()}
        onClose={() => setConfirming(false)}
      />
    </>
  )
}
