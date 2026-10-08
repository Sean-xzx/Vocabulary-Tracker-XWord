/**
 * 加密保存 DeepSeek API key：Electron safeStorage（Windows 上是 DPAPI，绑定当前用户）加密后写进
 * userData\secrets\deepseek.key。明文只在主进程内存里短暂存在，不写日志、不回传渲染进程。
 */
import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeFileAtomic } from './db/connection'
import type { SecretStore } from './ai'

export function safeStorageSecret(file: string): SecretStore {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    save: (plain) => {
      mkdirSync(dirname(file), { recursive: true })
      writeFileAtomic(file, safeStorage.encryptString(plain))
    },
    load: () => {
      if (!existsSync(file)) return null
      try {
        return safeStorage.decryptString(readFileSync(file))
      } catch {
        return null
      }
    },
    clear: () => rmSync(file, { force: true })
  }
}
