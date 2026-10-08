/**
 * 极简日志：写到 userData\xword.log，超过 1 MB 时清空重写。同时输出到控制台。
 */
import { appendFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { nowIso } from '../shared/domain/dates'
import { appClock } from './clock'

const MAX_BYTES = 1024 * 1024
let logFile: string | null = null

export function initLog(file: string): void {
  logFile = file
  try {
    if (existsSync(file) && statSync(file).size > MAX_BYTES) writeFileSync(file, '')
  } catch {
    // 日志不可写时不影响启动
  }
}

function write(level: 'INFO' | 'ERROR', message: string): void {
  const line = `${nowIso(new Date(), appClock.timeZone())} ${level} ${message}\n`
  if (level === 'ERROR') console.error(line.trimEnd())
  else console.log(line.trimEnd())
  if (!logFile) return
  try {
    appendFileSync(logFile, line)
  } catch {
    // 忽略
  }
}

export function logInfo(message: string): void {
  write('INFO', message)
}

export function logError(message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : error ? String(error) : ''
  write('ERROR', detail ? `${message}: ${detail}` : message)
}
