/**
 * 应用图标（D1）：直接使用 design-assets 里设计好的文件，不重新绘制、不重新生成 ico。
 * design-assets/icon/app-icon.ico → build/icon.ico（内含 16/24/32/48/64/128/256，16、24 为专门绘制的版本）。
 * exe、安装程序、卸载程序、快捷方式、窗口和任务栏都用这一个文件。用法：npm run icon
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'design-assets/icon/app-icon.ico')
const to = join(root, 'build/icon.ico')
mkdirSync(dirname(to), { recursive: true })
copyFileSync(from, to)
if (!readFileSync(from).equals(readFileSync(to))) throw new Error('build/icon.ico 与设计稿不一致')
console.log('design-assets/icon/app-icon.ico → build/icon.ico（字节一致）')
