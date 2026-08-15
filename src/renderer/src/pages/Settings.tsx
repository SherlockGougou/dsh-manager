import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ManagerPrefs } from '../../../core/types'

export default function Settings() {
  const [prefs, setPrefs] = useState<ManagerPrefs | null>(null)
  const [paths, setPaths] = useState<{ managerDir: string; backupsDir: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [p, d] = await Promise.all([api.prefs(), api.paths()])
      if (p.ok) setPrefs(p.data)
      if (d.ok) setPaths(d.data)
    })()
  }, [])

  const save = async () => {
    if (!prefs) return
    const res = await api.prefsSet(prefs)
    if (res.ok) {
      setPrefs(res.data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setError(res.error)
    }
  }

  return (
    <div className="page">
      <h1>设置</h1>
      {error && <p className="error">{error}</p>}
      {saved && <p className="ok-text">已保存</p>}

      {prefs && (
        <>
          <section className="card">
            <h2>备份偏好</h2>
            <div className="row">
              <label className="checkbox">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={prefs.backup.retention}
                  onChange={(e) =>
                    setPrefs({ ...prefs, backup: { ...prefs.backup, retention: Number(e.target.value) || 10 } })
                  }
                  className="input number"
                />
                保留最近 N 份备份（超出自动清理）
              </label>
            </div>
          </section>

          <section className="card">
            <h2>更新偏好</h2>
            <div className="row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={prefs.update.autoCheckOnStart}
                  onChange={(e) => setPrefs({ ...prefs, update: { ...prefs.update, autoCheckOnStart: e.target.checked } })}
                />
                启动时自动检查更新
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={prefs.update.notifyOnUpdate}
                  onChange={(e) => setPrefs({ ...prefs, update: { ...prefs.update, notifyOnUpdate: e.target.checked } })}
                />
                发现新版本时通知
              </label>
            </div>
          </section>

          <section className="card">
            <h2>管理器路径</h2>
            {paths && (
              <table className="kv">
                <tbody>
                  <tr>
                    <td>管理器目录</td>
                    <td>
                      {paths.managerDir}{' '}
                      <button className="btn btn-sm" onClick={() => api.openPath(paths.managerDir)}>
                        打开
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td>备份目录</td>
                    <td>
                      {paths.backupsDir}{' '}
                      <button className="btn btn-sm" onClick={() => api.openPath(paths.backupsDir)}>
                        打开
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>

          <button className="btn btn-primary" onClick={save}>
            保存设置
          </button>
        </>
      )}
    </div>
  )
}
