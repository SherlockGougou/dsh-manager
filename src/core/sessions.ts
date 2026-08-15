import { readdirSync, statSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { resolveDshHome } from './detect.ts'
import { decodeSessionFile } from './zstd.ts'
import type { DecodedEvent, DecodedSession, SessionHeader, SessionMeta, SessionStats } from './types.ts'

/**
 * 会话日志管理：列表、解码、统计、导出。
 * 日志为 $DSH_HOME/sessions/<workspace-key>/session-<uuid>/session.jsonl[.zstd]
 * 追加式多帧 zstd 容器；只读访问，绝不修改。
 */

const NL = String.fromCharCode(10)
const BT = String.fromCharCode(96)

export function sessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(env), 'sessions')
}

/**
 * 工作区目录名 → 可读路径（尽力解码）。
 * dsh 编码：/ \ : → '-'（连续折叠）；其他非常规字符 → ~XXXX（hex）。
 * 由于 '-' 同时也是合法路径字符，解码有歧义；精确路径以会话 header 的 cwd 为准。
 */
export function decodeWorkspaceKey(key: string): string | null {
  try {
    const hexDecoded = key.replace(/~([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    return hexDecoded.replace(/-+/g, '/')
  } catch {
    return null
  }
}

export function listWorkspaces(env: NodeJS.ProcessEnv = process.env): string[] {
  const root = sessionsRoot(env)
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

export function listSessions(env: NodeJS.ProcessEnv = process.env): SessionMeta[] {
  const root = sessionsRoot(env)
  const metas: SessionMeta[] = []
  if (!existsSync(root)) return metas
  for (const workspaceKey of readdirSync(root)) {
    const wsDir = join(root, workspaceKey)
    let isDir = false
    try {
      isDir = statSync(wsDir).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    for (const entry of readdirSync(wsDir)) {
      const dir = join(wsDir, entry)
      try {
        if (!statSync(dir).isDirectory()) continue
      } catch {
        continue
      }
      let logFile: string | null = null
      let bytes = 0
      let mtimeMs = 0
      for (const file of readdirSync(dir)) {
        if (file === 'session.jsonl.zstd' || file === 'session.jsonl') {
          logFile = join(dir, file)
          const st = statSync(logFile)
          bytes = st.size
          mtimeMs = st.mtimeMs
        }
      }
      const id = entry.startsWith('session-') ? entry.slice('session-'.length) : entry
      metas.push({
        id,
        workspaceKey,
        workspacePath: decodeWorkspaceKey(workspaceKey),
        dir,
        logFile,
        bytes,
        mtimeMs,
      })
    }
  }
  metas.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return metas
}

export function parseHeaderLine(line: string): SessionHeader | null {
  try {
    const parsed = JSON.parse(line) as SessionHeader
    if (parsed.type === 'session' && typeof parsed.id === 'string') return parsed
    return null
  } catch {
    return null
  }
}

function parseEventLine(line: string): DecodedEvent | null {
  try {
    const parsed = JSON.parse(line) as {
      type?: string
      seq?: number
      seq0?: number
      time?: number
      time0?: number
      data?: Record<string, unknown>
    }
    if (typeof parsed.type !== 'string') return null
    return {
      type: parsed.type,
      seq: typeof parsed.seq === 'number' ? parsed.seq : typeof parsed.seq0 === 'number' ? parsed.seq0 : null,
      time: typeof parsed.time === 'number' ? parsed.time : typeof parsed.time0 === 'number' ? parsed.time0 : null,
      data: parsed.data ?? {},
      raw: line,
    }
  } catch {
    return null
  }
}

/** 解码一个会话日志（events 默认最多 5000 条，超限截断并标注） */
export async function decodeSession(
  path: string,
  opts: { maxEvents?: number } = {},
): Promise<DecodedSession> {
  const maxEvents = opts.maxEvents ?? 5000
  const buffer = await readFile(path)
  const { plaintext, frames, torn } = decodeSessionFile(buffer)
  const lines = plaintext.split(NL).filter((l) => l.trim().length > 0)
  const header = lines.length > 0 ? parseHeaderLine(lines[0]) : null
  const events: DecodedEvent[] = []
  let truncated = false
  for (const line of lines.slice(1)) {
    const event = parseEventLine(line)
    if (!event) continue
    if (events.length >= maxEvents) {
      truncated = true
      break
    }
    events.push(event)
  }
  return {
    path,
    header,
    events,
    totalLines: lines.length - 1,
    frames,
    torn,
    truncated,
    sizeBytes: buffer.length,
  }
}

/** 会话统计 */
export function sessionStats(events: readonly DecodedEvent[]): SessionStats {
  const byType: Record<string, number> = {}
  let messages = 0
  let toolCalls = 0
  let firstTime: number | null = null
  let lastTime: number | null = null
  let chars = 0
  for (const e of events) {
    byType[e.type] = (byType[e.type] ?? 0) + 1
    if (e.type === 'user/message' || e.type === 'assistant/message') messages += 1
    if (e.type === 'tool/call') toolCalls += 1
    if (e.time !== null) {
      if (firstTime === null || e.time < firstTime) firstTime = e.time
      if (lastTime === null || e.time > lastTime) lastTime = e.time
    }
    chars += e.raw.length
  }
  return { totalEvents: events.length, byType, messages, toolCalls, firstTime, lastTime, chars }
}

/** 从事件中提取可读文本（message.content 数组 / 字符串 / 打包 chunk 行） */
export function extractText(event: DecodedEvent): string {
  const data = event.data
  const content = data.content ?? data.message
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const item of content) {
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        if (typeof obj.text === 'string') parts.push(obj.text)
        else if (Array.isArray(obj.content)) {
          for (const sub of obj.content as unknown[]) {
            if (sub && typeof sub === 'object' && typeof (sub as Record<string, unknown>).text === 'string') {
              parts.push((sub as Record<string, unknown>).text as string)
            }
          }
        }
      }
    }
    return parts.join('')
  }
  // 打包行：text-chunks / reasoning-chunks / tool-call-chunks
  if (Array.isArray(data.texts)) return (data.texts as string[]).join('')
  return ''
}

/** 导出为可读 Markdown（按事件流顺序渲染） */
export function renderMarkdown(header: SessionHeader | null, events: readonly DecodedEvent[]): string {
  const out: string[] = []
  const title = events.find((e) => e.type === 'session/title')
  const titleText = title ? extractText(title) : header?.id ?? '会话'
  out.push('# ' + titleText)
  if (header) {
    out.push('')
    out.push(
      '> 会话 ' + header.id + ' · 创建于 ' + new Date(header.createdAt).toLocaleString() + (header.agentPreset ? ' · preset ' + header.agentPreset : ''),
    )
    if (header.cwd) out.push('> 工作目录：' + header.cwd)
  }
  out.push('')
  for (const event of events) {
    const time = event.time !== null ? BT + new Date(event.time).toLocaleTimeString() + BT + ' ' : ''
    switch (event.type) {
      case 'user/message': {
        const text = extractText(event)
        out.push('## 用户 ' + time)
        out.push('')
        out.push(text || '_(空消息)_')
        out.push('')
        break
      }
      case 'assistant/message': {
        const content = event.data.message as { content?: unknown[] } | undefined
        const reasoning: string[] = []
        const text: string[] = []
        for (const item of (content?.content ?? []) as Record<string, unknown>[]) {
          if (item.type === 'reasoning' && typeof item.text === 'string') reasoning.push(item.text)
          else if (item.type === 'text' && typeof item.text === 'string') text.push(item.text)
          else if (typeof item.text === 'string') text.push(item.text)
        }
        if (reasoning.length > 0) {
          out.push('### 思考 ' + time)
          out.push('')
          out.push('> ' + reasoning.join('').split(NL).join(NL + '> '))
          out.push('')
        }
        out.push('## 助手 ' + time)
        out.push('')
        out.push(text.join('') || '_(空回复)_')
        out.push('')
        break
      }
      case 'tool/call': {
        const name = typeof event.data.name === 'string' ? event.data.name : '?'
        const args = typeof event.data.arguments === 'string' ? event.data.arguments : JSON.stringify(event.data.arguments ?? '')
        out.push('### 工具调用：' + name + ' ' + time)
        out.push('')
        out.push(BT + BT + BT + 'json')
        out.push(truncate(args, 4000))
        out.push(BT + BT + BT)
        out.push('')
        break
      }
      case 'tool/result': {
        const text = extractText(event)
        out.push('#### 结果 ' + time)
        out.push('')
        out.push(BT + BT + BT)
        out.push(truncate(text || '_(空结果)_', 4000))
        out.push(BT + BT + BT)
        out.push('')
        break
      }
      case 'session/title':
      case 'step/start':
      case 'step/end':
      case 'turn/start':
      case 'turn/end':
      case 'permission/preset':
      case 'sandbox/mode':
      case 'approval/policy':
      case 'agent/inbox/spliced':
      case 'agent/status':
      case 'request/header':
      case 'request/context':
      case 'session/title-llm-request':
      case 'assistant/chunk':
      case 'text-chunks':
      case 'reasoning-chunks':
      case 'tool-call-chunks':
        break
      default:
        // 未知事件类型：保留为注释行，避免丢失信息
        out.push('<!-- ' + event.type + ' -->')
        break
    }
  }
  return out.join(NL)
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…（截断，共 ' + text.length + ' 字符）' : text
}

function stripSuffix(name: string, suffix: string): string {
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
}

/** 导出（jsonl = 原始解压文本；markdown = 可读渲染） */
export async function exportSession(
  path: string,
  format: 'jsonl' | 'markdown',
): Promise<{ content: string; fileName: string }> {
  if (format === 'markdown') {
    const decoded = await decodeSession(path, { maxEvents: 100_000 })
    const base = stripSuffix(stripSuffix(basename(path), '.zstd'), '.jsonl')
    return { content: renderMarkdown(decoded.header, decoded.events), fileName: base + '.md' }
  }
  const buffer = await readFile(path)
  const { plaintext } = decodeSessionFile(buffer)
  const base = stripSuffix(stripSuffix(basename(path), '.zstd'), '.jsonl')
  return { content: plaintext, fileName: base + '.jsonl' }
}
