/**
 * DeepSeek 句子翻译与解释（请求只在主进程发出）。
 * - API key 用 Electron 的 safeStorage 加密后存在 userData 的单独文件里：不进数据库明文、不进 git、不进日志、不进报错信息；
 *   保存后不再回传给渲染进程，渲染进程只能知道“已设置 / 未设置”。
 * - https://api.deepseek.com/chat/completions（OpenAI 兼容），流式返回；选中文本最多 1000 个字符；30 秒没有数据算超时。
 * - 结果按“文本哈希 + 类型”缓存在 translations 表里，同一段文本再次请求直接读缓存。
 * - 错误一律映射成中文提示（没有 key、401、402、429、断网、超时……），不带服务器返回的原文。
 */
import { createHash, randomUUID } from 'node:crypto'
import type { AiError, AiErrorCode, AiKind, AiStart, AiStatus, AiChunk } from '../shared/api'
import { HOSTS, NetError, guardedFetch, type NetPolicy } from './net'

export const AI_MAX_CHARS = 1000
export const AI_TIMEOUT_MS = 30_000
export const DEFAULT_MODEL = 'deepseek-chat'
export const DEEPSEEK_BASE = 'https://api.deepseek.com'

export const PROMPTS: Record<AiKind, string> = {
  translate: '把用户给出的英文译成自然、准确的简体中文，只输出译文。',
  explain:
    '用中文讲解用户给出的这句英文：句子结构、难点词和语气。不超过 200 字，不要复述原文，不要使用 Markdown。'
}

const MESSAGES: Record<AiErrorCode, string> = {
  noKey: '请先在设置里填写 DeepSeek API key',
  unauthorized: 'DeepSeek API key 无效，请在设置里检查后重新填写',
  balance: 'DeepSeek 账户余额不足，请充值后再试',
  rateLimit: '请求太频繁，请稍后再试',
  network: '网络连接失败，连不上 DeepSeek，请检查网络后重试',
  timeout: '请求超时：30 秒内没有收到 DeepSeek 的回复，请重试',
  server: 'DeepSeek 服务暂时出错，请稍后重试',
  tooLong: `选中的文字超过 ${AI_MAX_CHARS} 个字符，请少选一些`
}

export function aiError(code: AiErrorCode, detail?: string): AiError {
  return {
    code,
    message: detail ? `${MESSAGES[code]}（${detail}）` : MESSAGES[code],
    retryable: code === 'network' || code === 'timeout' || code === 'server' || code === 'rateLimit'
  }
}

/** HTTP 状态码 → 中文错误 */
export function errorForStatus(status: number): AiError {
  if (status === 401 || status === 403) return aiError('unauthorized')
  if (status === 402) return aiError('balance')
  if (status === 429) return aiError('rateLimit')
  return aiError('server', `HTTP ${status}`)
}

/** 网络层异常 → 中文错误 */
export function errorForException(error: unknown): AiError {
  if (error instanceof NetError && error.kind === 'timeout') return aiError('timeout')
  return aiError('network')
}

export interface SecretStore {
  available(): boolean
  save(plain: string): void
  load(): string | null
  clear(): void
}

export interface AiRepo {
  getTranslation(hash: string, kind: string): string | null
  putTranslation(hash: string, kind: string, result: string): void
  getSetting(key: string): string | null
  putSetting(key: string, value: string): void
}

const KEY_RE = /^[\x21-\x7e]{8,200}$/
const MODEL_RE = /^[A-Za-z0-9._:-]{1,64}$/

export function textHash(text: string): string {
  return createHash('sha256').update(text.normalize('NFC').trim()).digest('hex')
}

export class AiService {
  private readonly running = new Map<string, AbortController>()
  private readonly policy: NetPolicy

  constructor(
    private readonly deps: {
      repo: AiRepo
      secret: SecretStore
      emit: (chunk: AiChunk) => void
      base?: string
      devOrigin?: string | null
      fetchImpl?: typeof fetch
      log?: (message: string) => void
    }
  ) {
    this.policy = { hosts: HOSTS.deepseek, devOrigins: deps.devOrigin ? [deps.devOrigin] : [] }
  }

  private get base(): string {
    return this.deps.base ?? DEEPSEEK_BASE
  }

  private get model(): string {
    const m = this.deps.repo.getSetting('aiModel')
    return m && MODEL_RE.test(m) ? m : DEFAULT_MODEL
  }

  status(): AiStatus {
    return {
      hasKey: this.deps.secret.load() !== null,
      model: this.model,
      canEncrypt: this.deps.secret.available()
    }
  }

  saveKey(key: string): AiStatus {
    const k = key.trim()
    if (!KEY_RE.test(k)) throw new Error('API key 格式不对：应为 8–200 个字符，不含空格')
    if (!this.deps.secret.available()) throw new Error('这台电脑不支持加密保存，无法保存 API key')
    this.deps.secret.save(k)
    this.deps.log?.('DeepSeek API key 已保存（已加密）')
    return this.status()
  }

  clearKey(): AiStatus {
    this.deps.secret.clear()
    this.deps.log?.('DeepSeek API key 已清除')
    return this.status()
  }

  setModel(model: string): AiStatus {
    const m = model.trim() || DEFAULT_MODEL
    if (!MODEL_RE.test(m)) throw new Error('模型名称只能包含字母、数字和 . _ : -')
    this.deps.repo.putSetting('aiModel', m)
    return this.status()
  }

  /** 测试连接：列出模型（不消耗额度）。成功返回 null。 */
  async test(): Promise<AiError | null> {
    const key = this.deps.secret.load()
    if (!key) return aiError('noKey')
    try {
      const { response, controller, timer } = await guardedFetch(
        `${this.base}/models`,
        { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } },
        this.policy,
        AI_TIMEOUT_MS,
        this.deps.fetchImpl
      )
      timer.stop()
      controller.abort()
      return response.ok ? null : errorForStatus(response.status)
    } catch (error) {
      return errorForException(error)
    }
  }

  /** 开始翻译 / 解释：有缓存直接返回；否则开始流式请求，结果通过 emit 推给渲染进程。 */
  start(kind: AiKind, text: string): AiStart {
    const source = text.trim()
    if (source.length > AI_MAX_CHARS) return { status: 'error', error: aiError('tooLong') }
    const hash = textHash(source)
    const cached = this.deps.repo.getTranslation(hash, kind)
    if (cached !== null) return { status: 'cached', result: cached }
    const key = this.deps.secret.load()
    if (!key) return { status: 'error', error: aiError('noKey') }
    const requestId = randomUUID()
    void this.stream(requestId, kind, source, hash, key)
    return { status: 'stream', requestId }
  }

  cancel(requestId: string): void {
    this.running.get(requestId)?.abort()
    this.running.delete(requestId)
  }

  private async stream(
    requestId: string,
    kind: AiKind,
    text: string,
    hash: string,
    key: string
  ): Promise<void> {
    const emit = (chunk: Omit<AiChunk, 'requestId'>): void =>
      this.deps.emit({ requestId, ...chunk })
    let result = ''
    try {
      const { response, controller, timer } = await guardedFetch(
        `${this.base}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream'
          },
          body: JSON.stringify({
            model: this.model,
            stream: true,
            messages: [
              { role: 'system', content: PROMPTS[kind] },
              { role: 'user', content: text }
            ]
          })
        },
        this.policy,
        AI_TIMEOUT_MS,
        this.deps.fetchImpl
      )
      this.running.set(requestId, controller)
      if (!response.ok) {
        timer.stop()
        controller.abort()
        emit({ error: errorForStatus(response.status) })
        return
      }
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      try {
        while (reader && !finished) {
          const { done, value } = await reader.read()
          if (done) break
          timer.touch()
          buffer += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') {
              finished = true
              break
            }
            const delta = parseDelta(data)
            if (delta) {
              result += delta
              emit({ delta })
            }
          }
        }
      } catch (error) {
        if (!this.running.has(requestId)) return // 被取消
        throw timer.fired ? new NetError('超时', 'timeout') : error
      } finally {
        timer.stop()
      }
      if (!this.running.has(requestId)) return
      if (result.trim() !== '') this.deps.repo.putTranslation(hash, kind, result.trim())
      emit({ done: true })
    } catch (error) {
      if (this.running.has(requestId) || !(error instanceof Error && error.name === 'AbortError'))
        emit({ error: errorForException(error) })
    } finally {
      this.running.delete(requestId)
    }
  }
}

function parseDelta(data: string): string {
  try {
    const json = JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] }
    return json.choices?.[0]?.delta?.content ?? ''
  } catch {
    return ''
  }
}
