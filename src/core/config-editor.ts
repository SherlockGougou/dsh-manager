import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { load, dump } from 'js-yaml'
import { resolveDshHome } from './detect.ts'
import { listProfiles } from './profiles.ts'
import { run } from './exec.ts'
import { managerDir } from './manager-config.ts'
import type { ConfigFileDef, ConfigSaveResult, ConfigValidateResult } from './types.ts'

/**
 * 配置编辑：settings.yaml / .credentials.yaml（掩码）/ cordis.patch.yml（home + profile）。
 * 写前自动 .bak-<ts> 快照 + 原子写（临时文件 rename），避免半截文件触发 dsh 热重载。
 */

export function listConfigFiles(env: NodeJS.ProcessEnv = process.env): ConfigFileDef[] {
  const home = resolveDshHome(env)
  const files: ConfigFileDef[] = []
  const settings = join(home, 'settings.yaml')
  files.push({ id: 'settings', label: '用户设置 settings.yaml', kind: 'settings', path: settings, exists: existsSync(settings), masked: false })
  const credentials = join(home, '.credentials.yaml')
  files.push({ id: 'credentials', label: '凭据 .credentials.yaml', kind: 'credentials', path: credentials, exists: existsSync(credentials), masked: true })
  const homePatch = join(home, 'cordis.patch.yml')
  files.push({ id: 'home-patch', label: 'home 级补丁 cordis.patch.yml', kind: 'home-patch', path: homePatch, exists: existsSync(homePatch), masked: false })
  for (const profile of listProfiles(env)) {
    const patch = join(home, 'profiles', profile, 'cordis.patch.yml')
    files.push({
      id: 'patch-' + profile,
      label: 'profile 补丁 ' + profile + '/cordis.patch.yml',
      kind: 'profile-patch',
      path: patch,
      profile,
      exists: existsSync(patch),
      masked: false,
    })
  }
  const envFile = join(home, '.env')
  if (existsSync(envFile)) {
    files.push({ id: 'env', label: '环境 .env', kind: 'env', path: envFile, exists: true, masked: true })
  }
  return files
}

export function getConfigFile(id: string, env: NodeJS.ProcessEnv = process.env): ConfigFileDef | null {
  return listConfigFiles(env).find((f) => f.id === id) ?? null
}

function maskYaml(content: string): string {
  try {
    const doc = load(content)
    if (doc && typeof doc === 'object') {
      const masked = maskValue(doc as Record<string, unknown>)
      return dump(masked, { noRefs: true })
    }
  } catch {
    // 解析失败则用正则兜底
  }
  return content.replace(/^(\s*[\w.-]+\s*:\s*)(.+)$/gm, '$1***')
}

function maskValue(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    return /key|token|secret|password|api/i.test(key) && value.length > 0 ? '***' : value
  }
  if (Array.isArray(value)) return value.map((v) => maskValue(v, key))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskValue(v, k)
    }
    return out
  }
  return value
}

export function readConfigFile(
  id: string,
  opts: { reveal?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): { ok: boolean; content?: string; error?: string; def?: ConfigFileDef } {
  const def = getConfigFile(id, env)
  if (!def) return { ok: false, error: '未知配置文件: ' + id }
  if (!existsSync(def.path)) return { ok: true, content: '', def }
  try {
    let content = readFileSync(def.path, 'utf8')
    if (def.masked && !opts.reveal) content = maskYaml(content)
    return { ok: true, content, def }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

export function validateYaml(content: string): { ok: boolean; error: string | null } {
  try {
    load(content)
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/** 用 dsh --patch <tmp> --dump-config 验证补丁（解析 + schema + 插件解析全链路） */
export async function validatePatchWithDsh(
  profile: string,
  content: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: boolean; output: string }> {
  const dsh = await whichDsh()
  if (!dsh) return { ok: false, output: '未找到 dsh 命令' }
  const tmpDir = join(managerDir(), 'tmp')
  mkdirSync(tmpDir, { recursive: true })
  const tmpFile = join(tmpDir, 'validate-' + Date.now() + '.yml')
  writeFileSync(tmpFile, content, 'utf8')
  try {
    const result = await run(dsh, ['--profile', profile, '--patch', tmpFile, '--dump-config'], {
      timeoutMs: 60_000,
      env,
    })
    return { ok: result.code === 0, output: result.stdout || result.stderr }
  } finally {
    try {
      renameSync(tmpFile, tmpFile + '.done')
    } catch {
      /* ignore */
    }
  }
}

async function whichDsh(): Promise<string | null> {
  const { which } = await import('./exec.ts')
  return which('dsh')
}

export function validateConfigFile(
  id: string,
  content: string,
): ConfigValidateResult {
  const def = getConfigFile(id)
  const yaml = validateYaml(content)
  if (!def || def.kind !== 'profile-patch' || !def.profile) {
    return { yamlOk: yaml.ok, yamlError: yaml.error, patchOk: null, patchOutput: null }
  }
  // profile 补丁：YAML 合法后再跑一次 dsh 全链路校验（同步接口内无法 await，返回占位）
  return { yamlOk: yaml.ok, yamlError: yaml.error, patchOk: null, patchOutput: null }
}

/** 写入配置：先 .bak 快照，再原子写（同目录 tmp + rename） */
export function writeConfigFile(
  id: string,
  content: string,
  env: NodeJS.ProcessEnv = process.env,
): { ok: boolean; result?: ConfigSaveResult; error?: string } {
  const def = getConfigFile(id, env)
  if (!def) return { ok: false, error: '未知配置文件: ' + id }
  const yaml = validateYaml(content)
  if (!yaml.ok) return { ok: false, error: 'YAML 无效，已阻止写入：' + (yaml.error ?? '') }
  const before = existsSync(def.path) ? readFileSync(def.path, 'utf8') : ''
  try {
    mkdirSync(dirname(def.path), { recursive: true })
    if (before.trim().length > 0) {
      const stamp = timestamp()
      const backupPath = def.path + '.bak-' + stamp
      writeFileSync(backupPath, before, 'utf8')
      const tmpPath = def.path + '.dshm-tmp'
      writeFileSync(tmpPath, content, 'utf8')
      renameSync(tmpPath, def.path)
      return { ok: true, result: { path: def.path, backupPath, before, after: content } }
    }
    const tmpPath = def.path + '.dshm-tmp'
    writeFileSync(tmpPath, content, 'utf8')
    renameSync(tmpPath, def.path)
    return { ok: true, result: { path: def.path, backupPath: '', before, after: content } }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

function timestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate()) +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
  )
}

/** 简单行级 LCS 差异（用于 UI 展示 before/after） */
export function diffLines(before: string, after: string): { kind: 'same' | 'add' | 'del'; text: string }[] {
  const a = before.split(String.fromCharCode(10))
  const b = after.split(String.fromCharCode(10))
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: { kind: 'same' | 'add' | 'del'; text: string }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] })
      i++
    } else {
      out.push({ kind: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) {
    out.push({ kind: 'del', text: a[i] })
    i++
  }
  while (j < m) {
    out.push({ kind: 'add', text: b[j] })
    j++
  }
  return out
}
