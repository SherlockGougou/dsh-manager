import { useState } from 'react'
import { api } from '../api'
import { useAsyncData } from '../hooks'
import type { ConfigFileDef } from '../../../core/types'

export default function Config() {
  const files = useAsyncData(() => api.configFiles())
  const [selected, setSelected] = useState<string>('settings')
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')
  const [reveal, setReveal] = useState(false)
  const [validateResult, setValidateResult] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ kind: 'same' | 'add' | 'del'; text: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const current: ConfigFileDef | undefined = files.data?.find((f) => f.id === selected)

  const load = async (id: string, revealFlag: boolean) => {
    setSelected(id)
    setValidateResult(null)
    setDiff(null)
    setSaved('')
    setError(null)
    const res = await api.configRead(id, revealFlag)
    if (res.ok) {
      setContent(res.data.content ?? '')
    } else {
      setError(res.error)
    }
  }

  const doValidate = async () => {
    setBusy(true)
    setValidateResult(null)
    const res = await api.configValidate(selected, content)
    if (res.ok) {
      const v = res.data
      const lines: string[] = []
      lines.push('YAML: ' + (v.yamlOk ? '✓ 合法' : '✗ ' + (v.yamlError ?? '')))
      if (v.patchOk !== null) {
        lines.push('dsh 全链路校验: ' + (v.patchOk ? '✓ 通过' : '✗ 失败'))
        if (v.patchOutput) lines.push(v.patchOutput.slice(0, 1500))
      }
      setValidateResult(lines.join(String.fromCharCode(10)))
    } else {
      setError(res.error)
    }
    setBusy(false)
  }

  const doSave = async () => {
    setBusy(true)
    setError(null)
    setSaved('')
    const res = await api.configSave(selected, content)
    if (res.ok) {
      const r = res.data.result
      if (r) {
        setSaved('已保存' + (r.backupPath ? '；备份: ' + r.backupPath : '') + (r.before !== r.after ? '；内容已变化' : ''))
        const d = await api.configDiff(r.before, r.after)
        if (d.ok) setDiff(d.data)
      }
    } else {
      setError(res.error)
    }
    setBusy(false)
  }

  const toggleReveal = () => {
    const next = !reveal
    setReveal(next)
    void load(selected, next)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>配置编辑器</h1>
        <div className="row" style={{ margin: 0 }}>
          {current?.masked && (
            <button className="btn" onClick={toggleReveal}>
              {reveal ? '隐藏敏感值' : '显示敏感值'}
            </button>
          )}
          <button className="btn" onClick={() => load(selected, reveal)} disabled={busy}>
            重新加载
          </button>
          <button className="btn btn-primary" onClick={doSave} disabled={busy}>
            保存（自动备份）
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {saved && <p className="ok-text">{saved}</p>}

      <section className="card">
        <h2>文件</h2>
        {files.data?.map((f) => (
          <div key={f.id} className="row" style={{ margin: '4px 0' }}>
            <button
              className={'nav-item' + (selected === f.id ? ' active' : '')}
              onClick={() => load(f.id, reveal)}
              style={{ flex: 1 }}
            >
              {f.label}
            </button>
            <span className="muted small">{f.exists ? '' : '（不存在，保存时创建）'}</span>
          </div>
        ))}
      </section>

      {current && (
        <>
          <section className="card">
            <div className="page-head">
              <h2>
                <code>{current.path}</code>
              </h2>
              <button className="btn" onClick={doValidate} disabled={busy}>
                校验
              </button>
            </div>
            {validateResult && <pre className="output">{validateResult}</pre>}
            <textarea
              className="editor"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              rows={22}
            />
            <p className="muted small">
              {current.masked && !reveal
                ? '凭据文件已掩码显示；保存时将写入完整内容（掩码值会替换原值！）。'
                : '保存前自动创建 .bak-<时间戳> 备份，并原子写入（避免 dsh 热重载读到半截文件）。'}
              {current.kind === 'profile-patch' ? ' 校验会调用 dsh --dump-config 做全链路验证。' : ''}
            </p>
          </section>

          {diff && diff.some((d) => d.kind !== 'same') && (
            <section className="card">
              <h2>变更差异</h2>
              <pre className="output diff">
                {diff.map((d, i) => (
                  <div key={i} className={'diff-' + d.kind}>
                    {d.kind === 'add' ? '+' : d.kind === 'del' ? '-' : ' '} {d.text}
                  </div>
                ))}
              </pre>
            </section>
          )}
        </>
      )}
    </div>
  )
}
