import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync, renameSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { managerDir } from './manager-config.ts'
import { which } from './exec.ts'
import { probePort } from './detect.ts'
import type { InstanceConfig, InstanceStatus } from './types.ts'

/**
 * dsh 实例管理：配置注册表 + 进程生命周期 + 日志采集。
 * 状态通过 pid 文件恢复（管理器重启后可重新接管孤儿实例）。
 * 停止语义：SIGTERM（dsh 优雅释放插件树，5 秒排空）→ 超时 SIGKILL。
 */

const MAX_LOG_BYTES = 5 * 1024 * 1024

function instancesFile(): string {
  return join(managerDir(), 'instances.json')
}

function runDir(): string {
  return join(managerDir(), 'run')
}

function logsDir(): string {
  return join(managerDir(), 'logs')
}

function pidFile(id: string): string {
  return join(runDir(), id + '.pid')
}

function logFile(id: string): string {
  return join(logsDir(), id + '.log')
}

export function listInstances(): InstanceConfig[] {
  const file = instancesFile()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as InstanceConfig[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveInstances(instances: InstanceConfig[]): void {
  mkdirSync(managerDir(), { recursive: true })
  writeFileSync(instancesFile(), JSON.stringify(instances, null, 2) + String.fromCharCode(10), 'utf8')
}

export function saveInstance(config: InstanceConfig): InstanceConfig {
  const instances = listInstances()
  const index = instances.findIndex((i) => i.id === config.id)
  const next: InstanceConfig = { ...config, createdAt: config.createdAt ?? Date.now() }
  if (index >= 0) instances[index] = next
  else instances.push(next)
  saveInstances(instances)
  return next
}

export function removeInstance(id: string): void {
  stopInstance(id)
  const instances = listInstances().filter((i) => i.id !== id)
  saveInstances(instances)
  const pid = pidFile(id)
  if (existsSync(pid)) unlinkSync(pid)
}

export function newInstanceId(): string {
  return randomUUID().slice(0, 8)
}

/** 进程是否存活（pid 文件 + kill(0) 探测） */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readPid(id: string): number | null {
  const file = pidFile(id)
  if (!existsSync(file)) return null
  try {
    const pid = Number(readFileSync(file, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function rotateLogIfNeeded(id: string): void {
  const file = logFile(id)
  try {
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
      renameSync(file, file + '.1')
    }
  } catch {
    /* ignore */
  }
}

function logTail(id: string, maxBytes = 64 * 1024): string {
  const file = logFile(id)
  if (!existsSync(file)) return '(暂无日志)'
  try {
    const size = statSync(file).size
    const start = Math.max(0, size - maxBytes)
    if (start === 0) return readFileSync(file, 'utf8')
    const fd = readFileSync(file, 'utf8')
    return fd.slice(fd.length - maxBytes)
  } catch {
    return '(读取日志失败)'
  }
}

// 运行中的子进程表（仅当前管理器进程可见；重启后靠 pid 文件重建状态）
const running: Record<string, ChildProcess> = {}

function resolveCommand(config: InstanceConfig): { cmd: string; args: string[] } {
  const cmd = config.command ?? 'dsh'
  const args: string[] = []
  if (cmd === 'dsh') {
    // dsh：launcher 参数在前，app 参数在后
    args.push('--profile', config.profile)
    if (config.port !== undefined && config.port > 0) args.push('--port', String(config.port))
  }
  if (config.extraArgs) args.push(...config.extraArgs)
  return { cmd, args }
}

export async function startInstance(id: string): Promise<{ ok: boolean; error?: string }> {
  const config = listInstances().find((i) => i.id === id)
  if (!config) return { ok: false, error: '实例不存在: ' + id }
  if (running[id]) return { ok: true }

  const { cmd, args } = resolveCommand(config)
  if (cmd === 'dsh') {
    const dsh = await which('dsh')
    if (!dsh) return { ok: false, error: '未找到 dsh 命令（PATH 中无 dsh）' }
  }
  mkdirSync(runDir(), { recursive: true })
  mkdirSync(logsDir(), { recursive: true })
  rotateLogIfNeeded(id)
  const stream = createWriteStream(logFile(id), { flags: 'a' })
  const child = spawn(cmd, args, {
    cwd: config.cwd ?? process.env.HOME ?? undefined,
    env: {
      ...process.env,
      ...(config.dshHome ? { DSH_HOME: config.dshHome } : {}),
      ...(config.env ?? {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
  child.stdout?.on('data', (chunk: Buffer) => stream.write(chunk))
  child.stderr?.on('data', (chunk: Buffer) => stream.write(chunk))
  child.on('error', (error) => {
    stream.write('[dsh-manager] 启动失败: ' + error.message + String.fromCharCode(10))
    stream.end()
    delete running[id]
  })
  child.on('close', (code) => {
    stream.write('[dsh-manager] 进程退出 code=' + String(code) + ' ' + new Date().toISOString() + String.fromCharCode(10))
    stream.end()
    delete running[id]
    const pid = pidFile(id)
    if (existsSync(pid)) {
      try {
        unlinkSync(pid)
      } catch {
        /* ignore */
      }
    }
  })
  running[id] = child
  if (child.pid !== undefined) writeFileSync(pidFile(id), String(child.pid), 'utf8')
  return { ok: true }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        resolvePromise(false)
      }
    }, timeoutMs)
    child.once('exit', () => {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolvePromise(true)
      }
    })
  })
}

export async function stopInstance(id: string): Promise<{ ok: boolean; error?: string }> {
  const child = running[id]
  if (child) {
    child.kill('SIGTERM')
    const exited = await waitForExit(child, 6000)
    if (!exited) {
      child.kill('SIGKILL')
      await waitForExit(child, 3000)
    }
    return { ok: true }
  }
  // 接管场景：直接按 pid 发信号
  const pid = readPid(id)
  if (pid !== null && pidAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* ignore */
    }
    // 轮询等待退出（最多 6.5s）
    for (let i = 0; i < 13; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (!pidAlive(pid)) break
    }
    if (pidAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* ignore */
      }
    }
    return { ok: true }
  }
  return { ok: false, error: '实例未在运行' }
}

export async function restartInstance(id: string): Promise<{ ok: boolean; error?: string }> {
  await stopInstance(id)
  return startInstance(id)
}

export async function instanceStatus(id: string): Promise<InstanceStatus | null> {
  const config = listInstances().find((i) => i.id === id)
  if (!config) return null
  const pid = readPid(id)
  const alive = pid !== null && pidAlive(pid)
  const logFile_ = logFile(id)
  let logBytes = 0
  try {
    if (existsSync(logFile_)) logBytes = statSync(logFile_).size
  } catch {
    /* ignore */
  }
  return {
    config,
    running: alive,
    pid,
    startedAt: null,
    portListening: config.port !== undefined && config.port > 0 ? await probePort(config.port) : false,
    logBytes,
    lastExitCode: null,
  }
}

export function instanceLog(id: string, maxBytes = 64 * 1024): string {
  return logTail(id, maxBytes)
}

export function instanceLogPath(id: string): string {
  return logFile(id)
}

/** 管理器启动时自动拉起标记了 autoStart 的实例 */
export async function autoStartInstances(): Promise<{ started: string[]; skipped: string[] }> {
  const started: string[] = []
  const skipped: string[] = []
  for (const config of listInstances()) {
    if (!config.autoStart) continue
    const status = await instanceStatus(config.id)
    if (status?.running) {
      skipped.push(config.id)
      continue
    }
    const result = await startInstance(config.id)
    if (result.ok) started.push(config.id)
    else skipped.push(config.id)
  }
  return { started, skipped }
}

export async function stopAllInstances(): Promise<void> {
  for (const config of listInstances()) {
    await stopInstance(config.id)
  }
}

export function hasRunningInstances(): boolean {
  for (const config of listInstances()) {
    const pid = readPid(config.id)
    if (pid !== null && pidAlive(pid)) return true
  }
  return false
}

/** 供 UI 列出全部实例及状态 */
export async function listInstanceStatuses(): Promise<InstanceStatus[]> {
  const statuses: InstanceStatus[] = []
  for (const config of listInstances()) {
    statuses.push((await instanceStatus(config.id))!)
  }
  return statuses
}

/** 打开实例的 Web 地址（端口探测确认后才返回 URL） */
export async function instanceUrl(id: string): Promise<string | null> {
  const status = await instanceStatus(id)
  if (!status?.portListening || !status.config.port) return null
  return 'http://127.0.0.1:' + status.config.port
}
