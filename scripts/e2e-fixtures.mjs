/**
 * 端到端测试用的夹具与 mock 服务（只在测试里用）：
 * - makeEpub：代码生成的 EPUB 3（三章，含 lighthouse / went / harbour 等要查的词）；
 * - makeTxt：给性能测试用的大 TXT（约 1MB，或一章 2000 段）；
 * - startMockServer：本机 http 服务，同时扮演 Gutendex（搜索、下载）和 DeepSeek（/models、流式 /chat/completions）。
 *   key 以 sk-good 开头时正常返回；sk-401 / sk-402 开头时返回对应的错误码。
 */
import { createServer } from 'node:http'
import { strToU8, zipSync } from 'fflate'

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

export const FIXTURE_TITLE = 'The Test Voyage'

function chapterXhtml(title, paragraphs) {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>
<h2 id="top">${title}</h2>
${paragraphs.map((p) => `<p>${p}</p>`).join('\n')}
</body></html>`
}

const FILLER = [
  'The morning wind came in from the sea and rattled the shutters of every house along the quay.',
  'Fishermen mended their nets in silence, and the gulls wheeled above the grey water like scraps of paper.',
  'Nobody in the village remembered a winter as long as this one, not even the oldest of the widows.',
  'At noon the bell of the chapel rang twice, which meant that the post had arrived from the mainland.'
]

/** 三章的小书。第 1 章第 1 段有 lighthouse 和 went；第 2 章第 2 段再出现 lighthouse */
export function makeEpub(title = FIXTURE_TITLE) {
  const ch1 = [
    'The lighthouse stood above the harbour. She went down to the water, and the old keeper waved to her.',
    'Nobody knew why the tower was abandoned; it was a well-known mystery in the town.',
    ...Array.from({ length: 30 }, (_, i) => FILLER[i % FILLER.length])
  ]
  const ch2 = [
    'Years later the keeper wrote a letter to her from the city.',
    'He said the lighthouse had been sold, and that the new owners painted it white.',
    ...Array.from({ length: 30 }, (_, i) => FILLER[(i + 1) % FILLER.length])
  ]
  const ch3 = ['In the end she returned, and the harbour was exactly as she remembered it.']
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>E. Tester</dc:creator><dc:language>en</dc:language></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>
</package>`
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol>
  <li><a href="c1.xhtml">Chapter I</a></li><li><a href="c2.xhtml">Chapter II</a></li><li><a href="c3.xhtml">Chapter III</a></li>
</ol></nav></body></html>`
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/c1.xhtml': strToU8(chapterXhtml('CHAPTER I', ch1)),
    'OEBPS/c2.xhtml': strToU8(chapterXhtml('CHAPTER II', ch2)),
    'OEBPS/c3.xhtml': strToU8(chapterXhtml('CHAPTER III', ch3))
  })
}

export const STRUCT_TITLE = 'The Structured Almanac'

/**
 * v0.4 的结构夹具：landmarks、多级 nav（前言 / 正文 / 附录三组）、装饰性首字母、小节标题、书自带的目录页、封面图片。
 */
export async function makeStructuredEpub() {
  const { makePng } = await import('../src/shared/domain/testing/pdfFixtures.ts')
  const xhtml = (body) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><link rel="stylesheet" href="book.css"/></head>${body}</html>`
  const paras = (n, seed) =>
    Array.from({ length: n }, (_, i) => `<p>${FILLER[(i + seed) % FILLER.length]}</p>`).join('\n')
  const files = {
    'OEBPS/content.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${STRUCT_TITLE}</dc:title><dc:creator>S. Tester</dc:creator><dc:language>en</dc:language></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="book.css" media-type="text/css"/>
    <item id="img" href="cover.png" media-type="image/png"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="fw" href="foreword.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ap" href="appendix.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="cover"/><itemref idref="fw"/><itemref idref="c1"/><itemref idref="c2"/><itemref idref="ap"/></spine>
</package>`,
    'OEBPS/book.css':
      '.dropcap { float: left; font-size: 3em } .sc { font-variant: small-caps } .center { text-align: center }',
    'OEBPS/nav.xhtml': xhtml(`<body>
<nav epub:type="landmarks" hidden=""><ol><li><a epub:type="cover" href="cover.xhtml">Cover</a></li><li><a epub:type="bodymatter" href="c1.xhtml">Start</a></li></ol></nav>
<nav epub:type="toc"><ol>
  <li><a href="foreword.xhtml"><span class="dropcap">F</span>
<span class="sc">OREWORD</span></a></li>
  <li><span>Part One</span><ol>
    <li><a href="c1.xhtml">Chapter One: The Harbour</a><ol><li><a href="c1.xhtml#s1">The Quay at Dawn</a></li></ol></li>
    <li><a href="c2.xhtml">Chapter Two: The Tower</a></li>
  </ol></li>
  <li><a href="appendix.xhtml">Appendix</a></li>
</ol></nav></body>`),
    'OEBPS/cover.xhtml': xhtml('<body><div><img src="cover.png" alt="Cover"/></div></body>'),
    'OEBPS/foreword.xhtml':
      xhtml(`<body><section epub:type="foreword"><h1><span class="dropcap">F</span>
<span class="sc">OREWORD</span></h1>
<p><span class="dropcap">T</span>
his almanac collects the small facts of a harbour town.</p>${paras(6, 0)}</section></body>`),
    'OEBPS/c1.xhtml': xhtml(`<body><h1>Chapter One: The Harbour</h1>
<p>The lighthouse stood above the harbour, and the keeper counted the boats each evening.</p>
${paras(10, 1)}
<h2 id="s1">The Quay at Dawn</h2>
${paras(14, 2)}</body>`),
    'OEBPS/c2.xhtml': xhtml(`<body><h1>Chapter Two: The Tower</h1>${paras(18, 3)}</body>`),
    'OEBPS/appendix.xhtml': xhtml(
      `<body><section epub:type="appendix"><h1>Appendix</h1><p class="center">Tide tables and notes.</p>${paras(3, 0)}</section></body>`
    )
  }
  const entries = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER)
  }
  for (const [k, v] of Object.entries(files)) entries[k] = strToU8(v)
  entries['OEBPS/cover.png'] = makePng(300, 420, [196, 120, 80])
  return zipSync(entries)
}

/** PDF 夹具：正文三页（书签、行尾连字符），以及扫描版（十页图片） */
export async function makePdfs() {
  const f = await import('../src/shared/domain/testing/pdfFixtures.ts')
  return { text: await f.textPdf(), scanned: await f.scannedPdf(), title: f.PDF_TITLE }
}

/** 约 bytes 字节、chapters 章的 TXT；chapters = 1 时就是一章很多段 */
export function makeTxt(title, bytes, chapters, paragraphsPerChapter) {
  const lines = [
    `Title: ${title}`,
    '',
    'Author: Perf Tester',
    '',
    `*** START OF THE PROJECT GUTENBERG EBOOK ${title.toUpperCase()} ***`,
    ''
  ]
  let size = 0
  let p = 0
  for (let c = 1; c <= chapters; c++) {
    lines.push(`CHAPTER ${c}`, '')
    const count = paragraphsPerChapter ?? Math.ceil(bytes / chapters / 200)
    for (let i = 0; i < count; i++) {
      const text = `${FILLER[p++ % FILLER.length]} ${FILLER[p % FILLER.length]}`
      lines.push(text, '')
      size += text.length + 2
    }
  }
  lines.push(`*** END OF THE PROJECT GUTENBERG EBOOK ${title.toUpperCase()} ***`)
  return { text: lines.join('\n'), size }
}

const MOCK_BOOKS = [
  {
    id: 1342,
    title: 'Pride and Prejudice',
    authors: [{ name: 'Austen, Jane' }],
    download_count: 60123
  },
  {
    id: 84,
    title: 'Frankenstein; Or, The Modern Prometheus',
    authors: [{ name: 'Shelley, Mary Wollstonecraft' }],
    download_count: 51234
  }
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function startMockServer() {
  const requests = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    requests.push(`${req.method} ${url.pathname}${url.search}`)
    const base = `http://127.0.0.1:${server.address().port}`
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const withFormats = (b) => ({
      ...b,
      formats: { 'application/epub+zip': `${base}/files/${b.id}.epub3.images` }
    })

    // ---- Gutendex
    if (url.pathname === '/books/' && req.method === 'GET') {
      if (url.searchParams.get('languages') !== 'en') return json(400, { detail: 'languages' })
      const q = (url.searchParams.get('search') ?? '').toLowerCase()
      const results = MOCK_BOOKS.filter((b) => !q || b.title.toLowerCase().includes(q)).map(
        withFormats
      )
      return json(200, { count: results.length, results })
    }
    const one = /^\/books\/(\d+)$/.exec(url.pathname)
    if (one) {
      const b = MOCK_BOOKS.find((x) => x.id === Number(one[1]))
      return b ? json(200, withFormats(b)) : json(404, {})
    }
    const file = /^\/files\/(\d+)\.epub3\.images$/.exec(url.pathname)
    if (file) {
      const b = MOCK_BOOKS.find((x) => x.id === Number(file[1]))
      const bytes = makeEpub(b?.title ?? 'Unknown')
      res.writeHead(200, {
        'content-type': 'application/epub+zip',
        'content-length': bytes.byteLength
      })
      // 分几块慢慢发，界面上能看到进度
      const step = Math.ceil(bytes.byteLength / 4)
      for (let i = 0; i < bytes.byteLength; i += step) {
        res.write(Buffer.from(bytes.subarray(i, i + step)))
        await sleep(120)
      }
      return res.end()
    }

    // ---- DeepSeek
    const auth = req.headers.authorization ?? ''
    const key = auth.replace(/^Bearer /, '')
    const fail = key.startsWith('sk-401')
      ? 401
      : key.startsWith('sk-402')
        ? 402
        : key.startsWith('sk-good')
          ? 0
          : 401
    if (url.pathname === '/models')
      return fail
        ? json(fail, { error: `bad ${key}` })
        : json(200, { data: [{ id: 'deepseek-chat' }] })
    if (url.pathname === '/chat/completions' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw)
      if (fail) return json(fail, { error: { message: `key ${key} rejected` } })
      const system = body.messages?.[0]?.content ?? ''
      const text = body.messages?.[1]?.content ?? ''
      const answer = system.includes('讲解')
        ? ['这句话', '的主干是', '讲解示例。']
        : ['【译文】', '这是', `（${text.length} 字）的中文。`]
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      await sleep(600) // 等第一个字：界面上播放 AI 等待的循环动效
      for (const part of answer) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`)
        await sleep(150)
      }
      res.write('data: [DONE]\n\n')
      return res.end()
    }
    json(404, { detail: 'not found' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => server.close()
  }
}
