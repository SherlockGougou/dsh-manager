import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome, isBuiltinBundle, normalizeVersion } from './detect.ts'
import { run, which } from './exec.ts'
import type { PluginRow, ProfileInfo } from './types.ts'

interface PackageJson {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] }; bundle?: { patch?: string } }
}

function readJson<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** 读取一个出树包的元数据（版本 + dsh.bundle 声明） */
function readInstalledPkg(profileDir: string, name: string): { version: string | null; hasBundlePatch: boolean } {
  const pkg = readJson<PackageJson>(join(profileDir, 'node_modules', name, 'package.json'))
  if (!pkg) return { version: null, hasBundlePatch: false }
  return {
    version: normalizeVersion(pkg.version ?? null),
    hasBundlePatch: typeof pkg.dsh?.bundle?.patch === 'string' && pkg.dsh.bundle.patch.length > 0,
  }
}

/** 列出所有 profile */
export function listProfiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = resolveDshHome(env)
  const profilesRoot = join(home, 'profiles')
  if (!existsSync(profilesRoot)) return []
  return readdirSync(profilesRoot)
    .filter((name) => {
      try {
        return statSync(join(profilesRoot, name)).isDirectory() && name !== 'node_modules'
      } catch {
        return false
      }
    })
    .sort()
}

/** 读取单个 profile 详情（含插件行） */
export function readProfile(profile: string, env: NodeJS.ProcessEnv = process.env): ProfileInfo {
  const home = resolveDshHome(env)
  const dir = join(home, 'profiles', profile)
  const pkg = readJson<PackageJson>(join(dir, 'package.json'))
  const bundles = pkg?.dsh?.profile?.bundles ?? []
  const dependencies = pkg?.dependencies ?? {}
  const plugins: PluginRow[] = []

  // 已声明的依赖
  for (const [name] of Object.entries(dependencies)) {
    const installed = readInstalledPkg(dir, name)
    const inBundlesList = bundles.includes(name)
    const kind: PluginRow['kind'] = isBuiltinBundle(name)
      ? 'builtin-bundle'
      : installed.hasBundlePatch
        ? 'out-of-tree-bundle'
        : 'plain-dep'
    plugins.push({
      name,
      version: installed.version,
      kind,
      inBundlesList,
      hasBundlePatch: installed.hasBundlePatch,
      installed: installed.version !== null,
      declared: true,
      latest: null,
      outdated: false,
    })
  }

  // bundles 列表里声明但不在依赖里的（安装缺失 → 启动必失败）
  for (const bundle of bundles) {
    if (!plugins.some((p) => p.name === bundle)) {
      plugins.push({
        name: bundle,
        version: null,
        kind: isBuiltinBundle(bundle) ? 'builtin-bundle' : 'out-of-tree-bundle',
        inBundlesList: true,
        hasBundlePatch: false,
        installed: false,
        declared: false,
        latest: null,
        outdated: false,
      })
    }
  }

  // node_modules 里的孤儿包（未声明；过滤 pnpm 内部目录与 dot 文件）
  const NM_INTERNAL = new Set(['.bin', '.pnpm', '.modules.yaml', '.pnpm-workspace-state-v1.json'])
  const nmRoot = join(dir, 'node_modules')
  if (existsSync(nmRoot)) {
    let scopes = readdirSync(nmRoot).filter((n) => n.startsWith('@') && !NM_INTERNAL.has(n))
    const plain = readdirSync(nmRoot).filter((n) => !n.startsWith('@') && !n.startsWith('.') && !NM_INTERNAL.has(n))
    const orphans: string[] = []
    for (const scope of scopes) {
      const scopeDir = join(nmRoot, scope)
      if (!statSync(scopeDir).isDirectory()) continue
      for (const sub of readdirSync(scopeDir)) {
        if (sub.startsWith('.')) continue
        const fullName = `${scope}/${sub}`
        if (!plugins.some((p) => p.name === fullName)) orphans.push(fullName)
      }
    }
    for (const name of plain) {
      if (!plugins.some((p) => p.name === name)) orphans.push(name)
    }
    for (const name of orphans.slice(0, 200)) {
      const installed = readInstalledPkg(dir, name)
      plugins.push({
        name,
        version: installed.version,
        kind: 'orphan',
        inBundlesList: false,
        hasBundlePatch: installed.hasBundlePatch,
        installed: true,
        declared: false,
        latest: null,
        outdated: false,
      })
    }
  }

  plugins.sort((a, b) => {
    const rank = { 'builtin-bundle': 0, 'out-of-tree-bundle': 1, 'plain-dep': 2, orphan: 3 } as const
    return rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name)
  })

  return {
    name: profile,
    dir,
    exists: existsSync(dir),
    bundles,
    dependencies,
    nodeModulesPresent: existsSync(join(dir, 'node_modules')),
    lockfilePresent: existsSync(join(dir, 'pnpm-lock.yaml')),
    patchPresent: existsSync(join(dir, 'cordis.patch.yml')),
    plugins,
  }
}

/** 读取所有 profile 详情 */
export function readAllProfiles(env: NodeJS.ProcessEnv = process.env): ProfileInfo[] {
  return listProfiles(env).map((name) => readProfile(name, env))
}

/** 执行 dsh plugin 命令（官方推荐路径，保留 bundle reconcile 语义） */
export async function runPluginAction(
  profile: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  const dsh = await which('dsh')
  if (!dsh) {
    return { ok: false, stdout: '', stderr: '未找到 dsh 命令，请先安装 @deepseek-ai/dsh', code: null }
  }
  const r = await run(dsh, ['plugin', '--profile', profile, ...args], { timeoutMs: 180_000, env })
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, code: r.code }
}

/** 导出组合树（用于配置校验与行级来源追踪） */
export async function dumpConfig(
  profile: string,
  opts: { defaultOnly?: boolean; patch?: string[] } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: boolean; output: string; code: number | null }> {
  const dsh = await which('dsh')
  if (!dsh) return { ok: false, output: '', code: null }
  const args = ['--profile', profile, opts.defaultOnly ? '--dump-default-config' : '--dump-config']
  for (const p of opts.patch ?? []) args.push('--patch', p)
  const r = await run(dsh, args, { timeoutMs: 60_000, env })
  return { ok: r.code === 0, output: r.stdout || r.stderr, code: r.code }
}
