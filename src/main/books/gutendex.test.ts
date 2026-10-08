import { describe, expect, it } from 'vitest'
import { isAllowedUrl } from '../net'
import { Gutendex, pickFormat } from './gutendex'

describe('Gutendex', () => {
  it('下载格式：EPUB3 带图版本优先，其次其它 EPUB，再次 UTF-8 纯文本', () => {
    expect(
      pickFormat({
        'text/plain; charset=utf-8': 'https://www.gutenberg.org/ebooks/1342.txt.utf-8',
        'application/epub+zip': 'https://www.gutenberg.org/ebooks/1342.epub3.images',
        'text/html': 'https://www.gutenberg.org/ebooks/1342.html.images'
      })
    ).toEqual({ url: 'https://www.gutenberg.org/ebooks/1342.epub3.images', format: 'epub' })
    expect(
      pickFormat({
        'text/plain; charset=us-ascii': 'https://www.gutenberg.org/files/1/1.txt',
        'text/plain; charset=utf-8': 'https://www.gutenberg.org/cache/epub/1/pg1.txt'
      })
    ).toEqual({ url: 'https://www.gutenberg.org/cache/epub/1/pg1.txt', format: 'txt' })
    expect(pickFormat({ 'image/jpeg': 'https://www.gutenberg.org/x.jpg' })).toBeNull()
  })

  it('只许访问白名单域名、只走 https；开发用的 mock 源只在显式允许时可以', () => {
    const { api, files } = Gutendex.policies(null)
    expect(isAllowedUrl('https://gutendex.com/books/?languages=en', api)).toBe(true)
    expect(isAllowedUrl('http://gutendex.com/books/', api)).toBe(false)
    expect(isAllowedUrl('https://gutendex.com.evil.test/books/', api)).toBe(false)
    expect(isAllowedUrl('https://www.gutenberg.org/cache/epub/1/pg1.epub', files)).toBe(true)
    expect(isAllowedUrl('https://gutenberg.org/ebooks/1.epub3.images', files)).toBe(true)
    expect(isAllowedUrl('https://example.com/pg1.epub', files)).toBe(false)
    expect(isAllowedUrl('http://127.0.0.1:5000/books/', api)).toBe(false)
    const dev = Gutendex.policies('http://127.0.0.1:5000')
    expect(isAllowedUrl('http://127.0.0.1:5000/books/', dev.api)).toBe(true)
  })

  it('搜索只要英文书；重定向到白名单以外的地址会被拦下', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      if (url.startsWith('https://gutendex.com/books/?'))
        return new Response(
          JSON.stringify({
            count: 1,
            results: [
              {
                id: 7,
                title: 'Seven',
                authors: [{ name: 'Austen, Jane' }],
                download_count: 1234,
                formats: {
                  'application/epub+zip': 'https://www.gutenberg.org/ebooks/7.epub3.images'
                }
              }
            ]
          })
        )
      if (url === 'https://www.gutenberg.org/ebooks/7.epub3.images')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://evil.test/7.epub' }
        })
      throw new Error(`unexpected ${url}`)
    }) as unknown as typeof fetch
    const g = new Gutendex('https://gutendex.com', Gutendex.policies(null), fakeFetch)
    const page = await g.search('seven')
    expect(calls[0]).toBe('https://gutendex.com/books/?languages=en&search=seven')
    expect(page.books).toEqual([
      { id: 7, title: 'Seven', authors: ['Jane Austen'], downloadCount: 1234, format: 'epub' }
    ])
    await expect(g.download(7, () => {})).rejects.toThrow('不允许访问这个地址：evil.test')
  })
})
