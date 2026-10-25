import { AlertTriangle } from 'lucide-react'

interface Props {
  title: string
  message: string
  onRetry?: () => void
  onDismiss: () => void
  dismissLabel?: string
}

export function ErrorNotice({ title, message, onRetry, onDismiss, dismissLabel = 'Choose another file' }: Props) {
  return (
    <div role="alert" className="rise rounded-2xl border border-danger/30 bg-card p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-danger">{title}</p>
          <p className="mt-1 text-sm text-ink-2">{message}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {onRetry && (
              <button type="button" onClick={onRetry} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink-2">
                Try again
              </button>
            )}
            <button type="button" onClick={onDismiss} className="rounded-full border border-line-strong px-4 py-2 text-sm hover:bg-paper-2">
              {dismissLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
