import { optimizer } from '@electron-toolkit/utils'
import { BrowserWindow, Menu, app, dialog, powerMonitor, session } from 'electron'
import { join } from 'node:path'
import { today } from '../shared/domain/dates'
import { backupBeforeMigration, backupDaily } from './db/backup'
import { SqlDb } from './db/connection'
import { LATEST_VERSION, migrate } from './db/migrations'
import { Repository } from './db/repository'
import { DictService } from './dict'
import { EVENTS } from '../shared/api'
import { AiService } from './ai'
import { Gutendex } from './books/gutendex'
import { Importer } from './books/importer'
import { BookStore } from './books/store'
import { appClock } from './clock'
import { safeStorageSecret } from './secret'
import { applyTheme, notifyPower, registerIpc } from './ipc'
import { initLog, logError, logInfo } from './log'
import { createMainWindow, windowIconPath } from './window'

const isDev = !app.isPackaged
// 以下开发 / 测试开关在打包后一律无效：ELECTRON_RENDERER_URL、XWORD_USER_DATA、远程调试端口
const devUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined

if (!isDev) {
  for (const sw of ['remote-debugging-port', 'remote-debugging-pipe', 'remote-allow-origins']) {
    app.commandLine.removeSwitch(sw)
  }
}

// 开发模式用独立的数据目录，避免示例数据覆盖安装版的真实数据；端到端测试可用 XWORD_USER_DATA 指定临时目录。
if (isDev) {
  app.setPath(
    'userData',
    process.env['XWORD_USER_DATA'] || join(app.getPath('appData'), 'XWord-dev')
  )
}

// 在 app ready 之前设置，任务栏分组和图标正确，固定到任务栏后图标也不会变
app.setAppUserModelId('com.sean.xword')

let mainWindow: BrowserWindow | null = null

function isTrustedUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (devUrl) return u.origin === new URL(devUrl).origin
    return u.protocol === 'file:'
  } catch {
    return false
  }
}

function harden(): void {
  // 页面不许跳转到其它地址，不许打开新窗口，不许嵌入 webview。
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault()
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
  // 不需要任何浏览器权限（摄像头、通知、剪贴板读取等）。
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
}

async function start(): Promise<void> {
  if (!isDev) Menu.setApplicationMenu(null)
  harden()

  const dataDir = app.getPath('userData')
  const dbPath = join(dataDir, 'xword.db')
  initLog(join(dataDir, 'xword.log'))
  logInfo(`XWord ${app.getVersion()} 启动（${isDev ? '开发' : '生产'}模式），数据库：${dbPath}`)

  let repo: Repository
  try {
    // “今天”按本地时间：每日备份的文件名和“每天第一次启动”都以它为准
    const day = today(appClock.now(), appClock.timeZone())
    const backupDir = join(dataDir, 'backups')
    const backup = backupDaily(dbPath, backupDir, day)
    if (backup) logInfo(`已备份：${backup}`)
    const db = await SqlDb.open(dbPath)
    const pre = backupBeforeMigration(dbPath, backupDir, db.userVersion, LATEST_VERSION, day)
    if (pre) logInfo(`升级表结构前已备份：${pre}`)
    const from = migrate(db, logInfo, {
      timeZone: appClock.timeZone(),
      bookFileName: (id) => new BookStore(join(dataDir, 'books')).readMeta(id).fileName
    })
    logInfo(`sql.js 已加载，表结构版本 ${from} -> ${db.userVersion}`)
    repo = new Repository(db, appClock)
  } catch (error) {
    logError('数据库初始化失败', error)
    dialog.showErrorBox(
      'XWord 无法打开数据库',
      `${dbPath}\n\n${error instanceof Error ? error.message : String(error)}`
    )
    app.quit()
    return
  }

  applyTheme(repo.getSettings().theme, null)
  const dict = new DictService()
  const store = new BookStore(join(dataDir, 'books'))
  const importer = new Importer(repo, store, logInfo)
  // 测试开关：mock 服务地址（只在未打包时生效）
  const mockGutendex = isDev ? devOrigin(process.env['XWORD_GUTENDEX_URL']) : null
  const mockDeepSeek = isDev ? devOrigin(process.env['XWORD_DEEPSEEK_URL']) : null
  const gutendex = new Gutendex(
    mockGutendex ?? 'https://gutendex.com',
    Gutendex.policies(mockGutendex)
  )
  const ai = new AiService({
    repo,
    secret: safeStorageSecret(join(dataDir, 'secrets', 'deepseek.key')),
    emit: (chunk) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(EVENTS.ai, chunk)
    },
    base: mockDeepSeek ?? undefined,
    devOrigin: mockDeepSeek,
    log: logInfo
  })
  if (mockGutendex || mockDeepSeek)
    logInfo(`测试用 mock 服务：${[mockGutendex, mockDeepSeek].filter(Boolean).join('、')}`)
  registerIpc({
    repo,
    dict,
    store,
    importer,
    gutendex,
    ai,
    appInfo: { version: app.getVersion(), isDev, dataDir, dbPath },
    getWindow: () => mainWindow,
    isTrustedUrl
  })

  app.on('browser-window-created', (_event, window) => {
    // 开发模式 F12 开关开发者工具；生产模式屏蔽 Ctrl+R / F5 刷新。
    optimizer.watchWindowShortcuts(window)
  })

  // 系统唤醒、屏幕解锁后让渲染进程重新检查日期（睡眠时午夜定时器不会触发）
  powerMonitor.on('resume', () => notifyPower(mainWindow, 'resume'))
  powerMonitor.on('unlock-screen', () => notifyPower(mainWindow, 'unlock-screen'))

  mainWindow = createMainWindow(devUrl)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) =>
    logError(`渲染进程退出：${details.reason}`)
  )
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error') logError(`渲染进程：${event.message}`)
  })
  mainWindow.webContents.once('did-finish-load', () => {
    logInfo(`窗口已创建，页面加载完成；窗口图标：${windowIconPath()}`)
    // 页面加载完再在后台加载词典（解压在线程池里进行），不影响窗口显示
    void loadDictionary(dict)
  })
}

/** mock 服务只能是本机的 http 源 */
function devOrigin(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
      ? u.origin
      : null
  } catch {
    return null
  }
}

function dictionaryPath(): string {
  const file = 'ecdict-lite.json.gz'
  return app.isPackaged
    ? join(process.resourcesPath, 'dict', file)
    : join(app.getAppPath(), 'resources', 'dict', file)
}

async function loadDictionary(dict: DictService): Promise<void> {
  const started = performance.now()
  try {
    const loaded = await dict.load(dictionaryPath())
    const ms = Math.round(performance.now() - started)
    const probe = dict.lookup('ability').status
    logInfo(`词典已加载：${loaded.size} 条，用时 ${ms} ms；自检 ability：${probe}`)
  } catch (error) {
    logError('词典加载失败', error)
  }
}

// sql.js 把整个数据库读进内存再写回文件，两个实例同时运行会互相覆盖数据，所以只允许一个实例。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  process.on('uncaughtException', (error) => logError('未捕获的异常', error))

  app.whenReady().then(start, (error) => logError('启动失败', error))

  app.on('window-all-closed', () => app.quit())
}
