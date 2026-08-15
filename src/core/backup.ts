import { cp, mkdir, readdir, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { resolveDshHome } from './detect.ts'
import { backupsDir, ensureManagerDir, managerDir } from './manager-config.ts'
import { detectEnvironment } from './detect.ts'
import type { BackupManifest, BackupMeta, BackupOptions, EffectiveBackupOptions, RestorePreview, RestoreResult } from './types.ts'

/**
 * 备份与恢复。
 * 默认排除：node_modules（可由 package.json+lock 重建）、.credentials.yaml/.env（凭据）、
 * cache（可再生成）、.DS_Store。排除策略与清单记录在 manifest.json。
 */

const ALWAYS_EXCLUDE = ['.DS_Store']

function exclusionList(opts: EffectiveBackupOptions): string[] {
  const list = [...ALWAYS_EXCLUDE]
  if (!opts.includeNodeModules) list.push('node_modules')
  if (!opts.includeCredentials) list.push('.credentials.yaml', '.env')
  if (!opts.includeCache) list.push('cache')
  return list
}

function isExcluded(rel: string, exclusions: string[]): boolean {
  const parts = rel.split(sep)
  return parts.some((part) => exclusions.includes(part))
}

export async function backupHome(
  opts: BackupOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ dir: string; manifest: BackupManifest }> {
  ensureManagerDir()
  const home = resolveDshHome(env)
  const options: EffectiveBackupOptions = {
    includeCredentials: opts.includeCredentials ?? false,
    includeNodeModules: opts.includeNodeModules ?? false,
    includeCache: opts.includeCache ?? false,
    note: opts.note,
  }
  const exclusions = exclusionList(options)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(backupsDir(), `${timestamp}-dsh-home`)
  await mkdir(dir, { recursive: true })

  let files = 0
  let bytes = 0
  await cp(home, dir, {
    recursive: true,
    filter: (src) => {
      const rel = relative(home, src)
      if (rel === '') return true
      if (isExcluded(rel, exclusions)) return false
      return true
    },
  })
  // 统计备份内容
  const walk = async (d: string) => {
    let names: string[]
    try {
      names = await readdir(d)
    } catch {
      return
    }
    for (const name of names) {
      const full = join(d, name)
      const s = await stat(full)
      if (s.isDirectory()) await walk(full)
      else {
        files += 1
        bytes += s.size
      }
    }
  }
  await walk(dir)

  const envSnap = await detectEnvironment(env)
  const manifest: BackupManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    dshVersion: envSnap.dsh.version,
    homePath: home,
    source: 'dsh-manager',
    files,
    bytes,
    excluded: exclusions,
    options,
    note: options.note,
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { dir, manifest }
}

/** 列出已有备份（按时间倒序） */
export function listBackups(): BackupMeta[] {
  const root = backupsDir()
  if (!existsSync(root)) return []
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  const metas: BackupMeta[] = []
  for (const name of names) {
    const dir = join(root, name)
    let manifest: BackupManifest | null = null
    try {
      const raw = readFileSync(join(dir, 'manifest.json'), 'utf8')
      manifest = JSON.parse(raw) as BackupManifest
    } catch {
      manifest = null
    }
    metas.push({ dir, manifest, exists: true })
  }
  metas.sort((a, b) => {
    const ta = a.manifest?.createdAt ?? a.dir
    const tb = b.manifest?.createdAt ?? b.dir
    return tb.localeCompare(ta)
  })
  return metas
}

/** 恢复预览：备份 vs 现状差异（dry-run） */
export async function restorePreview(
  backupDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RestorePreview> {
  const home = resolveDshHome(env)
  const toAdd: string[] = []
  const toOverwrite: string[] = []
  const unchanged: string[] = []
  const exclusions: string[] = []
  try {
    const manifestRaw = await readFile(join(backupDir, 'manifest.json'), 'utf8')
    const manifest = JSON.parse(manifestRaw) as BackupManifest
    exclusions.push(...manifest.excluded)
  } catch {
    /* 无 manifest 也允许预览 */
  }
  const walk = async (d: string, prefix: string) => {
    let names: string[]
    try {
      names = await readdir(d)
    } catch {
      return
    }
    for (const name of names) {
      if (name === 'manifest.json') continue
      const full = join(d, name)
      const rel = prefix ? `${prefix}${sep}${name}` : name
      if (isExcluded(rel, exclusions)) continue
      const s = await stat(full)
      const target = join(home, rel)
      if (s.isDirectory()) {
        await walk(full, rel)
      } else {
        if (!existsSync(target)) toAdd.push(rel)
        else {
          try {
            const ts = await stat(target)
            if (ts.size === s.size) unchanged.push(rel)
            else toOverwrite.push(rel)
          } catch {
            toOverwrite.push(rel)
          }
        }
      }
    }
  }
  await walk(backupDir, '')
  const current = await collectCurrent(home, exclusions)
  const toDelete = current.filter((rel) => !existsSync(join(backupDir, rel)))
  return { backupDir, toAdd, toOverwrite, toDelete, unchanged: unchanged.length, total: toAdd.length + toOverwrite.length + unchanged.length }
}

async function collectCurrent(home: string, exclusions: string[]): Promise<string[]> {
  const result: string[] = []
  const walk = async (d: string, prefix: string) => {
    let names: string[]
    try {
      names = await readdir(d)
    } catch {
      return
    }
    for (const name of names) {
      const rel = prefix ? `${prefix}${sep}${name}` : name
      if (isExcluded(rel, exclusions)) continue
      const full = join(d, name)
      const s = await stat(full)
      if (s.isDirectory()) await walk(full, rel)
      else result.push(rel)
    }
  }
  await walk(home, '')
  return result
}

/** 执行恢复（默认 dry-run=false；恢复前自动把现状移入 trash 目录而非直接删除） */
export async function restoreBackup(
  backupDir: string,
  opts: { dryRun?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<RestoreResult> {
  if (opts.dryRun) {
    const preview = await restorePreview(backupDir, env)
    return {
      ok: true,
      added: preview.toAdd.length,
      overwritten: preview.toOverwrite.length,
      deleted: preview.toDelete.length,
      errors: [],
    }
  }
  const home = resolveDshHome(env)
  const errors: string[] = []
  let added = 0
  let overwritten = 0
  let deleted = 0
  // 1. 现状快照（覆盖前先备份被覆盖文件，删除前移到 trash）
  const trashDir = join(managerDir(), 'restore-trash', Date.now().toString())
  await mkdir(trashDir, { recursive: true })
  const preview = await restorePreview(backupDir, env)
  for (const rel of preview.toOverwrite) {
    try {
      await cp(join(home, rel), join(trashDir, rel), { recursive: true })
      overwritten += 1
    } catch (error) {
      errors.push(`backup current ${rel}: ${String(error)}`)
    }
  }
  for (const rel of preview.toDelete) {
    try {
      await cp(join(home, rel), join(trashDir, rel), { recursive: true })
      await rm(join(home, rel), { recursive: true, force: true })
      deleted += 1
    } catch (error) {
      errors.push(`remove ${rel}: ${String(error)}`)
    }
  }
  // 2. 复制备份内容
  const walkCopy = async (d: string, prefix: string) => {
    let names: string[]
    try {
      names = await readdir(d)
    } catch {
      return
    }
    for (const name of names) {
      if (name === 'manifest.json') continue
      const full = join(d, name)
      const rel = prefix ? `${prefix}${sep}${name}` : name
      const target = join(home, rel)
      const s = await stat(full)
      if (s.isDirectory()) {
        await mkdir(target, { recursive: true })
        await walkCopy(full, rel)
      } else {
        try {
          await mkdir(join(home, rel.split(sep).slice(0, -1).join(sep)), { recursive: true })
          await cp(full, target)
          added += 1
        } catch (error) {
          errors.push(`restore ${rel}: ${String(error)}`)
        }
      }
    }
  }
  await walkCopy(backupDir, '')
  return { ok: errors.length === 0, added, overwritten, deleted, errors }
}

/** 按保留策略清理旧备份（返回被删除的目录） */
export async function pruneBackups(retention: number): Promise<string[]> {
  const metas = listBackups()
  const removed: string[] = []
  for (const meta of metas.slice(retention)) {
    try {
      await rm(meta.dir, { recursive: true, force: true })
      removed.push(meta.dir)
    } catch {
      /* ignore */
    }
  }
  return removed
}
