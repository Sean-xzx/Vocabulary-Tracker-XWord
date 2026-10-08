/** 在隔离开发窗口验证 TTS 调用，真实扬声器音质仍需人工试听。 */
export const SPEECH_MOCK = `(() => {
  if (window.__speechTest) return;
  window.__speechTest = { spoken: [], canceled: 0,
    installedVoices: speechSynthesis.getVoices().map(v => ({name:v.name, lang:v.lang, local:v.localService})) };
  const voice = {name:'Test local English', lang:'en-US', localService:true, default:true};
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {configurable:true, value:class {
    constructor(text) { this.text = text; }
  }});
  Object.defineProperty(speechSynthesis, 'getVoices', {configurable:true, value:() => [voice]});
  Object.defineProperty(speechSynthesis, 'speak', {configurable:true, value:u => window.__speechTest.spoken.push(u.text)});
  Object.defineProperty(speechSynthesis, 'cancel', {configurable:true, value:() => window.__speechTest.canceled++});
})()`

export async function speechScenarios(t) {
  const { cdp: getCdp, check, expectEq, waitFor, press, sleep, shootAs, setTheme } = t
  const cdp = getCdp()
  // 只操作当前 E2E 隔离目录，不碰用户安装版数据。
  await cdp.eval(
    `window.xword.loadSampleData().then(() => window.dispatchEvent(new Event('focus')))`
  )
  await waitFor(`document.querySelector('.nav-count')?.textContent === '28'`, '朗读夹具')
  await setTheme('light')
  const nav = async (view) => {
    await cdp.eval(
      `document.activeElement?.blur(); document.querySelector('[data-view="${view}"]').click()`
    )
    await waitFor(
      `!!document.querySelector('.${view === 'today' ? 'overview' : view === 'library' ? 'library' : 'wordbook'}')`,
      view
    )
  }
  const spoken = () => cdp.eval('window.__speechTest.spoken')
  const clear = () => cdp.eval('window.__speechTest.spoken = []')

  await check('单词本：按钮和 R 朗读，不改学习记录，不打开编辑器', async () => {
    await nav('wordbook')
    const before = await cdp.eval('window.xword.getSnapshot()')
    const target = await cdp.eval(`(() => { const r = document.querySelector('.grid-row');
      r.querySelector('.word-audio').click(); r.querySelector('[role=gridcell]').focus();
      return r.querySelector('.word-text').textContent.trim(); })()`)
    await press('r')
    expectEq((await spoken()).slice(-2), [target, target], '按钮与快捷键')
    expectEq(await cdp.eval('window.xword.getSnapshot()'), before, '朗读不写学习数据')
    expectEq(await cdp.eval(`!!document.querySelector('.cell-input')`), false, '不触发编辑')
    await sleep(300)
    await shootAs('speech-wordbook-light')
  })

  await check('词库：列表和详情有朗读入口，列表朗读不改变选中项', async () => {
    await nav('library')
    await waitFor(
      `!!document.querySelector('.word-row .word-audio') && !!document.querySelector('.detail-head .word-audio')`,
      '词库按钮'
    )
    const selected = await cdp.eval(`document.querySelector('.word-row.is-selected')?.id`)
    await cdp.eval(
      `document.querySelectorAll('.word-row .word-audio')[1].click(); document.querySelector('.detail-head .word-audio').click()`
    )
    expectEq(
      await cdp.eval(`document.querySelector('.word-row.is-selected')?.id`),
      selected,
      '朗读不选其他词'
    )
    await sleep(300)
    await shootAs('speech-library-light')
  })

  await check('英译中：自动读一次、R 重播、按钮 Enter 不翻面；开关持久化', async () => {
    await nav('today')
    await cdp.eval(`[...document.querySelectorAll('.segmented-item')].find(b => b.textContent === '英 → 中').click();
      const toggle = document.querySelector('.review-audio-toggle input'); if (!toggle.checked) toggle.click()`)
    await clear()
    await cdp.eval(`document.querySelector('.overview-actions button').click()`)
    await waitFor(`window.__speechTest.spoken.length === 1`, '自动朗读')
    const target = (await spoken())[0]
    await cdp.eval(`document.querySelector('.card:not(.is-ghost) .word-audio').focus()`)
    await press('Enter')
    expectEq(await cdp.eval(`!!document.querySelector('.card-back')`), false, '按钮Enter不翻面')
    await press('r')
    expectEq(await spoken(), [target, target, target], '手动重播')
    await cdp.eval('document.activeElement.blur()')
    await press(' ')
    await sleep(100)
    expectEq((await spoken()).length, 3, '翻面不重复自动读')
    await cdp.eval(`document.querySelector('.review-audio-toggle input').click()`)
    expectEq(await cdp.eval(`localStorage.getItem('xword.reviewAutoSpeak')`), 'false', '保存关闭')
    await press('Escape')
    await waitFor(`!!document.querySelector('.done')`, '结束')
    await nav('today')
    expectEq(
      await cdp.eval(`document.querySelector('.review-audio-toggle input').checked`),
      false,
      '记住关闭'
    )
  })

  await check('中译英：翻面前不读/不显示按钮，翻面后读；退出停止', async () => {
    await cdp.eval(`[...document.querySelectorAll('.segmented-item')].find(b => b.textContent === '中 → 英').click();
      document.querySelector('.review-audio-toggle input').click()`)
    await clear()
    await cdp.eval(`document.querySelector('.overview-actions button').click()`)
    await waitFor(`!!document.querySelector('.session')`, '中译英')
    await cdp.eval('document.activeElement.blur()')
    await press('r')
    await sleep(100)
    expectEq(await spoken(), [], '不泄露答案')
    expectEq(
      await cdp.eval(`!!document.querySelector('.card:not(.is-ghost) .word-audio')`),
      false,
      '不显示答案按钮'
    )
    await press(' ')
    await waitFor('window.__speechTest.spoken.length === 1', '翻面自动读')
    await shootAs('speech-review-light')
    await setTheme('dark')
    await shootAs('speech-review-dark')
    await setTheme('light')
    const before = await cdp.eval('window.__speechTest.canceled')
    await press('Escape')
    await waitFor(`!!document.querySelector('.done')`, '结束')
    if ((await cdp.eval('window.__speechTest.canceled')) <= before)
      throw new Error('退出未取消播放')
    await nav('today')
    await cdp.eval(
      `[...document.querySelectorAll('.segmented-item')].find(b => b.textContent === '英 → 中').click()`
    )
  })
}
