import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

type InvokeResult<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * 渲染层唯一通道：window.dshm。
 * 调用返回 { ok: true, data } 或 { ok: false, error }；
 * on() 订阅主进程推送事件（主题变更 / 更新进度），返回取消订阅函数。
 */
const api = {
  invoke<TRes = unknown>(channel: string, payload?: unknown): Promise<InvokeResult<TRes>> {
    return ipcRenderer.invoke(channel, payload) as Promise<InvokeResult<TRes>>
  },
  on<T>(channel: string, cb: (payload: T) => void): () => void {
    const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  send(channel: string, payload?: unknown): void {
    ipcRenderer.send(channel, payload)
  },
}

contextBridge.exposeInMainWorld('dshm', api)

export type DshmApi = typeof api
