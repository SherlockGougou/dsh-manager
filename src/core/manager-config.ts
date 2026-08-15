import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ManagerPrefs } from './types.ts'

/**
 * 管理器自身配置目录：默认 ~/.dsh-manager，与 dsh 的 DSH_HOME 完全隔离。
 * 可用环境变量 DSHM_MANAGER_DIR 覆盖（测试/多用户场景）。
 */
export function managerDir(): string {
  const override = process.env.DSHM_MANAGER_DIR
  return override && override.trim().length > 0 ? resolve(override) : join(homedir(), '.dsh-manager')
}

export function backupsDir(): string {
  return join(managerDir(), 'backups')
}

export function prefsPath(): string {
  return join(managerDir(), 'prefs.json')
}

export const DEFAULT_PREFS: ManagerPrefs = {
  backup: { includeCredentials: false, includeNodeModules: false, includeCache: false, retention: 10 },
  update: { autoCheckOnStart: true, notifyOnUpdate: true },
  instances: { stopOnQuit: false },
  theme: 'system',
}

export function ensureManagerDir(): string {
  const dir = managerDir()
  mkdirSync(dir, { recursive: true })
  mkdirSync(backupsDir(), { recursive: true })
  return dir
}

export function readPrefs(): ManagerPrefs {
  try {
    if (existsSync(prefsPath())) {
      const raw = JSON.parse(readFileSync(prefsPath(), 'utf8')) as Partial<ManagerPrefs>
      return {
        backup: { ...DEFAULT_PREFS.backup, ...(raw.backup ?? {}) },
        update: { ...DEFAULT_PREFS.update, ...(raw.update ?? {}) },
        instances: { ...DEFAULT_PREFS.instances, ...(raw.instances ?? {}) },
        theme: raw.theme ?? DEFAULT_PREFS.theme,
      }
    }
  } catch {
    // 损坏的偏好文件按默认值处理
  }
  return {
    ...DEFAULT_PREFS,
    backup: { ...DEFAULT_PREFS.backup },
    update: { ...DEFAULT_PREFS.update },
    instances: { ...DEFAULT_PREFS.instances },
    theme: DEFAULT_PREFS.theme,
  }
}

export function writePrefs(prefs: ManagerPrefs): void {
  ensureManagerDir()
  writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2) + '\n', 'utf8')
}
