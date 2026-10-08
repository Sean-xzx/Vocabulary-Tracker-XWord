/**
 * 联网（只在主进程）：只允许访问白名单域名，只走 https，每个请求都有超时，重定向逐跳检查。
 * 白名单：gutendex.com（找书）、www.gutenberg.org / gutenberg.org（下载）、api.deepseek.com（翻译）。
 * 开发 / 测试可以用环境变量把服务地址换成本机的 mock（只在未打包时生效，见 index.ts），此时额外允许那个源。
 */

export const HOSTS = {
  gutendex: ['gutendex.com'],
  gutenberg: ['www.gutenberg.org', 'gutenberg.org'],
  deepseek: ['api.deepseek.com']
} as const

export class NetError extends Error {
  constructor(
    message: string,
    readonly kind: 'blocked' | 'network' | 'timeout' | 'http' | 'tooLarge',
    readonly status = 0
  ) {
    super(message)
  }
}

export interface NetPolicy {
  hosts: readonly string[]
  /** 开发 / 测试用的 mock 源（例如 http://127.0.0.1:5123），允许 http */
  devOrigins?: readonly string[]
}

export function isAllowedUrl(url: string, policy: NetPolicy): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (policy.devOrigins?.includes(u.origin)) return true
  return u.protocol === 'https:' && policy.hosts.includes(u.hostname) && u.port === ''
}

const MAX_REDIRECTS = 5

/**
 * 带白名单与超时的 fetch。timeoutMs 是“没有任何进展”的时间：建立连接、收到响应头都算进展；
 * 读取响应体时由调用方用 readBody 继续计时。
 */
export async function guardedFetch(
  url: string,
  init: RequestInit,
  policy: NetPolicy,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch
): Promise<{ response: Response; controller: AbortController; timer: IdleTimer }> {
  const controller = new AbortController()
  const timer = new IdleTimer(controller, timeoutMs)
  let current = url
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isAllowedUrl(current, policy)) {
        throw new NetError(`不允许访问这个地址：${safeHost(current)}`, 'blocked')
      }
      const response = await fetchImpl(current, {
        ...init,
        redirect: 'manual',
        signal: controller.signal
      })
      timer.touch()
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        current = new URL(response.headers.get('location')!, current).toString()
        continue
      }
      return { response, controller, timer }
    }
    throw new NetError('重定向次数太多', 'network')
  } catch (error) {
    timer.stop()
    throw toNetError(error, timer.fired, timeoutMs)
  }
}

/** 读取响应体：每收到一块数据就重新计时；超过 maxBytes 立即中止。 */
export async function readBody(
  response: Response,
  controller: AbortController,
  timer: IdleTimer,
  maxBytes: number,
  onProgress?: (received: number, total: number) => void
): Promise<Uint8Array> {
  const total = Number(response.headers.get('content-length')) || 0
  if (total > maxBytes) {
    controller.abort()
    timer.stop()
    throw new NetError(`文件太大（超过 ${Math.round(maxBytes / 1024 / 1024)}MB）`, 'tooLarge')
  }
  const reader = response.body?.getReader()
  if (!reader) {
    timer.stop()
    return new Uint8Array(0)
  }
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      timer.touch()
      received += value.byteLength
      if (received > maxBytes) {
        controller.abort()
        throw new NetError(`文件太大（超过 ${Math.round(maxBytes / 1024 / 1024)}MB）`, 'tooLarge')
      }
      chunks.push(value)
      onProgress?.(received, total)
    }
  } catch (error) {
    throw toNetError(error, timer.fired, timer.ms)
  } finally {
    timer.stop()
  }
  const out = new Uint8Array(received)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

/** 一段时间没有进展就中止请求 */
export class IdleTimer {
  private handle: ReturnType<typeof setTimeout> | null = null
  fired = false

  constructor(
    private readonly controller: AbortController,
    readonly ms: number
  ) {
    this.touch()
  }

  touch(): void {
    if (this.handle) clearTimeout(this.handle)
    this.handle = setTimeout(() => {
      this.fired = true
      this.controller.abort()
    }, this.ms)
  }

  stop(): void {
    if (this.handle) clearTimeout(this.handle)
    this.handle = null
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '无效地址'
  }
}

function toNetError(error: unknown, timedOut: boolean, ms: number): NetError {
  if (error instanceof NetError) return error
  if (timedOut) return new NetError(`请求超时（${Math.round(ms / 1000)} 秒没有响应）`, 'timeout')
  return new NetError('网络连接失败，请检查网络后重试', 'network')
}
