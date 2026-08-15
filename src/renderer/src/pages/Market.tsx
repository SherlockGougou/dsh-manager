import { useMemo, useState } from 'react'
import { api } from '../api'
import { useAsyncData } from '../hooks'
import type { MarketplaceEntry } from '../../../core/types'

function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—'
}

export default function Market() {
  const market = useAsyncData(() => api.marketplace())
  const profiles = useAsyncData(() => api.profiles())
  const [filter, setFilter] = useState('')
  const [source, setSource] = useState<'all' | 'github' | 'npm'>('all')
  const [installTo, setInstallTo] = useState<Record<string, string>>({})
  const [busySpec, setBusySpec] = useState<string | null>(null)
  const [output, setOutput] = useState<Record<string, { ok: boolean; text: string }>>({})

  const entries = useMemo(() => {
    const list = market.data?.entries ?? []
    const q = filter.trim().toLowerCase()
    return list.filter((e) => {
      if (source !== 'all' && e.source !== source) return false
      if (!q) return true
      return e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q)
    })
  }, [market.data, filter, source])

  const doInstall = async (entry: MarketplaceEntry) => {
    const profile = installTo[entry.name] ?? profiles.data?.[0]?.name
    if (!profile) return
    setBusySpec(entry.name)
    setOutput((m) => ({ ...m, [entry.name]: { ok: false, text: '安装中…' } }))
    const res = await api.pluginAction(profile, ['add', entry.installSpec])
    if (res.ok) {
      const r = res.data
      setOutput((m) => ({
        ...m,
        [entry.name]: { ok: r.ok, text: (r.stdout || '(无输出)') + (r.stderr ? String.fromCharCode(10) + '[stderr] ' + r.stderr : '') },
      }))
    } else {
      setOutput((m) => ({ ...m, [entry.name]: { ok: false, text: '调用失败: ' + res.error } }))
    }
    setBusySpec(null)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>插件市场</h1>
        <button
          className="btn"
          onClick={() => market.reload()}
          disabled={market.loading}
          title="GitHub 匿名 API 限额 60 次/小时，结果缓存 10 分钟"
        >
          {market.loading ? '检索中…' : '刷新（清缓存）'}
        </button>
      </div>

      {market.error && <p className="error">{market.error}</p>}
      {market.data?.cached && <p className="muted small">已显示缓存结果（10 分钟内）· 检索时间 {new Date(market.data.fetchedAt).toLocaleString()}</p>}
      {market.data?.errors.map((e) => (
        <p key={e} className="warn-text small">
          {e}
        </p>
      ))}

      <section className="card">
        <div className="row" style={{ marginTop: 0 }}>
          <input className="input" placeholder="搜索名称 / 描述…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }} />
          <select className="select" value={source} onChange={(e) => setSource(e.target.value as 'all' | 'github' | 'npm')}>
            <option value="all">全部渠道</option>
            <option value="github">GitHub（topic: dsh-plugin）</option>
            <option value="npm">npm（keywords: dsh-plugin）</option>
          </select>
        </div>
        <p className="muted small">
          共 {entries.length} 个插件。来源：GitHub topic 检索（官方推荐发现渠道）+ npm 关键字检索。安装将转发官方
          <code> dsh plugin add </code>
          流程（自动处理 allowBuilds 与 bundle reconcile）。
        </p>
      </section>

      {entries.map((entry) => (
        <section key={entry.name} className="card">
          <div className="market-head">
            <div>
              <a href={entry.url} target="_blank" rel="noreferrer">
                <strong>{entry.name}</strong>
              </a>
              {entry.source === 'github' ? (
                <span className="badge badge-info">GitHub</span>
              ) : (
                <span className="badge badge-ok">npm</span>
              )}
              {entry.dshBundlePatch && <span className="badge badge-kind-out-of-tree-bundle">dsh bundle</span>}
              {entry.version ? <span className="muted small">v{entry.version}</span> : null}
              {entry.stars !== undefined ? <span className="muted small">★ {entry.stars}</span> : null}
              <span className="muted small">更新 {fmtTime(entry.updatedAt)}</span>
            </div>
            <div className="row" style={{ margin: 0 }}>
              <select
                className="select"
                value={installTo[entry.name] ?? profiles.data?.[0]?.name ?? ''}
                onChange={(e) => setInstallTo((m) => ({ ...m, [entry.name]: e.target.value }))}
              >
                {profiles.data?.map((p) => (
                  <option key={p.name} value={p.name}>
                    安装到 {p.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm btn-primary" disabled={busySpec === entry.name} onClick={() => doInstall(entry)}>
                {busySpec === entry.name ? '安装中…' : '安装'}
              </button>
            </div>
          </div>
          {entry.description && <p className="muted small">{entry.description}</p>}
          {(entry.topics ?? []).length > 0 && (
            <p className="small">
              {(entry.topics ?? []).slice(0, 6).map((t) => (
                <span key={t} className="badge badge-skip">
                  {t}
                </span>
              ))}
            </p>
          )}
          <p className="small muted">
            install spec: <code>{entry.installSpec}</code>
          </p>
          {output[entry.name] && (
            <pre className={'output' + (output[entry.name]!.ok ? '' : ' output-warn')}>{output[entry.name]!.text}</pre>
          )}
        </section>
      ))}

      {!market.loading && entries.length === 0 && (
        <p className="muted">
          {market.data?.errors.length ? '检索失败（见上方提示，可能是网络或 API 限额）' : '没有匹配的插件'}
        </p>
      )}
    </div>
  )
}
