import { ipcMain, shell, BrowserWindow } from 'electron'
import { applyTheme, effectiveTheme, sendTheme } from './theme.ts'
import { checkAppUpdate, downloadAppUpdate, installAppUpdate, appUpdateState, setAppUpdateLatest } from './updater.ts'
import { appGitHubRepo, fetchGithubLatestRelease } from '../core/updates.ts'
import { detectEnvironment } from '../core/detect.ts'
import { scanHome } from '../core/home.ts'
import { readAllProfiles, readProfile, runPluginAction, dumpConfig } from '../core/profiles.ts'
import { checkUpdates, checkPluginUpdates } from '../core/updates.ts'
import { runHealthChecks } from '../core/health.ts'
import { backupHome, listBackups, restoreBackup, restorePreview, pruneBackups } from '../core/backup.ts'
import { readPrefs, writePrefs, backupsDir, managerDir } from '../core/manager-config.ts'
import {
  saveInstance, removeInstance, startInstance, stopInstance, restartInstance,
  instanceLog, listInstanceStatuses, instanceUrl, newInstanceId, listInstances,
} from '../core/instances.ts'

function listInstancesForService() {
  return listInstances()
}
import { listSessions, decodeSession, exportSession, sessionStats } from '../core/sessions.ts'
import {
  listConfigFiles, readConfigFile, writeConfigFile, validateYaml, validatePatchWithDsh, diffLines,
} from '../core/config-editor.ts'
import { repairActions, executeRepair } from '../core/repair.ts'
import { installService, uninstallService, serviceStatus } from '../core/service.ts'
import { searchMarketplace } from '../core/marketplace.ts'
import type { BackupOptions, ManagerPrefs, InstanceConfig } from '../core/types.ts'

/**
 * IPC 注册表：所有渲染层能力经此暴露。
 * 统一包装：handler 抛错时返回 { ok: false, error }，不把异常泄漏到渲染层。
 */
type Handler<TReq, TRes> = (payload: TReq) => Promise<TRes> | TRes

function register<TReq, TRes>(channel: string, handler: Handler<TReq, TRes>): void {
  ipcMain.handle(channel, async (_event, payload: TReq) => {
    try {
      return { ok: true as const, data: await handler(payload) }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

export function registerIpc(): void {
  // ── 环境 / 数据 ──────────────────────────────────────────────
  register('dshm:env', async () => detectEnvironment())
  register('dshm:scanHome', async () => scanHome())
  register('dshm:profiles', async () => readAllProfiles())
  register('dshm:profile', async (name: string) => readProfile(name))

  // ── 健康 / 更新 ──────────────────────────────────────────────
  register('dshm:health', async () => runHealthChecks())
  register('dshm:updates', async () => {
    const env = await detectEnvironment()
    const report = await checkUpdates({ dsh: env.dsh.version, pythonSdk: env.pythonSdk?.version ?? null })
    return report
  })
  register('dshm:pluginUpdates', async (names: string[]) => checkPluginUpdates(names))

  // ── 备份 / 恢复 ──────────────────────────────────────────────
  register('dshm:backup', async (opts: BackupOptions) => backupHome(opts))
  register('dshm:backups', async () => listBackups())
  register('dshm:restorePreview', async (dir: string) => restorePreview(dir))
  register('dshm:restore', async (payload: { dir: string; dryRun?: boolean }) => restoreBackup(payload.dir, { dryRun: payload.dryRun }))
  register('dshm:pruneBackups', async (retention: number) => pruneBackups(retention))

  // ── 偏好 ─────────────────────────────────────────────────────
  register('dshm:prefs', async () => readPrefs())
  register('dshm:prefsSet', async (prefs: ManagerPrefs) => {
    writePrefs(prefs)
    return readPrefs()
  })

  // ── 插件 / 配置操作 ──────────────────────────────────────────
  register('dshm:pluginAction', async (payload: { profile: string; args: string[] }) =>
    runPluginAction(payload.profile, payload.args),
  )
  register('dshm:dumpConfig', async (payload: { profile: string; defaultOnly?: boolean }) =>
    dumpConfig(payload.profile, { defaultOnly: payload.defaultOnly }),
  )

  // ── 实例管理 ────────────────────────────────────────────────
  register('dshm:instances', async () => listInstanceStatuses())
  register('dshm:instanceNewId', async () => newInstanceId())
  register('dshm:instanceSave', async (config: InstanceConfig) => saveInstance(config))
  register('dshm:instanceRemove', async (id: string) => removeInstance(id))
  register('dshm:instanceStart', async (id: string) => startInstance(id))
  register('dshm:instanceStop', async (id: string) => stopInstance(id))
  register('dshm:instanceRestart', async (id: string) => restartInstance(id))
  register('dshm:instanceLog', async (payload: { id: string; maxBytes?: number }) => instanceLog(payload.id, payload.maxBytes))
  register('dshm:instanceOpen', async (id: string) => {
    const url = await instanceUrl(id)
    if (!url) return { ok: false, error: '实例未监听任何端口' }
    await shell.openExternal(url)
    return { ok: true, url }
  })

  // ── 会话日志 ──────────────────────────────────────────────────
  register('dshm:sessions', async () => listSessions())
  register('dshm:sessionDecode', async (payload: { path: string; maxEvents?: number }) => {
    const decoded = await decodeSession(payload.path, { maxEvents: payload.maxEvents })
    return { ...decoded, stats: sessionStats(decoded.events) }
  })
  register('dshm:sessionExport', async (payload: { path: string; format: 'jsonl' | 'markdown' }) =>
    exportSession(payload.path, payload.format),
  )

  // ── 配置编辑 ──────────────────────────────────────────────────
  register('dshm:configFiles', async () => listConfigFiles())
  register('dshm:configRead', async (payload: { id: string; reveal?: boolean }) => readConfigFile(payload.id, { reveal: payload.reveal }))
  register('dshm:configValidate', async (payload: { id: string; content: string }) => {
    const def = listConfigFiles().find((f) => f.id === payload.id)
    const yaml = validateYaml(payload.content)
    if (def?.kind === 'profile-patch' && def.profile && yaml.ok) {
      const patch = await validatePatchWithDsh(def.profile, payload.content)
      return { yamlOk: yaml.ok, yamlError: yaml.error, patchOk: patch.ok, patchOutput: patch.output.slice(0, 4000) }
    }
    return { yamlOk: yaml.ok, yamlError: yaml.error, patchOk: null, patchOutput: null }
  })
  register('dshm:configSave', async (payload: { id: string; content: string }) => writeConfigFile(payload.id, payload.content))
  register('dshm:configDiff', async (payload: { before: string; after: string }) => diffLines(payload.before, payload.after))

  // ── 修复动作库 ──────────────────────────────────────────────
  register('dshm:repairActions', async () => repairActions())
  register('dshm:repairExecute', async (payload: { action: string; params?: Record<string, unknown> }) =>
    executeRepair(payload.action, payload.params ?? {}),
  )

  // ── 系统服务 ──────────────────────────────────────────────────
  register('dshm:serviceInstall', async (id: string) => {
    const config = listInstancesForService().find((i) => i.id === id)
    if (!config) return { ok: false, message: '实例不存在' }
    return installService(config)
  })
  register('dshm:serviceUninstall', async (id: string) => uninstallService(id))
  register('dshm:serviceStatus', async (id: string) => {
    const config = listInstancesForService().find((i) => i.id === id)
    if (!config) return null
    return serviceStatus(config)
  })

  // ── 插件市场 ────────────────────────────────────────────────
  register('dshm:marketplace', async (payload: { refresh?: boolean }) => searchMarketplace({ refresh: payload?.refresh }))

  // ── 主题 ─────────────────────────────────────────────────────
  register('dshm:themeGet', async () => readPrefs().theme)
  register('dshm:themeSet', async (mode: 'system' | 'light' | 'dark') => {
    const prefs = readPrefs()
    prefs.theme = mode
    writePrefs(prefs)
    applyTheme(mode)
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    sendTheme(win, mode)
    return effectiveTheme(mode)
  })

  // ── 应用内更新 ────────────────────────────────────────────────
  register('dshm:appUpdateCheck', async () => {
    const gh = await fetchGithubLatestRelease(appGitHubRepo())
    const latest = gh
      ? {
          tagName: gh.tagName,
          publishedAt: gh.publishedAt,
          body: gh.body,
          assets: gh.assets.map((a) => ({ name: a.name, size: a.size, downloadUrl: a.downloadUrl })),
        }
      : null
    setAppUpdateLatest(latest)
    return checkAppUpdate()
  })
  register('dshm:appUpdateDownload', async () => downloadAppUpdate())
  register('dshm:appUpdateInstall', async () => installAppUpdate())
  register('dshm:appUpdateState', async () => appUpdateState())

  // ── 窗口控制（无边框窗口） ──────────────────────────────────
  ipcMain.on('dshm:windowMinimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on('dshm:windowToggleMaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('dshm:windowClose', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  // ── 系统 ─────────────────────────────────────────────────────
  register('dshm:openPath', async (path: string) => shell.openPath(path))
  register('dshm:paths', async () => ({ managerDir: managerDir(), backupsDir: backupsDir() }))
}
