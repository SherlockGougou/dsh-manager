import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, copyFileSync, rmSync, chmodSync, truncateSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { load } from 'js-yaml'
import { resolveDshHome } from './detect.ts'
import { truncatePoint } from './zstd.ts'
import { run } from './exec.ts'
import { managerDir } from './manager-config.ts'
import type { RepairAction, RepairResult } from './types.ts'

/**
 * 修复动作库：每个动作 = 诊断 → 确认 → 备份 → 执行 → 报告。
 * 所有破坏性操作先备份到 <managerDir>/repair-backups/<ts>/。
 */

export const REPAIR_ACTIONS: RepairAction[] = [
  {
    id: 'fix-permissions',
    title: '修复文件权限位',
    group: 'Harness Home',
    description: '将 .credentials.yaml 收紧为 600、DSH_HOME 与 sessions 收紧为 700（仅 POSIX）。',
    params: [],
    destructive: false,
  },
  {
    id: 'restore-yaml-from-bak',
    title: '从 .bak 还原 YAML',
    group: 'Harness Home',
    description: '配置文件（settings.yaml / cordis.patch.yml 等）损坏时，用最近的自动备份还原。当前文件先备份到修复备份区。',
    params: [{ key: 'path', label: '目标文件路径', required: true }],
    destructive: true,
  },
  {
    id: 'pnpm-install-profile',
    title: '重装 profile 依赖',
    group: 'Profile',
    description: '在 profile 目录执行 pnpm install，修复 node_modules 缺失 / symlink 损坏 / bundle 未安装。',
    params: [{ key: 'profile', label: 'profile 名', required: true }],
    destructive: false,
  },
  {
    id: 'repair-session-log',
    title: '修复会话日志（截断）',
    group: '数据文件',
    description: 'torn/corrupt 的 session.jsonl.zstd 截断到最后一个完整 zstd 帧（复用 dsh 自身恢复语义）。原文件先整体备份。',
    params: [{ key: 'path', label: '日志文件路径', required: true }],
    destructive: true,
  },
  {
    id: 'clean-cache',
    title: '清理缓存与旧备份',
    group: 'Harness Home',
    description: '清空 DSH_HOME/cache，删除多余 .bak-*（保留最近 3 份）。删除前移入修复备份区。',
    params: [],
    destructive: true,
  },
  {
    id: 'add-allowbuilds',
    title: '插件 allowBuilds 白名单',
    group: 'Profile',
    description: 'pnpm>=10 拦截插件构建脚本时，把包加入 profile 的 pnpm-workspace.yaml allowBuilds（dsh 官方指引）。',
    params: [
      { key: 'profile', label: 'profile 名', required: true },
      { key: 'package', label: '包名', required: true },
    ],
    destructive: false,
  },
]

function backupToRepairArea(sourcePath: string, reason: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destDir = join(managerDir(), 'repair-backups', stamp)
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, basename(sourcePath) + '.' + reason)
  if (existsSync(sourcePath)) copyFileSync(sourcePath, dest)
  return dest
}

export function repairActions(): RepairAction[] {
  return REPAIR_ACTIONS
}

export async function executeRepair(
  actionId: string,
  payload: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<RepairResult> {
  const log: string[] = []
  const backups: string[] = []
  const touched: string[] = []
  const fail = (message: string): RepairResult => ({ ok: false, message, log, backups, touched })

  switch (actionId) {
    case 'fix-permissions': {
      if (process.platform === 'win32') return fail('Windows 平台无需 POSIX 权限位修复')
      const home = resolveDshHome(env)
      const targets: [string, number][] = [
        [home, 0o700],
        [join(home, 'sessions'), 0o700],
        [join(home, '.credentials.yaml'), 0o600],
      ]
      let fixed = 0
      let failed = 0
      for (const [path, mode] of targets) {
        if (!existsSync(path)) continue
        const current = statSync(path).mode & 0o777
        // 只收紧不放开
        const next = current & mode
        if (current !== next) {
          try {
            chmodSync(path, next)
            log.push('chmod ' + next.toString(8) + ' ' + path + '（原 ' + current.toString(8) + '）')
            touched.push(path)
            fixed += 1
          } catch (error) {
            log.push('chmod 失败: ' + path + ' ' + String(error))
            failed += 1
          }
        } else {
          log.push('无需修改: ' + path)
        }
      }
      if (failed > 0) return { ok: false, message: fixed + ' 个已收紧，' + failed + ' 个失败（可能无权限，可手动 chmod）', log, backups, touched }
      return { ok: true, message: fixed + ' 个文件已收紧权限', log, backups, touched }
    }

    case 'restore-yaml-from-bak': {
      const path = String(payload.path ?? '')
      if (!path) return fail('缺少 path 参数')
      if (!existsSync(path)) return fail('文件不存在: ' + path)
      const dir = dirname(path)
      const base = basename(path)
      const baks = readdirSync(dir)
        .filter((name) => name.startsWith(base + '.bak-'))
        .sort()
        .reverse()
      if (baks.length === 0) return fail('未找到备份文件（' + base + '.bak-*）')
      const bakPath = join(dir, baks[0])
      const saved = backupToRepairArea(path, 'before-restore')
      backups.push(saved)
      const content = readFileSync(bakPath, 'utf8')
      writeFileSync(path, content, 'utf8')
      touched.push(path)
      log.push('从 ' + bakPath + ' 还原（' + content.length + ' 字符）')
      log.push('还原前副本: ' + saved)
      return { ok: true, message: '已用 ' + basename(bakPath) + ' 还原', log, backups, touched }
    }

    case 'pnpm-install-profile': {
      const profile = String(payload.profile ?? '')
      if (!profile) return fail('缺少 profile 参数')
      const home = resolveDshHome(env)
      const profileDir = join(home, 'profiles', profile)
      if (!existsSync(join(profileDir, 'package.json'))) return fail('profile 目录不存在: ' + profileDir)
      log.push('pnpm install @ ' + profileDir)
      const result = await run('pnpm', ['install'], { cwd: profileDir, timeoutMs: 300_000, env })
      log.push('exit=' + String(result.code))
      if (result.stdout) log.push(result.stdout.slice(0, 2000))
      if (result.stderr) log.push('[stderr] ' + result.stderr.slice(0, 2000))
      touched.push(profileDir)
      return result.code === 0
        ? { ok: true, message: 'pnpm install 成功', log, backups, touched }
        : { ok: false, message: 'pnpm install 失败（exit=' + String(result.code) + '）', log, backups, touched }
    }

    case 'repair-session-log': {
      const path = String(payload.path ?? '')
      if (!path) return fail('缺少 path 参数')
      if (!existsSync(path)) return fail('文件不存在: ' + path)
      const buffer = readFileSync(path)
      const { keepBytes, frames, corruptOffset } = truncatePoint(buffer)
      if (frames === 0) return fail('无完整帧可保留（文件头部已损坏）')
      const total = buffer.length
      if (keepBytes === total) {
        return { ok: true, message: '无需修复：' + frames + ' 帧全部完整（' + total + ' 字节）', log, backups, touched }
      }
      const saved = backupToRepairArea(path, 'before-truncate')
      backups.push(saved)
      truncateSync(path, keepBytes)
      touched.push(path)
      const dropped = total - keepBytes
      log.push('完整帧: ' + frames + ' 个')
      log.push('截断: ' + total + ' → ' + keepBytes + ' 字节（丢弃 ' + dropped + ' 字节' + (corruptOffset !== null ? '，损坏点 @ ' + corruptOffset : '，尾部未完成帧') + '）')
      log.push('原文件备份: ' + saved)
      return { ok: true, message: '已截断到最后一个完整帧（保留 ' + keepBytes + ' 字节）', log, backups, touched }
    }

    case 'clean-cache': {
      const home = resolveDshHome(env)
      let removed = 0
      let freed = 0
      const cacheDir = join(home, 'cache')
      if (existsSync(cacheDir)) {
        try {
          const saved = backupToRepairArea(cacheDir, 'cache')
          backups.push(saved)
          rmSync(cacheDir, { recursive: true, force: true })
          touched.push(cacheDir)
          removed += 1
          log.push('已清空 ' + cacheDir + '（备份: ' + saved + '）')
        } catch (error) {
          log.push('清空失败: ' + String(error))
        }
      }
      // 旧 .bak-*（保留最近 3 份）
      for (const name of readdirSync(home)) {
        if (!name.includes('.bak-')) continue
        const full = join(home, name)
        const baks = readdirSync(home).filter((n) => n.includes('.bak-')).sort().reverse()
        const keep = baks.slice(0, 3)
        if (!keep.includes(name)) {
          const size = statSync(full).size
          freed += size
          rmSync(full, { force: true })
          touched.push(full)
          removed += 1
        }
      }
      return {
        ok: true,
        message: '清理完成：' + removed + ' 项，释放约 ' + (freed / 1024).toFixed(0) + 'KB（缓存目录已移入备份区）',
        log,
        backups,
        touched,
      }
    }

    case 'add-allowbuilds': {
      const profile = String(payload.profile ?? '')
      const pkg = String(payload.package ?? '')
      if (!profile || !pkg) return fail('缺少 profile 或 package 参数')
      const home = resolveDshHome(env)
      const profileDir = join(home, 'profiles', profile)
      if (!existsSync(profileDir)) return fail('profile 目录不存在: ' + profileDir)
      const wsFile = join(profileDir, 'pnpm-workspace.yaml')
      let doc: Record<string, unknown>
      const before = existsSync(wsFile) ? readFileSync(wsFile, 'utf8') : ''
      try {
        doc = before.trim() ? (load(before) as Record<string, unknown>) : {}
      } catch (error) {
        return fail('pnpm-workspace.yaml 解析失败: ' + String(error))
      }
      if (!doc || typeof doc !== 'object') return fail('pnpm-workspace.yaml 结构异常')
      const allowBuilds = (doc.allowBuilds ?? {}) as Record<string, unknown>
      if (allowBuilds[pkg] === true) return { ok: true, message: pkg + ' 已在 allowBuilds 中', log, backups, touched }
      allowBuilds[pkg] = true
      doc.allowBuilds = allowBuilds
      const { dump } = await import('js-yaml')
      const after = dump(doc, { noRefs: true })
      if (before.trim().length > 0) {
        const saved = backupToRepairArea(wsFile, 'before-allowbuilds')
        backups.push(saved)
      }
      mkdirSync(profileDir, { recursive: true })
      writeFileSync(wsFile, after, 'utf8')
      touched.push(wsFile)
      log.push('已加入 allowBuilds: ' + pkg)
      log.push('文件: ' + wsFile)
      return { ok: true, message: pkg + ' 已加入 allowBuilds（重新执行插件 add 即可）', log, backups, touched }
    }

    default:
      return fail('未知修复动作: ' + actionId)
  }
}

