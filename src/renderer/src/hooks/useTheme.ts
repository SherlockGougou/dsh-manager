import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ThemeMode } from '../../../core/types'

/** 主题 Hook：模式（system/light/dark）→ 主进程解析生效主题并推送 */
export function useTheme(): {
  mode: ThemeMode
  effective: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
} {
  const [mode, setMode] = useState<ThemeMode>('system')
  const [effective, setEffective] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    void api.themeGet().then((res) => {
      if (res.ok) setMode(res.data)
    })
    const off = api.onThemeChanged((theme) => setEffective(theme))
    return off
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = effective
  }, [effective])

  const setModeFn = (next: ThemeMode) => {
    setMode(next)
    void api.themeSet(next).then((res) => {
      if (res.ok) setEffective(res.data)
    })
  }

  return { mode, effective, setMode: setModeFn }
}
