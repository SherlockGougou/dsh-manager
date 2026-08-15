import { spawn } from 'node:child_process'
import type { ExecResult } from './types.ts'

const MAX_OUTPUT_BYTES = 1_048_576 // 1MB 输出截断
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * 安全执行外部命令（无 shell 拼接），带超时与输出截断。
 * 用于调用 node/pnpm/dsh 等工具；返回值永远结构化，不抛异常。
 */
export function run(
  cmd: string,
  args: string[] = [],
  opts: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    const collect = (chunk: Buffer, sink: (s: string) => void) => {
      const text = chunk.toString('utf8')
      if (sink.length + text.length > MAX_OUTPUT_BYTES) return
      sink(text)
    }
    child.stdout.on('data', (c: Buffer) => collect(c, (s) => (stdout += s)))
    child.stderr.on('data', (c: Buffer) => collect(c, (s) => (stderr += s)))
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: `spawn failed: ${err.message}`, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

/** 在 PATH 中定位可执行文件（跨平台） */
export async function which(name: string): Promise<string | null> {
  const isWin = process.platform === 'win32'
  const exe = isWin ? `${name}.cmd` : name
  const r = await run(isWin ? 'where' : 'which', [exe], { timeoutMs: 5000 })
  if (r.code !== 0 || !r.stdout.trim()) return null
  return r.stdout.trim().split(/\r?\n/)[0]
}
