/**
 * dsh-manager 核心层门面：所有管理能力从这里导出。
 * 本层为框架无关纯 Node 模块（Electron 主进程 / 未来 Tauri sidecar 均复用）。
 */
export * from './types.ts'
export * from './manager-config.ts'
export * from './detect.ts'
export * from './home.ts'
export * from './profiles.ts'
export * from './updates.ts'
export * from './health.ts'
export * from './backup.ts'
export * from './zstd.ts'
export * from './sessions.ts'
export * from './instances.ts'
export * from './config-editor.ts'
export * from './repair.ts'
export * from './service.ts'
export * from './marketplace.ts'
