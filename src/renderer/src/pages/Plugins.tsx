import { useState } from 'react'
import { api } from '../api'
import { useAsyncData } from '../hooks'
import { KindBadge } from '../components/StatusBadge'

export default function Plugins() {
  const profiles = useAsyncData(() => api.profiles())
  const [selected, setSelected] = useState<string>('')
  const [actionArgs, setActionArgs] = useState('add <package>')
  const [actionOutput, setActionOutput] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dump, setDump] = useState<string | null>(null)
  const [dumpBusy, setDumpBusy] = useState(false)

  const profile = profiles.data?.find((p) => p.name === (selected || profiles.data?.[0]?.name))

  const runAction = async () => {
    if (!profile) return
    setBusy(true)
    setActionOutput(null)
    setActionError(null)
    const res = await api.pluginAction(profile.name, actionArgs.trim().split(/\s+/))
    if (res.ok) {
      const r = res.data
      setActionOutput((r.stdout || '(无输出)') + (r.stderr ? '\n[stderr] ' + r.stderr : ''))
      setActionError(r.ok ? null : '插件命令退出码非 0，请检查输出')
      void profiles.reload()
    } else {
      setActionError(res.error)
    }
    setBusy(false)
  }

  const runDump = async (defaultOnly: boolean) => {
    if (!profile) return
    setDumpBusy(true)
    const res = await api.dumpConfig(profile.name, defaultOnly)
    setDump(res.ok ? res.data.output : '错误：' + res.error)
    setDumpBusy(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>插件管理</h1>
        <select value={selected || profile?.name || ''} onChange={(e) => setSelected(e.target.value)} className="select">
          {profiles.data?.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {profiles.error && <p className="error">{profiles.error}</p>}

      {profile && (
        <>
          <section className="card">
            <h2>
              profile <code>{profile.name}</code>：bundle 栈与插件
            </h2>
            <p className="muted small">
              目录：{profile.dir}｜bundles：{profile.bundles.join(' → ') || '（空）'}
            </p>
            <table className="checks">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>包名</th>
                  <th>已装版本</th>
                  <th>入栈</th>
                  <th>声明</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {profile.plugins.map((p) => (
                  <tr key={p.name}>
                    <td>
                      <KindBadge kind={p.kind} />
                    </td>
                    <td>
                      <code>{p.name}</code>
                    </td>
                    <td>{p.version ?? '—'}</td>
                    <td>{p.inBundlesList ? '✓' : ''}</td>
                    <td>{p.declared ? '✓' : ''}</td>
                    <td>
                      {!p.installed ? <span className="error-text">未安装</span> : <span className="ok-text">已安装</span>}
                      {p.outdated ? ' · 有新版' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2>插件操作（dsh plugin 转发）</h2>
            <p className="muted small">
              支持 pnpm 动词：add / remove / update / why / outdated 等。安装后 bundles 列表会自动 reconcile。
            </p>
            <div className="row">
              <input
                className="input"
                value={actionArgs}
                onChange={(e) => setActionArgs(e.target.value)}
                spellCheck={false}
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={runAction} disabled={busy}>
                {busy ? '执行中…' : '执行'}
              </button>
            </div>
            {actionError && <p className="error">{actionError}</p>}
            {actionOutput && (
              <pre className="output">
                {actionOutput}
              </pre>
            )}
          </section>

          <section className="card">
            <h2>配置树（--dump-config）</h2>
            <div className="row">
              <button className="btn" onClick={() => runDump(false)} disabled={dumpBusy}>
                导出完整配置
              </button>
              <button className="btn" onClick={() => runDump(true)} disabled={dumpBusy}>
                仅 bundle 层
              </button>
            </div>
            {dump && <pre className="output">{dump}</pre>}
          </section>
        </>
      )}
    </div>
  )
}
