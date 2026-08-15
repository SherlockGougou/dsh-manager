import { app, BrowserWindow } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { AppUpdateInfo, AppUpdateState } from '../core/types.ts'

/**
 * 应用内更新（electron-updater + GitHub Releases provider）。
 * 仅在打包安装（app.isPackaged）后启用；开发模式返回 state='dev'，
 * 此时"最新版本/发布说明/安装包链接"由 GitHub API 提供（见 core/updates.ts）。
 */

let state: AppUpdateState = 'idle'
let progress: number | null = null
let error: string | null = null
let message: string | null = null

let getWindow: () => BrowserWindow | null = () => null
let lastInfo: AppUpdateInfo['latest'] = null

function push(): void {
  getWindow()?.webContents.send('dshm:update-event', snapshot())
}

function snapshot(): AppUpdateInfo {
  return {
    currentVersion: app.getVersion(),
    state,
    latest: lastInfo,
    progress,
    error,
    message,
  }
}

export function setupUpdater(windowGetter: () => BrowserWindow | null, initialLatest: AppUpdateInfo['latest'] = null): void {
  getWindow = windowGetter
  lastInfo = initialLatest
  if (!app.isPackaged) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => {
    state = 'checking'
    error = null
    message = '正在检查更新…'
    push()
  })
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    state = 'available'
    message = '发现新版本 ' + info.version
    push()
  })
  autoUpdater.on('update-not-available', () => {
    state = 'none'
    message = '已是最新版本'
    push()
  })
  autoUpdater.on('download-progress', (p) => {
    state = 'downloading'
    progress = Math.round(p.percent)
    message = '下载中 ' + progress + '%'
    push()
  })
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    state = 'downloaded'
    message = '新版本 ' + info.version + ' 已下载，重启安装'
    push()
  })
  autoUpdater.on('error', (err) => {
    state = 'error'
    error = String(err.message ?? err)
    message = '更新失败'
    push()
  })
}

export async function checkAppUpdate(): Promise<AppUpdateInfo> {
  if (!app.isPackaged) {
    state = 'dev'
    message = '开发模式：自动更新仅在打包安装后可用（可通过下方安装包手动升级）'
    push()
    return snapshot()
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    state = 'error'
    error = String(err)
    push()
  }
  return snapshot()
}

export async function downloadAppUpdate(): Promise<AppUpdateInfo> {
  if (!app.isPackaged) return snapshot()
  try {
    progress = 0
    await autoUpdater.downloadUpdate()
  } catch (err) {
    state = 'error'
    error = String(err)
    push()
  }
  return snapshot()
}

export function installAppUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall()
}

export function appUpdateState(): AppUpdateInfo {
  return snapshot()
}

export function setAppUpdateLatest(latest: AppUpdateInfo['latest']): void {
  lastInfo = latest
}
