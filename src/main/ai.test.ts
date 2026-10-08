/**
 * DeepSeek 翻译客户端：错误映射（mock 的 fetch）、流式输出、缓存；key 不出现在任何返回给渲染进程的数据里。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiChunk } from '../shared/api'
import { AI_TIMEOUT_MS, AiService, type AiRepo, type SecretStore } from './ai'

const KEY = 'sk-test-0123456789abcdef-SECRET'

function memorySecret(): SecretStore & { value: string | null } {
  const s = {
    value: null as string | null,
    available: () => true,
    save: (v: string) => {
      s.value = v
    },
    load: () => s.value,
    clear: () => {
      s.value = null
    }
  }
  return s
}

function memoryRepo(): AiRepo {
  const cache = new Map<string, string>()
  const settings = new Map<string, string>()
  return {
    getTranslation: (h, k) => cache.get(`${h}:${k}`) ?? null,
    putTranslation: (h, k, r) => void cache.set(`${h}:${k}`, r),
    getSetting: (k) => settings.get(k) ?? null,
    putSetting: (k, v) => void settings.set(k, v)
  }
}

/** 流式响应：每一块是一行 data: {...} */
function sse(parts: string[]): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts)
        controller.enqueue(
          enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`)
        )
      controller.enqueue(enc.encode('data: [DONE]\n\n'))
      controller.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function setup(fetchImpl: typeof fetch): {
  ai: AiService
  secret: ReturnType<typeof memorySecret>
  chunks: AiChunk[]
  log: string[]
} {
  const secret = memorySecret()
  const chunks: AiChunk[] = []
  const log: string[] = []
  const ai = new AiService({
    repo: memoryRepo(),
    secret,
    emit: (c) => chunks.push(c),
    fetchImpl,
    log: (m) => log.push(m)
  })
  return { ai, secret, chunks, log }
}

async function settle(chunks: AiChunk[]): Promise<void> {
  for (let i = 0; i < 100 && !chunks.some((c) => c.done || c.error); i++)
    await new Promise((r) => setTimeout(r, 5))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DeepSeek 翻译客户端', () => {
  it('没有 key：请先在设置里填写 DeepSeek API key', async () => {
    const { ai } = setup((() => {
      throw new Error('不应联网')
    }) as unknown as typeof fetch)
    expect(ai.start('translate', 'Hello')).toEqual({
      status: 'error',
      error: { code: 'noKey', message: '请先在设置里填写 DeepSeek API key', retryable: false }
    })
    expect(await ai.test()).toMatchObject({ code: 'noKey' })
  })

  it('HTTP 状态码映射成中文提示：401 key 无效、402 余额不足、429 太频繁、500 服务出错', async () => {
    const cases: [number, string, boolean][] = [
      [401, 'DeepSeek API key 无效，请在设置里检查后重新填写', false],
      [402, 'DeepSeek 账户余额不足，请充值后再试', false],
      [429, '请求太频繁，请稍后再试', true],
      [500, 'DeepSeek 服务暂时出错，请稍后重试（HTTP 500）', true]
    ]
    for (const [status, message, retryable] of cases) {
      const { ai, secret, chunks } = setup(
        (async () =>
          new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), {
            status
          })) as unknown as typeof fetch
      )
      secret.value = KEY
      const r = ai.start('translate', `Hello ${status}`)
      expect(r.status).toBe('stream')
      await settle(chunks)
      expect(chunks.at(-1)?.error).toEqual(expect.objectContaining({ message, retryable }))
      expect(await ai.test()).toEqual(expect.objectContaining({ message }))
    }
  })

  it('断网：说明原因并可以重试；30 秒没有回应算超时', async () => {
    const offline = setup((async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch)
    offline.secret.value = KEY
    offline.ai.start('translate', 'Hi')
    await settle(offline.chunks)
    expect(offline.chunks.at(-1)?.error).toEqual({
      code: 'network',
      message: '网络连接失败，连不上 DeepSeek，请检查网络后重试',
      retryable: true
    })

    vi.useFakeTimers()
    const hang = setup(
      ((_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        )) as unknown as typeof fetch
    )
    hang.secret.value = KEY
    hang.ai.start('translate', 'Slow')
    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS + 10)
    expect(hang.chunks.at(-1)?.error).toEqual(
      expect.objectContaining({ code: 'timeout', retryable: true })
    )
  })

  it('流式输出；同一段文字再次请求直接读缓存；超过 1000 个字符提示少选一些', async () => {
    const calls: { url: string; auth: string; body: unknown }[] = []
    const { ai, secret, chunks } = setup((async (url: string, init: RequestInit) => {
      calls.push({
        url,
        auth: (init.headers as Record<string, string>).Authorization,
        body: JSON.parse(String(init.body))
      })
      return sse(['你好', '，世界'])
    }) as unknown as typeof fetch)
    secret.value = KEY
    const r = ai.start('translate', 'Hello, world')
    expect(r.status).toBe('stream')
    await settle(chunks)
    expect(chunks.map((c) => c.delta ?? (c.done ? 'DONE' : 'ERR'))).toEqual([
      '你好',
      '，世界',
      'DONE'
    ])
    expect(calls[0]).toMatchObject({
      url: 'https://api.deepseek.com/chat/completions',
      auth: `Bearer ${KEY}`,
      body: { model: 'deepseek-chat', stream: true }
    })
    expect(ai.start('translate', '  Hello, world ')).toEqual({
      status: 'cached',
      result: '你好，世界'
    })
    expect(calls).toHaveLength(1)
    expect(ai.start('translate', 'x'.repeat(1001))).toMatchObject({
      status: 'error',
      error: { code: 'tooLong' }
    })
  })

  it('key 不出现在任何返回给渲染进程的数据里（返回值、流式事件、错误信息、日志）', async () => {
    const { ai, secret, chunks, log } = setup((async (url: string) =>
      url.endsWith('/models')
        ? new Response(`invalid key ${KEY}`, { status: 401 })
        : new Response(`{"error":"${KEY}"}`, { status: 402 })) as unknown as typeof fetch)
    const returned: unknown[] = []
    returned.push(ai.status())
    returned.push(ai.saveKey(`  ${KEY}  `))
    expect(secret.value).toBe(KEY)
    returned.push(ai.status())
    returned.push(await ai.test())
    returned.push(ai.start('translate', 'Hello'))
    returned.push(ai.start('explain', 'Hello'))
    await settle(chunks)
    returned.push(ai.setModel('deepseek-reasoner'))
    try {
      ai.saveKey('bad key with spaces')
    } catch (e) {
      returned.push((e as Error).message)
    }
    returned.push(ai.clearKey())
    const everything = JSON.stringify({ returned, chunks, log })
    expect(everything).not.toContain(KEY)
    expect(everything).not.toContain('SECRET')
    expect(returned[2]).toEqual({ hasKey: true, model: 'deepseek-chat', canEncrypt: true })
    expect(returned.at(-1)).toEqual({ hasKey: false, model: 'deepseek-reasoner', canEncrypt: true })
  })
})
