import { useState } from 'react'
import { api } from './api'
import { useAsyncData } from './hooks'
import { useTheme } from './hooks/useTheme'
import Dashboard from './pages/Dashboard'
import Instances from './pages/Instances'
import Health from './pages/Health'
import Plugins from './pages/Plugins'
import Sessions from './pages/Sessions'
import Config from './pages/Config'
import Market from './pages/Market'
import Updates from './pages/Updates'
import Backup from './pages/Backup'
import Settings from './pages/Settings'

type PageId = 'dashboard' | 'instances' | 'health' | 'plugins' | 'market' | 'sessions' | 'config' | 'updates' | 'backup' | 'settings'

const NAV: { id: PageId; label: string; icon: string }[] = [
  { id: 'dashboard', label: '仪表盘', icon: '◧' },
  { id: 'instances', label: '实例', icon: '▶' },
  { id: 'health', label: '健康检查', icon: '✚' },
  { id: 'plugins', label: '插件管理', icon: '▤' },
  { id: 'market', label: '插件市场', icon: '◈' },
  { id: 'sessions', label: '会话日志', icon: '≡' },
  { id: 'config', label: '配置', icon: '⚙' },
  { id: 'updates', label: '更新', icon: '⇅' },
  { id: 'backup', label: '备份与恢复', icon: '◫' },
  { id: 'settings', label: '设置', icon: '☰' },
]

export default function App() {
  const [page, setPage] = useState<PageId>('dashboard')
  const theme = useTheme()
  const env = useAsyncData(() => api.env())
  const isMac = env.data?.platform === 'darwin'

  return (
    <div className="app">
      {/* 无边框窗口标题栏：整条可拖拽；macOS 左侧留出原生红绿灯 */}
      <div className={'titlebar drag-region' + (isMac ? ' titlebar-mac' : '')}>
        <span className="titlebar-title">DSH Manager</span>
        <span className="titlebar-theme" title={'主题：' + (theme.mode === 'system' ? '跟随系统' : theme.mode === 'light' ? '浅色' : '深色')}>
          {theme.effective === 'dark' ? '◐ 深色' : '◑ 浅色'}
        </span>
        {!isMac && (
          <div className="window-controls no-drag">
            <button className="win-btn" title="最小化" onClick={() => api.windowMinimize()}>
              &#x2013;
            </button>
            <button className="win-btn" title="最大化/还原" onClick={() => api.windowToggleMaximize()}>
              &#x25A1;
            </button>
            <button className="win-btn win-btn-close" title="关闭" onClick={() => api.windowClose()}>
              &#x2715;
            </button>
          </div>
        )}
      </div>
      <div className="app-body">
        <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">DSH</span>
          <span className="brand-name">Manager</span>
        </div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={'nav-item' + (page === item.id ? ' active' : '')}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">DeepSeek Harness 独立管理器 v0.1.0</div>
        </aside>
        <main className="content">
          {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
          {page === 'instances' && <Instances />}
          {page === 'health' && <Health />}
          {page === 'plugins' && <Plugins />}
          {page === 'market' && <Market />}
          {page === 'sessions' && <Sessions />}
          {page === 'config' && <Config />}
          {page === 'updates' && <Updates />}
          {page === 'backup' && <Backup />}
          {page === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  )
}
