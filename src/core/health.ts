import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { detectEnvironment, isBuiltinBundle } from './detect.ts'
import { readAllProfiles } from './profiles.ts'
import { listBackups } from './backup.ts'
import type { HealthCheck } from './types.ts'

/**
 * 健康检查：只读诊断，输出"状态 + 证据 + 修复提示"。
 * 修复动作由管理器 UI 在用户确认后调用（见 index.ts 的 repair 面）。
 */

function parseYamlOrNull(content: string): { ok: boolean; error?: string } {
  try {
    load(content)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

function modeOf(path: string): number | null {
  try {
    return statSync(path).mode & 0o777
  } catch {
    return null
  }
}

/** 检查文件权限位（POSIX；Windows 跳过） */
function permissionOk(path: string, expected: number): boolean | null {
  if (process.platform === 'win32') return null
  const mode = modeOf(path)
  if (mode === null) return null
  // 只看是否比预期更宽松（组/其他位）
  return (mode & 0o077) <= (expected & 0o077)
}

export async function runHealthChecks(env: NodeJS.ProcessEnv = process.env): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = []
  const envSnap = await detectEnvironment(env)
  const home = envSnap.home.path

  const push = (check: HealthCheck) => checks.push(check)

  // ── A. 运行时环境 ──────────────────────────────────────────────
  push({
    id: 'node-version',
    group: '运行时环境',
    title: 'Node.js 版本',
    status: envSnap.node.ok ? 'ok' : 'error',
    detail: envSnap.node.version
      ? `${envSnap.node.version}（要求 ${envSnap.node.required}）`
      : '未检测到 node',
    fixHint: envSnap.node.ok ? undefined : '安装 Node 22.19+ 或 24+（dsh 官方要求）',
  })
  push({
    id: 'pnpm-available',
    group: '运行时环境',
    title: 'pnpm 可用性',
    status: envSnap.pnpm.ok ? 'ok' : 'error',
    detail: envSnap.pnpm.version ? `pnpm ${envSnap.pnpm.version}` : '未检测到 pnpm（插件管理必需）',
    fixHint: envSnap.pnpm.ok ? undefined : '安装 pnpm（corepack enable 或 npm i -g pnpm）',
  })
  push({
    id: 'dsh-available',
    group: '运行时环境',
    title: 'dsh 安装',
    status: envSnap.dsh.found ? 'ok' : 'error',
    detail: envSnap.dsh.found
      ? `${envSnap.dsh.form}，版本 ${envSnap.dsh.version ?? '未知'}${envSnap.dsh.path ? ' @ ' + envSnap.dsh.path : ''}`
      : '未找到 dsh 命令',
    fixHint: envSnap.dsh.found ? undefined : 'npx @deepseek-ai/dsh web（或安装到 PATH）',
  })
  push({
    id: 'disk-space',
    group: '运行时环境',
    title: '磁盘空间',
    status: 'info',
    detail: `DSH_HOME 位于 ${envSnap.home.display}（${existsSync(home) ? '存在' : '不存在'}）`,
  })

  // ── B. Harness Home 完整性 ─────────────────────────────────────
  push({
    id: 'home-exists',
    group: 'Harness Home',
    title: 'DSH_HOME 存在',
    status: envSnap.home.exists ? 'ok' : 'warn',
    detail: envSnap.home.exists ? envSnap.home.display : `${envSnap.home.display} 尚未初始化`,
    fixHint: envSnap.home.exists ? undefined : '首次运行 dsh（如 dsh web --dump-config）会自动初始化模板',
  })
  push({
    id: 'home-writable',
    group: 'Harness Home',
    title: 'DSH_HOME 可写',
    status: envSnap.home.writable ? 'ok' : 'error',
    detail: envSnap.home.writable ? '可写' : '不可写（会话日志/设置无法落盘）',
    fixHint: envSnap.home.writable ? undefined : '检查目录所有权与权限',
  })
  if (existsSync(home)) {
    const credMode = permissionOk(join(home, '.credentials.yaml'), 0o600)
    push({
      id: 'credentials-permissions',
      group: 'Harness Home',
      title: '.credentials.yaml 权限',
      status: credMode === null ? 'skip' : credMode ? 'ok' : 'error',
      detail: credMode === null ? 'Windows 平台跳过权限位检查' : `当前 ${modeOf(join(home, '.credentials.yaml'))?.toString(8)}，应为 600`,
      fixHint: credMode === false ? 'chmod 600 ~/.dsh/.credentials.yaml（管理器可代执行）' : undefined,
      repair: credMode === false ? { action: 'fix-permissions' } : undefined,
    })
    const settingsPath = join(home, 'settings.yaml')
    if (existsSync(settingsPath)) {
      const parsed = parseYamlOrNull(readFileSync(settingsPath, 'utf8'))
      push({
        id: 'settings-yaml',
        group: 'Harness Home',
        title: 'settings.yaml 可解析',
        status: parsed.ok ? 'ok' : 'error',
        detail: parsed.ok ? 'YAML 正常' : `解析失败：${parsed.error}`,
        fixHint: parsed.ok ? undefined : '用最近备份还原或修复 YAML',
        repair: parsed.ok ? undefined : { action: 'restore-yaml-from-bak', payload: { path: settingsPath } },
      })
    }
    for (const patch of ['cordis.patch.yml', join('profiles', 'web', 'cordis.patch.yml')]) {
      const p = join(home, patch)
      if (existsSync(p)) {
        const parsed = parseYamlOrNull(readFileSync(p, 'utf8'))
        push({
          id: `patch-${patch.replace(/[\\/.]/g, '-')}`,
          group: 'Harness Home',
          title: `补丁可解析：${patch}`,
          status: parsed.ok ? 'ok' : 'error',
          detail: parsed.ok ? 'YAML 正常' : `解析失败：${parsed.error}`,
          fixHint: parsed.ok ? undefined : '检查 !!js 表达式与缩进；或用 .bak-* 还原',
          repair: parsed.ok ? undefined : { action: 'restore-yaml-from-bak', payload: { path: p } },
        })
      }
    }
  }

  // ── C. profile 一致性 ──────────────────────────────────────────
  const profiles = readAllProfiles(env)
  for (const profile of profiles) {
    const missing = profile.bundles.filter(
      (b) => !isBuiltinBundle(b) && !profile.plugins.some((p) => p.name === b && p.installed),
    )
    push({
      id: `profile-${profile.name}-bundles`,
      group: 'Profile',
      title: `profile ${profile.name}：bundle 一致性`,
      status: missing.length === 0 ? (profile.exists ? 'ok' : 'warn') : 'error',
      detail: missing.length > 0
        ? `bundle 声明但未安装：${missing.join(', ')}`
        : profile.exists
          ? `${profile.bundles.length} 个 bundle，依赖声明齐全`
          : 'profile 目录缺失',
      fixHint: missing.length > 0 ? `在 ${profile.dir} 执行 pnpm install（管理器可代执行）` : undefined,
      repair: missing.length > 0 ? { action: 'pnpm-install-profile', payload: { profile: profile.name } } : undefined,
    })
  }
  if (profiles.length === 0) {
    push({
      id: 'profiles-none',
      group: 'Profile',
      title: 'profile 数量',
      status: 'info',
      detail: '尚未初始化任何 profile（运行 dsh web 自动创建 web profile）',
    })
  }

  // ── D. 运行态 ──────────────────────────────────────────────────
  push({
    id: 'web-instance',
    group: '运行态',
    title: 'Web 实例（端口 3080）',
    status: envSnap.runningWeb?.listening ? 'info' : 'ok',
    detail: envSnap.runningWeb?.listening
      ? '检测到 http://127.0.0.1:3080 正在监听（dsh web 或其它服务）'
      : '当前无实例监听 3080',
    fixHint: envSnap.runningWeb?.listening ? '若占用者不是 dsh，请排查端口冲突' : undefined,
  })

  // ── E. 数据文件 ────────────────────────────────────────────────
  const sessionsRoot = join(home, 'sessions')
  if (existsSync(sessionsRoot)) {
    let logs = 0
    let bytes = 0
    const walk = (dir: string, depth: number) => {
      if (depth > 3) return
      for (const name of readdirSafe(dir)) {
        const full = join(dir, name)
        try {
          const s = statSync(full)
          if (s.isDirectory()) walk(full, depth + 1)
          else if (name.endsWith('.zstd') || name === 'session.jsonl') {
            logs += 1
            bytes += s.size
          }
        } catch {
          /* ignore */
        }
      }
    }
    walk(sessionsRoot, 0)
    push({
      id: 'sessions-overview',
      group: '数据文件',
      title: '会话日志',
      status: logs === 0 ? 'info' : 'ok',
      detail: `${logs} 个日志，共 ${(bytes / 1024 / 1024).toFixed(1)} MB`,
      fixHint: bytes > 5 * 1024 * 1024 * 1024 ? '会话日志超过 5GB，建议归档旧会话' : undefined,
    })
  }

  // ── F. 管理器自身 ──────────────────────────────────────────────
  const backups = listBackups()
  push({
    id: 'manager-backups',
    group: '管理器',
    title: '最近备份',
    status: backups.length > 0 ? 'ok' : 'warn',
    detail: backups.length > 0
      ? `最近备份：${new Date(backups[0].manifest?.createdAt ?? backups[0].dir).toLocaleString()}`
      : '尚未执行过备份（建议首次使用前备份一次）',
    fixHint: backups.length === 0 ? '前往"备份"页创建第一个备份' : undefined,
  })

  return checks
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
