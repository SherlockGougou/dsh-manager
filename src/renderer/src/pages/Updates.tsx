import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAsyncData } from '../hooks'
import type { AppUpdateInfo } from '../../../core/types'

const STATE_LABEL: Record<string, string> = {
  dev: '开发模式',
  idle: '未检查',
  checking: '检查中…',
  available: '可更新',
  none: '已是最新',
  downloading: '下载中',
  downloaded: '已下载',
  error: '失败',
  unpublished: '未发布',
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024).toFixed(0) + ' KB'
}

export default function Updates() {
  const updates = useAsyncData(() => api.updates())
  const [appInfo, setAppInfo] = useState<AppUpdateInfo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.appUpdateState().then((res) => {
      if (res.ok) setAppInfo(res.data)
    })
    return api.onUpdateEvent((info) => setAppInfo(info))
  }, [])

  const checkApp = async () => {
    setBusy(true)
    const res = await api.appUpdateCheck()
    if (res.ok) setAppInfo(res.data)
    setBusy(false)
  }

  const downloadApp = async () => {
    setBusy(true)
    const res = await api.appUpdateDownload()
    if (res.ok) setAppInfo(res.data)
    setBusy(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>检查更新</h1>
        <button className="btn" onClick={updates.reload} disabled={updates.loading}>
          {updates.loading ? '检查中…' : '重新检查'}
        </button>
      </div>

      {updates.error && <p className="error">{updates.error}</p>}
      {updates.data && (
        <>
          <p className="muted small">检查时间：{new Date(updates.data.checkedAt).toLocaleString()}</p>
          <section className="card">
            <table className="checks">
              <thead>
                <tr>
                  <th>渠道</th>
                  <th>本机</th>
                  <th>最新</th>
                  <th>状态</th>
                  <th>发布时间</th>
                </tr>
              </thead>
              <tbody>
                {updates.data.channels.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <a href={c.url} target="_blank" rel="noreferrer">
                        {c.name}
                      </a>
                    </td>
                    <td>{c.local ?? '—'}</td>
                    <td>{c.latest ?? (c.error ? '查询失败' : '—')}</td>
                    <td>
                      {c.state === 'outdated' && <span className="warn-text">可更新</span>}
                      {c.state === 'up-to-date' && <span className="ok-text">已是最新</span>}
                      {c.state === 'unknown' && <span className="muted">未安装</span>}
                      {c.state === 'error' && <span className="error-text">错误</span>}
                    </td>
                    <td className="small muted">{c.publishedAt ? new Date(c.publishedAt).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <div className="page-head">
              <h2>应用自身更新（DSH Manager）</h2>
              <button className="btn" onClick={checkApp} disabled={busy || appInfo?.state === 'downloading'}>
                {appInfo?.state === 'checking' ? '检查中…' : '检查更新'}
              </button>
            </div>
            {appInfo && (
              <>
                <p>
                  当前版本 <code>v{appInfo.currentVersion}</code>{' '}
                  {appInfo.latest ? (
                    <span>
                      · 最新 <code>{appInfo.latest.tagName}</code>{' '}
                      {appInfo.latest.publishedAt ? '（' + new Date(appInfo.latest.publishedAt).toLocaleDateString() + '）' : ''}
                    </span>
                  ) : (
                    <span className="muted">· 仓库未发布或未配置（DSHM_GH_REPO）</span>
                  )}
                </p>
                {appInfo.state === 'dev' && (
                  <p className="muted small">
                    {appInfo.message ?? '开发模式：自动更新仅在打包安装后可用，可通过下方安装包手动升级。'}
                  </p>
                )}
                <p className="small">
                  状态：<span className={'badge ' + (appInfo.state === 'error' ? 'badge-error' : appInfo.state === 'available' || appInfo.state === 'downloaded' ? 'badge-ok' : 'badge-info')}>
                    {STATE_LABEL[appInfo.state] ?? appInfo.state}
                  </span>
                </p>
                {appInfo.state !== 'dev' && appInfo.message && (
                  <p className={appInfo.state === 'error' ? 'error-text' : 'ok-text'}>{appInfo.message}</p>
                )}
                {appInfo.progress !== null && appInfo.state === 'downloading' && (
                  <div className="progress">
                    <div className="progress-bar" style={{ width: appInfo.progress + '%' }} />
                    <span className="progress-text">{appInfo.progress}%</span>
                  </div>
                )}
                <div className="row">
                  {appInfo.state === 'available' && (
                    <button className="btn btn-primary" onClick={downloadApp} disabled={busy}>
                      下载并安装
                    </button>
                  )}
                  {appInfo.state === 'downloaded' && (
                    <button className="btn btn-primary" onClick={() => api.appUpdateInstall()}>
                      立即重启安装
                    </button>
                  )}
                  {appInfo.latest && (
                    <button
                      className="btn"
                      onClick={() => api.openPath('https://github.com/' + 'dsh-manager/dsh-manager/releases')}
                    >
                      打开 Releases 页
                    </button>
                  )}
                </div>
                {appInfo.latest && appInfo.latest.assets.length > 0 && (
                  <details className="release-details">
                    <summary>
                      安装包（{appInfo.latest.assets.length} 个，点击下载）
                    </summary>
                    <ul className="asset-list">
                      {appInfo.latest.assets.map((a) => (
                        <li key={a.name}>
                          <a href={a.downloadUrl} target="_blank" rel="noreferrer">
                            {a.name}
                          </a>{' '}
                          <span className="muted small">({fmtSize(a.size)})</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {appInfo.latest?.body && (
                  <details className="release-details">
                    <summary>发布说明</summary>
                    <pre className="output release-notes">{appInfo.latest.body.slice(0, 4000)}</pre>
                  </details>
                )}
              </>
            )}
          </section>

          <section className="card">
            <h2>升级流程（建议顺序）</h2>
            <ol className="steps">
              <li>
                <strong>备份</strong>：在"备份与恢复"页创建备份（默认排除凭据与 node_modules）
              </li>
              <li>
                <strong>停止实例</strong>：关闭正在运行的 dsh web（SIGTERM 优雅退出）
              </li>
              <li>
                <strong>升级</strong>：npm 形态执行{' '}
                <code>npm install -g @deepseek-ai/dsh@latest</code>；源码形态 git pull + pnpm install + pnpm run build；
                Python 形态 <code>pip install -U deepseek-harness-sdk</code>
              </li>
              <li>
                <strong>自检</strong>：回到"健康检查"页确认全绿；失败则用备份回滚
              </li>
            </ol>
            <p className="muted small">
              注意：dsh 处于 developer preview，版本间可能有破坏性变更（SESSION_FORMAT_VERSION 无兼容承诺），升级前务必备份。
            </p>
          </section>
        </>
      )}
    </div>
  )
}
