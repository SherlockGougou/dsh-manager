import { nativeTheme, BrowserWindow } from 'electron'
import type { ThemeMode } from '../core/types.ts'

/**
 * 主题管理：模式（system/light/dark）→ nativeTheme.themeSource，
 * 并把"生效主题"（system 解析后）推送给渲染层。
 */

export function effectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : mode
}

export function applyTheme(mode: ThemeMode): void {
  nativeTheme.themeSource = mode
}

export function sendTheme(window: BrowserWindow | null, mode: ThemeMode): void {
  window?.webContents.send('dshm:theme-changed', effectiveTheme(mode))
}

export function watchTheme(getWindow: () => BrowserWindow | null, getMode: () => ThemeMode): void {
  nativeTheme.on('updated', () => {
    // system 模式下跟随系统切换
    if (getMode() === 'system') sendTheme(getWindow(), 'system')
  })
}
