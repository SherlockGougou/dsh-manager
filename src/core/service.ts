import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { managerDir } from './manager-config.ts'
import { which } from './exec.ts'
import { run } from './exec.ts'
import type { InstanceConfig, ServiceInfo } from './types.ts'

/**
 * 实例系统服务化（开机自启 + 崩溃重启，独立于管理器进程）：
 *  - macOS: launchd LaunchAgent（KeepAlive）
 *  - Linux: systemd user unit（Restart=always）
 *  - Windows: 启动文件夹 .cmd（schtasks 为备选）
 * 测试/沙箱场景可用 DSHM_SERVICE_DIR 覆盖目标目录。
 */

const NL = String.fromCharCode(10)

function serviceRoot(platform: NodeJS.Platform): string {
  const override = process.env.DSHM_SERVICE_DIR
  if (override && override.trim().length > 0) return override
  if (platform === 'darwin') return join(homedir(), 'Library', 'LaunchAgents')
  if (platform === 'linux') return join(homedir(), '.config', 'systemd', 'user')
  if (platform === 'win32') return join(process.env.APPDATA ?? homedir(), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  return join(managerDir(), 'services')
}

function serviceLabel(id: string): string {
  return 'com.dsh-manager.' + id
}

function unitFileName(id: string, platform: NodeJS.Platform): string {
  if (platform === 'darwin') return serviceLabel(id) + '.plist'
  if (platform === 'linux') return 'dsh-manager-' + id + '.service'
  return 'dsh-manager-' + id + '.cmd'
}

/** 解析 dsh 可执行文件绝对路径（服务单元必须用绝对路径） */
async function resolveDshExe(): Promise<string | null> {
  const found = await which('dsh')
  if (!found) return null
  const { realpath } = await import('node:fs/promises')
  try {
    return await realpath(found)
  } catch {
    return found
  }
}

function buildUnitContent(config: InstanceConfig, dshPath: string, logPath: string, platform: NodeJS.Platform): string {
  const args = ['--profile', config.profile]
  if (config.port !== undefined && config.port > 0) args.push('--port', String(config.port))
  if (config.extraArgs) args.push(...config.extraArgs)

  if (platform === 'darwin') {
    const envEntries = envXml(config)
    const argEntries = args.map((a) => '    <string>' + xmlEscape(a) + '</string>').join(NL)
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>Label</key><string>' + serviceLabel(config.id) + '</string>',
      '  <key>ProgramArguments</key>',
      '  <array>',
      '    <string>' + xmlEscape(dshPath) + '</string>',
      argEntries,
      '  </array>',
      '  <key>WorkingDirectory</key><string>' + xmlEscape(config.cwd ?? homedir()) + '</string>',
      envEntries,
      '  <key>RunAtLoad</key><true/>',
      '  <key>KeepAlive</key><true/>',
      '  <key>StandardOutPath</key><string>' + xmlEscape(logPath) + '</string>',
      '  <key>StandardErrorPath</key><string>' + xmlEscape(logPath) + '</string>',
      '  <key>ProcessType</key><string>Background</string>',
      '</dict>',
      '</plist>',
      '',
    ].join(NL)
  }

  if (platform === 'linux') {
    const envLines: string[] = []
    if (config.dshHome) envLines.push('Environment=DSH_HOME=' + systemdEscape(config.dshHome))
    for (const [k, v] of Object.entries(config.env ?? {})) {
      envLines.push('Environment=' + k + '=' + systemdEscape(v))
    }
    return [
      '[Unit]',
      'Description=DSH Manager instance ' + config.name + ' (' + config.id + ')',
      'After=network.target',
      '',
      '[Service]',
      'Type=simple',
      'ExecStart=' + dshPath + ' ' + args.map(systemdEscape).join(' '),
      'WorkingDirectory=' + systemdEscape(config.cwd ?? homedir()),
      ...envLines,
      'Restart=always',
      'RestartSec=3',
      'StandardOutput=append:' + logPath,
      'StandardError=append:' + logPath,
      '',
      '[Install]',
      'WantedBy=default.target',
      '',
    ].join(NL)
  }

  // win32：启动文件夹 .cmd
  return [
    '@echo off',
    'start "" /min "' + dshPath + '" --profile ' + config.profile + (config.port ? ' --port ' + config.port : ''),
    '',
  ].join(NL)
}

function envXml(config: InstanceConfig): string {
  const env: Record<string, string> = {}
  if (config.dshHome) env.DSH_HOME = config.dshHome
  for (const [k, v] of Object.entries(config.env ?? {})) env[k] = v
  if (Object.keys(env).length === 0) return ''
  const entries = Object.entries(env)
    .map(([k, v]) => '  <key>' + xmlEscape(k) + '</key><string>' + xmlEscape(v) + '</string>')
    .join(NL)
  return '  <key>EnvironmentVariables</key>' + NL + '  <dict>' + NL + entries + NL + '  </dict>'
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function systemdEscape(text: string): string {
  return text.replace(/["\\ ]/g, (ch) => '\\' + ch)
}

function logPathFor(config: InstanceConfig): string {
  const dir = join(managerDir(), 'logs')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'service-' + config.id + '.log')
}

/** 安装系统服务（写单元文件 + 注册启动） */
export async function installService(config: InstanceConfig, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; message: string; unitPath?: string }> {
  const platform = process.platform as NodeJS.Platform
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    // 支持平台
  } else {
    return { ok: false, message: '不支持平台: ' + platform }
  }
  const dshPath = await resolveDshExe()
  if (!dshPath) return { ok: false, message: '未找到 dsh 可执行文件（服务需要绝对路径）' }

  const root = serviceRoot(platform)
  mkdirSync(root, { recursive: true })
  const unitPath = join(root, unitFileName(config.id, platform))
  const logPath = logPathFor(config)
  const content = buildUnitContent(config, dshPath, logPath, platform)
  writeFileSync(unitPath, content, 'utf8')

  const log: string[] = ['单元文件: ' + unitPath]
  if (platform === 'darwin') {
    const load = await run('launchctl', ['load', '-w', unitPath], { timeoutMs: 30_000, env })
    log.push('launchctl load: exit=' + String(load.code) + (load.stderr ? ' ' + load.stderr.slice(0, 500) : ''))
    return { ok: load.code === 0, message: 'LaunchAgent 已安装' + (load.code === 0 ? '' : '（launchctl 注册失败，文件已写入）'), unitPath }
  }
  if (platform === 'linux') {
    const reload = await run('systemctl', ['--user', 'daemon-reload'], { timeoutMs: 30_000, env })
    const enable = await run('systemctl', ['--user', 'enable', '--now', basename(unitPath)], { timeoutMs: 30_000, env })
    log.push('systemctl daemon-reload: exit=' + String(reload.code))
    log.push('systemctl enable --now: exit=' + String(enable.code) + (enable.stderr ? ' ' + enable.stderr.slice(0, 500) : ''))
    return { ok: enable.code === 0, message: 'systemd 单元已安装' + (enable.code === 0 ? '' : '（注册失败，文件已写入）'), unitPath }
  }
  // win32：启动文件夹即生效
  return { ok: true, message: '启动文件夹快捷方式已创建（下次登录自动启动）', unitPath }
}

/** 卸载系统服务 */
export async function uninstallService(id: string, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; message: string }> {
  const platform = process.platform as NodeJS.Platform
  const root = serviceRoot(platform)
  const unitPath = join(root, unitFileName(id, platform))
  if (platform === 'darwin' && existsSync(unitPath)) {
    await run('launchctl', ['unload', '-w', unitPath], { timeoutMs: 30_000, env })
    rmSync(unitPath, { force: true })
    return { ok: true, message: 'LaunchAgent 已卸载' }
  }
  if (platform === 'linux') {
    const unitName = basename(unitPath)
    await run('systemctl', ['--user', 'disable', '--now', unitName], { timeoutMs: 30_000, env })
    await run('systemctl', ['--user', 'daemon-reload'], { timeoutMs: 30_000, env })
    if (existsSync(unitPath)) rmSync(unitPath, { force: true })
    return { ok: true, message: 'systemd 单元已卸载' }
  }
  if (existsSync(unitPath)) {
    rmSync(unitPath, { force: true })
    return { ok: true, message: '启动项已移除' }
  }
  return { ok: false, message: '服务未安装' }
}

/** 服务状态 */
export async function serviceStatus(config: InstanceConfig, env: NodeJS.ProcessEnv = process.env): Promise<ServiceInfo> {
  const platform = process.platform as NodeJS.Platform
  const root = serviceRoot(platform)
  const unitPath = join(root, unitFileName(config.id, platform))
  const installed = existsSync(unitPath)
  let active: boolean | null = null
  let detail = '未安装'
  if (installed) {
    if (platform === 'darwin') {
      const result = await run('launchctl', ['list'], { timeoutMs: 15_000, env })
      active = result.stdout.includes(serviceLabel(config.id))
      detail = active ? '已注册并运行' : '已安装（未运行）'
    } else if (platform === 'linux') {
      const result = await run('systemctl', ['--user', 'is-active', basename(unitPath)], { timeoutMs: 15_000, env })
      active = result.code === 0
      detail = active ? 'active' : 'inactive / 未运行'
    } else {
      detail = '启动文件夹项（下次登录生效）'
    }
  }
  return { id: config.id, platform: platform as 'darwin' | 'linux' | 'win32', label: serviceLabel(config.id), unitPath, installed, active, detail }
}
