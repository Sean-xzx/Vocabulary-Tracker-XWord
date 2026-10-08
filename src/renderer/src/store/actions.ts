/**
 * 界面层的写操作：调用 IPC → 刷新快照 → 必要时弹出可撤销的 Toast。
 * 所有错误都以 Toast 呈现，不向上抛。
 */
import type { AddWordsResult, GradeResponse, NewWordInput, Word, WordPatch } from '@shared/api'
import { GRADE_LABELS, STAGE_LABELS, type Grade } from '@shared/domain/scheduler'
import { draw, duration } from '../motion'
import { useApp } from './app'
import { toast, toastError } from './toast'

const refresh = (): Promise<unknown> => useApp.getState().refresh()

export async function undoGrade(logId: string, retryLogIds: string[] = []): Promise<boolean> {
  try {
    await window.xword.undoGrade({ logId, retryLogIds })
    await refresh()
    return true
  } catch (error) {
    toastError(error)
    return false
  }
}

/** 撤销网格评分前：按写出的反方向把勾 / 叉收回（120ms）。减少动态效果时直接跳过。 */
async function retractMark(wordId: string, stage: number): Promise<void> {
  const cell = document.querySelector(`[data-mark-key="${wordId}:${stage}"]`)
  const strokes = Array.from(cell?.querySelectorAll('.mark-stroke') ?? [])
  const anims = strokes
    .map((s) => draw(s, { reverse: true, duration: duration('--dur-micro') }))
    .filter((a): a is Animation => a !== null)
  if (anims.length === 0) return
  await Promise.all(anims.map((a) => a.finished.catch(() => undefined)))
}

/** 网格评分：写库、刷新，并弹出可撤销的 Toast。 */
export async function gradeFromGrid(word: Word, grade: Grade): Promise<GradeResponse | null> {
  try {
    const res = await window.xword.gradeWord({ wordId: word.id, grade })
    await refresh()
    const missed = res.missedStages.length > 0 ? `（${res.missedStages.length} 个节点记为漏）` : ''
    toast(`${word.text} · ${STAGE_LABELS[res.stage]}：${GRADE_LABELS[grade]}${missed}`, {
      label: '撤销',
      run: async () => {
        await retractMark(word.id, res.stage)
        if (await undoGrade(res.logId)) toast(`已撤销 ${word.text} 的评分`)
      }
    })
    return res
  } catch (error) {
    toastError(error)
    return null
  }
}

/** 软删除并弹出可撤销的 Toast；onUndo 在撤销成功后调用（例如重新选中这个词）。 */
export async function deleteWord(word: Word, onUndo?: () => void): Promise<void> {
  try {
    await window.xword.deleteWord(word.id)
    await refresh()
    toast(`已删除 ${word.text}`, {
      label: '撤销',
      run: async () => {
        try {
          await window.xword.restoreWord(word.id)
          await refresh()
          onUndo?.()
        } catch (error) {
          toastError(error)
        }
      }
    })
  } catch (error) {
    toastError(error)
  }
}

export async function restoreWord(word: Word): Promise<void> {
  try {
    await window.xword.restoreWord(word.id)
    await refresh()
    toast(`已恢复 ${word.text}`)
  } catch (error) {
    toastError(error)
  }
}

/** 彻底删除（不可撤销）：调用前要先二次确认。 */
export async function purgeWord(word: Word): Promise<boolean> {
  try {
    await window.xword.purgeWord(word.id)
    await refresh()
    toast(`已彻底删除 ${word.text}`)
    return true
  } catch (error) {
    toastError(error)
    return false
  }
}

/** 清空回收站（不可撤销）：调用前要先二次确认。 */
export async function emptyTrash(): Promise<void> {
  try {
    const n = await window.xword.emptyTrash()
    await refresh()
    toast(`已清空回收站（${n} 个词）`)
  } catch (error) {
    toastError(error)
  }
}

export async function setStarred(word: Word, starred: boolean): Promise<void> {
  try {
    await window.xword.setStarred(word.id, starred)
    await refresh()
  } catch (error) {
    toastError(error)
  }
}

export async function updateWord(id: string, patch: WordPatch): Promise<boolean> {
  try {
    await window.xword.updateWord(id, patch)
    await refresh()
    return true
  } catch (error) {
    toastError(error)
    return false
  }
}

export async function addWords(items: NewWordInput[]): Promise<AddWordsResult | null> {
  try {
    const res = await window.xword.addWords(items)
    await refresh()
    return res
  } catch (error) {
    toastError(error)
    return null
  }
}
