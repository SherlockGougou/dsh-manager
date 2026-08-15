import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { managerDir } from './manager-config.ts'
import type { MarketplaceEntry, MarketplaceSearch } from './types.ts'

/**
 * 插件市场：双渠道检索 dsh 插件。
 *  - GitHub：官方推荐发现渠道（topic:dsh-plugin）
 *  - npm：keywords 含 dsh-plugin 的包（含 dsh.bundle.patch 元数据富化）
 * GitHub API 匿名限额 60 次/小时 → 结果缓存到管理器目录（TTL 10 分钟）。
 */

const GITHUB_SEARCH = 'https://api.github.com/search/repositories'
const NPM_SEARCH = 'https://registry.npmjs.org/-/v1/search'
const CACHE_TTL_MS = 10 * 60 * 1000

function cacheFile(channel: 'github' | 'npm'): string {
  return join(managerDir(), 'cache', 'marketplace-' + channel + '.json')
}

function readCache<T>(channel: 'github' | 'npm'): { data: T; fetchedAt: string } | null {
  const file = cacheFile(channel)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { data: T; fetchedAt: string }
    if (Date.now() - new Date(parsed.fetchedAt).getTime() > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache<T>(channel: 'github' | 'npm', data: T): void {
  try {
    mkdirSync(join(managerDir(), 'cache'), { recursive: true })
    writeFileSync(cacheFile(channel), JSON.stringify({ data, fetchedAt: new Date().toISOString() }), 'utf8')
  } catch {
    /* ignore */
  }
}

async function fetchJson(url: string, headers: Record<string, string> = {}, timeoutMs = 15_000): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json', ...headers },
  })
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url)
  return res.json() as Promise<unknown>
}

/** GitHub topic:dsh-plugin 检索 */
async function searchGithub(): Promise<MarketplaceEntry[]> {
  const cache = readCache<MarketplaceEntry[]>('github')
  if (cache) return cache.data
  const doc = (await fetchJson(
    GITHUB_SEARCH + '?q=topic:dsh-plugin&sort=updated&order=desc&per_page=30',
    { 'User-Agent': 'dsh-manager' },
  )) as {
    items?: {
      full_name?: string
      description?: string | null
      html_url?: string
      stargazers_count?: number
      updated_at?: string
      topics?: string[]
    }[]
  }
  const entries: MarketplaceEntry[] = (doc.items ?? [])
    .filter((item) => typeof item.full_name === 'string')
    .map((item) => ({
      source: 'github' as const,
      name: item.full_name!,
      description: item.description ?? null,
      url: item.html_url ?? 'https://github.com/' + item.full_name,
      stars: item.stargazers_count ?? 0,
      updatedAt: item.updated_at ?? null,
      version: null,
      dshBundlePatch: false,
      topics: item.topics ?? [],
      installSpec: 'github:' + item.full_name,
    }))
  writeCache('github', entries)
  return entries
}

/** npm 关键字检索（并富化前 12 个包的 dsh 元数据） */
async function searchNpm(): Promise<MarketplaceEntry[]> {
  const cache = readCache<MarketplaceEntry[]>('npm')
  if (cache) return cache.data
  const doc = (await fetchJson(NPM_SEARCH + '?text=keywords:dsh-plugin&size=30')) as {
    objects?: {
      package?: {
        name?: string
        version?: string
        description?: string
        date?: string
        links?: { npm?: string; homepage?: string; repository?: string }
      }
    }[]
  }
  const raw = (doc.objects ?? [])
    .filter((o) => typeof o.package?.name === 'string')
    .map((o) => ({
      name: o.package!.name as string,
      version: o.package!.version ?? null,
      description: o.package!.description ?? null,
      date: o.package!.date ?? null,
      links: o.package!.links ?? {},
    }))
  // 富化前 12 个：读 npm 文档取 dsh.bundle.patch
  const enriched = new Set<string>()
  const queue = raw.slice(0, 12)
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const item = queue.shift()
      if (!item) return
      try {
        const doc2 = (await fetchJson('https://registry.npmjs.org/' + encodeURIComponent(item.name).replace(/%2F/g, '/'), undefined, 8000)) as {
          dsh?: { bundle?: { patch?: string } }
          'dist-tags'?: Record<string, string>
        }
        if (doc2.dsh?.bundle?.patch || (doc2['dist-tags']?.latest && doc2['dist-tags'].latest !== item.version)) {
          enriched.add(item.name)
        }
      } catch {
        /* 单个包富化失败不影响整体 */
      }
    }
  })
  await Promise.all(workers)

  const entries: MarketplaceEntry[] = raw.map((item) => ({
    source: 'npm' as const,
    name: item.name,
    description: item.description,
    url: item.links.repository ?? item.links.homepage ?? item.links.npm ?? 'https://www.npmjs.com/package/' + item.name,
    stars: undefined,
    updatedAt: item.date,
    version: item.version,
    dshBundlePatch: enriched.has(item.name),
    topics: undefined,
    installSpec: item.name,
  }))
  writeCache('npm', entries)
  return entries
}

/** 合并检索（GitHub 失败不阻断 npm，反之亦然；结果缓存 10 分钟） */
export async function searchMarketplace(opts: { refresh?: boolean } = {}): Promise<MarketplaceSearch> {
  const errors: string[] = []
  let fromCache = false
  if (opts.refresh) {
    for (const channel of ['github', 'npm'] as const) {
      try {
        rmSync(cacheFile(channel), { force: true })
      } catch {
        /* ignore */
      }
    }
  }
  const [githubEntries, npmEntries] = await Promise.all([
    (async () => {
      const cache = readCache<MarketplaceEntry[]>('github')
      if (cache && !opts.refresh) {
        fromCache = true
        return cache.data
      }
      try {
        return await searchGithub()
      } catch (error) {
        errors.push('GitHub: ' + String(error))
        return cache?.data ?? []
      }
    })(),
    (async () => {
      const cache = readCache<MarketplaceEntry[]>('npm')
      if (cache && !opts.refresh) {
        fromCache = true
        return cache.data
      }
      try {
        return await searchNpm()
      } catch (error) {
        errors.push('npm: ' + String(error))
        return cache?.data ?? []
      }
    })(),
  ])
  return {
    entries: dedupe([...githubEntries, ...npmEntries]),
    cached: fromCache,
    fetchedAt: new Date().toISOString(),
    errors,
  }
}

function dedupe(entries: MarketplaceEntry[]): MarketplaceEntry[] {
  const seen = new Set<string>()
  const out: MarketplaceEntry[] = []
  for (const entry of entries) {
    if (seen.has(entry.name)) continue
    seen.add(entry.name)
    out.push(entry)
  }
  return out
}
