import { useState } from 'react'
import { api } from '../api'
import { useAsyncData } from '../hooks'
import { StatusBadge } from '../components/StatusBadge'
import type { HealthCheck, RepairAction, RepairResult } from '../../../core/types'

export default function Health() {
  const checks = useAsyncData(() => api.health())
  const actions = useAsyncData(() => api.repairActions())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resultMap, setResultMap] = useState<Record<string, { kind: 'ok'; data: RepairResult } | { kind: 'error'; error: string }>>({})
  const [formParams, setFormParams] = useState<Record<string, Record<string, string>>>({})

  const groups = new Map<string, HealthCheck[]>()
  for (const c of checks.data ?? []) {
    const list = groups.get(c.group) ?? []
    list.push(c)
    groups.set(c.group, list)
  }

  const counts = (checks.data ?? []).reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  const runRepair = async (action: string, params?: Record<string, unknown>, label = action) => {
    const key = action + ':' + label
    setBusyId(key)
    setResultMap((m) => ({ ...m, [key]: { kind: 'error', error: '' } }))
    const res = await api.repairExecute(action, params)
    setResultMap((m) => ({ ...m, [key]: res.ok ? { kind: 'ok', data: res.data } : { kind: 'error', error: res.error } }))
    setBusyId(null)
    if (action === 'fix-permissions' || action === 'pnpm-install-profile') checks.reload()
  }

  const confirmRun = (a: RepairAction) => {
    if (a.destructive && !window.confirm('该操作会修改文件（执行前自动备份）。确认执行「' + a.title + '」？')) return
    const params: Record<string, string> = formParams[a.id] ?? {}
    const payload: Record<string, unknown> = {}
    for (const p of a.params) {
      if (!params[p.key] && p.required) {
        alert('缺少必填参数: ' + p.label)
        return
      }
      if (params[p.key]) payload[p.key] = params[p.key]
    }
    void runRepair(a.id, Object.keys(payload).length > 0 ? payload : undefined)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>健康检查与修复</h1>
        <button className="btn" onClick={checks.reload} disabled={checks.loading}>
          {checks.loading ? '检查中…' : '重新检查'}
        </button>
      </div>

      {checks.error && <p className="error">{checks.error}</p>}
      {!checks.error && (
        <div className="summary">
          {(['ok', 'warn', 'error', 'info'] as const).map((s) => (
            <span key={s} className={'summary-item summary-' + s}>
              {s}: {counts[s] ?? 0}
            </span>
          ))}
        </div>
      )}

      {checks.data &&
        [...groups.entries()].map(([group, list]) => (
          <section key={group} className="card">
            <h2>{group}</h2>
            <table className="checks">
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td className="col-status">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="col-title">{c.title}</td>
                    <td className="col-detail">
                      {c.detail}
                      {c.fixHint ? <div className="fix-hint">修复建议：{c.fixHint}</div> : null}
                    </td>
                    <td className="row-actions">
                      {c.repair && (
                        <button
                          className="btn btn-sm"
                          disabled={busyId === c.repair.action}
                          onClick={() => {
                            if (c.repair?.action === 'restore-yaml-from-bak' && !window.confirm('用最近 .bak 备份还原该文件？（当前文件会先备份）')) return
                            void runRepair(c.repair!.action, c.repair!.payload)
                          }}
                        >
                          {busyId === c.repair.action ? '修复中…' : '一键修复'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

      <section className="card">
        <h2>修复动作库</h2>
        <p className="muted small">所有破坏性操作执行前自动备份到管理器 repair-backups 目录。</p>
        {actions.data?.map((a) => {
          const result = resultMap[a.id]
          return (
            <div key={a.id} className="repair-row">
              <div className="repair-info">
                <strong>
                  {a.title}
                  {a.destructive ? <span className="warn-text">（破坏性）</span> : null}
                </strong>
                <div className="muted small">{a.description}</div>
                <div className="row" style={{ margin: '4px 0' }}>
                  {a.params.map((p) => (
                    <input
                      key={p.key}
                      className="input"
                      placeholder={p.label + (p.required ? ' *' : '')}
                      value={formParams[a.id]?.[p.key] ?? ''}
                      onChange={(e) =>
                        setFormParams((m) => ({ ...m, [a.id]: { ...(m[a.id] ?? {}), [p.key]: e.target.value } }))
                      }
                    />
                  ))}
                </div>
              </div>
              <button className="btn btn-sm" disabled={busyId === a.id} onClick={() => confirmRun(a)}>
                {busyId === a.id ? '执行中…' : '执行'}
              </button>
              {result && (
                <div className="repair-result">
                  {result.kind === 'error' ? (
                    <p className="error">{result.error}</p>
                  ) : (
                    <div>
                      <p className={result.data.ok ? 'ok-text' : 'warn-text'}>
                        {result.data.ok ? result.data.message : '失败：' + result.data.message}
                      </p>
                      {result.data.log.slice(-6).map((l, i) => (
                        <div key={i} className="small muted">
                          {l}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
