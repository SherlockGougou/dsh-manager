import { useState } from 'react'
import { api } from '../api'
import { useAsyncData } from '../hooks'
import type { BackupMeta } from '../../../core/types'

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

export default function Backup() {
  const backups = useAsyncData(() => api.backups())
  const [includeCredentials, setIncludeCredentials] = useState(false)
  const [includeNodeModules, setIncludeNodeModules] = useState(false)
  const [includeCache, setIncludeCache] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string[] | null>(null)
  const [previewFor, setPreviewFor] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

  const runBackup = async () => {
    setBusy(true)
    setMessage(null)
    setError(null)
    const res = await api.backup({ includeCredentials, includeNodeModules, includeCache, note: note || undefined })
    if (res.ok) {
      setMessage(
        '备份完成：' + res.data.dir + '（' + res.data.manifest.files + ' 个文件，' + fmtBytes(res.data.manifest.bytes) + '）',
      )
      void backups.reload()
    } else {
      setError(res.error)
    }
    setBusy(false)
  }

  const runPreview = async (dir: string) => {
    setPreviewBusy(true)
    const res = await api.restorePreview(dir)
    if (res.ok) {
      setPreviewFor(dir)
      setPreview([
        '将新增: ' + res.data.toAdd.length,
        '将覆盖: ' + res.data.toOverwrite.length,
        '将删除: ' + res.data.toDelete.length,
        '不变: ' + res.data.unchanged,
        ...res.data.toAdd.slice(0, 5).map((f) => '  + ' + f),
        ...res.data.toOverwrite.slice(0, 5).map((f) => '  ~ ' + f),
        ...res.data.toDelete.slice(0, 5).map((f) => '  - ' + f),
      ])
    } else {
      setError(res.error)
    }
    setPreviewBusy(false)
  }

  const runRestore = async (dir: string) => {
    if (!window.confirm('确认用该备份恢复 DSH_HOME？覆盖前的文件会自动转移到管理器 trash 目录。')) return
    setBusy(true)
    const res = await api.restore(dir)
    if (res.ok) {
      setMessage(
        '恢复完成：新增 ' + res.data.added + '，覆盖 ' + res.data.overwritten + '，删除 ' + res.data.deleted + (res.data.errors.length ? '；错误：' + res.data.errors.join('; ') : ''),
      )
    } else {
      setError(res.error)
    }
    setBusy(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>备份与恢复</h1>
        <button className="btn" onClick={backups.reload}>
          刷新列表
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="ok-text">{message}</p>}

      <section className="card">
        <h2>创建备份（DSH_HOME）</h2>
        <div className="row">
          <label className="checkbox">
            <input type="checkbox" checked={includeCredentials} onChange={(e) => setIncludeCredentials(e.target.checked)} />
            包含凭据（.credentials.yaml / .env，建议加密存放）
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={includeNodeModules} onChange={(e) => setIncludeNodeModules(e.target.checked)} />
            包含 node_modules（默认不包含，可经 package.json 重建）
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={includeCache} onChange={(e) => setIncludeCache(e.target.checked)} />
            包含 cache
          </label>
        </div>
        <div className="row">
          <input className="input" placeholder="备注（可选）" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={runBackup} disabled={busy}>
            {busy ? '备份中…' : '开始备份'}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>已有备份</h2>
        {backups.loading && <p className="muted">加载中…</p>}
        {!backups.loading && backups.data?.length === 0 && <p className="muted">暂无备份</p>}
        <table className="checks">
          <tbody>
            {backups.data?.map((b: BackupMeta) => (
              <tr key={b.dir}>
                <td className="col-title">
                  {b.manifest ? new Date(b.manifest.createdAt).toLocaleString() : b.dir.split('/').pop()}
                  {b.manifest?.note ? <div className="muted small">{b.manifest.note}</div> : null}
                </td>
                <td>
                  {b.manifest ? (
                    <>
                      {b.manifest.files} 文件 / {fmtBytes(b.manifest.bytes)}
                      <div className="muted small">排除：{b.manifest.excluded.join(', ')}</div>
                    </>
                  ) : (
                    <span className="warn-text">缺少 manifest</span>
                  )}
                </td>
                <td className="row-actions">
                  <button className="btn btn-sm" onClick={() => runPreview(b.dir)} disabled={previewBusy}>
                    预览
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => runRestore(b.dir)} disabled={busy}>
                    恢复
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {preview && (
          <pre className="output">
            <strong>恢复预览（{previewFor}）</strong>
            {'\n' + preview.join('\n')}
          </pre>
        )}
      </section>
    </div>
  )
}
