import { api } from '../api'
import { useAsyncData } from '../hooks'

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

export default function Dashboard({ onNavigate }: { onNavigate: (page: 'health' | 'backup' | 'updates') => void }) {
  const env = useAsyncData(() => api.env())
  const scan = useAsyncData(() => api.scanHome())

  const e = env.data

  return (
    <div className="page">
      <h1>仪表盘</h1>

      <section className="grid">
        <div className="card">
          <h2>运行时环境</h2>
          {env.loading && <p className="muted">加载中…</p>}
          {env.error && <p className="error">{env.error}</p>}
          {e && (
            <table className="kv">
              <tbody>
                <tr>
                  <td>平台</td>
                  <td>
                    {e.platform} / {e.arch}
                  </td>
                </tr>
                <tr>
                  <td>Node.js</td>
                  <td>
                    {e.node.version ?? '未检测'} <span className={'dot dot-' + (e.node.ok ? 'ok' : 'error')} />
                  </td>
                </tr>
                <tr>
                  <td>pnpm</td>
                  <td>
                    {e.pnpm.version ?? '未检测'} <span className={'dot dot-' + (e.pnpm.ok ? 'ok' : 'error')} />
                  </td>
                </tr>
                <tr>
                  <td>dsh</td>
                  <td>
                    {e.dsh.found ? (
                      <>
                        {e.dsh.version ?? '未知版本'}（{e.dsh.form}）
                        {e.dsh.path ? <div className="muted small">{e.dsh.path}</div> : null}
                      </>
                    ) : (
                      <span className="error-text">未安装</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>DSH_HOME</td>
                  <td>
                    {e.home.display}
                    <div className="muted small">{e.home.path}</div>
                  </td>
                </tr>
                <tr>
                  <td>Web 实例（:3080）</td>
                  <td>
                    {e.runningWeb?.listening ? (
                      <span className="ok-text">● 监听中</span>
                    ) : (
                      <span className="muted">○ 未运行</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>数据总览</h2>
          {scan.loading && <p className="muted">加载中…</p>}
          {scan.error && <p className="error">{scan.error}</p>}
          {scan.data && (
            <table className="kv">
              <tbody>
                <tr>
                  <td>总大小</td>
                  <td>{fmtBytes(scan.data.totalBytes)}</td>
                </tr>
                <tr>
                  <td>会话日志</td>
                  <td>
                    {scan.data.sessions.logs} 个 / {fmtBytes(scan.data.sessions.bytes)}
                  </td>
                </tr>
                <tr>
                  <td>工作区</td>
                  <td>{scan.data.sessions.dirs} 个</td>
                </tr>
                <tr>
                  <td>附件</td>
                  <td>{fmtBytes(scan.data.attachmentsBytes)}</td>
                </tr>
                <tr>
                  <td>存储状态</td>
                  <td>{fmtBytes(scan.data.storagesBytes)}</td>
                </tr>
                <tr>
                  <td>最大文件</td>
                  <td>
                    {scan.data.largest.slice(0, 2).map((f) => (
                      <div key={f.path} className="small muted" title={f.path}>
                        {f.path.split('/').pop()}（{fmtBytes(f.bytes)}）
                      </div>
                    ))}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="card">
        <h2>快捷操作</h2>
        <div className="row">
          <button className="btn" onClick={() => onNavigate('health')}>
            运行健康检查
          </button>
          <button className="btn" onClick={() => onNavigate('backup')}>
            创建备份
          </button>
          <button className="btn" onClick={() => onNavigate('updates')}>
            检查更新
          </button>
        </div>
        <p className="muted small">
          提示：本管理器只读 dsh 数据面（DSH_HOME），所有修复/备份操作都会先做快照。请勿在 dsh 运行中直接编辑
          sessions/ 目录。
        </p>
      </section>
    </div>
  )
}
