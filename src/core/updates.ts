import { normalizeVersion, compareVersions } from './detect.ts'
import type { UpdateChannel, UpdateReport } from './types.ts'

/**
 * 更新检查：直连 registry API（不依赖 npm CLI 缓存——本机实测 npm 缓存损坏
 * 会导致 EPERM，因此走 HTTP）。
 */

const NPM_REGISTRY = 'https://registry.npmjs.org'
const PYPI_JSON = 'https://pypi.org/pypi'

async function fetchJson(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    headers: { accept: 'application/json', ...(opts.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json() as Promise<unknown>
}

export interface NpmPackageInfo {
  distTags: Record<string, string>
  time: Record<string, string>
}

/** 查询 npm 包完整信息（dist-tags + time） */
export async function fetchNpmPackage(name: string): Promise<NpmPackageInfo> {
  const encoded = name.replace('/', '%2F')
  const doc = (await fetchJson(`${NPM_REGISTRY}/${encoded}`)) as {
    'dist-tags'?: Record<string, string>
    time?: Record<string, string>
  }
  return { distTags: doc['dist-tags'] ?? {}, time: doc.time ?? {} }
}

/** 查询 npm 包 latest 版本 */
export async function fetchNpmLatest(name: string): Promise<{ version: string; time: string | null }> {
  const info = await fetchNpmPackage(name)
  const latest = info.distTags.latest
  const time = latest ? info.time[latest] ?? null : null
  return { version: latest ?? 'unknown', time }
}

/** 查询 PyPI 包最新版本 */
export async function fetchPypiLatest(name: string): Promise<{ version: string; time: string | null }> {
  const doc = (await fetchJson(`${PYPI_JSON}/${name}/json`)) as {
    info?: { version?: string }
    releases?: Record<string, unknown[]>
  }
  const version = doc.info?.version ?? 'unknown'
  const release = doc.releases?.[version]
  const uploadTime = Array.isArray(release) && release.length > 0
    ? (release[0] as { upload_time?: string }).upload_time ?? null
    : null
  return { version: normalizeVersion(version) ?? version, time: uploadTime }
}

function channelState(local: string | null, latest: string | null): UpdateChannel['state'] {
  if (!latest) return 'error'
  if (!local) return 'unknown'
  const cmp = compareVersions(local, latest)
  return cmp >= 0 ? 'up-to-date' : 'outdated'
}

export interface LocalVersions {
  dsh: string | null
  pythonSdk: string | null
}

/** 主程序与 SDK 更新检查 */
export async function checkUpdates(
  local: LocalVersions,
): Promise<UpdateReport> {
  const checkedAt = new Date().toISOString()
  const channels: UpdateChannel[] = []

  try {
    const npm = await fetchNpmPackage('@deepseek-ai/dsh')
    const latest = npm.distTags.latest ?? null
    const next = npm.distTags.next ?? null
    channels.push({
      id: 'npm',
      name: '@deepseek-ai/dsh (npm)',
      url: 'https://www.npmjs.com/package/@deepseek-ai/dsh',
      local: local.dsh,
      latest: latest ?? next,
      publishedAt: latest ? npm.time[latest] ?? null : null,
      state: channelState(local.dsh, latest ?? next),
    })
  } catch (error) {
    channels.push({
      id: 'npm', name: '@deepseek-ai/dsh (npm)', url: 'https://www.npmjs.com/package/@deepseek-ai/dsh',
      local: local.dsh, latest: null, publishedAt: null, state: 'error', error: String(error),
    })
  }

  try {
    const pypi = await fetchPypiLatest('deepseek-harness-sdk')
    channels.push({
      id: 'pypi',
      name: 'deepseek-harness-sdk (PyPI)',
      url: 'https://pypi.org/project/deepseek-harness-sdk/',
      local: local.pythonSdk,
      latest: pypi.version,
      publishedAt: pypi.time,
      state: channelState(local.pythonSdk, pypi.version),
    })
  } catch (error) {
    channels.push({
      id: 'pypi', name: 'deepseek-harness-sdk (PyPI)', url: 'https://pypi.org/project/deepseek-harness-sdk/',
      local: local.pythonSdk, latest: null, publishedAt: null, state: 'error', error: String(error),
    })
  }

  return { channels, checkedAt }
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 应用自身 GitHub 仓库（更新查询用）：
 * 优先级：环境变量 DSHM_GH_REPO > package.json repository 字段 > 兜底值。
 */
export function appGitHubRepo(): string {
  const envRepo = process.env.DSHM_GH_REPO
  if (envRepo && envRepo.trim().length > 0) return envRepo.trim()
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      repository?: { url?: string }
    }
    const url = pkg.repository?.url ?? ''
    const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(url)
    if (match) return match[1]
  } catch {
    /* ignore */
  }
  return 'SherlockGougou/dsh-manager'
}

export interface GithubReleaseInfo {
  tagName: string
  publishedAt: string | null
  body: string | null
  assets: { name: string; size: number; downloadUrl: string }[]
}

/** 查询应用自身最新 GitHub Release（404=仓库未发布，返回 null） */
export async function fetchGithubLatestRelease(
  repo = appGitHubRepo(),
  timeoutMs = 10_000,
): Promise<GithubReleaseInfo | null> {
  try {
    const doc = (await fetchJson('https://api.github.com/repos/' + repo + '/releases/latest', {
      headers: { 'User-Agent': 'dsh-manager' },
      timeoutMs,
    })) as {
      tag_name?: string
      published_at?: string
      body?: string
      assets?: { name?: string; size?: number; browser_download_url?: string }[]
    }
    if (!doc.tag_name) return null
    return {
      tagName: doc.tag_name,
      publishedAt: doc.published_at ?? null,
      body: doc.body ?? null,
      assets: (doc.assets ?? [])
        .filter((a) => typeof a.name === 'string' && typeof a.browser_download_url === 'string')
        .map((a) => ({ name: a.name!, size: a.size ?? 0, downloadUrl: a.browser_download_url! })),
    }
  } catch {
    return null
  }
}

/** 批量检查已安装出树插件的 latest 版本（并发 4） */
export async function checkPluginUpdates(names: string[]): Promise<Record<string, { latest: string | null; error?: string }>> {
  const result: Record<string, { latest: string | null; error?: string }> = {}
  const queue = [...names]
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (;;) {
      const name = queue.shift()
      if (!name) return
      try {
        const info = await fetchNpmLatest(name)
        result[name] = { latest: info.version }
      } catch (error) {
        result[name] = { latest: null, error: String(error) }
      }
    }
  })
  await Promise.all(workers)
  return result
}
