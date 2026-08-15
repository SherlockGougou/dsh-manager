import { contextBridge, ipcRenderer } from 'electron'

/**
 * 渲染层唯一通道：window.dshm。
 * 所有调用返回 { ok: true, data } 或 { ok: false, error }。
 */
const api = {
  invoke<TRes = unknown>(channel: string, payload?: unknown): Promise<{ ok: true; data: TRes } | { ok: false; error: string }> {
    return ipcRenderer.invoke(channel, payload) as Promise<{ ok: true; data: TRes } | { ok: false; error: string }>
  },
}

contextBridge.exposeInMainWorld('dshm', api)

export type DshmApi = typeof api
