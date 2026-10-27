import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from './Button'

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return <Loader2 className={`animate-spin text-accent ${className}`} aria-hidden />
}

/** A block that is waiting on data. The label is announced to screen readers. */
export function LoadingState({ label, detail }: { label: string; detail?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <Spinner className="size-6" />
      <p className="text-sm font-medium text-ink">{label}</p>
      {detail && <p className="max-w-sm text-sm text-ink-3">{detail}</p>}
    </div>
  )
}

/** A placeholder bar shaped like the content that is loading. */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <span className={`block animate-pulse rounded-control bg-paper-2 ${className}`} aria-hidden />
}

/**
 * Something did not work: a failed request, an unusable file, a model that could not load. Amber, not red:
 * red is reserved for high-risk findings, and an operational error says nothing about the call being a scam.
 */
export function ErrorState({ title, message, onRetry, retryLabel = 'Try again', children }: { title: string; message: ReactNode; onRetry?: () => void; retryLabel?: string; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-card border border-amber-light/50 bg-amber-tint/40 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{title}</p>
          <div className="mt-1 text-sm text-ink-2">{message}</div>
          {(onRetry || children) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {onRetry && (
                <Button size="sm" onClick={onRetry}>
                  {retryLabel}
                </Button>
              )}
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-12 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-paper-2 text-ink-3">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="mt-3 font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-3">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
