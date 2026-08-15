import { readdir, stat } from 'node:fs/promises'
import { readdirSync, statSync, lstatSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { resolveDshHome } from './detect.ts'
import type { HomeScan, HomeEntry } from './types.ts'

/**
 * DSH_HOME 扫描：目录/文件清单 + 大小统计 + 会话/附件/存储统计。
 * 只读操作，绝不修改任何 dsh 数据。
 */

interface WalkResult {
  bytes: number
  itemCount: number
}

async function walkSize(root: string, opts: { skipDirs?: Set<string> } = {}): Promise<WalkResult> {
  const result: WalkResult = { bytes: 0, itemCount: 0 }
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      if (opts.skipDirs?.has(entry) && existsSync(full)) {
        try {
          if ((await stat(full)).isDirectory()) continue
        } catch {
          /* ignore */
        }
      }
      try {
        const s = await stat(full)
        if (s.isDirectory()) {
          stack.push(full)
        } else {
          result.bytes += s.size
          result.itemCount += 1
        }
      } catch {
        /* 权限/竞态：跳过 */
      }
    }
  }
  return result
}

export async function scanHome(env: NodeJS.ProcessEnv = process.env): Promise<HomeScan> {
  const homePath = resolveDshHome(env)
  const entries: HomeEntry[] = []
  let sessions = { dirs: 0, bytes: 0, logs: 0 }
  let attachmentsBytes = 0
  let storagesBytes = 0
  let totalBytes = 0
  const largest: { path: string; bytes: number }[] = []
  const recent: { path: string; mtimeMs: number }[] = []

  if (!existsSync(homePath)) {
    return { homePath, entries, sessions, profiles: { dirs: 0 }, attachmentsBytes, storagesBytes, totalBytes, largest, recent }
  }

  const topNames = readdirSync(homePath)
  for (const name of topNames.sort()) {
    const full = join(homePath, name)
    let kind: HomeEntry['kind'] = 'other'
    let bytes = 0
    let itemCount = 0
    let note: string | undefined
    try {
      const lst = lstatSync(full)
      if (lst.isSymbolicLink()) kind = 'symlink'
      else if (lst.isDirectory()) {
        kind = 'dir'
        const res = await walkSize(full)
        bytes = res.bytes
        itemCount = res.itemCount
      } else if (lst.isFile()) {
        kind = 'file'
        bytes = lst.size
        itemCount = 1
      }
      if (name === 'sessions') {
        sessions = { dirs: 0, bytes, logs: 0 }
        try {
          for (const ws of readdirSync(full)) {
            const wsFull = join(full, ws)
            if (!statSync(wsFull).isDirectory()) continue
            sessions.dirs += 1
            for (const s of readdirSync(wsFull)) {
              const sFull = join(wsFull, s)
              if (statSync(sFull).isDirectory()) {
                for (const f of readdirSync(sFull)) {
                  if (f.endsWith('.zstd') || f === 'session.jsonl') sessions.logs += 1
                }
              }
            }
          }
        } catch {
          /* ignore */
        }
        note = `${sessions.dirs} 个工作区 / ${sessions.logs} 个会话日志`
      }
      if (name === 'attachments') attachmentsBytes = bytes
      if (name === 'storages') storagesBytes = bytes
      if (name === 'profiles') {
        try {
          note = `${readdirSync(full).filter((e) => statSync(join(full, e)).isDirectory()).length} 个 profile`
        } catch {
          /* ignore */
        }
      }
      totalBytes += bytes
    } catch {
      kind = 'other'
    }
    entries.push({ name, kind, bytes, itemCount, note })
  }

  // 重新精确统计 total（entries 已含全部）
  totalBytes = entries.reduce((acc, e) => acc + (e.kind === 'dir' || e.kind === 'file' ? e.bytes : 0), 0)

  // 最大文件/最近修改（顶层向下 3 层，限制遍历量）
  const walkTop = async (dir: string, depth: number) => {
    if (depth > 3) return
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name === 'node_modules') continue
      const full = join(dir, name)
      try {
        const s = await stat(full)
        if (s.isDirectory()) await walkTop(full, depth + 1)
        else {
          if (largest.length < 10) largest.push({ path: relative(homePath, full), bytes: s.size })
          else {
            largest.sort((a, b) => b.bytes - a.bytes)
            if (s.size > largest[largest.length - 1].bytes) {
              largest[largest.length - 1] = { path: relative(homePath, full), bytes: s.size }
            }
          }
          recent.push({ path: relative(homePath, full), mtimeMs: s.mtimeMs })
        }
      } catch {
        /* ignore */
      }
    }
  }
  await walkTop(homePath, 0)
  largest.sort((a, b) => b.bytes - a.bytes)
  recent.sort((a, b) => b.mtimeMs - a.mtimeMs)

  return {
    homePath,
    entries,
    sessions,
    profiles: { dirs: entries.find((e) => e.name === 'profiles')?.itemCount ?? 0 },
    attachmentsBytes,
    storagesBytes,
    totalBytes,
    largest: largest.slice(0, 8),
    recent: recent.slice(0, 8),
  }
}
