import type { HealthStatus } from '../../../core/types'

const LABEL: Record<HealthStatus, string> = {
  ok: '正常',
  warn: '警告',
  error: '异常',
  info: '信息',
  skip: '跳过',
}

export function StatusBadge({ status }: { status: HealthStatus }) {
  return <span className={'badge badge-' + status}>{LABEL[status]}</span>
}

export function KindBadge({ kind }: { kind: string }) {
  const label: Record<string, string> = {
    'builtin-bundle': '内置 bundle',
    'out-of-tree-bundle': '出树 bundle',
    'plain-dep': '普通依赖',
    orphan: '孤儿包',
  }
  return <span className={'badge badge-kind-' + kind}>{label[kind] ?? kind}</span>
}
