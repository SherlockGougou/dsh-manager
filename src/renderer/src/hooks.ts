import { useCallback, useEffect, useRef, useState } from 'react'
import type { Result } from './api'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** 通用异步数据加载 Hook（自动防重复请求） */
export function useAsyncData<T>(fn: () => Promise<Result<T>>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fnRef.current()
    if (result.ok) setData(result.data)
    else setError(result.error)
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  useEffect(() => {
    void load()
  }, [load])

  return { data, error, loading, reload: () => setTick((t) => t + 1) }
}

/** 一次性动作（按钮触发） */
export function useAction<TReq, TRes>() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async (fn: (req: TReq) => Promise<Result<TRes>>, req: TReq): Promise<TRes | null> => {
    setBusy(true)
    setResult(null)
    setError(null)
    try {
      const res = await fn(req)
      if (res.ok) {
        setResult('操作成功')
        return res.data
      }
      setError(res.error)
      return null
    } catch (e) {
      setError(String(e))
      return null
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, result, error, run, setResult, setError }
}
