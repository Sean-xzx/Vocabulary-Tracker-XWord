import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('../store/toast', () => ({ toast }))

const english = {
  name: 'Local English',
  lang: 'en-US',
  localService: true,
  default: false
} as SpeechSynthesisVoice
const british = { ...english, name: 'Local British', lang: 'en-GB' } as SpeechSynthesisVoice
let voices: SpeechSynthesisVoice[]
let service: typeof import('./speech')
let synth: EventTarget & {
  getVoices: ReturnType<typeof vi.fn>
  speak: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

class Utterance {
  voice: SpeechSynthesisVoice | null = null
  lang = ''
  rate = 1
  onerror: ((event: { error: string }) => void) | null = null
  constructor(public text: string) {}
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  toast.mockReset()
  voices = [english]
  synth = Object.assign(new EventTarget(), {
    getVoices: vi.fn(() => voices),
    speak: vi.fn(),
    cancel: vi.fn()
  })
  vi.stubGlobal('window', { speechSynthesis: synth, setTimeout, clearTimeout })
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  service = await import('./speech')
})

afterEach(() => {
  service.stopSpeaking()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('本地英语朗读', () => {
  it('只选择本地英语，优先美式，提交用户的单词或词组', () => {
    voices = [{ ...english, lang: 'zh-CN' }, { ...english, localService: false }, british, english]
    service.speak(' take care ')
    const utterance = synth.speak.mock.calls[0][0] as Utterance
    expect(utterance.text).toBe('take care')
    expect(utterance.voice).toBe(english)
    expect(utterance.lang).toBe('en-US')
    expect(utterance.rate).toBe(0.9)
  })

  it('没有美式时可用本地英式，不能选中文或联网语音', () => {
    voices = [british]
    service.speak('word')
    expect(synth.speak.mock.calls[0][0].voice).toBe(british)
    voices = [
      { ...english, lang: 'zh-CN' },
      { ...english, localService: false }
    ]
    service.speak('next')
    vi.advanceTimersByTime(1600)
    expect(synth.speak).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('本地英语语音'))
  })

  it('语音延迟加载时等待 voiceschanged，成功后不再超时或重复播放', () => {
    voices = []
    service.speak('ability')
    expect(synth.speak).not.toHaveBeenCalled()
    voices = [english]
    synth.dispatchEvent(new Event('voiceschanged'))
    synth.dispatchEvent(new Event('voiceschanged'))
    vi.advanceTimersByTime(2000)
    expect(synth.speak).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()
  })

  it('换词取消之前等待的请求，只读最后一个词', () => {
    voices = []
    service.speak('old')
    service.speak('new')
    voices = [english]
    synth.dispatchEvent(new Event('voiceschanged'))
    expect(synth.speak).toHaveBeenCalledTimes(1)
    expect(synth.speak.mock.calls[0][0].text).toBe('new')
    expect(synth.cancel).toHaveBeenCalledTimes(2)
  })

  it('退出后即使语音才加载，也不会播放旧词或弹错误', () => {
    voices = []
    service.speak('old')
    service.stopSpeaking()
    voices = [english]
    synth.dispatchEvent(new Event('voiceschanged'))
    vi.advanceTimersByTime(2000)
    expect(synth.speak).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('没有语音时自动模式只提醒一次，手动仍可提示', () => {
    voices = []
    service.speak('one', { automatic: true })
    vi.advanceTimersByTime(1600)
    service.speak('two', { automatic: true })
    vi.advanceTimersByTime(1600)
    expect(toast).toHaveBeenCalledTimes(1)
    service.speak('three')
    vi.advanceTimersByTime(1600)
    expect(toast).toHaveBeenCalledTimes(2)
  })

  it('忽略被取消或过期的错误，真实播放错误给中文说明', () => {
    service.speak('one')
    const first = synth.speak.mock.calls[0][0] as Utterance
    service.speak('two')
    first.onerror?.({ error: 'audio-busy' })
    const second = synth.speak.mock.calls[1][0] as Utterance
    second.onerror?.({ error: 'canceled' })
    expect(toast).not.toHaveBeenCalled()
    second.onerror?.({ error: 'audio-busy' })
    expect(toast).toHaveBeenCalledWith('单词朗读失败，请重试')
  })

  it('空词不朗读，系统接口不可用时不抛异常', () => {
    service.speak(' ')
    expect(synth.speak).not.toHaveBeenCalled()
    vi.stubGlobal('SpeechSynthesisUtterance', undefined)
    expect(() => service.speak('word')).not.toThrow()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('本地英语语音'))
  })
})
