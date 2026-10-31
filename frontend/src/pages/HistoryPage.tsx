import { ArrowRight, AudioLines, History, Info, PhoneIncoming, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge, SimulatedBadge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/Feedback'
import { buttonClass } from '../components/ui/styles'
import { useHistory } from '../hooks/useHistory'
import { DEMO_CALL_PATH } from '../lib/callSimulation'
import { formatTimestamp } from '../lib/highlight'
import { clearHistory, formatCompletedAt, HISTORY_NOTICE, reportPath, type HistoryEntry, type HistorySource } from '../lib/history'
import { filterBySource, SOURCE_FILTERS, SOURCE_LABEL } from '../lib/historyFilter'
import { formatClock, highestScamLevel, RISK_VIEW } from '../lib/liveCall/view'
import { INTENT_VIEW, VOICE_VIEW } from '../lib/views'

const STATUS = { complete: 'Complete', partial: 'Partial results', failed: 'Analysis failed' } as const

export function HistoryPage() {
  const all = useHistory()
  const [source, setSource] = useState<HistorySource | 'all'>('all')
  const entries = filterBySource(all, source)
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-medium tracking-tight">History</h1>
          <p className="mt-2 max-w-2xl text-ink-2">Completed analyses and simulations from this tab.</p>
        </div>
        {entries.length > 0 && (
          <Button variant="ghost" size="sm" icon={Trash2} onClick={clearHistory}>
            Clear history
          </Button>
        )}
      </header>

      <p className="flex max-w-3xl items-start gap-2 text-sm text-ink-3">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {HISTORY_NOTICE}
      </p>

      {all.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by source">
          {SOURCE_FILTERS.map((option) => (
            <Button key={option.value} variant={option.value === source ? 'primary' : 'secondary'} size="sm" aria-pressed={option.value === source} onClick={() => setSource(option.value)}>
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {all.length > 0 && entries.length === 0 ? (
        <p className="text-sm text-ink-3">No {SOURCE_FILTERS.find((o) => o.value === source)?.label.toLowerCase()} in this tab's history.</p>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={History}
          title="No completed analyses yet"
          description="Analyze a recording, run a Lab sample, or finish the simulated call to see it here."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/analyze" className={buttonClass()}>
                <AudioLines className="size-4" aria-hidden />
                Analyze Audio
              </Link>
              <Link to={DEMO_CALL_PATH} className={buttonClass({ variant: 'secondary' })}>
                <PhoneIncoming className="size-4" aria-hidden />
                Launch Simulation
              </Link>
            </div>
          }
        />
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              <HistoryRow entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  return (
    <article className="flex flex-col gap-4 rounded-card border border-line bg-card p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {entry.kind === 'simulation' ? (
            <SimulatedBadge>Simulation</SimulatedBadge>
          ) : entry.kind === 'live-call' ? (
            <Badge tone="info">Real analysis · Live call</Badge>
          ) : (
            <Badge tone="info">{SOURCE_LABEL[entry.source]}</Badge>
          )}
          <span className="font-mono text-xs text-ink-3">{entry.id}</span>
          <span className="text-xs text-ink-3">{formatCompletedAt(entry.completedAt)}</span>
        </div>
        <h2 className="mt-2 truncate font-semibold text-ink" title={entry.title}>
          {entry.title}
        </h2>
        {entry.kind === 'analysis' ? (
          <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Result label="Status" value={STATUS[entry.report.status]} />
            {/* Two separate results, never combined. */}
            <Result label="Scam intent" value={INTENT_VIEW[entry.report.intent.risk].label} dot={INTENT_VIEW[entry.report.intent.risk].dot} />
            <Result label="Voice" value={VOICE_VIEW[entry.report.voice.verdict].label} dot={VOICE_VIEW[entry.report.voice.verdict].dot} />
          </dl>
        ) : entry.kind === 'deeptruth' ? (
          <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Result label="Status" value={STATUS[entry.report.status]} />
            <Result label="Media" value={entry.report.media.kind} />
            <Result label="Verdict" value={entry.report.verdict} />
            {entry.pageUrl && <Result label="Found on" value={new URL(entry.pageUrl).hostname} />}
          </dl>
        ) : entry.kind === 'live-call' ? (
          <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Result label="Duration" value={formatClock(entry.durationSeconds)} />
            <Result label="Alerts" value={String(entry.alerts.length)} />
            <Result label="Highest scam risk" value={RISK_VIEW[highestScamLevel(entry.alerts)].label} />
          </dl>
        ) : (
          <p className="mt-1 text-sm text-ink-2">
            {entry.status === 'finished' ? 'Played to the end' : `Ended at ${formatTimestamp(entry.elapsed)} of ${formatTimestamp(entry.duration)}`} · prewritten demo data
          </p>
        )}
      </div>
      <Link to={reportPath(entry.id)} className={buttonClass({ variant: 'secondary', className: 'shrink-0' })}>
        Open report
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </article>
  )
}

function Result({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-ink-3">{label}:</dt>
      <dd className="inline-flex items-center gap-1.5 text-ink-2">
        {dot && <span className={`size-2 rounded-full ${dot}`} aria-hidden />}
        {value}
      </dd>
    </div>
  )
}
