import { api } from '../api'
import { useAsyncData } from '../hooks'

export default function Updates() {
  const updates = useAsyncData(() => api.updates())

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
