import type {
  EnvSnapshot,
  HomeScan,
  ProfileInfo,
  UpdateReport,
  HealthCheck,
  BackupOptions,
  BackupManifest,
  BackupMeta,
  RestorePreview,
  ManagerPrefs,
  InstanceConfig,
  InstanceStatus,
  SessionMeta,
  DecodedSession,
  SessionStats,
  ConfigFileDef,
  ConfigValidateResult,
  ConfigSaveResult,
  RepairAction,
  RepairResult,
  ServiceInfo,
  MarketplaceSearch,
} from '../../core/types'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  return window.dshm.invoke(channel, payload) as Promise<Result<T>>
}

/** 渲染层类型化 API（全部走 window.dshm → IPC → src/core） */
export const api = {
  env: () => invoke<EnvSnapshot>('dshm:env'),
  scanHome: () => invoke<HomeScan>('dshm:scanHome'),
  profiles: () => invoke<ProfileInfo[]>('dshm:profiles'),
  health: () => invoke<HealthCheck[]>('dshm:health'),
  updates: () => invoke<UpdateReport>('dshm:updates'),
  backup: (opts: BackupOptions) => invoke<{ dir: string; manifest: BackupManifest }>('dshm:backup', opts),
  backups: () => invoke<BackupMeta[]>('dshm:backups'),
  restorePreview: (dir: string) => invoke<RestorePreview>('dshm:restorePreview', dir),
  restore: (dir: string, dryRun?: boolean) =>
    invoke<{ ok: boolean; added: number; overwritten: number; deleted: number; errors: string[] }>('dshm:restore', { dir, dryRun }),
  pruneBackups: (retention: number) => invoke<string[]>('dshm:pruneBackups', retention),
  prefs: () => invoke<ManagerPrefs>('dshm:prefs'),
  prefsSet: (prefs: ManagerPrefs) => invoke<ManagerPrefs>('dshm:prefsSet', prefs),
  pluginAction: (profile: string, args: string[]) =>
    invoke<{ ok: boolean; stdout: string; stderr: string; code: number | null }>('dshm:pluginAction', { profile, args }),
  dumpConfig: (profile: string, defaultOnly?: boolean) =>
    invoke<{ ok: boolean; output: string; code: number | null }>('dshm:dumpConfig', { profile, defaultOnly }),
  openPath: (path: string) => invoke<string>('dshm:openPath', path),
  paths: () => invoke<{ managerDir: string; backupsDir: string }>('dshm:paths'),

  // 实例管理
  instances: () => invoke<InstanceStatus[]>('dshm:instances'),
  instanceNewId: () => invoke<string>('dshm:instanceNewId'),
  instanceSave: (config: InstanceConfig) => invoke<InstanceConfig>('dshm:instanceSave', config),
  instanceRemove: (id: string) => invoke<string>('dshm:instanceRemove', id),
  instanceStart: (id: string) => invoke<{ ok: boolean; error?: string }>('dshm:instanceStart', id),
  instanceStop: (id: string) => invoke<{ ok: boolean; error?: string }>('dshm:instanceStop', id),
  instanceRestart: (id: string) => invoke<{ ok: boolean; error?: string }>('dshm:instanceRestart', id),
  instanceLog: (id: string, maxBytes?: number) => invoke<string>('dshm:instanceLog', { id, maxBytes }),
  instanceOpen: (id: string) => invoke<{ ok: boolean; url?: string; error?: string }>('dshm:instanceOpen', id),

  // 会话日志
  sessions: () => invoke<SessionMeta[]>('dshm:sessions'),
  sessionDecode: (path: string, maxEvents?: number) =>
    invoke<DecodedSession & { stats: SessionStats }>('dshm:sessionDecode', { path, maxEvents }),
  sessionExport: (path: string, format: 'jsonl' | 'markdown') =>
    invoke<{ content: string; fileName: string }>('dshm:sessionExport', { path, format }),

  // 配置编辑
  configFiles: () => invoke<ConfigFileDef[]>('dshm:configFiles'),
  configRead: (id: string, reveal?: boolean) =>
    invoke<{ ok: boolean; content?: string; error?: string; def?: ConfigFileDef }>('dshm:configRead', { id, reveal }),
  configValidate: (id: string, content: string) =>
    invoke<ConfigValidateResult>('dshm:configValidate', { id, content }),
  configSave: (id: string, content: string) =>
    invoke<{ ok: boolean; result?: ConfigSaveResult; error?: string }>('dshm:configSave', { id, content }),
  configDiff: (before: string, after: string) =>
    invoke<{ kind: 'same' | 'add' | 'del'; text: string }[]>('dshm:configDiff', { before, after }),

  // 修复动作库
  repairActions: () => invoke<RepairAction[]>('dshm:repairActions'),
  repairExecute: (action: string, params?: Record<string, unknown>) =>
    invoke<RepairResult>('dshm:repairExecute', { action, params }),

  // 系统服务
  serviceInstall: (id: string) => invoke<{ ok: boolean; message: string; unitPath?: string }>('dshm:serviceInstall', id),
  serviceUninstall: (id: string) => invoke<{ ok: boolean; message: string }>('dshm:serviceUninstall', id),
  serviceStatus: (id: string) => invoke<ServiceInfo | null>('dshm:serviceStatus', id),

  // 插件市场
  marketplace: (refresh?: boolean) => invoke<MarketplaceSearch>('dshm:marketplace', { refresh }),
}

/** 简单异步加载 Hook */
export function useAsync<T>(fn: () => Promise<Result<T>>, deps: unknown[] = []) {
  // 在组件中使用的轻量实现见 hooks 文件
  return { fn, deps }
}
