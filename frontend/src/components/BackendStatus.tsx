import type { BackendState } from '../hooks/useApi'

const styles = {
  checking: { dot: 'bg-line-strong animate-pulse', text: 'Connecting…' },
  online: { dot: 'bg-ok', text: 'Server online' },
  offline: { dot: 'bg-amber-light', text: 'Server offline' },
} as const

export function BackendStatus({ state }: { state: BackendState }) {
  const view = styles[state.status]
  return (
    <p role="status" className="inline-flex items-center gap-2 text-sm text-ink-3">
      <span className={`size-2 rounded-full ${view.dot}`} aria-hidden />
      {view.text}
    </p>
  )
}
