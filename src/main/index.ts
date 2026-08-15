import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc.ts'
import { autoStartInstances, stopAllInstances } from '../core/instances.ts'
import { readPrefs } from '../core/manager-config.ts'
import { applyTheme, watchTheme, sendTheme } from './theme.ts'
import { setupUpdater } from './updater.ts'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'DSH Manager',
    show: false,
    // 无边框纯净窗口：macOS 保留原生红绿灯（hiddenInset），win/linux 用自绘控件
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#111418',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // 主题初始化：应用偏好 → nativeTheme → 推送生效主题到渲染层
  applyTheme(readPrefs().theme)
  watchTheme(() => mainWindow, () => readPrefs().theme)

  mainWindow.on('ready-to-show', () => {
    sendTheme(mainWindow, readPrefs().theme)
    mainWindow?.show()
  })
  mainWindow.webContents.on('did-finish-load', () => {
    sendTheme(mainWindow, readPrefs().theme)
  })

  // 外链一律交给系统浏览器，禁止在应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  // 应用内更新（打包安装后启用；开发模式仅提供 GitHub Release 信息）
  setupUpdater(() => mainWindow)
  // 自动拉起标记了 autoStart 的 dsh 实例（不影响主窗口启动）
  void autoStartInstances().then((result) => {
    if (result.started.length > 0) {
      console.log('[dsh-manager] 自动启动实例:', result.started.join(', '))
    }
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  if (readPrefs().instances.stopOnQuit) {
    event.preventDefault()
    quitting = true
    void stopAllInstances().finally(() => {
      app.quit()
    })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
