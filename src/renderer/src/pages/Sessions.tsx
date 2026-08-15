import { useState } from 'react'
import { api } from '../api'
import { useAsyncData } from '../hooks'
import type { SessionMeta, DecodedSession, SessionStats } from '../../../core/types'

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

function fmtTime(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : '—'
}

type ViewState = { session: SessionMeta; decoded: DecodedSession & { stats: SessionStats } } | null

export default function Sessions() {
  const sessions = useAsyncData(() => api.sessions())
  const [view, setView] = useState<ViewState>(null)
  const [viewBusy, setViewBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const workspaces = new Map<string, SessionMeta[]>()
  for (const s of sessions.data ?? []) {
    const list = workspaces.get(s.workspaceKey) ?? []
    list.push(s)
    workspaces.set(s.workspaceKey, list)
  }

  const openView = async (session: SessionMeta) => {
    if (!session.logFile) return
    setViewBusy(true)
    setError(null)
    const res = await api.sessionDecode(session.logFile, 3000)
    if (res.ok) setView({ session, decoded: res.data })
    else setError(res.error)
    setViewBusy(false)
  }

  const doExport = async (session: SessionMeta, format: 'jsonl' | 'markdown') => {
    if (!session.logFile) return
    setMessage(null)
    setError(null)
    const res = await api.sessionExport(session.logFile, format)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const blob = new Blob([res.data.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = res.data.fileName
    a.click()
    URL.revokeObjectURL(url)
    setMessage('已导出 ' + res.data.fileName + '（' + res.data.content.length + ' 字符）')
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>会话日志</h1>
        <button className="btn" onClick={sessions.reload}>
          刷新
        </button>
      </div>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="error">{error}</p>}
      {sessions.error && <p className="error">{sessions.error}</p>}

      {!sessions.loading && sessions.data?.length === 0 && <p className="muted">暂无会话日志。</p>}

      {[...workspaces.entries()].map(([wsKey, list]) => (
        <section key={wsKey} className="card">
          <h2>
            {list[0]?.workspacePath ?? wsKey}
            <span className="muted small">（{list.length} 个会话）</span>
          </h2>
          <table className="checks">
            <thead>
              <tr>
                <th>会话</th>
                <th>大小</th>
                <th>最后活动</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>
                    <code>{s.id.slice(0, 8)}</code>
                    {!s.logFile ? <span className="warn-text">（无日志文件）</span> : null}
                  </td>
                  <td>{fmtBytes(s.bytes)}</td>
                  <td>{fmtTime(s.mtimeMs)}</td>
                  <td className="row-actions">
                    <button className="btn btn-sm" onClick={() => openView(s)} disabled={viewBusy || !s.logFile}>
                      查看
                    </button>
                    <button className="btn btn-sm" onClick={() => doExport(s, 'markdown')} disabled={!s.logFile}>
                      导出 MD
                    </button>
                    <button className="btn btn-sm" onClick={() => doExport(s, 'jsonl')} disabled={!s.logFile}>
                      导出 JSONL
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {view && (
        <section className="card">
          <div className="page-head">
            <h2>
              会话 {view.session.id.slice(0, 8)}
              <span className="muted small">
                {' '}
                · {view.decoded.frames} 帧 · {view.decoded.totalLines} 事件
                {view.decoded.torn ? ' · ⚠ 尾部未完成帧' : ''}
                {view.decoded.truncated ? ' · 仅显示前 3000 条' : ''}
              </span>
            </h2>
            <button className="btn btn-sm" onClick={() => setView(null)}>
              关闭
            </button>
          </div>
          {view.decoded.header && (
            <p className="muted small">
              创建于 {fmtTime(view.decoded.header.createdAt)} · cwd={view.decoded.header.cwd ?? '—'}
              {view.decoded.header.agentPreset ? ' · preset=' + view.decoded.header.agentPreset : ''}
            </p>
          )}
          <p className="muted small">
            消息 {view.decoded.stats.messages} · 工具调用 {view.decoded.stats.toolCalls} · 类型{' '}
            {Object.entries(view.decoded.stats.byType)
              .slice(0, 8)
              .map(([t, n]) => t + '×' + n)
              .join('、')}
          </p>
          <pre className="output">{view.decoded.events.map((e) => e.raw).join(String.fromCharCode(10))}</pre>
        </section>
      )}
    </div>
  )
}
