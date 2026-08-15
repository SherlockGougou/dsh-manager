import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAsyncData } from '../hooks'
import type { InstanceConfig, ServiceInfo } from '../../../core/types'

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

export default function Instances() {
  const instances = useAsyncData(() => api.instances())
  const profiles = useAsyncData(() => api.profiles())
  const [editing, setEditing] = useState<Partial<InstanceConfig> | null>(null)
  const [logFor, setLogFor] = useState<string | null>(null)
  const [logContent, setLogContent] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [services, setServices] = useState<Record<string, ServiceInfo>>({})

  useEffect(() => {
    if (!instances.data) return
    for (const s of instances.data) {
      void api.serviceStatus(s.config.id).then((res) => {
        if (res.ok && res.data) {
          const info: ServiceInfo = res.data
          setServices((m) => ({ ...m, [s.config.id]: info }))
        }
      })
    }
  }, [instances.data])

  const refresh = () => {
    instances.reload()
  }

  const refreshService = async (id: string) => {
    const status = await api.serviceStatus(id)
    if (status.ok && status.data) {
      const info: ServiceInfo = status.data
      setServices((m) => ({ ...m, [id]: info }))
    }
  }

  const toggleService = async (s: { config: InstanceConfig; running: boolean }) => {
    const current = services[s.config.id]
    if (current?.installed) {
      if (!window.confirm('卸载系统服务？运行中的服务会被停止。')) return
      const res = await api.serviceUninstall(s.config.id)
      if (res.ok) {
        setError(null)
        await refreshService(s.config.id)
      } else {
        setError(res.error)
      }
    } else {
      if (s.running) {
        alert('实例正在由管理器托管，建议先停止再安装服务（避免端口冲突）。')
      }
      const res = await api.serviceInstall(s.config.id)
      if (res.ok) {
        setError(res.data.ok ? null : res.data.message)
        await refreshService(s.config.id)
      } else {
        setError(res.error)
      }
    }
  }

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true)
    setError(null)
    const res = await fn()
    if (!res.ok) setError(res.error ?? '操作失败')
    refresh()
    setBusy(false)
  }

  const startEdit = () => {
    void api.instanceNewId().then((idRes) => {
      setEditing({
        id: idRes.ok ? idRes.data : String(Date.now()),
        name: '新实例',
        profile: 'web',
        port: 3080,
        autoStart: false,
        createdAt: Date.now(),
      })
    })
  }

  const saveEdit = async () => {
    if (!editing?.id || !editing.profile) return
    const config: InstanceConfig = {
      id: editing.id,
      name: editing.name || editing.profile,
      profile: editing.profile,
      port: editing.port,
      cwd: editing.cwd || undefined,
      dshHome: editing.dshHome || undefined,
      env: editing.env,
      autoStart: editing.autoStart ?? false,
      createdAt: editing.createdAt ?? Date.now(),
    }
    const res = await api.instanceSave(config)
    if (!res.ok) setError(res.error)
    setEditing(null)
    refresh()
  }

  const viewLog = async (id: string) => {
    setLogFor(id)
    const res = await api.instanceLog(id)
    setLogContent(res.ok ? res.data : '读取失败: ' + res.error)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>实例管理</h1>
        <div className="row" style={{ margin: 0 }}>
          <button className="btn" onClick={refresh} disabled={busy}>
            刷新
          </button>
          <button className="btn btn-primary" onClick={startEdit}>
            + 新建实例
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {editing && (
        <section className="card">
          <h2>编辑实例</h2>
          <div className="row">
            <input className="input" placeholder="名称" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <select className="select" value={editing.profile ?? 'web'} onChange={(e) => setEditing({ ...editing, profile: e.target.value })}>
              {(profiles.data ?? []).map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              className="input number"
              type="number"
              placeholder="端口"
              value={editing.port ?? ''}
              onChange={(e) => setEditing({ ...editing, port: Number(e.target.value) || undefined })}
            />
          </div>
          <div className="row">
            <input className="input" placeholder="工作目录（默认 HOME）" value={editing.cwd ?? ''} onChange={(e) => setEditing({ ...editing, cwd: e.target.value })} />
            <input className="input" placeholder="DSH_HOME（留空=默认）" value={editing.dshHome ?? ''} onChange={(e) => setEditing({ ...editing, dshHome: e.target.value })} />
          </div>
          <div className="row">
            <input className="input" placeholder="附加环境变量 KEY=VALUE,KEY2=VALUE2" value={envToText(editing.env)} onChange={(e) => setEditing({ ...editing, env: textToEnv(e.target.value) })} style={{ flex: 1 }} />
          </div>
          <div className="row">
            <label className="checkbox">
              <input type="checkbox" checked={editing.autoStart ?? false} onChange={(e) => setEditing({ ...editing, autoStart: e.target.checked })} />
              管理器启动时自动拉起
            </label>
            <button className="btn btn-primary" onClick={saveEdit}>
              保存
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>实例列表</h2>
        {instances.loading && <p className="muted">加载中…</p>}
        {!instances.loading && instances.data?.length === 0 && (
          <p className="muted">暂无实例。dsh 不会自行常驻——创建一个实例即可由管理器托管其生命周期。</p>
        )}
        <table className="checks">
          <thead>
            <tr>
              <th>状态</th>
              <th>名称</th>
              <th>Profile</th>
              <th>端口</th>
              <th>PID</th>
              <th>日志</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {instances.data?.map((s) => (
              <tr key={s.config.id}>
                <td>
                  {s.running ? (
                    <span className="ok-text">● 运行中</span>
                  ) : (
                    <span className="muted">○ 已停止</span>
                  )}
                  {s.portListening ? <div className="small ok-text">端口监听中</div> : null}
                  {services[s.config.id]?.installed ? (
                    <div className="small">
                      <span className="badge badge-info" title={services[s.config.id]?.detail ?? ''}>
                        系统服务
                        {services[s.config.id]?.active === true ? ' · active' : ''}
                      </span>
                    </div>
                  ) : null}
                </td>
                <td>
                  {s.config.name}
                  <div className="small muted">{s.config.id}</div>
                </td>
                <td>
                  <code>{s.config.profile}</code>
                  {s.config.autoStart ? <div className="small warn-text">自动启动</div> : null}
                </td>
                <td>{s.config.port ?? '—'}</td>
                <td>{s.pid ?? '—'}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => viewLog(s.config.id)}>
                    {fmtBytes(s.logBytes)}
                  </button>
                </td>
                <td className="row-actions">
                  {!s.running ? (
                    <button className="btn btn-sm" onClick={() => act(() => api.instanceStart(s.config.id))} disabled={busy}>
                      启动
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-sm btn-danger" onClick={() => act(() => api.instanceStop(s.config.id))} disabled={busy}>
                        停止
                      </button>
                      <button className="btn btn-sm" onClick={() => act(() => api.instanceRestart(s.config.id))} disabled={busy}>
                        重启
                      </button>
                    </>
                  )}
                  {s.portListening && (
                    <button className="btn btn-sm" onClick={() => api.instanceOpen(s.config.id)}>
                      打开
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => setEditing(s.config)} disabled={busy}>
                    编辑
                  </button>
                  <button
                    className={'btn btn-sm' + (services[s.config.id]?.installed ? ' btn-warn' : '')}
                    title={services[s.config.id]?.detail}
                    onClick={() => toggleService(s)}
                  >
                    {services[s.config.id]?.installed ? '卸载服务' : '安装为系统服务'}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={async () => {
                      if (window.confirm('删除实例 ' + s.config.name + '？（不会删除任何 dsh 数据）')) {
                        const res = await api.instanceRemove(s.config.id)
                        if (!res.ok) setError(res.error)
                        refresh()
                      }
                    }}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {logFor && (
        <section className="card">
          <div className="page-head">
            <h2>实例日志：{logFor}</h2>
            <div className="row" style={{ margin: 0 }}>
              <button className="btn btn-sm" onClick={() => viewLog(logFor)}>
                刷新
              </button>
              <button className="btn btn-sm" onClick={() => setLogFor(null)}>
                关闭
              </button>
            </div>
          </div>
          <pre className="output">{logContent}</pre>
        </section>
      )}
    </div>
  )
}

function envToText(env: Record<string, string> | undefined): string {
  return env ? Object.entries(env).map(([k, v]) => k + '=' + v).join(',') : ''
}

function textToEnv(text: string): Record<string, string> | undefined {
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return undefined
  const env: Record<string, string> = {}
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq > 0) env[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return Object.keys(env).length > 0 ? env : undefined
}
