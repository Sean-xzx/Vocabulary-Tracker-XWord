/**
 * 阅读器的端到端用例（v0.3 的阅读器与单词本打通 + v0.4 的书页排版、PDF 原版页面）：
 * 查词、收词、出处、熟词、高亮、发现页（mock Gutendex）、翻译（mock DeepSeek）、时间（可注入的时钟、运行中改时区）、
 * 双页、快速连按不丢键、目录分组、改字号后内容还在当前页、重启回到原位置；PDF 点词、连字符词、翻译、缩放后高亮不偏、
 * 扫描版提示；性能实测；浅深两套截图。由 scripts/e2e.mjs 调用，t 里是那边的测试工具。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FIXTURE_TITLE,
  STRUCT_TITLE,
  makeEpub,
  makePdfs,
  makeStructuredEpub,
  makeTxt
} from './e2e-fixtures.mjs'

// ---------------------------------------------------------------- 页面里用的小工具（字符串形式交给 eval）

/** 可见的正文区域（书页排版：裁切框；PDF：页面所在的滚动区） */
const CLIP = `(document.querySelector('.flow-clip') ?? document.querySelector('.pdf-scroll'))`
/** 可见的文字根：书页排版的多栏容器；PDF 的文字层 */
const ROOT = `(document.querySelector('.flow-clip .rflow') ?? document.querySelector('.pdf-spread'))`

/** 可见区里第 n 个完整单词 word 的中心点；没有返回 null */
function wordPointJs(word, n = 0) {
  return `(() => {
    const root = ${ROOT}; const clip = ${CLIP}?.getBoundingClientRect(); if (!root || !clip) return null
    const w = ${JSON.stringify(word)}; const isW = (c) => !!c && /[A-Za-z]/.test(c)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let k = 0
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      let from = 0; let i
      while ((i = t.data.indexOf(w, from)) >= 0) {
        from = i + 1
        if (isW(t.data[i - 1]) || isW(t.data[i + w.length])) continue
        const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + w.length)
        const rect = r.getClientRects()[0]
        if (!rect || rect.left < clip.left - 1 || rect.right > clip.right + 1 || rect.top < clip.top - 1 || rect.bottom > clip.bottom + 1) continue
        if (k++ === ${n}) return { x: rect.left + Math.min(rect.width / 2, 8), y: rect.top + rect.height / 2 }
      }
    }
    return null })()`
}

/** 选中第 block 块里 [start, end) 的文字（书页排版） */
function selectJs(block, start, end) {
  return `(() => {
    const el = document.querySelector('.flow-clip [data-b="${block}"]'); if (!el) return false
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const pts = []; let pos = 0
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { pts.push([n, pos]); pos += n.data.length }
    const at = (o) => { for (let i = pts.length - 1; i >= 0; i--) if (pts[i][1] <= o) return [pts[i][0], o - pts[i][1]] }
    const r = document.createRange(); const a = at(${start}); const b = at(${end})
    r.setStart(a[0], a[1]); r.setEnd(b[0], b[1])
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return true })()`
}

/** 当前锚点（章节:块:偏移）所在的字符是否在可见区里（书页排版） */
const ANCHOR_VISIBLE = `(() => {
  const a = document.querySelector('.reader')?.dataset.anchor; if (!a) return 'no anchor'
  const [c, b, o] = a.split(':').map(Number)
  const el = document.querySelector('.flow-clip [data-b="' + b + '"]'); if (!el) return 'no block ' + b
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let rest = o; let node = null
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (rest < n.data.length) { node = n; break } rest -= n.data.length }
  let rect
  if (node) { const r = document.createRange(); r.setStart(node, rest); r.setEnd(node, rest + 1); rect = r.getBoundingClientRect() }
  else rect = el.getClientRects()[0]
  const clip = document.querySelector('.flow-clip').getBoundingClientRect()
  return rect && rect.left >= clip.left - 1 && rect.right <= clip.right + 1 && rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1
})()`

/** 底栏的页码：{ n, total } */
const FOOT_PAGE = `(() => { const m = /第 (\\d+)(?: \\/ (\\d+))? 页/.exec(document.querySelector('.foot-page')?.textContent ?? ''); return m ? { n: Number(m[1]), total: m[2] ? Number(m[2]) : null } : null })()`

export async function readerScenarios(t) {
  const { press, type, waitFor, check, expectEq, sleep, q, clickToastAction } = t
  const cdp = () => t.cdp()
  const ev = (expr) => cdp().eval(expr)

  async function clickPoint(pt) {
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp().send('Input.dispatchMouseEvent', {
        type,
        x: pt.x,
        y: pt.y,
        button: 'left',
        clickCount: 1
      })
    await sleep(80)
  }

  /** 在元素中心点一下（真实的鼠标事件） */
  async function clickAt(selectorExpr, label) {
    const pt = await waitFor(
      `(() => { const el = ${selectorExpr}; if (!el) return null; el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect(); return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null })()`,
      label
    )
    await sleep(60)
    await clickPoint(pt)
  }

  /** 点可见区里的单词打开查词卡片；卡片没出来时再点一次 */
  async function openLookup(word, label = word, n = 0) {
    for (let i = 0; i < 3; i++) {
      const pt = await waitFor(wordPointJs(word, n), `${label} 的位置`)
      await clickPoint(pt)
      try {
        await waitFor(`!!document.querySelector('.lookup-card')`, `${label} 的查词卡片`, 2500)
        return
      } catch (e) {
        if (i === 2) throw e
      }
    }
  }

  /** 可见区里单词本标记过的 word（.w 片段） */
  const markedEl = (word) =>
    `[...document.querySelectorAll('.flow-clip .w')].find(e => e.textContent === ${q(word)})`

  async function selectInBlock(block, start, end) {
    if (!(await ev(selectJs(block, start, end)))) throw new Error(`第 ${block} 块不在当前页`)
    await waitFor(`!!document.querySelector('.selection-toolbar')`, '选区工具条')
  }
  const snapshot = () => ev('window.xword.getSnapshot()')
  const epubPath = join(t.dataDir, 'fixture.epub')
  writeFileSync(epubPath, makeEpub())
  let bookId = null
  let collectedId = null

  /** 从书架打开一本书，等第一屏排好 */
  async function openFromShelf(title) {
    await ev(`document.activeElement && document.activeElement.blur()`)
    if (await ev(`!!document.querySelector('.reader')`)) {
      await press('Escape')
      await waitFor(`!!document.querySelector('.shelf')`, '书架')
    }
    await press('2', { ctrl: true })
    await waitFor(`!!document.querySelector('.shelf')`, '书架')
    await ev(
      `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent.startsWith('我的书'))?.click()`
    )
    await clickAt(`document.querySelector('.shelf-book-open[aria-label*=${q(title)}]')`, title)
    await waitFor(`document.querySelector('.reader')?.dataset.ready === ''`, `${title} 排好`, 8000)
  }

  console.log('阅读器')

  await check('导入夹具 EPUB：书架「我的书」里出现这本书（生成的封面）', async () => {
    if (await ev(`!!document.querySelector('.dialog')`)) await press('Escape')
    await ev(`window.__xwordDev.importPath(${q(epubPath)})`)
    await ev(`document.activeElement && document.activeElement.blur()`)
    await press('2', { ctrl: true })
    await waitFor(`!!document.querySelector('.shelf')`, '书架')
    await ev(
      `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent.startsWith('我的书'))?.click()`
    )
    await waitFor(
      `[...document.querySelectorAll('.shelf-book .book-cover-title')].some(e => e.textContent === ${q(FIXTURE_TITLE)})`,
      '封面'
    )
    const snap = await snapshot()
    bookId = snap.books.find((b) => b.title === FIXTURE_TITLE)?.id
    if (!bookId) throw new Error('快照里没有这本书')
    // 重复导入不新增
    await ev(`window.__xwordDev.importPath(${q(epubPath)})`)
    expectEq(
      (await snapshot()).books.filter((b) => b.title === FIXTURE_TITLE).length,
      1,
      '重复导入'
    )
  })

  await check(
    '打开 EPUB：默认双页（章首在右页），侧栏收起，底栏显示“第 N 页”，正文 19px',
    async () => {
      await clickAt(
        `document.querySelector('.shelf-book-open[aria-label*=${q(FIXTURE_TITLE)}]')`,
        '书'
      )
      await waitFor(`!!document.querySelector('.flow-clip .ch-open')`, '章首')
      await waitFor(`document.querySelector('.reader')?.dataset.ready === ''`, '排好')
      expectEq(await ev(`!!document.querySelector('.sidebar')`), false, '侧栏收起')
      expectEq(await ev(`!!document.querySelector('.spread.is-double')`), true, '双页')
      expectEq(await ev(`innerWidth >= 1100`), true, '窗口宽度 ≥ 1100')
      expectEq(
        await ev(`document.querySelector('.reader-chapter')?.textContent`),
        'Chapter I',
        '当前章节'
      )
      await waitFor(
        `/^第 1( \\/ \\d+)? 页$/.test(document.querySelector('.foot-page')?.textContent ?? '')`,
        '底栏“第 1 页”'
      )
      expectEq(
        await ev(`getComputedStyle(document.querySelector('.flow-clip .rb-p')).fontSize`),
        '19px',
        '默认字号'
      )
      // 章首页：左边是空白页，正文在右页
      const clip = await ev(
        `(() => { const c = document.querySelector('.flow-clip').getBoundingClientRect(); const h = document.querySelector('.flow-clip .ch-open').getBoundingClientRect(); return h.left > c.left + c.width / 2 })()`
      )
      expectEq(clip, true, '章首在右页')
    }
  )

  await check('点一个单词：查词卡片（音标、义项、按钮）', async () => {
    await openLookup('lighthouse')
    await waitFor(
      `document.querySelector('.lookup-card .lookup-word')?.textContent === 'lighthouse'`,
      '查词卡片'
    )
    const text = await ev(`document.querySelector('.lookup-card').textContent`)
    await ev(`document.querySelector('.lookup-card .word-audio').click()`)
    expectEq(await ev(`window.__speechTest.spoken.at(-1)`), 'lighthouse', '阅读查词朗读')
    if (!/收进单词本/.test(text) || !/我认识/.test(text)) throw new Error(`卡片按钮：${text}`)
  })

  await check(
    '选义项并收词：写进今天的单词页，出处（章节、块、偏移、句子）正确，例句自动填入',
    async () => {
      await press('a')
      await waitFor(
        `!!document.activeElement?.closest('.sense-panel:not([data-closing])')`,
        '焦点进入义项面板'
      )
      await press('1')
      await ev(`document.querySelector('.sense-panel:not([data-closing]) .word-audio').click()`)
      expectEq(await ev(`window.__speechTest.spoken.at(-1)`), 'lighthouse', '选义项朗读')
      await press('Enter')
      await waitFor(
        `[...document.querySelectorAll('.toast-message')].some(t => t.textContent.includes('已收进单词本'))`,
        '收词提示'
      )
      const snap = await snapshot()
      const w = snap.words.find((x) => x.text === 'lighthouse')
      if (!w) throw new Error('单词本里没有 lighthouse')
      collectedId = w.id
      const page = snap.pages.find((p) => p.id === w.pageId)
      expectEq(page.startedOn, snap.today, '写进今天的页')
      expectEq(w.status, 'new', '新词')
      expectEq(w.example, 'The lighthouse stood above the harbour.', '例句')
      const src = snap.sources.filter((s) => s.wordId === w.id)
      expectEq(
        src.map((s) => [s.bookId === bookId, s.chapter, s.block, s.offset, s.sentence]),
        [[true, 0, 1, 4, 'The lighthouse stood above the harbour.']],
        '出处'
      )
      // 正文里的 lighthouse 加上了单词本的标记
      await waitFor(`${markedEl('lighthouse')}?.className.includes('w-')`, '正文标记')
    }
  )

  await check('重复收同一个词：只追加出处，不新增单词，提示“已在第 N 页，已添加出处”', async () => {
    const before = await snapshot()
    await press(']')
    await waitFor(
      `document.querySelector('.reader-chapter')?.textContent === 'Chapter II'`,
      '第二章'
    )
    await waitFor(
      `document.querySelector('.reader')?.dataset.anchor?.startsWith('1:')`,
      '第二章排好'
    )
    await openLookup('lighthouse', '第二章的 lighthouse')
    await waitFor(
      `document.querySelector('.lookup-status')?.textContent.includes('已在单词本')`,
      '卡片顶部的单词本状态'
    )
    await press('a')
    await waitFor(
      `[...document.querySelectorAll('.toast-message')].some(t => /已在第 \\d+ 页，已添加出处/.test(t.textContent))`,
      '追加出处提示'
    )
    const after = await snapshot()
    expectEq(after.words.length, before.words.length, '单词数不变')
    expectEq(after.sources.filter((s) => s.wordId === collectedId).length, 2, '出处 2 条')
  })

  await check('熟词：标记后这个词和它的变形不再显示标记；撤销后恢复', async () => {
    await openLookup('lighthouse')
    await ev(
      `[...document.querySelectorAll('.lookup-card button')].find(b => b.textContent === '我认识').click()`
    )
    await waitFor(`!${markedEl('lighthouse')}`, '标记消失')
    if (!(await snapshot()).known.includes('lighthouse')) throw new Error('熟词没有写入')
    await clickToastAction()
    await waitFor(`${markedEl('lighthouse')}?.className.includes('w-')`, '撤销后标记恢复')
    expectEq((await snapshot()).known.includes('lighthouse'), false, '熟词已撤销')
  })

  await check('高亮：选中文字按 H 创建（荧光笔划出），Toast 撤销后消失', async () => {
    await press('[')
    await waitFor(
      `document.querySelector('.reader-chapter')?.textContent === 'Chapter I'`,
      '第一章'
    )
    await waitFor(
      `document.querySelector('.reader')?.dataset.anchor?.startsWith('0:')`,
      '第一章排好'
    )
    await sleep(300)
    await selectInBlock(2, 0, 31)
    await press('h')
    await waitFor(`!!document.querySelector('.flow-clip .hl.hl-yellow:not(.is-pending)')`, '高亮')
    expectEq(
      await ev(`[...document.querySelectorAll('.flow-clip .hl')].map(e => e.textContent).join('')`),
      'Nobody knew why the tower was a',
      '高亮文字'
    )
    await clickToastAction()
    await waitFor(`!document.querySelector('.flow-clip .hl')`, '撤销高亮')
    expectEq((await ev(`window.xword.listHighlights(${q(bookId)})`)).length, 0, '库里没有高亮')
  })

  await check('高亮与笔记页：按书分组，点一条跳回原文位置', async () => {
    await selectInBlock(3, 4, 20)
    await press('h')
    await waitFor(`!!document.querySelector('.flow-clip .hl')`, '再建一条')
    await press('Escape')
    await waitFor(`!!document.querySelector('.shelf')`, '退出阅读回到书架')
    await press('3', { ctrl: true })
    await waitFor(
      `document.querySelector('.hl-group-title')?.textContent.startsWith(${q(FIXTURE_TITLE)})`,
      '分组'
    )
    await clickAt(`document.querySelector('.hl-item')`, '高亮条目')
    await waitFor(
      `(() => { const m = document.querySelector('.flow-clip .hl'); if (!m) return false; const r = m.getBoundingClientRect(); const c = ${CLIP}.getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top && r.bottom <= c.bottom })()`,
      '跳回后高亮在当前页上'
    )
  })

  await check('快速连按 10 次“下一页”：直接跳到目标页，不丢键', async () => {
    await press('Home')
    await press('[')
    await waitFor(`document.querySelector('.reader')?.dataset.anchor === '0:0:0'`, '回到第一章开头')
    // 全书各章的页数（空闲时量好、缓存在本地）
    await waitFor(`${FOOT_PAGE}?.total != null`, '总页数算好', 8000)
    const counts = await ev(
      `JSON.parse(localStorage.getItem('xword.pageCounts.' + ${q(bookId)})).counts`
    )
    // 按双页规则模拟 10 次翻页：每章从右页开始
    let ch = 0
    let pg = 0
    for (let i = 0; i < 10; i++) {
      const last = pg === 0 ? 0 : Math.min(counts[ch] - 1, pg % 2 === 1 ? pg + 1 : pg)
      if (last + 1 < counts[ch]) pg = last + 1
      else if (ch + 1 < counts.length) {
        ch++
        pg = 0
      }
    }
    const expected = counts.slice(0, ch).reduce((a, b) => a + b, 0) + pg + 1
    for (let i = 0; i < 10; i++) await t.pressFast('ArrowRight')
    await waitFor(`${FOOT_PAGE}?.n === ${expected}`, `第 ${expected} 页`, 5000)
    await sleep(400)
    expectEq((await ev(FOOT_PAGE)).n, expected, '没有多翻也没有少翻')
    t.log(`各章页数 ${counts.join(' / ')}，连按 10 次到第 ${expected} 页`)
  })

  await check('改字号、单双页后当前内容还在当前页上；高亮锚点不变', async () => {
    await press('ArrowLeft')
    await sleep(300)
    const before = await ev(`document.querySelector('.reader').dataset.anchor`)
    await ev(`document.querySelector('.reader-bar button[aria-label="页面设置"]').click()`)
    await waitFor(`!!document.querySelector('.aa-panel input[aria-label="字号"]')`, '页面设置')
    for (const size of ['24', '16', '19']) {
      await ev(
        `(() => { const i = document.querySelector('.aa-panel input[aria-label="字号"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '${size}'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`
      )
      await waitFor(
        `getComputedStyle(document.querySelector('.flow-clip .rb-p')).fontSize === '${size}px'`,
        `字号 ${size}`
      )
      await sleep(250)
      expectEq(
        await ev(`document.querySelector('.reader').dataset.anchor`),
        before,
        `字号 ${size} 锚点`
      )
      expectEq(await ev(ANCHOR_VISIBLE), true, `字号 ${size} 锚点文字在当前页`)
    }
    for (const mode of ['单页', '双页']) {
      await ev(
        `[...document.querySelectorAll('.aa-panel .segmented-item')].find(b => b.textContent === '${mode}').click()`
      )
      await sleep(300)
      expectEq(await ev(ANCHOR_VISIBLE), true, `${mode}后锚点文字在当前页`)
    }
    await press('Escape')
    await waitFor(`!document.querySelector('.aa-panel')`, '关闭页面设置')
    await ev(`document.activeElement && document.activeElement.blur()`)
  })

  await check(
    '复习卡片显示出处句子（目标词标出、“《书名》第 N 章”），点击后关闭复习跳回书里对应的位置',
    async () => {
      await press('Escape')
      await waitFor(`!!document.querySelector('.shelf')`, '书架')
      await press('4', { ctrl: true })
      await waitFor(`!!document.querySelector('.overview')`, '概览')
      await press('Enter')
      await waitFor(`!!document.querySelector('.session .card:not(.is-ghost)')`, '复习中')
      for (let i = 0; i < 80; i++) {
        const w = await ev(
          `document.querySelector('.session .card:not(.is-ghost) .card-word')?.textContent`
        )
        if (w === 'lighthouse') break
        await press('s')
        await sleep(40)
      }
      await press(' ')
      await waitFor(
        `document.querySelector('.card:not(.is-ghost) .card-source-word')?.textContent === 'lighthouse'`,
        '出处句子里标出目标词'
      )
      const link = await ev(
        `document.querySelector('.card:not(.is-ghost) .card-source-link').textContent.replace(/\\s+/g, ' ').trim()`
      )
      expectEq(link, `《${FIXTURE_TITLE}》第 2 章`, '出处链接（最近一条在第二章）')
      await ev(`document.querySelector('.card:not(.is-ghost) .card-source-link').click()`)
      await waitFor(
        `document.querySelector('.reader-chapter')?.textContent === 'Chapter II'`,
        '跳到第二章'
      )
      await waitFor(
        `document.querySelector('.reader')?.dataset.anchor?.startsWith('1:2:')`,
        '锚点是出处'
      )
      await waitFor(ANCHOR_VISIBLE, '出处所在的文字在当前页上')
    }
  )

  await check('发现页：mock Gutendex 搜索、下载（进度），完成后出现在「我的书」', async () => {
    await press('Escape')
    await waitFor(`!!document.querySelector('.shelf')`, '书架')
    await ev(
      `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent === '发现').click()`
    )
    await waitFor(`document.querySelectorAll('.discover-row').length === 2`, '最热门的书')
    await ev(`document.querySelector('.discover-search input').focus()`)
    await type('pride')
    await press('Enter')
    await waitFor(
      `document.querySelectorAll('.discover-row').length === 1 && document.querySelector('.discover-title').textContent === 'Pride and Prejudice'`,
      '搜索结果'
    )
    expectEq(
      await ev(`document.querySelector('.discover-author').textContent`),
      'Jane Austen',
      '作者'
    )
    await ev(
      `[...document.querySelectorAll('.discover-row button')].find(b => b.textContent.includes('下载')).click()`
    )
    await waitFor(`!!document.querySelector('.discover-progress')`, '下载进度', 3000)
    await waitFor(
      `[...document.querySelectorAll('.discover-row button')].some(b => b.textContent === '打开')`,
      '下载完成',
      8000
    )
    expectEq(
      (await snapshot()).books.some(
        (b) => b.title === 'Pride and Prejudice' && b.source === 'gutenberg'
      ),
      true,
      '我的书'
    )
    const hint = await ev(`document.querySelector('.discover-foot').textContent`)
    if (
      !hint.includes('去 Standard Ebooks 挑精排版') ||
      !hint.includes('下载 EPUB 后拖进来即可导入')
    )
      throw new Error(`底部外链：${hint}`)
  })

  await check(
    '翻译：mock DeepSeek 流式输出（先显示 AI 等待）、缓存命中、401 与 402 的中文提示',
    async () => {
      await ev(`window.xword.aiSaveKey('sk-good-e2e-0123456789')`)
      const status = await ev('window.xword.aiStatus()')
      expectEq(
        status,
        { hasKey: true, model: 'deepseek-chat', canEncrypt: status.canEncrypt },
        'key 只回传“已设置”'
      )
      await openFromShelf(FIXTURE_TITLE)
      await press('[')
      await waitFor(`document.querySelector('.reader')?.dataset.anchor === '0:0:0'`, '第一章')
      await sleep(300)
      await selectInBlock(1, 0, 39)
      await press('t')
      await waitFor(`!!document.querySelector('.translate-panel .ai-wait')`, 'AI 等待动效')
      await waitFor(
        `document.querySelector('.translate-panel .ai-text')?.textContent.includes('的中文。')`,
        '流式译文',
        6000
      )
      expectEq(
        await ev(`!!document.querySelector('.translate-panel .ai-wait')`),
        false,
        '第一个字出现后等待动效停止'
      )
      await waitFor(
        `!!document.querySelector('.translate-panel .ai-text[data-done]')`,
        '流式输出结束'
      )
      await press('Escape')
      await selectInBlock(1, 0, 39)
      await press('t')
      await waitFor(
        `document.querySelector('.translate-panel .translate-head')?.textContent.includes('来自缓存')`,
        '缓存命中'
      )
      await press('Escape')
      await ev(`window.xword.aiSaveKey('sk-401-e2e-0123456789')`)
      await selectInBlock(2, 0, 20)
      await press('t')
      await waitFor(
        `document.querySelector('.translate-panel .ai-error')?.textContent.includes('key 无效')`,
        '401 提示'
      )
      await press('Escape')
      await ev(`window.xword.aiSaveKey('sk-402-e2e-0123456789')`)
      await selectInBlock(3, 0, 20)
      await press('t')
      await waitFor(
        `document.querySelector('.translate-panel .ai-error')?.textContent.includes('余额不足')`,
        '402 提示'
      )
      await press('Escape')
      await ev('window.xword.aiClearKey()')
    }
  )

  await check(
    '时间：可注入的时钟模拟睡眠跨过午夜后唤醒，今日队列、首页和单词页自动更新',
    async () => {
      await press('Escape')
      await waitFor(`!!document.querySelector('.shelf')`, '书架')
      await press('1', { ctrl: true })
      await waitFor(`!!document.querySelector('.home')`, '首页')
      const snap = await snapshot()
      const [y, m, d] = snap.today.split('-').map(Number)
      const off = await ev(
        `(() => { const o = -new Date().getTimezoneOffset(); const s = o < 0 ? '-' : '+'; const a = Math.abs(o); return s + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0') })()`
      )
      const next = new Date(Date.UTC(y, m - 1, d + 1))
      const tomorrow = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
      await ev(`window.__xwordDev.setNow(${q(`${snap.today}T23:59:30${off}`)})`)
      await ev(`window.dispatchEvent(new Event('focus'))`)
      await waitFor(
        `document.querySelector('.page-eyebrow')?.textContent.startsWith(${q(`${m}月${d}日`)})`,
        '睡前是今天'
      )
      const navBefore = await ev(`document.querySelector('.nav-count')?.textContent`)
      // 睡了一觉：时钟跳过午夜，没有任何焦点事件；唤醒事件到来
      await ev(`window.__xwordDev.setNow(${q(`${tomorrow}T07:30:00${off}`)})`)
      await ev(`window.xword.devSimulatePower('resume')`)
      await waitFor(
        `document.querySelector('.page-eyebrow')?.textContent.startsWith(${q(`${next.getUTCMonth() + 1}月${next.getUTCDate()}日`)})`,
        '唤醒后首页是第二天'
      )
      const after = await snapshot()
      expectEq(after.today, tomorrow, '快照的今天')
      const navAfter = await ev(`document.querySelector('.nav-count')?.textContent`)
      t.log(`跨午夜：导航数量 ${navBefore} → ${navAfter}`)
      await press('5', { ctrl: true })
      await waitFor(`!!document.querySelector('.wordbook')`, '单词本')
      const header = await ev(`document.querySelector('.page-head .page-meta')?.textContent ?? ''`)
      if (header.includes('今天开始')) throw new Error(`单词页还把昨天的页当作今天：${header}`)
      await ev('window.__xwordDev.setNow(null)')
      await ev(`window.xword.devSimulatePower('resume')`)
      await waitFor(`!!document.querySelector('.wordbook')`, '单词本')
    }
  )

  await check('运行中修改时区（Pacific/Pago_Pago），1 分钟内按新时区的日期更新', async () => {
    // 单词本打开时焦点在录入框里，全局快捷键不触发：先离开输入框
    await ev(`document.activeElement && document.activeElement.blur()`)
    await press('1', { ctrl: true })
    await waitFor(`!!document.querySelector('.home .page-eyebrow')`, '首页')
    const expected = await ev(
      `(() => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Pacific/Pago_Pago', month: 'numeric', day: 'numeric' }).formatToParts(new Date()); const g = (t) => p.find(x => x.type === t).value; return g('month') + '月' + g('day') + '日' })()`
    )
    const started = Date.now()
    await cdp().send('Emulation.setTimezoneOverride', { timezoneId: 'Pacific/Pago_Pago' })
    await waitFor(
      `document.querySelector('.page-eyebrow')?.textContent.startsWith(${q(expected)}) && Intl.DateTimeFormat().resolvedOptions().timeZone === 'Pacific/Pago_Pago'`,
      '新时区的日期',
      65000
    )
    const snap = await snapshot()
    expectEq(snap.timeZone, 'Pacific/Pago_Pago', '主进程使用渲染进程报告的时区')
    t.log(`改时区后 ${Math.round((Date.now() - started) / 1000)} 秒更新（日期 ${expected}）`)
    if (!/时区变为 Pacific\/Pago_Pago/.test(t.mainLog())) throw new Error('日志里没有时区变化')
    await cdp().send('Emulation.setTimezoneOverride', { timezoneId: '' })
    await ev(`window.dispatchEvent(new Event('focus'))`)
    await waitFor(
      `Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Pacific/Pago_Pago'`,
      '恢复时区'
    )
  })

  await check(
    '开发模式下窗口图标是 D1：BrowserWindow 的 icon 是 build/icon.ico，与 design-assets 的 ico 字节一致',
    async () => {
      const m = /窗口图标：(.+icon\.ico)/.exec(t.mainLog())
      if (!m) throw new Error('日志里没有窗口图标')
      const path = m[1].trim()
      if (!/[\\/]build[\\/]icon\.ico$/.test(path)) throw new Error(`窗口图标路径：${path}`)
      const a = readFileSync(path)
      const b = readFileSync(join(t.root, 'design-assets', 'icon', 'app-icon.ico'))
      if (!a.equals(b)) throw new Error('窗口图标不是 D1')
    }
  )
}

/**
 * v0.4 新增：结构化 EPUB 的目录分组与层级、PDF（点词、连字符词、翻译、缩放后高亮不偏）、扫描版提示、重启后回到原位置。
 */
export async function pagesScenarios(t) {
  const { press, waitFor, check, expectEq, sleep, q } = t
  const cdp = () => t.cdp()
  const ev = (expr) => cdp().eval(expr)
  const click = async (pt) => {
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp().send('Input.dispatchMouseEvent', {
        type,
        x: pt.x,
        y: pt.y,
        button: 'left',
        clickCount: 1
      })
    await sleep(80)
  }
  const openFromShelf = async (title) => {
    await ev(`document.activeElement && document.activeElement.blur()`)
    if (await ev(`!!document.querySelector('.reader')`)) {
      await press('Escape')
      await waitFor(`!!document.querySelector('.shelf')`, '书架')
    }
    await press('2', { ctrl: true })
    await waitFor(`!!document.querySelector('.shelf')`, '书架')
    await ev(
      `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent.startsWith('我的书'))?.click()`
    )
    await waitFor(`!!document.querySelector('.shelf-book-open[aria-label*=${q(title)}]')`, title)
    await ev(`document.querySelector('.shelf-book-open[aria-label*=${q(title)}]').click()`)
    await waitFor(`document.querySelector('.reader')?.dataset.ready === ''`, `${title} 排好`, 8000)
  }
  const lookupAt = async (word, n = 0) => {
    const pt = await waitFor(wordPointJs(word, n), `${word} 的位置`)
    await click(pt)
    await waitFor(`!!document.querySelector('.lookup-card .lookup-word')`, `${word} 的查词卡片`)
    const got = await ev(`document.querySelector('.lookup-card .lookup-word').textContent`)
    await ev(`document.querySelector('.lookup-card .word-audio').click()`)
    expectEq(
      (await ev(`window.__speechTest.spoken.at(-1)`)).toLowerCase(),
      got.toLowerCase(),
      '书页查词发音'
    )
    await press('Escape')
    await waitFor(`!document.querySelector('.lookup-card')`, '关闭查词卡片')
    return got
  }
  const structPath = join(t.dataDir, 'structured.epub')
  writeFileSync(structPath, await makeStructuredEpub())
  const pdfs = await makePdfs()
  const pdfPath = join(t.dataDir, 'manual.pdf')
  const scannedPath = join(t.dataDir, 'scanned.pdf')
  writeFileSync(pdfPath, pdfs.text)
  writeFileSync(scannedPath, pdfs.scanned)
  const state = {}

  console.log('书页排版与 PDF（v0.4）')

  await check(
    '目录抽屉：按“前言部分 / 正文 / 附录”分组、按层级缩进，点目录项跳到对应位置',
    async () => {
      await ev(`window.__xwordDev.importPath(${q(structPath)})`)
      await openFromShelf(STRUCT_TITLE)
      await press('m')
      await waitFor(`!!document.querySelector('.toc-drawer.is-open')`, '目录抽屉')
      await sleep(300)
      expectEq(
        await ev(`[...document.querySelectorAll('.toc-group-title')].map(e => e.textContent)`),
        ['前言部分', '正文', '附录'],
        '三组'
      )
      expectEq(
        await ev(
          `[...document.querySelectorAll('.toc-item')].map(e => [e.querySelector('.toc-text').textContent, e.className.match(/toc-l(\\d)/)[1], parseInt(e.style.paddingLeft)])`
        ),
        [
          ['FOREWORD', '1', 12],
          ['Part One', '1', 12],
          ['Chapter One: The Harbour', '2', 28],
          ['The Quay at Dawn', '3', 44],
          ['Chapter Two: The Tower', '2', 28],
          ['Appendix', '1', 12]
        ],
        '目录项、层级、缩进（每级 16px）'
      )
      await ev(
        `[...document.querySelectorAll('.toc-item')].find(e => e.textContent.includes('The Quay at Dawn')).click()`
      )
      await waitFor(`!document.querySelector('.toc-drawer.is-open')`, '目录关闭')
      await waitFor(
        `document.querySelector('.reader-chapter')?.textContent === 'Chapter One: The Harbour'`,
        '跳到第一章'
      )
      await waitFor(
        `(() => { const h = [...document.querySelectorAll('.flow-clip .rb-h2')].find(e => e.textContent === 'The Quay at Dawn'); if (!h) return false; const r = h.getBoundingClientRect(); const c = document.querySelector('.flow-clip').getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 })()`,
        '小节标题在当前页上'
      )
      // 章首：标签 + 章名分开排版；首字母合并
      await press('m')
      await waitFor(`!!document.querySelector('.toc-drawer.is-open')`, '目录抽屉')
      await ev(
        `[...document.querySelectorAll('.toc-item')].find(e => e.textContent.includes('FOREWORD')).click()`
      )
      await waitFor(
        `document.querySelector('.flow-clip .ch-name')?.textContent === 'FOREWORD'`,
        '前言标题首字母合并'
      )
      const first = await ev(`document.querySelector('.flow-clip [data-b="1"]').textContent`)
      if (!first.startsWith('This almanac')) throw new Error(`首字母没有合并：${first}`)
      state.epubAnchor = null
      await press('ArrowRight')
      await sleep(400)
      state.epubAnchor = await ev(`document.querySelector('.reader').dataset.anchor`)
    }
  )

  await check(
    'PDF：导入后原版页面显示；点词得到这个词，点行尾连字符断开的词得到完整的词',
    async () => {
      await ev(`window.__xwordDev.importPath(${q(pdfPath)})`)
      const snap = await ev('window.xword.getSnapshot()')
      const book = snap.books.find((b) => b.title === pdfs.title)
      if (!book) throw new Error('没有导入 PDF')
      expectEq(book.format, 'pdf', '格式')
      await openFromShelf(pdfs.title)
      await waitFor(
        `document.querySelectorAll('.pdf-page canvas').length > 0 && document.querySelectorAll('.textLayer span').length > 5`,
        '画布和文字层',
        8000
      )
      expectEq(await ev(`document.querySelector('.foot-page').textContent`), '第 1 / 3 页', '页码')
      expectEq(await lookupAt('lighthouse'), 'lighthouse', '点词')
      expectEq(await lookupAt('effec'), 'effective', '连字符前半')
      expectEq(await lookupAt('tive'), 'effective', '连字符后半')
    }
  )

  await check('PDF：选中跨行的句子翻译（mock DeepSeek）', async () => {
    await ev(`window.xword.aiSaveKey('sk-good-e2e-0123456789')`)
    const ok = await ev(`(() => {
      const spans = [...document.querySelectorAll('.textLayer span')]
      const a = spans.find(s => s.textContent.includes('They plan the week')); const b = spans.find(s => s.textContent.includes('simple lighthouse list.'))
      if (!a || !b) return false
      const r = document.createRange(); r.setStart(a.firstChild, a.textContent.indexOf('They')); r.setEnd(b.firstChild, b.textContent.indexOf('list.') + 5)
      const s = getSelection(); s.removeAllRanges(); s.addRange(r)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return true })()`)
    if (!ok) throw new Error('找不到要选的句子')
    await waitFor(`!!document.querySelector('.selection-toolbar')`, '选区工具条')
    await press('t')
    await waitFor(
      `document.querySelector('.translate-panel .ai-text')?.textContent.includes('的中文。')`,
      '译文',
      6000
    )
    await waitFor(`!!document.querySelector('.translate-panel .ai-text[data-done]')`, '输出结束')
    await press('Escape')
    await ev('window.xword.aiClearKey()')
    await ev('getSelection().removeAllRanges()')
  })

  await check('PDF：建高亮后缩放到 150%，高亮仍然盖在原来的文字上', async () => {
    const ok = await ev(`(() => {
      const s = [...document.querySelectorAll('.textLayer span')].find(x => x.textContent.includes('quiet morning'))
      if (!s) return false
      const i = s.textContent.indexOf('quiet morning'); const r = document.createRange(); r.setStart(s.firstChild, i); r.setEnd(s.firstChild, i + 13)
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return true })()`)
    if (!ok) throw new Error('找不到要高亮的文字')
    await waitFor(`!!document.querySelector('.selection-toolbar')`, '选区工具条')
    await press('h')
    await waitFor(`!!document.querySelector('.pdf-hl.hl-yellow')`, '高亮', 3000)
    const offset = `(() => {
      const s = [...document.querySelectorAll('.textLayer span')].find(x => x.textContent.includes('quiet morning'))
      const i = s.textContent.indexOf('quiet morning'); const r = document.createRange(); r.setStart(s.firstChild, i); r.setEnd(s.firstChild, i + 13)
      const t = r.getClientRects()[0]; const h = document.querySelector('.pdf-hl').getBoundingClientRect()
      return Math.max(Math.abs(t.left - h.left), Math.abs(t.top - h.top), Math.abs(t.right - h.right), Math.abs(t.bottom - h.bottom)) })()`
    const before = await ev(offset)
    await ev(`document.querySelector('.reader-bar button[aria-label="页面设置"]').click()`)
    await waitFor(`!!document.querySelector('.aa-panel')`, '页面设置')
    await ev(
      `[...document.querySelectorAll('.aa-panel .segmented-item')].find(b => b.textContent === '150%').click()`
    )
    await press('Escape')
    await waitFor(
      `(() => { const p = document.querySelector('.pdf-page'); return p && Math.abs(parseFloat(p.style.getPropertyValue('--scale-factor')) - 1.5 * 96 / 72) < 0.01 })()`,
      '缩放到 150%'
    )
    await waitFor(
      `!!document.querySelector('.pdf-hl') && document.querySelectorAll('.textLayer span').length > 5`,
      '重新画好'
    )
    await sleep(500)
    const after = await ev(offset)
    t.log(`高亮与文字的偏差：缩放前 ${before.toFixed(1)}px，150% 后 ${after.toFixed(1)}px`)
    if (after > 2) throw new Error(`缩放后高亮偏了 ${after.toFixed(1)}px`)
    await press('ArrowRight')
    await waitFor(
      `/^第 [23] \\/ 3 页$/.test(document.querySelector('.foot-page').textContent)`,
      '翻到下一页'
    )
    await sleep(2500)
    state.pdfPage = await ev(`document.querySelector('.foot-page').textContent`)
  })

  await check(
    '扫描版 PDF：提示“这是扫描版 PDF（页面是图片），无法选中文字，暂不支持”，不导入',
    async () => {
      const before = (await ev('window.xword.getSnapshot()')).books.length
      await ev(`window.__xwordDev.importPath(${q(scannedPath)})`)
      await waitFor(
        `[...document.querySelectorAll('.toast-message')].some(t => t.textContent === '这是扫描版 PDF（页面是图片），无法选中文字，暂不支持')`,
        '扫描版提示'
      )
      expectEq((await ev('window.xword.getSnapshot()')).books.length, before, '没有导入')
    }
  )

  await check('重启后回到原来的位置（EPUB 锚点、PDF 页码）', async () => {
    await press('Escape')
    await waitFor(`!!document.querySelector('.shelf')`, '书架（保存位置）')
    await sleep(500)
    await t.restart()
    await openFromShelf(STRUCT_TITLE)
    expectEq(
      await ev(`document.querySelector('.reader').dataset.anchor`),
      state.epubAnchor,
      'EPUB 锚点'
    )
    expectEq(await ev(ANCHOR_VISIBLE), true, '锚点文字在当前页上')
    await openFromShelf(pdfs.title)
    await waitFor(
      `document.querySelector('.foot-page')?.textContent === ${q(state.pdfPage)}`,
      'PDF 页码'
    )
    await press('Escape')
    await waitFor(`!!document.querySelector('.shelf')`, '书架')
  })
}

/** 性能实测：打开 1MB 的书、查词、2000 块章节的排版与翻页。结果写进 t.perf */
export async function perfScenarios(t) {
  const { press, waitFor, check, sleep, q } = t
  const ev = (expr) => t.cdp().eval(expr)
  console.log('性能')
  const big = makeTxt('One Megabyte', 1_050_000, 30)
  const bigPath = join(t.dataDir, 'one-megabyte.txt')
  writeFileSync(bigPath, big.text)
  const long = makeTxt('Long Chapter', 0, 1, 2000)
  const longPath = join(t.dataDir, 'long-chapter.txt')
  writeFileSync(longPath, long.text)

  await check('打开 1MB 的书：第一屏排好不超过 1 秒', async () => {
    await ev(`window.__xwordDev.importPath(${q(bigPath)})`)
    await ev(`document.activeElement && document.activeElement.blur()`)
    if (await ev(`!!document.querySelector('.reader')`)) await press('Escape')
    await press('2', { ctrl: true })
    await waitFor(`!!document.querySelector('.shelf')`, '书架')
    await ev(
      `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent.startsWith('我的书'))?.click()`
    )
    await waitFor(`!!document.querySelector('.shelf-book-open[aria-label*="One Megabyte"]')`, '书')
    const ms = await ev(`(async () => {
      const t0 = performance.now()
      document.querySelector('.shelf-book-open[aria-label*="One Megabyte"]').click()
      for (;;) { await new Promise(r => setTimeout(r, 5)); if (document.querySelector('.reader')?.dataset.ready === '') break; if (performance.now() - t0 > 5000) return 99999 }
      return performance.now() - t0 })()`)
    const total = await ev(`(async () => {
      const t0 = performance.now()
      for (;;) { await new Promise(r => setTimeout(r, 20)); if (/ \\/ \\d+ 页/.test(document.querySelector('.foot-page')?.textContent ?? '')) break; if (performance.now() - t0 > 20000) return -1 }
      return performance.now() - t0 })()`)
    t.perf.openBook = `${Math.round(ms)} ms 显示第一屏（${(big.size / 1024 / 1024).toFixed(2)} MB，30 章）；其余章节在空闲时量完页数又用了 ${Math.round(total)} ms`
    if (ms > 1000) throw new Error(`打开用了 ${Math.round(ms)} ms`)
  })

  await check('查词不超过 50ms（IPC 往返与点击到卡片出现）', async () => {
    const ipc =
      await ev(`(async () => { const w = ['went', 'lighthouse', 'harbour', 'abandoned', 'mystery']; const t0 = performance.now();
      for (let i = 0; i < 50; i++) await window.xword.dictLookup(w[i % w.length]); return (performance.now() - t0) / 50 })()`)
    const pt = await ev(wordPointJs('morning'))
    const click = await ev(`(async () => {
      const t0 = performance.now()
      document.elementFromPoint(${pt.x}, ${pt.y}).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${pt.x}, clientY: ${pt.y}, button: 0 }))
      for (;;) { await new Promise(r => setTimeout(r, 2)); if (document.querySelector('.lookup-card .lookup-group')) break; if (performance.now() - t0 > 3000) return -1 }
      return performance.now() - t0 })()`)
    t.perf.lookup = `IPC 平均 ${ipc.toFixed(1)} ms；点击到卡片显示义项 ${Math.round(click)} ms`
    await press('Escape')
    if (ipc > 50) throw new Error(`查词 ${ipc.toFixed(1)} ms`)
    if (click < 0 || click > 150) throw new Error(`点击到卡片 ${Math.round(click)} ms`)
  })

  await check('2000 个块的章节：排版分页不超过 1.5 秒，翻页 p95 不超过 50ms', async () => {
    await ev(`window.__xwordDev.importPath(${q(longPath)})`)
    await press('Escape')
    await waitFor(`!!document.querySelector('.shelf')`, '书架')
    const layout = await ev(`(async () => {
      const t0 = performance.now()
      document.querySelector('.shelf-book-open[aria-label*="Long Chapter"]').click()
      for (;;) { await new Promise(r => setTimeout(r, 5)); if (document.querySelector('.reader')?.dataset.ready === '') break; if (performance.now() - t0 > 10000) return -1 }
      return performance.now() - t0 })()`)
    await sleep(300)
    const result = await ev(`(async () => {
      const gaps = []
      for (let i = 0; i < 60; i++) {
        const before = document.querySelector('.reader').dataset.anchor
        const t0 = performance.now()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        for (;;) { await new Promise(r => setTimeout(r, 2)); if (document.querySelector('.reader').dataset.anchor !== before) break; if (performance.now() - t0 > 2000) break }
        gaps.push(performance.now() - t0)
      }
      gaps.sort((a, b) => a - b)
      return { p95: gaps[Math.floor(gaps.length * 0.95)], max: gaps[gaps.length - 1], avg: gaps.reduce((a, b) => a + b, 0) / gaps.length, pages: document.querySelector('.foot-page').textContent }
    })()`)
    t.perf.pages = `2001 块一章：从点书到第一屏排好（含扫描每页开头）${Math.round(layout)} ms；翻页 60 次平均 ${result.avg.toFixed(1)} ms，p95 ${result.p95.toFixed(1)} ms，最长 ${result.max.toFixed(1)} ms（${result.pages}）`
    if (layout < 0 || layout > 1500) throw new Error(`排版用了 ${Math.round(layout)} ms`)
    if (result.p95 > 50) throw new Error(`翻页慢：p95 ${result.p95.toFixed(1)} ms`)
    await press('Escape')
  })
}

/** 浅色、深色各一套截图 */
export async function v3Screens(t) {
  const { press, waitFor, check, sleep, shootAs, setTheme, q } = t
  const ev = (expr) => t.cdp().eval(expr)
  console.log('截图')
  const openBook = async (title) => {
    await ev(`document.activeElement && document.activeElement.blur()`)
    if (await ev(`!!document.querySelector('.reader')`)) {
      await press('Escape')
      await waitFor(`!!document.querySelector('.shelf')`, '书架')
    }
    await press('2', { ctrl: true })
    await waitFor(`!!document.querySelector('.shelf')`, '书架')
    await ev(
      `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent.startsWith('我的书'))?.click()`
    )
    await waitFor(`!!document.querySelector('.shelf-book-open[aria-label*=${q(title)}]')`, title)
    await ev(`document.querySelector('.shelf-book-open[aria-label*=${q(title)}]').click()`)
    await waitFor(`document.querySelector('.reader')?.dataset.ready === ''`, `${title} 排好`, 8000)
    await sleep(400)
  }
  await check(
    '截图（浅色、深色）：今日首页、书架、EPUB 双页正文、章首页、目录抽屉、PDF 双页（高亮 + 查词卡片）、高亮与笔记、带出处的复习卡片',
    async () => {
      await t.cdp().send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      })
      try {
        for (const theme of ['light', 'dark']) {
          await setTheme(theme)
          const shot = (name) => shootAs(`v4-${name}-${theme}`)
          await ev(`document.activeElement && document.activeElement.blur()`)
          if (await ev(`!!document.querySelector('.reader')`)) await press('Escape')
          await press('1', { ctrl: true })
          await waitFor(`!!document.querySelector('.home')`, '首页')
          await waitFor(`!document.querySelector('.toast')`, 'Toast 消失', 8000)
          await sleep(300)
          await shot('home')
          await press('2', { ctrl: true })
          await ev(
            `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent.startsWith('我的书')).click()`
          )
          await sleep(300)
          await shot('shelf-mine')
          // EPUB：章首页、双页正文、目录抽屉
          await openBook(STRUCT_TITLE)
          await press('m')
          await waitFor(`!!document.querySelector('.toc-drawer.is-open')`, '目录')
          await ev(
            `[...document.querySelectorAll('.toc-item')].find(e => e.textContent.includes('Chapter One')).click()`
          )
          await waitFor(
            `document.querySelector('.reader-chapter')?.textContent === 'Chapter One: The Harbour'`,
            '第一章'
          )
          await sleep(500)
          await shot('epub-opener')
          await press('ArrowRight')
          await sleep(500)
          await shot('epub-spread')
          const pt = await ev(wordPointJs('harbour'))
          if (pt) {
            await ev(
              `document.elementFromPoint(${pt.x}, ${pt.y}).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${pt.x}, clientY: ${pt.y}, button: 0 }))`
            )
            await waitFor(`!!document.querySelector('.lookup-card .lookup-group')`, '查词卡片')
            await sleep(300)
            await shot('epub-lookup')
            await press('Escape')
          }
          await press('m')
          await waitFor(`!!document.querySelector('.toc-drawer.is-open')`, '目录')
          await sleep(400)
          await shot('toc-drawer')
          await press('Escape')
          // PDF：双页（有高亮）+ 查词卡片
          await openBook('The Test Manual')
          await ev(`document.querySelector('.reader-bar button[aria-label="页面设置"]').click()`)
          await waitFor(`!!document.querySelector('.aa-panel')`, '页面设置')
          await ev(
            `[...document.querySelectorAll('.aa-panel .segmented-item')].find(b => b.textContent === '适合页面').click()`
          )
          await press('Escape')
          // 回到第一页（有高亮的那一页）
          await ev(`document.querySelector('.foot-page').click()`)
          await waitFor(`!!document.querySelector('.foot-jump-input')`, '页码输入框')
          await t.type('1')
          await press('Enter')
          await waitFor(`document.querySelectorAll('.pdf-hl').length > 0`, '高亮', 5000)
          const p2 = await ev(wordPointJs('lighthouse'))
          await ev(
            `document.elementFromPoint(${p2.x}, ${p2.y}).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${p2.x}, clientY: ${p2.y}, button: 0 }))`
          )
          await waitFor(`!!document.querySelector('.lookup-card .lookup-group')`, '查词卡片')
          await sleep(400)
          await shot('pdf-spread')
          await press('Escape')
          await press('Escape')
          await waitFor(`!!document.querySelector('.shelf')`, '书架')
          await press('3', { ctrl: true })
          await waitFor(`!!document.querySelector('.hl-item')`, '高亮与笔记')
          await sleep(300)
          await shot('highlights')
          // 带出处的复习卡片
          await press('4', { ctrl: true })
          await waitFor(
            `!!document.querySelector('.overview') || !!document.querySelector('.empty-state')`,
            '今日复习'
          )
          if (await ev(`!!document.querySelector('.overview')`)) {
            await press('Enter')
            await waitFor(`!!document.querySelector('.session .card:not(.is-ghost)')`, '复习中')
            for (let i = 0; i < 80; i++) {
              const w = await ev(
                `document.querySelector('.session .card:not(.is-ghost) .card-word')?.textContent`
              )
              if (w === 'lighthouse') break
              await press('s')
              await sleep(40)
            }
            await press(' ')
            await waitFor(`!!document.querySelector('.card:not(.is-ghost) .card-source')`, '出处')
            await sleep(500)
            await shot('review-source')
            await press('Escape')
            await waitFor(`!!document.querySelector('.done')`, '完成页')
          }
        }
        await setTheme('light')
        // 回到设置页（后面的重启用例从设置页开始）
        await press('8', { ctrl: true })
        await waitFor(`!!document.querySelector('.settings')`, '设置页')
      } finally {
        await t.cdp().send('Emulation.clearDeviceMetricsOverride')
      }
    }
  )
}
