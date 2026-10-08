/**
 * 端到端冒烟测试（不需要额外依赖）：
 * 启动已构建的应用（out/），通过 Chrome DevTools Protocol 发送真实按键、读取 DOM 做断言，
 * 并收集页面异常与 console.error。数据放在 .test-tmp/e2e-* 里，不碰开发或安装版的数据。
 *
 * 用法：npm run e2e（会先 electron-vite build）
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { startMockServer } from './e2e-fixtures.mjs'
import { pagesScenarios, perfScenarios, readerScenarios, v3Screens } from './e2e-reader.mjs'
import { SPEECH_MOCK, speechScenarios } from './e2e-speech.mjs'

const root = process.cwd()
const require = createRequire(import.meta.url)
const electronPath = require('electron')
const PORT = 9333 + Math.floor(Math.random() * 500)
const dataDir = join(root, '.test-tmp', `e2e-${Date.now()}`)
const screensDir = join(root, '.test-tmp', 'screens')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Keep test layout independent of the host desktop size (Windows CI may be 1024px wide).
const TEST_VIEWPORT = { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false }
const TEST_MOTION = [{ name: 'prefers-reduced-motion', value: 'no-preference' }]

// ---------------------------------------------------------------- CDP

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.errors = []
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(
          `异常：${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`
        )
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push(
          `console.error：${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`
        )
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.errors.push(`log：${msg.params.entry.text}`)
      }
    })
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
  }
  send(method, params = {}) {
    // Screenshot cases reset to the controlled baseline, rather than a clamped host window.
    if (method === 'Emulation.clearDeviceMetricsOverride') {
      method = 'Emulation.setDeviceMetricsOverride'
      params = TEST_VIEWPORT
    }
    // Reduced-motion cases still test "reduce"; clearing restores the normal-motion baseline.
    if (method === 'Emulation.setEmulatedMedia' && params.features?.length === 0)
      params = { ...params, features: TEST_MOTION }
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      // 任何一次调用都不能让整个测试卡住
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP 调用超时：${method}`))
      }, 30000)
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e))
      })
    })
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (res.exceptionDetails)
      throw new Error(`eval 失败：${expression}\n${res.exceptionDetails.exception?.description}`)
    return res.result.value
  }
  close() {
    this.ws.close()
  }
}

const KEYS = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Escape: { code: 'Escape', vk: 27 },
  ' ': { code: 'Space', vk: 32, text: ' ' },
  PageUp: { code: 'PageUp', vk: 33 },
  PageDown: { code: 'PageDown', vk: 34 },
  End: { code: 'End', vk: 35 },
  Home: { code: 'Home', vk: 36 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  Delete: { code: 'Delete', vk: 46 },
  Backspace: { code: 'Backspace', vk: 8 },
  '[': { code: 'BracketLeft', vk: 219, text: '[' },
  ']': { code: 'BracketRight', vk: 221, text: ']' }
}

function keyInfo(key) {
  if (KEYS[key]) return { key, ...KEYS[key] }
  if (/^[0-9]$/.test(key)) return { key, code: `Digit${key}`, vk: 48 + Number(key), text: key }
  if (/^[a-z]$/i.test(key)) {
    return { key, code: `Key${key.toUpperCase()}`, vk: key.toUpperCase().charCodeAt(0), text: key }
  }
  throw new Error(`未知按键 ${key}`)
}

// ---------------------------------------------------------------- 测试工具

let cdp
let passed = 0
const failures = []

async function press(key, { ctrl = false } = {}) {
  const k = keyInfo(key)
  const base = {
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.vk,
    nativeVirtualKeyCode: k.vk,
    modifiers: ctrl ? 2 : 0
  }
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    ...base,
    text: ctrl ? undefined : k.text
  })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(30)
}

async function type(text) {
  await cdp.send('Input.insertText', { text })
  await sleep(10)
}

async function waitFor(expression, label, timeout = 4000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try {
      last = await cdp.eval(expression)
      if (last) return last
    } catch (e) {
      last = e.message
    }
    await sleep(40)
  }
  throw new Error(`等待超时：${label}（最后结果：${JSON.stringify(last)}）`)
}

async function check(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ok ${name}`)
  } catch (e) {
    failures.push(`${name}：${e.message}`)
    console.log(`  FAIL ${name}：${e.message}`)
  }
}

function expectEq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}

const q = (sel) => JSON.stringify(sel)
const text = (sel) => cdp.eval(`document.querySelector(${q(sel)})?.textContent?.trim() ?? null`)
const count = (sel) => cdp.eval(`document.querySelectorAll(${q(sel)}).length`)
const navCount = () => text('.nav-item .nav-count')
const headerText = () =>
  cdp.eval(
    `[document.querySelector('h1.page-title'), document.querySelector('.page-head .page-meta')].map(c => c?.textContent.replace(/\\s+/g, ' ').trim()).join(' · ')`
  )
const activeInfo = () =>
  cdp.eval(
    `(() => { const a = document.activeElement; return a ? (a.getAttribute('aria-label') || a.tagName) : null })()`
  )
const refresh = () => cdp.eval(`window.dispatchEvent(new Event('focus'))`)
const blur = () => cdp.eval(`document.activeElement && document.activeElement.blur()`)
/** 聚焦网格中第 row 行、第 col 个可聚焦格（0 单词、1 词义、2–7 节点） */
const focusCell = (row, col) =>
  cdp.eval(
    `(() => { const r = document.querySelectorAll('.word-grid tbody tr.grid-row')[${row}];
      const c = r?.querySelectorAll('[role=gridcell]')[${col}]; c?.focus(); return !!c })()`
  )
const cellClass = (row, col) =>
  cdp.eval(
    `document.querySelectorAll('.word-grid tbody tr.grid-row')[${row}]?.querySelectorAll('[role=gridcell]')[${col}]?.className ?? null`
  )
const clickToastAction = () =>
  cdp.eval(
    `(() => { const b = [...document.querySelectorAll('.toast:not(.is-leaving) .toast-action')].pop(); b?.click(); return !!b })()`
  )

// ---------------------------------------------------------------- 场景

async function wordbookScenarios() {
  console.log('单词页（空库开始）')

  await check('启动后导航显示今日队列数量 0', async () => {
    await waitFor(`document.querySelector('.nav-count')?.textContent === '0'`, '导航计数')
  })

  await check('Ctrl+5 打开单词本；没有页时显示空状态，焦点在输入行', async () => {
    await press('5', { ctrl: true })
    await waitFor(`!!document.querySelector('.wordbook .empty-state')`, '空状态')
    await waitFor(`document.activeElement?.getAttribute('aria-label') === '新单词'`, '焦点在输入行')
  })

  await check('连续录入 30 个词（全键盘），自动翻到第 2 页并提示', async () => {
    for (let i = 1; i <= 30; i++) {
      await type(`word${i}`)
      await press('Enter')
      await type(`词义${i}`)
      await press('Enter')
      await waitFor(
        `document.activeElement?.getAttribute('aria-label') === '新单词' && document.activeElement.value === ''`,
        `第 ${i} 个词写入`
      )
    }
    const h = await headerText()
    expectEq(h, '第 2 页 · 今天开始 · 已写 3 / 27', '页头')
    const toasts = await cdp.eval(
      `[...document.querySelectorAll('.toast-message')].map(t => t.textContent)`
    )
    if (!toasts.some((t) => t.includes('已开始第 2 页')))
      throw new Error(`没有“已开始第 2 页”提示：${toasts}`)
    await waitFor(
      `(() => { const t = document.querySelector('.toast-viewport').getBoundingClientRect();
        const e = document.querySelector('.entry-row').getBoundingClientRect();
        return t.height > 0 && (t.bottom <= e.top || t.top >= e.bottom) })()`,
      'Toast 不遮挡输入行'
    )
    expectEq(await count('.word-grid tr.grid-row'), 3, '第 2 页行数')
    expectEq(await navCount(), '20', '今日队列（新词受上限 20 约束）')
  })

  await check('PageUp 回到第 1 页：27 行，序号连续', async () => {
    await blur()
    await press('PageUp')
    await waitFor(`document.querySelector('h1.page-title')?.textContent === '第 1 页'`, '第 1 页')
    expectEq(await count('.word-grid tr.grid-row'), 27, '第 1 页行数')
    await press('PageDown')
    await waitFor(
      `document.querySelector('h1.page-title')?.textContent === '第 2 页'`,
      '回到第 2 页'
    )
  })

  await check('查重：提示“已在第 N 页”，再按一次 Enter 才强制写入', async () => {
    await cdp.eval(`document.querySelector('input[aria-label="新单词"]').focus()`)
    await type('WORD1')
    await waitFor(
      `document.querySelector('.entry-hint')?.textContent.includes('已在第 1 页')`,
      '重复提示'
    )
    await press('Enter')
    await type('重复的词')
    await press('Enter')
    await waitFor(
      `document.querySelector('.entry-hint')?.textContent.includes('再按一次 Enter')`,
      '二次确认提示'
    )
    expectEq(await count('.word-grid tr.grid-row'), 3, '第一次 Enter 不写入')
    await press('Enter')
    await waitFor(`document.querySelectorAll('.word-grid tr.grid-row').length === 4`, '强制写入')
  })

  await check('方向键回到网格，Delete 软删除并可撤销', async () => {
    await press('ArrowUp')
    await waitFor(
      `document.activeElement?.getAttribute('aria-label') === '单词 WORD1'`,
      '焦点在最后一行'
    )
    await press('Delete')
    await waitFor(`document.querySelectorAll('.word-grid tr.grid-row').length === 3`, '删除后 3 行')
    await clickToastAction()
    await waitFor(`document.querySelectorAll('.word-grid tr.grid-row').length === 4`, '撤销后 4 行')
  })

  await check('网格里用键盘给新词评第1遍，撤销后恢复', async () => {
    await focusCell(0, 2)
    expectEq(await activeInfo(), '第1遍：待学', '聚焦第1遍格')
    await press('4')
    await waitFor(
      `document.querySelector('.word-grid tr.grid-row')?.querySelector('.mark.is-ok.is-sweep') !== null`,
      '打勾'
    )
    await waitFor(`document.querySelector('.nav-count')?.textContent === '19'`, '今日新词名额减 1')
    const next = await cellClass(0, 3)
    if (next.includes('is-due')) throw new Error('1天节点不应该今天到期')
    await clickToastAction()
    await waitFor(`document.querySelector('.nav-count')?.textContent === '20'`, '撤销后恢复')
    await waitFor(
      `document.querySelector('.word-grid tr.grid-row .cell-pending') !== null`,
      '恢复成待学'
    )
  })

  await check('Enter 编辑单词，Esc 取消，Enter 保存', async () => {
    await focusCell(0, 0)
    await press('Enter')
    await waitFor(`document.activeElement?.getAttribute('aria-label') === '编辑单词'`, '进入编辑')
    await type('changed')
    await press('Escape')
    await waitFor(
      `document.activeElement?.getAttribute('aria-label')?.startsWith('单词 word28')`,
      'Esc 取消'
    )
    await press('Enter')
    await cdp.eval(`document.activeElement.select()`)
    await type('word28x')
    await press('Enter')
    await waitFor(
      `document.activeElement?.getAttribute('aria-label') === '单词 word28x'`,
      'Enter 保存'
    )
  })

  await check('S 标记难词', async () => {
    await press('s')
    await waitFor(
      `document.querySelector('.word-grid tr.grid-row')?.classList.contains('is-starred')`,
      '难词'
    )
    await press('s')
    await waitFor(
      `!document.querySelector('.word-grid tr.grid-row')?.classList.contains('is-starred')`,
      '取消难词'
    )
  })

  await check('批量录入：解析预览、重复默认不导入、Ctrl+Enter 写入', async () => {
    await cdp.eval(
      `[...document.querySelectorAll('.page-actions button')].find(b => b.textContent.includes('批量录入')).click()`
    )
    await waitFor(`document.activeElement?.id === 'batch-input'`, '焦点在文本框')
    await type('alpha\tn. 阿尔法\nbeta v. 测试\ngamma 伽马\nword1\ndelta\nalpha')
    await waitFor(
      `document.querySelector('.batch-summary')?.textContent.includes('共 6 条，其中重复 2 条')`,
      '预览摘要'
    )
    const parsed = await cdp.eval(
      `[...document.querySelectorAll('.batch-preview tbody tr')].map(r => [...r.children].map(c => c.textContent))`
    )
    expectEq(parsed[1], ['beta', 'v.测试', ''], '按词性标记拆分')
    expectEq(parsed[3], ['word1', '', '已在第 1 页'], '库内重复')
    // 没写词义的行自动填入词典的第一组义项，可以在预览里修改
    const cell = (row, col) =>
      `document.querySelectorAll('.batch-preview tbody tr')[${row}]?.children[${col}]`
    await waitFor(`${cell(4, 2)}?.textContent === '来自词典'`, 'delta 自动填入词典义项')
    const delta = await cdp.eval(`${cell(4, 1)}.querySelector('input').value`)
    if (!/^n\. .*三角洲/.test(delta)) throw new Error(`delta 的词典义项：${delta}`)
    await waitFor(`${cell(5, 2)}?.textContent === '本次重复 · 来自词典'`, '本次重复')
    expectEq(await text('.batch-footer .btn-primary'), '写入 4 个词', '按钮文字')
    await press('Enter', { ctrl: true })
    await waitFor(`!document.querySelector('.dialog')`, '对话框关闭')
    await waitFor(
      `[...document.querySelectorAll('.toast-message')].some(t => t.textContent.includes('已写入 4 个词'))`,
      '写入提示'
    )
    expectEq(await count('.word-grid tr.grid-row'), 8, '第 2 页行数')
    const snap = await cdp.eval(`window.xword.getSnapshot()`)
    const d = snap.words.find((w) => w.text === 'delta')
    if (!d || d.pos !== 'n.' || !d.meaning.startsWith('n. ') || !d.phonetic)
      throw new Error(`delta 写入：${JSON.stringify(d)}`)
  })
}

/** 在输入行里输入单词并按 Enter，等义项面板出现 */
async function lookupInEntry(word, readySelector = '.sense-panel:not([data-closing]) .sense-chip') {
  await cdp.eval(`document.querySelector('input[aria-label="新单词"]').focus()`)
  await type(word)
  await press('Enter')
  await waitFor(`document.activeElement?.getAttribute('aria-label') === '词义'`, '焦点在词义框')
  await waitFor(`!!document.querySelector(${q(readySelector)})`, `面板（${word}）`, 8000)
}

async function clearEntry() {
  for (
    let i = 0;
    i < 3 && (await cdp.eval(`!!document.querySelector('.sense-panel:not([data-closing])')`));
    i++
  )
    await press('Escape')
  await press('Escape')
  await waitFor(
    `document.activeElement?.getAttribute('aria-label') === '新单词' && document.activeElement.value === ''`,
    '输入行已清空'
  )
}

const entryCleared = () =>
  waitFor(
    `document.activeElement?.getAttribute('aria-label') === '新单词' && document.activeElement.value === ''`,
    '写入后焦点回到单词框'
  )

async function dictScenarios() {
  console.log('录入时从词典选词义')

  await check(
    'ability：↓ 进面板，数字键选两个义项，Enter 写入；库里 meaning / pos / phonetic 正确',
    async () => {
      await lookupInEntry('ability')
      const head = await text('.sense-head')
      if (!head.includes("ә'biliti") || !head.includes('四级') || !head.includes('牛津核心词'))
        throw new Error(`面板顶部：${head}`)
      await press('ArrowDown')
      await waitFor(`document.activeElement?.classList.contains('sense-chip')`, '焦点进入面板')
      await press('1')
      await press('2')
      await waitFor(
        `document.querySelector('input[aria-label="词义"]').value === 'n. 能力；才干'`,
        '词义实时生成'
      )
      await press('Enter')
      await entryCleared()
      const snap = await cdp.eval(`window.xword.getSnapshot()`)
      const w = snap.words.find((x) => x.text === 'ability')
      expectEq(
        [w?.meaning, w?.pos, w?.phonetic],
        ['n. 能力；才干', 'n.', "ә'biliti"],
        'ability 的字段'
      )
    }
  )

  await check('went：显示“went 是 go 的过去式”，点“改录 go”后单词框变成 go', async () => {
    await lookupInEntry('went', '.sense-lemma')
    expectEq(await text('.sense-lemma span'), 'went 是 go 的过去式', '原形提示')
    await cdp.eval(
      `[...document.querySelectorAll('.sense-lemma button')].find(b => b.textContent.includes('改录 go')).click()`
    )
    await waitFor(
      `document.querySelector('input[aria-label="新单词"]').value === 'go'`,
      '单词框变成 go'
    )
    await waitFor(
      `!document.querySelector('.sense-lemma') && !!document.querySelector('.sense-chip')`,
      'go 的义项'
    )
    await clearEntry()
  })

  await check('词典里没有的词：面板提示，手动输入词义后写入', async () => {
    await lookupInEntry('qzxvwordy', '.sense-panel:not([data-closing]) .sense-note')
    await waitFor(
      `document.querySelector('.sense-panel:not([data-closing]) .sense-note')?.textContent === '词典里没有这个词，请直接输入词义'`,
      '提示'
    )
    await type('自造的词')
    await press('Enter')
    await entryCleared()
    const snap = await cdp.eval(`window.xword.getSnapshot()`)
    const w = snap.words.find((x) => x.text === 'qzxvwordy')
    expectEq([w?.meaning, w?.pos, w?.phonetic], ['自造的词', '', ''], '手动词义')
  })

  await check('没有词义时第一次 Enter 只提示，第二次才写入', async () => {
    await lookupInEntry('qzxvempty', '.sense-panel:not([data-closing]) .sense-note')
    const before = await count('.word-grid tr.grid-row')
    await press('Enter')
    await waitFor(
      `document.querySelector('.entry-hint')?.textContent.includes('还没有词义，再按一次 Enter 仍然写入')`,
      '空词义提示'
    )
    expectEq(await count('.word-grid tr.grid-row'), before, '第一次不写入')
    await press('Enter')
    await entryCleared()
    const snap = await cdp.eval(`window.xword.getSnapshot()`)
    if (!snap.words.some((w) => w.text === 'qzxvempty')) throw new Error('第二次没有写入')
  })
}

async function libraryScenarios() {
  console.log('词库页')
  if (await cdp.eval(`!!document.querySelector('.dialog')`)) await press('Escape')
  const N = 3000
  await cdp.eval(`(async () => {
    const make = (a, b) => Array.from({ length: b - a }, (_, i) => ({ text: 'lib' + (a + i), meaning: '词库测试' + (a + i) }))
    await window.xword.addWords(make(0, 2000))
    await window.xword.addWords(make(2000, ${N}))
  })()`)
  await refresh()
  await blur()
  await press('6', { ctrl: true })
  await waitFor(`!!document.querySelector('.library .word-row')`, '词库页')

  const clickFilter = (label) =>
    cdp.eval(
      `[...document.querySelectorAll('.filter-chip')].find(b => b.textContent.startsWith(${q(label)})).click()`
    )
  const filterCount = (label) =>
    cdp.eval(
      `Number([...document.querySelectorAll('.filter-chip')].find(b => b.textContent.startsWith(${q(label)})).querySelector('.filter-count').textContent)`
    )
  const search = async (value) => {
    await cdp.eval(
      `document.querySelector('.library-search input').focus(); document.querySelector('.library-search input').select()`
    )
    await sleep(200)
    if (value) await type(value)
    else await press('Backspace')
    await sleep(200)
    await blur()
  }
  const firstRow = () => text('.word-row-text')
  const clickDetail = (label) =>
    cdp.eval(
      `[...document.querySelectorAll('.detail-actions button')].find(b => b.textContent.includes(${q(label)})).click()`
    )
  const confirmDialog = async (label) => {
    await waitFor(`!!document.querySelector('.dialog')`, '确认对话框')
    await cdp.eval(
      `[...document.querySelectorAll('.dialog-footer button')].find(b => b.textContent === ${q(label)}).click()`
    )
    await waitFor(`!document.querySelector('.dialog')`, '对话框关闭')
  }

  await check(`${N} 个词：窗口化渲染，只渲染可见的行`, async () => {
    const snap = await cdp.eval(`window.xword.getSnapshot()`)
    expectEq(await filterCount('全部'), snap.words.length, '“全部”的数量')
    const rendered = await count('.word-row')
    if (rendered > 60) throw new Error(`渲染了 ${rendered} 行`)
    await cdp.eval(`document.querySelector('.word-list').scrollTop = 1e7`)
    await waitFor(
      `[...document.querySelectorAll('.word-row-text')].some(e => e.textContent === 'lib${N - 1}')`,
      '滚到底部'
    )
    if ((await count('.word-row')) > 60) throw new Error('滚动后渲染的行数过多')
    await cdp.eval(`document.querySelector('.word-list').scrollTop = 0`)
  })

  await check(
    '搜索：Ctrl+F 聚焦；按键到显示结果不超过 100ms；同时匹配单词和词义，不区分大小写',
    async () => {
      await press('f', { ctrl: true })
      await waitFor(
        `document.activeElement?.getAttribute('aria-label') === '搜索单词或词义'`,
        '焦点在搜索框'
      )
      const measure = async (textToType, doneExpr) => {
        await cdp.eval(`(() => {
        window.__searchMs = null
        const input = document.querySelector('.library-search input')
        input.addEventListener('input', () => {
          const t0 = performance.now()
          const tick = () => {
            if (${doneExpr}) window.__searchMs = performance.now() - t0
            else if (performance.now() - t0 < 2000) requestAnimationFrame(tick)
          }
          tick()
        }, { once: true })
      })()`)
        await type(textToType)
        await waitFor(`window.__searchMs !== null`, `搜索 ${textToType}`)
        return cdp.eval('window.__searchMs')
      }
      const ms1 = await measure(
        'lib1234',
        `document.querySelectorAll('.word-row').length === 1 && document.querySelector('.word-row-text')?.textContent === 'lib1234'`
      )
      await sleep(300)
      const ms2 = await measure(
        '9',
        `!!document.querySelector('.library .empty-state')?.textContent.includes('没有找到')`
      )
      console.log(`    搜索耗时：${ms1.toFixed(1)} ms、${ms2.toFixed(1)} ms`)
      if (ms1 > 100 || ms2 > 100) throw new Error(`搜索耗时 ${ms1} / ${ms2} ms`)
      await search('词库测试2999')
      await waitFor(`document.querySelectorAll('.word-row').length === 1`, '按词义搜索')
      await search('LIB29')
      await waitFor(
        `document.querySelectorAll('.word-row-text')[0]?.textContent === 'lib29'`,
        '不区分大小写'
      )
    }
  )

  await check('筛选：新词、难词、已掌握的数量与列表一致', async () => {
    await search('')
    const snap = await cdp.eval(`window.xword.getSnapshot()`)
    for (const [label, expected] of [
      ['新词', snap.words.filter((w) => w.status === 'new').length],
      ['难词', snap.words.filter((w) => w.starred).length],
      ['已掌握', snap.words.filter((w) => w.status === 'mastered').length]
    ]) {
      expectEq(await filterCount(label), expected, `${label}数量`)
      await clickFilter(label)
      const h = await cdp.eval(`document.querySelector('.word-list-inner')?.style.height ?? '0px'`)
      expectEq(parseInt(h), expected * 56, `${label}列表高度`)
    }
    await clickFilter('全部')
  })

  await check('Delete 软删除后 Toast 撤销', async () => {
    await search('lib100')
    expectEq(await firstRow(), 'lib100', '选中 lib100')
    const trash = await filterCount('回收站')
    await press('Delete')
    await waitFor(
      `document.querySelector('.word-row-text')?.textContent !== 'lib100'`,
      '删除后列表更新'
    )
    expectEq(await filterCount('回收站'), trash + 1, '回收站 +1')
    await clickToastAction()
    await waitFor(
      `document.querySelector('.word-row.is-selected .word-row-text')?.textContent === 'lib100'`,
      '撤销后恢复并重新选中'
    )
  })

  await check('从回收站恢复', async () => {
    await press('Delete')
    await waitFor(`document.querySelector('.word-row-text')?.textContent !== 'lib100'`, '删除')
    await clickFilter('回收站')
    await waitFor(
      `document.querySelector('.word-row-text')?.textContent === 'lib100'`,
      '回收站里有 lib100'
    )
    await clickDetail('恢复')
    await waitFor(`!!document.querySelector('.library .empty-state')`, '回收站变空')
    await clickFilter('全部')
    await waitFor(
      `document.querySelector('.word-row-text')?.textContent === 'lib100'`,
      '恢复到词库'
    )
  })

  await check('彻底删除：二次确认，连同复习记录一起删除', async () => {
    const snap0 = await cdp.eval(`window.xword.getSnapshot()`)
    const target = snap0.words.find((w) => w.text === 'lib101')
    await cdp.eval(`window.xword.gradeWord({ wordId: ${q(target.id)}, grade: 3 })`)
    await refresh()
    await search('lib101')
    await press('Delete')
    await clickFilter('回收站')
    await waitFor(
      `document.querySelector('.word-row-text')?.textContent === 'lib101'`,
      '回收站里有 lib101'
    )
    await clickDetail('彻底删除')
    await confirmDialog('彻底删除')
    await waitFor(`!!document.querySelector('.library .empty-state')`, '回收站变空')
    const snap = await cdp.eval(`window.xword.getSnapshot()`)
    if ([...snap.words, ...snap.deletedWords].some((w) => w.id === target.id))
      throw new Error('lib101 还在')
    const log = await cdp.eval(
      `window.xword.getReviewLog(${q(target.id)}).then(() => 'found', () => 'gone')`
    )
    expectEq(log, 'gone', '复习记录一并删除')
    await clickFilter('全部')
  })

  await check('清空回收站：二次确认；空状态的话随筛选变化', async () => {
    for (const w of ['lib102', 'lib103']) {
      await search(w)
      await press('Delete')
      await waitFor(
        `document.querySelector('.word-row-text')?.textContent !== ${q(w)}`,
        `删除 ${w}`
      )
    }
    await search('')
    await clickFilter('回收站')
    expectEq(await filterCount('回收站'), 2, '回收站 2 个')
    await cdp.eval(
      `[...document.querySelectorAll('.library-trash-bar button')].find(b => b.textContent.includes('清空回收站')).click()`
    )
    await confirmDialog('清空')
    await waitFor(
      `document.querySelector('.library .empty-state p')?.textContent === '回收站是空的'`,
      '回收站空状态'
    )
    expectEq(await filterCount('回收站'), 0, '回收站 0 个')
    await clickFilter('全部')
  })
}

async function sampleScenarios() {
  console.log('单词页（示例数据）')
  // 前一个场景失败时可能留下打开的对话框
  if (await cdp.eval(`!!document.querySelector('.dialog')`)) await press('Escape')

  await check('载入示例数据后今日队列为 28（手算：12 + 8 + 3 + 5）', async () => {
    await cdp.eval(`window.xword.loadSampleData()`)
    await refresh()
    await waitFor(`document.querySelector('.nav-count')?.textContent === '28'`, '导航 28')
  })

  await check('第 1 页：12 个 6天节点今天到期，表头显示日期且“今天”高亮', async () => {
    await blur()
    for (let i = 0; i < 3; i++) await press('PageUp')
    await waitFor(`document.querySelector('h1.page-title')?.textContent === '第 1 页'`, '第 1 页')
    expectEq(await count('.word-grid tr.grid-row'), 12, '行数')
    expectEq(await count('.cell-stage.is-due'), 12, '今天到期格')
    expectEq(await count('.stage-date'), 6, '表头日期')
    expectEq(
      await text('.stage-date.is-today'),
      await cdp.eval(`document.querySelectorAll('.stage-date')[3].textContent`),
      '6天列是今天'
    )
    expectEq(await count('.mark.is-fail'), 5, '叉（1天 3 个 + 2天 2 个）')
    expectEq(await count('.mark.is-faint'), 5, '淡色勾（模糊）')
    expectEq(await count('.grid-row.is-starred'), 1, '难词 accommodate')
  })

  await check('Enter 打开评分浮层，按 3 评分并打勾；Toast 撤销后恢复', async () => {
    await focusCell(0, 5)
    await press('Enter')
    await waitFor(`document.querySelectorAll('.popover .grade-chip').length === 4`, '评分浮层')
    await press('3')
    await waitFor(`!document.querySelector('.popover')`, '浮层关闭')
    await waitFor(
      `!!document.querySelectorAll('.word-grid tr.grid-row')[0].querySelector('.mark.is-ok.is-sweep')`,
      '打勾'
    )
    await waitFor(`document.querySelector('.nav-count')?.textContent === '27'`, '队列减 1')
    await clickToastAction()
    await waitFor(`document.querySelector('.nav-count')?.textContent === '28'`, '撤销后 28')
    const cls = await cellClass(0, 5)
    if (!cls.includes('is-due')) throw new Error(`撤销后应恢复为到期：${cls}`)
  })

  await check('Esc 关闭评分浮层，焦点回到格子', async () => {
    await focusCell(1, 5)
    await press(' ')
    await waitFor(`!!document.querySelector('.popover')`, '浮层打开')
    await press('Escape')
    await waitFor(`!document.querySelector('.popover')`, '浮层关闭')
    await waitFor(
      `document.activeElement?.getAttribute('aria-label')?.startsWith('6天')`,
      '焦点回到格子'
    )
  })

  await check('第 3 页：拖欠高亮 + 小圆点，2天节点推导为“漏”；答错后写入 missed 与叉', async () => {
    await blur()
    await press('PageDown')
    await press('PageDown')
    await waitFor(`document.querySelector('h1.page-title')?.textContent === '第 3 页'`, '第 3 页')
    expectEq(await count('.cell-stage.is-overdue'), 3, '拖欠格')
    expectEq(await count('.overdue-dot'), 3, '小圆点')
    expectEq(await count('.cell-missed'), 3, '漏')
    await focusCell(0, 5)
    await press('1')
    await waitFor(
      `!!document.querySelectorAll('.word-grid tr.grid-row')[0].querySelector('.mark.is-fail')`,
      '叉'
    )
    expectEq(await count('.cell-missed'), 3, '漏仍在（已写入）')
    await waitFor(`document.querySelector('.nav-count')?.textContent === '27'`, '队列 27')
  })

  await check('第 2 页：1天节点今天到期，第1遍“忘了”显示为叉', async () => {
    await blur()
    await press('PageUp')
    await waitFor(`document.querySelector('h1.page-title')?.textContent === '第 2 页'`, '第 2 页')
    expectEq(await count('.cell-stage.is-due'), 8, '到期格')
    expectEq(await count('.mark.is-fail'), 1, 'aggressive 第1遍忘了')
  })
}

/** 复习中：当前卡片的单词、是否重现、进度文字 */
const cardState = () =>
  cdp.eval(`(() => {
    const card = document.querySelector('.session .card:not(.is-ghost)')
    if (!card) return null
    return {
      word: card.querySelector('.card-front .card-word')?.textContent ?? null,
      retry: !!card.querySelector('.card-retry'),
      flipped: !!card.querySelector('.card-back'),
      progress: document.querySelector('.progress-count')?.textContent.replace(/\\s+/g, ' ').trim()
    }
  })()`)

/** 在复习中回答当前卡片：空格翻面 → 数字选择 → Enter 确认，等到换卡 */
async function answer(grade) {
  const before = await cardState()
  await press(' ')
  await waitFor(`!!document.querySelector('.session .card:not(.is-ghost) .card-back')`, '翻面')
  await press(String(grade))
  await waitFor(`!!document.querySelector('.grade-btn.is-selected')`, '选中评分')
  await press('Enter')
  await waitFor(
    `!document.querySelector('.session') || !document.querySelector('.session .card:not(.is-ghost) .card-back')`,
    `换卡（${before?.word}）`
  )
}

async function todayScenarios() {
  console.log('今日复习')
  if (await cdp.eval(`!!document.querySelector('.dialog')`)) await press('Escape')

  await check('概览：到期 23、新词 5、拖欠 3、预计 4 分钟；拖欠的词排在最前', async () => {
    await cdp.eval(`window.xword.loadSampleData()`)
    await refresh()
    await waitFor(`document.querySelector('.nav-count')?.textContent === '28'`, '导航 28')
    await blur()
    await press('4', { ctrl: true })
    await waitFor(`!!document.querySelector('.overview')`, '概览')
    const stats = await cdp.eval(
      `[...document.querySelectorAll('.overview-stats dd')].map(d => d.textContent.replace(/\\s+/g, ''))`
    )
    expectEq(stats, ['23', '5', '3'], '概览数字')
    if (!(await text('.overview-estimate')).startsWith('预计 4 分钟')) throw new Error('预计用时')
    expectEq(await count('.queue-item'), 28, '队列长度')
    const first = await cdp.eval(
      `[...document.querySelectorAll('.queue-item')].slice(0, 3).map(li => li.querySelector('.queue-overdue')?.textContent)`
    )
    expectEq(first, ['拖欠 4 天', '拖欠 4 天', '拖欠 4 天'], '拖欠排最前')
  })

  await check('勾选跳过会更新计数；方向切换记在本地', async () => {
    await cdp.eval(`document.querySelectorAll('.queue-skip input')[27].click()`)
    await waitFor(
      `document.querySelector('.overview-actions .muted')?.textContent === '27 个词，跳过 1 个'`,
      '跳过 1 个'
    )
    await cdp.eval(`document.querySelectorAll('.queue-skip input')[27].click()`)
    await waitFor(
      `document.querySelector('.overview-actions .muted')?.textContent === '28 个词'`,
      '取消跳过'
    )
    await cdp.eval(
      `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent === '中 → 英').click()`
    )
    expectEq(await cdp.eval(`localStorage.getItem('xword.reviewDirection')`), 'zh-en', '方向已保存')
    await cdp.eval(
      `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent === '英 → 中').click()`
    )
    await blur()
  })

  await check('Enter 开始：导航栏收起，只显示卡片；Esc 结束进入完成页', async () => {
    await press('Enter')
    await waitFor(
      `!!document.querySelector('.session .card:not(.is-ghost)') && !document.querySelector('.sidebar')`,
      '进入复习'
    )
    const c = await cardState()
    expectEq(c.progress, '0 / 28', '进度')
    await answer(3)
    await press('Escape')
    await waitFor(`!!document.querySelector('.done')`, '完成页')
    expectEq(await text('.done h1'), '这一轮先到这里', '中途结束的标题')
    await waitFor(`!!document.querySelector('.sidebar')`, '导航栏恢复')
    await waitFor(`document.querySelector('.nav-count')?.textContent === '27'`, '导航 27')
  })

  const firstGrades = new Map()
  let skippedWord = null
  await check('完整走一轮（全键盘）：重现、Ctrl+Z 撤销、S 跳过', async () => {
    await press('4', { ctrl: true })
    await waitFor(`!!document.querySelector('.overview')`, '概览')
    await press('Enter')
    await waitFor(`!!document.querySelector('.session .card:not(.is-ghost)')`, '开始')
    const pattern = [1, 2, 3, 4, 3, 3]
    let n = 0
    let extraRetryUsed = false
    let undoTested = false
    let sawRetryLabel = false
    for (let guard = 0; guard < 200; guard++) {
      const c = await cardState()
      if (!c) break
      if (c.retry) {
        sawRetryLabel = true
        // 第一个“忘了”的词在重现时再答错一次，验证会继续重现
        const g = !extraRetryUsed && firstGrades.get(c.word) === 1 ? 1 : 3
        if (g === 1) extraRetryUsed = true
        await answer(g)
        continue
      }
      if (!skippedWord && n === 5) {
        skippedWord = c.word
        await press('s')
        await waitFor(
          `document.querySelector('.session .card:not(.is-ghost) .card-front .card-word')?.textContent !== ${q(c.word)}`,
          '跳过'
        )
        continue
      }
      const g = pattern[n++ % pattern.length]
      firstGrades.set(c.word, g)
      await answer(g)
      if (!undoTested && n === 2) {
        undoTested = true
        await press('z', { ctrl: true })
        await waitFor(
          `document.querySelector('.session .card:not(.is-ghost) .card-front .card-word')?.textContent === ${q(c.word)}`,
          '撤销后回到那张卡'
        )
        const after = await cardState()
        if (!after.progress.startsWith('1 /'))
          throw new Error(`撤销后进度应为 1：${after.progress}`)
        await answer(g)
      }
    }
    if (!sawRetryLabel) throw new Error('没有出现“再来一次”')
    if (!extraRetryUsed) throw new Error('没有测到重现时再答错')
    await waitFor(`!!document.querySelector('.done')`, '完成页')
    expectEq(await text('.done h1'), '今天的复习完成了', '完成标题')
    expectEq(firstGrades.size, 26, '本轮第一次作答数（27 个里跳过 1 个）')
  })

  await check('网格结果与第一次作答一致，重现没有改写网格；跳过的词仍然到期', async () => {
    const snap = await cdp.eval(`window.xword.getSnapshot()`)
    const byText = new Map(snap.words.map((w) => [w.text, w]))
    for (const [wordText, g] of firstGrades) {
      const w = byText.get(wordText)
      const cells = snap.checks.filter(
        (c) => c.wordId === w.id && c.doneOn === snap.today && c.grade !== null
      )
      const last = cells.sort((a, b) => b.stage - a.stage)[0]
      if (!last || last.grade !== g || last.result !== (g === 1 ? 'fail' : 'ok')) {
        throw new Error(`${wordText}：期望第一次作答 ${g}，网格为 ${JSON.stringify(last)}`)
      }
    }
    await waitFor(`document.querySelector('.nav-count')?.textContent === '1'`, '只剩跳过的 1 个')
    const skipped = byText.get(skippedWord)
    if (snap.checks.some((c) => c.wordId === skipped.id && c.doneOn === snap.today)) {
      throw new Error('跳过的词不应该有今天的记录')
    }
  })

  await check('复习剩下的 1 个后导航数量变为 0，今日复习显示空状态', async () => {
    await press('4', { ctrl: true })
    await waitFor(`document.querySelectorAll('.queue-item').length === 1`, '队列剩 1 个')
    await press('Enter')
    await waitFor(`!!document.querySelector('.session .card:not(.is-ghost)')`, '开始')
    await answer(4)
    await waitFor(`!!document.querySelector('.done')`, '完成页')
    await waitFor(`document.querySelector('.nav-count')?.textContent === '0'`, '导航 0')
    const stats = await cdp.eval(
      `[...document.querySelectorAll('.done-stats dd')].map(d => d.textContent)`
    )
    expectEq(stats[0], '28', '今天复习了 28 个')
    await press('4', { ctrl: true })
    await waitFor(
      `document.querySelector('.empty-state p')?.textContent === '今天没有要复习的词'`,
      '空状态'
    )
    await cdp.eval(
      `[...document.querySelectorAll('.empty-state button')].find(b => b.textContent.includes('去录入新词')).click()`
    )
    await waitFor(`!!document.querySelector('.wordbook')`, '去录入新词')
  })
}

async function settingsScenarios() {
  console.log('设置')
  const bg = () => cdp.eval(`getComputedStyle(document.body).backgroundColor`)
  const dark = () => cdp.eval(`matchMedia('(prefers-color-scheme: dark)').matches`)
  const pickTheme = (label) =>
    cdp.eval(
      `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent === ${q(label)}).click()`
    )

  await check('主题：深色 / 浅色由主进程 nativeTheme 驱动，页面跟着切换', async () => {
    await press('8', { ctrl: true })
    await waitFor(`!!document.querySelector('.settings')`, '设置页')
    await pickTheme('深色')
    await waitFor(`matchMedia('(prefers-color-scheme: dark)').matches`, '深色生效')
    expectEq(await bg(), 'rgb(23, 21, 19)', '深色桌面 #171513')
    await pickTheme('浅色')
    await waitFor(`!matchMedia('(prefers-color-scheme: dark)').matches`, '浅色生效')
    expectEq(await bg(), 'rgb(243, 236, 225)', '浅色桌面 #F3ECE1')
    expectEq(await dark(), false, '浅色')
    const snap = await cdp.eval(`window.xword.getSnapshot()`)
    expectEq(snap.settings.theme, 'light', '写入 settings 表')
  })

  await check('每日新词上限：非法值提示并恢复；改为 5 后今日队列里的新词随之减少', async () => {
    const setLimit = async (v) => {
      await cdp.eval(`document.querySelector('.limit-input').focus()`)
      await cdp.eval(`document.querySelector('.limit-input').select()`)
      await type(String(v))
      await press('Enter')
    }
    await setLimit(4)
    await waitFor(
      `document.querySelector('.limit-error')?.textContent.includes('5–100')`,
      '错误提示'
    )
    expectEq(await cdp.eval(`document.querySelector('.limit-input').value`), '20', '恢复原值')
    // 添加 8 个新词，上限 5 时队列里只有 5 个新词
    await cdp.eval(
      `window.xword.addWords(Array.from({ length: 8 }, (_, i) => ({ text: 'limit' + i, meaning: '' })))`
    )
    await refresh()
    await waitFor(`document.querySelector('.nav-count')?.textContent === '8'`, '上限 20：8 个新词')
    // 今天已经学了 5 个示例新词：上限 5 时名额已满，上限 10 时还剩 5 个名额
    await setLimit(5)
    await waitFor(`document.querySelector('.nav-count')?.textContent === '0'`, '上限 5：名额已满')
    await setLimit(10)
    await waitFor(`document.querySelector('.nav-count')?.textContent === '5'`, '上限 10：5 个新词')
    const snap = await cdp.eval(`window.xword.getSnapshot()`)
    expectEq(snap.settings.dailyNewLimit, 10, '写入 settings 表')
  })

  await check('数据文件夹与版本号显示；生产构建里没有开发专用的“载入示例数据”', async () => {
    const path = await text('.settings .path')
    if (!path || !path.includes('.test-tmp')) throw new Error(`数据文件夹：${path}`)
    expectEq(await text('.settings .version'), `XWord ${version}`, '版本号')
    const hasSample = await cdp.eval(
      `[...document.querySelectorAll('.settings button')].some(b => b.textContent.includes('载入示例数据'))`
    )
    expectEq(hasSample, false, '生产构建不显示示例数据按钮')
    expectEq(await count('.settings-row'), 6, '设置项数量')
    expectEq(await text('.dict-credit'), '词典数据：ECDICT（MIT License）', '词典来源')
  })
}

async function restartScenario(relaunch) {
  console.log('重启')
  await check('重启后主题、数据都还在，冷启动进入今日首页，并生成了当天的备份', async () => {
    await cdp.eval(
      `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent === '深色').click()`
    )
    await waitFor(`matchMedia('(prefers-color-scheme: dark)').matches`, '深色')
    const before = await cdp.eval(`window.xword.getSnapshot()`)
    await relaunch()
    await waitFor(`!!document.querySelector('.home')`, '冷启动进入今日首页')
    await waitFor(`matchMedia('(prefers-color-scheme: dark)').matches`, '深色保留')
    const after = await cdp.eval(`window.xword.getSnapshot()`)
    expectEq(after.words.length, before.words.length, '单词数')
    expectEq(after.checks.length, before.checks.length, '检查记录数')
    expectEq(after.settings, before.settings, '设置')
    const backup = join(dataDir, 'backups', `xword-${after.today}.db`)
    if (!existsSync(backup)) throw new Error(`没有生成备份 ${backup}`)
  })
}

/** 不等待的按键（快速连按用） */
async function pressFast(key) {
  const k = keyInfo(key)
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: k.text })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

async function startSampleReview() {
  if (await cdp.eval(`!!document.querySelector('.dialog')`)) await press('Escape')
  await cdp.eval(`window.xword.loadSampleData()`)
  await refresh()
  await waitFor(`document.querySelector('.nav-count')?.textContent === '28'`, '导航 28')
  await blur()
  await press('4', { ctrl: true })
  await waitFor(`!!document.querySelector('.overview')`, '概览')
  const order = await cdp.eval(
    `[...document.querySelectorAll('.queue-item .queue-word')].map(e => e.textContent.trim())`
  )
  await press('Enter')
  await waitFor(`!!document.querySelector('.session .card:not(.is-ghost)')`, '开始复习')
  return order
}

async function motionScenarios() {
  console.log('动效与键盘')

  await check(
    '复习中 2 秒内连按 20 次“空格 + 评分键（+ Enter 确认）”：写入的记录条数和每条评分都正确，一条不丢',
    async () => {
      const order = await startSampleReview()
      const pattern = [3, 4, 2, 3, 1, 4, 3, 3, 2, 4, 3, 1, 4, 3, 3, 4, 2, 3, 4, 3]
      const t0 = Date.now()
      for (const g of pattern) {
        await pressFast(' ')
        await pressFast(String(g))
        await pressFast('Enter')
      }
      const elapsed = Date.now() - t0
      console.log(`    20 次作答用时 ${elapsed} ms`)
      if (elapsed > 2000) throw new Error(`按键用了 ${elapsed} ms`)
      await waitFor(
        `document.querySelector('.progress-count')?.textContent.replace(/\\s+/g, ' ').trim().startsWith('20 /')`,
        '进度 20'
      )
      await press('Escape')
      await waitFor(`!!document.querySelector('.done')`, '完成页（等写库排队完成）', 8000)
      const snap = await cdp.eval(`window.xword.getSnapshot()`)
      const byText = new Map(snap.words.map((w) => [w.text, w.id]))
      const todays = snap.checks.filter((c) => c.doneOn === snap.today && c.grade !== null)
      expectEq(todays.length, 20, '今天写入的评分条数')
      const got = order.slice(0, 20).map((text) => {
        const id = byText.get(text)
        const cell = todays.filter((c) => c.wordId === id).sort((a, b) => b.stage - a.stage)[0]
        return cell?.grade ?? null
      })
      expectEq(got, pattern, '每条评分')
    }
  )

  await check('减少动态效果：位移归零，完整走一遍复习流程', async () => {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })
    try {
      expectEq(
        await cdp.eval(
          `getComputedStyle(document.documentElement).getPropertyValue('--move-sm').trim()`
        ),
        '0px',
        '位移变量'
      )
      await startSampleReview()
      for (let guard = 0; guard < 80; guard++) {
        const c = await cardState()
        if (!c) break
        await answer(3)
      }
      await waitFor(`!!document.querySelector('.done')`, '完成页', 8000)
      expectEq(await text('.done h1'), '今天的复习完成了', '完成标题')
      await waitFor(`document.querySelector('.nav-count')?.textContent === '0'`, '导航 0')
    } finally {
      await cdp.send('Emulation.setEmulatedMedia', { features: [] })
    }
  })
}

async function splashScenarios() {
  console.log('开屏')
  const reloadPage = async (hold) => {
    await cdp.send('Page.enable')
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: hold ? 'window.__xwordSplashHold = true' : ''
    })
    await cdp.send('Page.reload', { ignoreCache: false })
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    await waitFor(`!!document.querySelector('.splash')`, '开屏出现', 8000)
  }

  await check('开屏时按任意键，立即进入主界面', async () => {
    await reloadPage(true)
    await waitFor(`!!document.querySelector('.sidebar')`, '主界面已在开屏下渲染好', 8000)
    await sleep(900)
    if (!(await cdp.eval(`!!document.querySelector('.splash')`))) throw new Error('开屏已自己结束')
    // 从发出按键之前开始计时（包含一次调试协议往返，偏保守）
    const t0 = await cdp.eval('performance.now()')
    await pressFast('a')
    await waitFor(`!document.querySelector('.splash')`, '开屏消失', 1000)
    const ms = (await cdp.eval(`window.__xwordStartup.interactive`)) - t0
    console.log(`    按键到进入主界面：${ms.toFixed(1)} ms`)
    if (!(ms >= 0 && ms <= 100)) throw new Error(`按键后 ${ms} ms 才进入主界面`)
  })

  await check('开屏结束后，主界面变为可操作的时间不晚于数据加载完成后 100ms', async () => {
    await reloadPage(false)
    await waitFor(`!document.querySelector('.splash')`, '开屏结束', 8000)
    const m = await cdp.eval(`window.__xwordStartup`)
    const out = await cdp.eval(
      `parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-splash-out'))`
    )
    const due = Math.max(m.dataReady, m.splashFinal + out)
    console.log(
      `    数据就绪 ${m.dataReady.toFixed(0)} ms，三笔画完 ${m.splashFinal.toFixed(0)} ms，可以操作 ${m.interactive.toFixed(0)} ms`
    )
    if (m.interactive - due > 100) throw new Error(`晚了 ${(m.interactive - due).toFixed(0)} ms`)
    if (m.interactive - m.dataReady > 900) throw new Error('开屏拖慢了进入主界面')
  })
}

// ---------------------------------------------------------------- 视觉对照截图（1440×900，缩放 100%）

async function shootAs(name, clip) {
  const params = { format: 'png' }
  if (clip) params.clip = { ...clip, scale: clip.scale ?? 1 }
  const { data } = await cdp.send('Page.captureScreenshot', params)
  writeFileSync(join(screensDir, `${name}.png`), Buffer.from(data, 'base64'))
}

async function setTheme(theme) {
  await cdp.eval(`window.xword.setTheme(${q(theme)})`)
  await waitFor(
    `matchMedia('(prefers-color-scheme: dark)').matches === ${theme === 'dark'}`,
    `主题 ${theme}`
  )
  await sleep(250)
}

async function visualScenarios() {
  console.log('视觉对照截图')
  rmSync(screensDir, { recursive: true, force: true })
  mkdirSync(screensDir, { recursive: true })
  await check(
    '截图：单词页、今日复习概览、复习中、词库（深色）、侧栏 Logo、开屏最终帧',
    async () => {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      })
      try {
        if (await cdp.eval(`!!document.querySelector('.dialog')`)) await press('Escape')
        await setTheme('light')
        await cdp.eval(`window.xword.loadSampleData()`)
        await refresh()
        await waitFor(`document.querySelector('.nav-count')?.textContent === '28'`, '示例数据')
        await waitFor(`!document.querySelector('.toast')`, 'Toast 消失', 8000)
        await blur()
        // 单词页：第 1 页（6天节点今天到期），输入行里写一个词并打开义项面板
        await press('5', { ctrl: true })
        await waitFor(`!!document.querySelector('.wordbook')`, '单词页')
        for (let i = 0; i < 4; i++) await press('PageUp')
        await waitFor(
          `document.querySelector('h1.page-title')?.textContent === '第 1 页'`,
          '第 1 页'
        )
        await cdp.eval(`document.querySelector('.main').scrollTop = 0`)
        await sleep(300)
        await shootAs('v2-wordbook')
        // 今日复习概览
        await press('4', { ctrl: true })
        await waitFor(`!!document.querySelector('.overview')`, '概览')
        await sleep(300)
        await shootAs('v2-overview')
        // 复习中：翻面并选中“记得”
        await press('Enter')
        await waitFor(`!!document.querySelector('.session .card:not(.is-ghost)')`, '复习中')
        await press(' ')
        await press('3')
        await sleep(400)
        await shootAs('v2-review')
        await press('Escape')
        await waitFor(`!!document.querySelector('.done')`, '完成页')
        // 词库（深色）：选中 accommodate
        await setTheme('dark')
        await blur()
        await press('6', { ctrl: true })
        await waitFor(`!!document.querySelector('.library .word-row')`, '词库')
        await cdp.eval(
          `[...document.querySelectorAll('.word-row-text')].find(e => e.textContent === 'accommodate')?.closest('.word-row')?.click()`
        )
        await waitFor(
          `document.querySelector('input.detail-word')?.value === 'accommodate'`,
          '详情'
        )
        await blur()
        await sleep(400)
        await shootAs('v2-library-dark')
        // 侧栏 Logo：浅色、深色各一张（放大 4 倍）
        const brand = await cdp.eval(
          `(() => { const r = document.querySelector('.sidebar-brand').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
        )
        await shootAs('logo-sidebar-dark', { ...brand, scale: 4 })
        await setTheme('light')
        await shootAs('logo-sidebar-light', { ...brand, scale: 4 })
        // 开屏最终帧：浅色、深色（测试开关让开屏停在最终帧）
        for (const theme of ['light', 'dark']) {
          await setTheme(theme)
          await cdp.send('Page.enable')
          const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
            source: 'window.__xwordSplashHold = true'
          })
          await cdp.send('Page.reload', {})
          await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
          await waitFor(`!!document.querySelector('.splash')`, '开屏', 8000)
          await waitFor(`!!window.__xwordStartup?.splashFinal`, '最终帧', 4000)
          await sleep(200)
          await shootAs(`splash-final-${theme}`)
          await pressFast('a')
          await waitFor(`!document.querySelector('.splash')`, '跳过开屏')
        }
        await setTheme('light')
        await blur()
        await press('8', { ctrl: true })
        await waitFor(`!!document.querySelector('.settings')`, '回到设置页')
      } finally {
        await cdp.send('Emulation.clearDeviceMetricsOverride')
      }
    }
  )
}

// ---------------------------------------------------------------- 主流程

let child = null
let restoreTimer = null
let mainLog = ''
let mock = null
const perf = {}

/** 交给 v0.3 用例（scripts/e2e-reader.mjs）的测试工具 */
function tools() {
  return {
    cdp: () => cdp,
    press,
    type,
    waitFor,
    check,
    expectEq,
    sleep,
    q,
    clickToastAction,
    pressFast,
    restart: async () => {
      checkMainLog()
      await stop()
      await launch()
    },
    shootAs,
    setTheme,
    dataDir,
    root,
    perf,
    log: (m) => console.log(`    ${m}`),
    mainLog: () => mainLog
  }
}

async function launch() {
  mainLog = ''
  // 窗口可能被别的窗口挡住：关掉 Chromium 对被遮挡 / 后台窗口的节流，动画帧和定时器照常运行
  const flags = [
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling'
  ]
  child = spawn(electronPath, ['.', `--remote-debugging-port=${PORT}`, ...flags], {
    cwd: root,
    env: {
      ...process.env,
      XWORD_USER_DATA: dataDir,
      ELECTRON_RENDERER_URL: '',
      // 测试开关：mock 的 Gutendex 与 DeepSeek（只在未打包时生效）
      XWORD_GUTENDEX_URL: mock?.origin ?? '',
      XWORD_DEEPSEEK_URL: mock?.origin ?? ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (d) => (mainLog += d))
  child.stderr.on('data', (d) => (mainLog += d))

  let wsUrl = null
  for (let i = 0; i < 100 && !wsUrl; i++) {
    await sleep(150)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      wsUrl =
        list.find((t) => t.type === 'page' && t.url.startsWith('file:'))?.webSocketDebuggerUrl ??
        null
    } catch {
      // 还没启动好
    }
  }
  if (!wsUrl) throw new Error('无法连接到应用的调试端口')
  const previousErrors = cdp?.errors ?? []
  cdp = new Cdp(wsUrl)
  cdp.errors.push(...previousErrors)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', TEST_VIEWPORT)
  await cdp.send('Emulation.setEmulatedMedia', { features: TEST_MOTION })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SPEECH_MOCK })
  await cdp.eval(SPEECH_MOCK)
  // 窗口被最小化时页面不出动画帧（pdf.js 画不完、动画不推进）：每 2 秒检查一次，被最小化就恢复（不抢焦点）
  clearInterval(restoreTimer)
  restoreTimer = setInterval(
    () => cdp.eval('window.xword.devRestoreWindow()').catch(() => {}),
    2000
  )
  await waitFor(`!!document.querySelector('.sidebar')`, '应用渲染完成', 10000)
  await waitFor(`!document.querySelector('.splash')`, '开屏结束', 10000)
}

/** 先像用户一样关窗口（让 Chromium 把 localStorage 写回磁盘），超时再强制结束 */
async function stop() {
  clearInterval(restoreTimer)
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', r))
    try {
      await Promise.race([cdp?.eval('window.close()'), sleep(1000)])
    } catch {
      // 页面已关闭
    }
    const graceful = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)])
    if (!graceful) {
      child.kill()
      await exited
    }
  }
  cdp?.close()
  await sleep(300)
}

function checkMainLog() {
  if (/ERROR/.test(mainLog)) failures.push(`主进程日志有错误：\n${mainLog}`)
}

async function main() {
  rmSync(dataDir, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })

  let exitCode = 1
  try {
    mock = await startMockServer()
    await launch()
    // 只跑阅读器的用例（调试用）：E2E_ONLY=v3
    if (process.env.E2E_ONLY === 'v3') {
      await cdp.eval('window.xword.loadSampleData()')
      await refresh()
      await readerScenarios(tools())
      await pagesScenarios(tools())
      await perfScenarios(tools())
      await v3Screens(tools())
      throw new Error(
        `只跑 v0.3：通过 ${passed} 项，失败 ${failures.length} 项\n${failures.join('\n')}\n页面错误：${cdp.errors.join('\n')}\n主进程日志（最后 25 行）：\n${mainLog
          .split('\n')
          .slice(-25)
          .join('\n')}`
      )
    }
    await wordbookScenarios()
    await dictScenarios()
    await sampleScenarios()
    await todayScenarios()
    await motionScenarios()
    await settingsScenarios()
    await libraryScenarios()
    await visualScenarios()
    await readerScenarios(tools())
    await pagesScenarios(tools())
    await perfScenarios(tools())
    await v3Screens(tools())
    await restartScenario(async () => {
      checkMainLog()
      await stop()
      await launch()
    })
    await splashScenarios()
    await speechScenarios(tools())

    if (cdp.errors.length) failures.push(...cdp.errors.map((e) => `页面错误 ${e}`))
    checkMainLog()
    if (Object.keys(perf).length > 0) {
      console.log('\n性能实测')
      for (const [k, v] of Object.entries(perf)) console.log(`  ${k}: ${v}`)
      writeFileSync(join(root, '.test-tmp', 'perf.json'), JSON.stringify(perf, null, 2))
    }
    console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`)
    for (const f of failures) console.log(`  - ${f}`)
    exitCode = failures.length === 0 ? 0 : 1
  } catch (e) {
    console.error(`端到端测试中断：${e.message}`)
    console.error(mainLog)
  } finally {
    await stop()
    mock?.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
  process.exit(exitCode)
}

main()
