/**
 * dsh-manager 核心层共享类型。
 * 本层（src/core）为框架无关的纯 Node 模块：
 *  - 由 Electron 主进程 import 并通过 IPC 暴露给渲染层；
 *  - 未来迁移 Tauri 时，整体打包为 sidecar 复用，接口不变。
 */

/** 命令执行结果（带超时与输出截断） */
export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** dsh 安装形态 */
export type DshForm =
  | 'npm-global'
  | 'npx-cache'
  | 'source-checkout'
  | 'python-wheel'
  | 'unknown'
  | 'not-found'

/** 环境快照：管理器首页的"环境卡"数据 */
export interface EnvSnapshot {
  platform: NodeJS.Platform
  arch: string
  node: { version: string | null; ok: boolean; required: string }
  pnpm: { version: string | null; ok: boolean }
  dsh: {
    version: string | null
    found: boolean
    form: DshForm
    path: string | null
    hint: string | null
  }
  pythonSdk: { installed: boolean; version: string | null } | null
  home: {
    path: string
    default: boolean
    exists: boolean
    writable: boolean
    display: string
  }
  /** 正在运行的 dsh web 实例（端口探测） */
  runningWeb: { listening: boolean; port: number } | null
}

/** DSH_HOME 扫描结果 */
export interface HomeScan {
  homePath: string
  entries: HomeEntry[]
  sessions: { dirs: number; bytes: number; logs: number }
  profiles: { dirs: number }
  attachmentsBytes: number
  storagesBytes: number
  totalBytes: number
  largest: { path: string; bytes: number }[]
  recent: { path: string; mtimeMs: number }[]
}

export interface HomeEntry {
  name: string
  kind: 'dir' | 'file' | 'symlink' | 'other'
  bytes: number
  itemCount: number
  note?: string
}

/** 插件分类 */
export type PluginKind = 'builtin-bundle' | 'out-of-tree-bundle' | 'plain-dep' | 'orphan'

export interface PluginRow {
  name: string
  version: string | null
  kind: PluginKind
  inBundlesList: boolean
  hasBundlePatch: boolean
  installed: boolean
  declared: boolean
  latest: string | null
  outdated: boolean
}

export interface ProfileInfo {
  name: string
  dir: string
  exists: boolean
  bundles: string[]
  dependencies: Record<string, string>
  nodeModulesPresent: boolean
  lockfilePresent: boolean
  patchPresent: boolean
  plugins: PluginRow[]
}

/** 更新渠道 */
export interface UpdateChannel {
  id: 'npm' | 'pypi' | 'github'
  name: string
  url: string
  local: string | null
  latest: string | null
  publishedAt: string | null
  state: 'up-to-date' | 'outdated' | 'unknown' | 'error'
  error?: string
}

export interface UpdateReport {
  channels: UpdateChannel[]
  checkedAt: string
}

/** 健康检查项 */
export type HealthStatus = 'ok' | 'warn' | 'error' | 'info' | 'skip'

export interface HealthCheck {
  id: string
  group: string
  title: string
  status: HealthStatus
  detail: string
  fixHint?: string
  /** 关联的修复动作（一键修复按钮） */
  repair?: { action: string; payload?: Record<string, unknown> }
}

// ── 修复动作库 ───────────────────────────────────────────────────

export interface RepairAction {
  id: string
  title: string
  group: string
  description: string
  /** 需要的参数（UI 生成表单） */
  params: { key: string; label: string; required?: boolean; placeholder?: string }[]
  /** 是否破坏性（需用户确认） */
  destructive: boolean
}

export interface RepairResult {
  ok: boolean
  message: string
  /** 执行详情行 */
  log: string[]
  /** 产生的备份 */
  backups: string[]
  /** 修改/删除的文件 */
  touched: string[]
}

// ── 系统服务 ─────────────────────────────────────────────────────

export type ServicePlatform = 'darwin' | 'linux' | 'win32'

export interface ServiceInfo {
  id: string
  platform: ServicePlatform
  label: string
  unitPath: string
  installed: boolean
  /** 注册/启动状态（launchctl/systemctl 查询结果） */
  active: boolean | null
  detail: string
}


/** 备份 */
export interface BackupOptions {
  includeCredentials?: boolean
  includeNodeModules?: boolean
  includeCache?: boolean
  note?: string
}

/** 生效后的备份选项（note 保持可选） */
export type EffectiveBackupOptions = Required<Omit<BackupOptions, 'note'>> & { note?: string }

export interface BackupManifest {
  schemaVersion: 1
  createdAt: string
  dshVersion: string | null
  homePath: string
  source: string
  files: number
  bytes: number
  excluded: string[]
  options: EffectiveBackupOptions
  note?: string
}

export interface BackupMeta {
  dir: string
  manifest: BackupManifest | null
  exists: boolean
}

export interface RestorePreview {
  backupDir: string
  toAdd: string[]
  toOverwrite: string[]
  toDelete: string[]
  unchanged: number
  total: number
}

export interface RestoreResult {
  ok: boolean
  added: number
  overwritten: number
  deleted: number
  errors: string[]
}

/** 管理器偏好 */
export interface ManagerPrefs {
  backup: { includeCredentials: boolean; includeNodeModules: boolean; includeCache: boolean; retention: number }
  update: { autoCheckOnStart: boolean; notifyOnUpdate: boolean }
  instances: { stopOnQuit: boolean }
}

// ── 实例管理 ────────────────────────────────────────────────────

export interface InstanceConfig {
  id: string
  name: string
  /** profile 名（web / headless / 自定义） */
  profile: string
  /** Web 端口（--port，仅 web 类 profile 生效） */
  port?: number
  /** 工作目录（默认 workspace root） */
  cwd?: string
  /** DSH_HOME 覆盖 */
  dshHome?: string
  /** 附加环境变量 */
  env?: Record<string, string>
  /** 附加 app 参数 */
  extraArgs?: string[]
  /** 可执行文件覆盖（默认 PATH 中的 dsh） */
  command?: string
  /** 管理器启动时自动拉起 */
  autoStart: boolean
  createdAt: number
}

export interface InstanceStatus {
  config: InstanceConfig
  running: boolean
  pid: number | null
  startedAt: number | null
  portListening: boolean
  logBytes: number
  lastExitCode: number | null
}

// ── 会话日志 ────────────────────────────────────────────────────

export interface SessionMeta {
  /** session-<uuid> 中的 uuid */
  id: string
  /** 工作区目录名（路径编码） */
  workspaceKey: string
  /** 工作区显示路径（若可解） */
  workspacePath: string | null
  dir: string
  logFile: string | null
  bytes: number
  mtimeMs: number
}

export interface SessionHeader {
  type: 'session'
  version: number
  id: string
  createdAt: number
  cwd?: string
  parentSession?: string
  seedLength?: number
  origin?: string
  delegationDepth: number
  agentPreset?: string
}

export interface DecodedEvent {
  seq: number | null
  time: number | null
  type: string
  data: Record<string, unknown>
  raw: string
}

export interface DecodedSession {
  path: string
  header: SessionHeader | null
  events: DecodedEvent[]
  totalLines: number
  frames: number
  torn: boolean
  truncated: boolean
  sizeBytes: number
}

export interface SessionStats {
  totalEvents: number
  byType: Record<string, number>
  messages: number
  toolCalls: number
  firstTime: number | null
  lastTime: number | null
  chars: number
}

// ── 配置编辑 ────────────────────────────────────────────────────

export type ConfigFileKind = 'settings' | 'home-patch' | 'profile-patch' | 'credentials' | 'env'

export interface ConfigFileDef {
  id: string
  label: string
  kind: ConfigFileKind
  path: string
  profile?: string
  exists: boolean
  /** 凭据类：默认掩码显示 */
  masked: boolean
}

export interface ConfigValidateResult {
  yamlOk: boolean
  yamlError: string | null
  patchOk: boolean | null
  patchOutput: string | null
}

export interface ConfigSaveResult {
  path: string
  backupPath: string
  before: string
  after: string
}

// ── 插件市场 ─────────────────────────────────────────────────────

export type MarketplaceSource = 'github' | 'npm'

export interface MarketplaceEntry {
  source: MarketplaceSource
  /** GitHub: owner/repo；npm: 包名 */
  name: string
  description: string | null
  url: string
  stars?: number
  updatedAt: string | null
  /** npm 已发布版本（npm 渠道） */
  version: string | null
  /** 声明了 dsh.bundle.patch（可作为 bundle 入栈） */
  dshBundlePatch: boolean
  topics?: string[]
  /** 安装 spec（dsh plugin add 用） */
  installSpec: string
}

export interface MarketplaceSearch {
  entries: MarketplaceEntry[]
  cached: boolean
  fetchedAt: string
  errors: string[]
}
