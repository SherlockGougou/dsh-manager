import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync, accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs'
import net from 'node:net'
import { run, which } from './exec.ts'
import type { EnvSnapshot } from './types.ts'

/** 与 @deepseek-ai/dsh-home-paths 相同的解析语义：显式配置 > $DSH_HOME > ~/.dsh */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return resolve(fromEnv.replace(/^~\//, homedir() + '/'))
  return join(homedir(), '.dsh')
}

export function isDefaultHome(home: string): boolean {
  return home === resolve(join(homedir(), '.dsh'))
}

const NODE_REQUIRED = '^22.19.0 || >=24.0.0'
const BUILTIN_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
])

export function isBuiltinBundle(name: string): boolean {
  return BUILTIN_BUNDLES.has(name)
}

/** 解析 dsh 版本号（0.1.0-rc.5 → 0.1.0-rc.5；0.1.0rc6 → 0.1.0-rc.6 归一化） */
export function normalizeVersion(v: string | null): string | null {
  if (!v) return null
  const m = v.trim().match(/^(\d+\.\d+\.\d+)(?:-?rc\.?(\d+))?/)
  if (!m) return v.trim()
  return m[2] !== undefined ? `${m[1]}-rc.${m[2]}` : m[1]
}

/** 简单语义化版本比较（支持 rc 预发布；相等或前者新 → >= 0） */
export function compareVersions(a: string | null, b: string | null): number {
  const na = normalizeVersion(a)
  const nb = normalizeVersion(b)
  if (na === nb) return 0
  if (!na) return -1
  if (!nb) return 1
  const pa = na.split('-')[0].split('.').map(Number)
  const pb = nb.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1
  }
  const ra = /rc\.(\d+)/.exec(na)?.[1]
  const rb = /rc\.(\d+)/.exec(nb)?.[1]
  if (ra !== undefined || rb !== undefined) {
    if (ra === undefined) return 1 // 正式版大于 rc
    if (rb === undefined) return -1
    return Number(ra) - Number(rb)
  }
  return 0
}

export function satisfiesNodeVersion(version: string | null): boolean {
  if (!version) return false
  const major = Number(version.replace(/^v/, '').split('.')[0])
  if (Number.isNaN(major)) return false
  return major === 22 ? Number(version.replace(/^v/, '').split('.')[1]) >= 19 : major >= 24
}

/** 在 npx 缓存中寻找 dsh 安装 */
function findInNpxCache(): { version: string | null; path: string } | null {
  const npxRoot = join(homedir(), '.npm', '_npx')
  if (!existsSync(npxRoot)) return null
  let found: { version: string | null; path: string } | null = null
  for (const entry of readdirSync(npxRoot)) {
    const pkgJson = join(npxRoot, entry, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    if (existsSync(pkgJson)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJson, 'utf8')) as { version?: string }
        found = { version: pkg.version ?? null, path: join(npxRoot, entry) }
      } catch {
        found = { version: null, path: join(npxRoot, entry) }
      }
    }
  }
  return found
}

/** 探测 dsh 安装形态 */
async function detectDsh(): Promise<EnvSnapshot['dsh']> {
  const onPath = await which('dsh')
  if (onPath) {
    const r = await run(onPath, ['-V'], { timeoutMs: 8000 })
    return {
      version: r.code === 0 ? normalizeVersion(r.stdout.trim() || null) : null,
      found: true,
      form: 'npm-global',
      path: onPath,
      hint: null,
    }
  }
  const npx = findInNpxCache()
  if (npx) {
    return { version: npx.version, found: true, form: 'npx-cache', path: npx.path, hint: 'npx 缓存中的安装' }
  }
  // Python wheel 形态：dsh-jsonrpc-agent-pkg-* 可执行
  const r = await run('python3', ['-c', 'import deepseek_harness, os; print(os.path.dirname(deepseek_harness.__file__))'], { timeoutMs: 8000 })
  if (r.code === 0 && r.stdout.trim()) {
    return {
      version: null,
      found: true,
      form: 'python-wheel',
      path: r.stdout.trim(),
      hint: 'Python SDK 形态（deepseek-harness-sdk）',
    }
  }
  return { version: null, found: false, form: 'not-found', path: null, hint: '未在 PATH / npx 缓存 / Python 环境中发现 dsh' }
}

/** 探测端口是否有服务监听 */
export function probePort(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolvePromise(false)
    }, timeoutMs)
    socket.on('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolvePromise(true)
    })
    socket.on('error', () => {
      clearTimeout(timer)
      resolvePromise(false)
    })
  })
}

/** 完整环境快照 */
export async function detectEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<EnvSnapshot> {
  const home = resolveDshHome(env)
  const nodeR = await run('node', ['--version'], { timeoutMs: 5000 })
  const nodeVersion = nodeR.code === 0 ? nodeR.stdout.trim() : null
  const pnpmR = await run('pnpm', ['--version'], { timeoutMs: 5000 })
  const pnpmVersion = pnpmR.code === 0 ? pnpmR.stdout.trim() : null
  const dsh = await detectDsh()
  const homeExists = existsSync(home)
  let writable = false
  if (homeExists) {
    try {
      accessSync(home, constants.W_OK)
      writable = true
    } catch {
      // accessSync 可能在受限环境（沙箱/ACL）误报：回退到所有权判断
      try {
        const st = statSync(home)
        writable = process.getuid !== undefined && st.uid === process.getuid()
      } catch {
        writable = false
      }
    }
  }
  const listening = await probePort(3080)
  return {
    platform: process.platform,
    arch: process.arch,
    node: { version: nodeVersion, ok: satisfiesNodeVersion(nodeVersion), required: NODE_REQUIRED },
    pnpm: { version: pnpmVersion, ok: pnpmVersion !== null },
    dsh,
    pythonSdk: dsh.form === 'python-wheel' ? { installed: true, version: dsh.version } : null,
    home: {
      path: home,
      default: isDefaultHome(home),
      exists: homeExists,
      writable,
      display: isDefaultHome(home) ? '~/.dsh' : home,
    },
    runningWeb: { listening, port: 3080 },
  }
}
