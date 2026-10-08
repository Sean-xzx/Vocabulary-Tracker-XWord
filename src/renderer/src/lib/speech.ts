/** 系统本地英语 TTS；全窗口只播放一个词，异步加载期间也服从取消。 */
import { toast } from '../store/toast'

const VOICE_WAIT_MS = 1500
let generation = 0
let clearPending: (() => void) | null = null
let automaticUnavailableReported = false

export function stopSpeaking(): void {
  generation++
  clearPending?.()
  clearPending = null
  try {
    window.speechSynthesis?.cancel()
  } catch {
    // 页面退出时取消失败不能打断导航。
  }
}

export function speak(word: string, { automatic = false }: { automatic?: boolean } = {}): void {
  stopSpeaking()
  const text = word.trim()
  if (!text) return
  const request = generation
  const unavailable = (): void => {
    if (request !== generation || (automatic && automaticUnavailableReported)) return
    if (automatic) automaticUnavailableReported = true
    toast('这台电脑没有可用的本地英语语音，可在 Windows 语言设置中添加英语语音')
  }
  try {
    const synth = window.speechSynthesis
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      unavailable()
      return
    }
    const play = (): boolean => {
      if (request !== generation) return true
      const voices = synth
        .getVoices()
        .filter((v) => v.localService && /^en(?:[-_]|$)/i.test(v.lang))
      const voice =
        voices.find((v) => /^en-US$/i.test(v.lang)) ?? voices.find((v) => v.default) ?? voices[0]
      if (!voice) return false
      clearPending?.()
      clearPending = null
      automaticUnavailableReported = false
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.voice = voice
      utterance.lang = voice.lang
      utterance.rate = 0.9
      utterance.onerror = (event) => {
        if (request !== generation || event.error === 'canceled' || event.error === 'interrupted')
          return
        if (event.error === 'language-unavailable' || event.error === 'voice-unavailable')
          unavailable()
        else toast('单词朗读失败，请重试')
      }
      synth.speak(utterance)
      return true
    }
    if (play()) return
    const changed = (): void => {
      try {
        play()
      } catch {
        stopSpeaking()
        toast('单词朗读失败，请重试')
      }
    }
    const timer = window.setTimeout(() => {
      clearPending?.()
      clearPending = null
      try {
        if (request === generation && !play()) unavailable()
      } catch {
        unavailable()
      }
    }, VOICE_WAIT_MS)
    synth.addEventListener('voiceschanged', changed)
    clearPending = () => {
      window.clearTimeout(timer)
      synth.removeEventListener('voiceschanged', changed)
    }
  } catch {
    unavailable()
  }
}
