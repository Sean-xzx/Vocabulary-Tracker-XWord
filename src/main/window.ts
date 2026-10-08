/**
 * 主窗口。
 * 这里是“禁止写十六进制色值”规则的唯一例外：启动时窗口背景色要与应用背景一致，避免闪白。
 */
import { BrowserWindow, app, nativeTheme } from 'electron'
import { join } from 'node:path'

// 与 design.css 的 --desk（窗口底色）一致
const BACKGROUND_LIGHT = '#F3ECE1'
const BACKGROUND_DARK = '#171513'

export function themeBackground(): string {
  return nativeTheme.shouldUseDarkColors ? BACKGROUND_DARK : BACKGROUND_LIGHT
}

/**
 * 窗口左上角和任务栏的图标（D1）：开发模式用 build/icon.ico，打包后用安装目录 resources/icon.ico（extraResources），
 * 两者都与 design-assets/icon/app-icon.ico 字节一致。显式设置，开发模式也不会显示 Electron 的默认图标。
 */
export function windowIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'build', 'icon.ico')
}

export function createMainWindow(devUrl: string | undefined): BrowserWindow {
  const win = new BrowserWindow({
    title: 'XWord',
    icon: windowIconPath(),
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    center: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: themeBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })

  win.once('ready-to-show', () => win.show())

  // 标题固定为 XWord，不跟随页面 <title> 变化
  win.on('page-title-updated', (event) => event.preventDefault())

  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}
