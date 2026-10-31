import { AlertTriangle, GitCompareArrows, RotateCcw, Target } from 'lucide-react'
import { useEffect, useMemo } from 'react'

import { MODALITY_LABELS, timelineRows, verdictTone, type DeepTruthReport, type Evidence, type ModuleResult } from '../../lib/deeptruth'
import { formatBytes, formatDuration } from '../../lib/format'
import { Badge, Button, Card, CardHeader } from '../ui'
import { EvidenceTimeline } from './EvidenceTimeline'
import { Heatmap } from './Heatmap'
import { FusionRules, ModuleBreakdown } from './ModuleBreakdown'
import { ScoreGauge } from './ScoreGauge'
import { Spectrogram } from './Spectrogram'
import { SyncChart } from './SyncChart'

const pct = (value: number) => `${Math.round(value * 100)}%`
const moduleId = (modality: string) => `module-${modality}`

/**
 * The evidence dashboard: verdict and gauge, per-module breakdown, a shared timeline, each module's evidence, and the
 * limitations. The uploaded file is kept in memory only so an image can be shown under its heatmaps.
 */
export function DeepTruthResult({ report, file, onReset }: { report: DeepTruthReport; file: File | null; onReset: () => void }) {
  const imageUrl = useObjectUrl(report.media.kind === 'image' ? file : null)
  const { media } = report
  const hasTimeline = timelineRows(report).length > 0
  const jump = (modality: string) => document.getElementById(moduleId(modality))?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <section aria-label="DeepTruth result" className="rise space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-sm text-ink-3">
            {media.kind} · {media.format} · {formatBytes(media.size_bytes)}
            {media.duration_seconds != null && ` · ${formatDuration(media.duration_seconds)}`}
            {media.width && media.height && ` · ${media.width}×${media.height}`}
          </p>
          <h1 className="mt-1 break-words font-display text-3xl font-medium sm:text-4xl">{media.filename}</h1>
        </div>
        <Button variant="secondary" onClick={onReset}>
          <RotateCcw className="size-4" aria-hidden />
          Analyze another file
        </Button>
      </div>

      {/* Verdict */}
      <Card as="section" aria-labelledby="verdict">
        <div className="grid items-center gap-6 md:grid-cols-[18rem_1fr]">
          <ScoreGauge likelihood={report.manipulation_likelihood} verdict={report.verdict} />
          <div>
            <p className="text-sm text-ink-3">Verdict</p>
            <h2 id="verdict" className="mt-1 font-display text-3xl font-medium sm:text-4xl">
              {report.verdict}
            </h2>
            <p className="mt-2 text-sm text-ink-2">{report.verdict_reason}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={verdictTone(report.verdict)}>{report.verdict}</Badge>
              <Badge tone="neutral">Confidence {pct(report.confidence)}</Badge>
              <Badge tone={report.status === 'complete' ? 'success' : 'warning'}>{report.status === 'complete' ? 'All modules ran' : report.status === 'partial' ? 'Some modules unavailable' : 'No module could run'}</Badge>
            </div>
            {report.decided_by && (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-critical/25 bg-critical-tint p-3 text-sm text-ink-2">
                <Target className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
                <span>
                  Decided by <span className="font-medium text-ink">{MODALITY_LABELS[report.decided_by]}</span>, the only strong signal needed. The weighted average of all modules is {pct(report.weighted_average ?? report.manipulation_likelihood)}, shown for comparison in the breakdown below.
                </span>
              </p>
            )}
            {report.verdict === 'Mixed signals' && report.disagreement && (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-light/40 bg-amber-tint/50 p-3 text-sm text-amber">
                <GitCompareArrows className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  The {report.disagreement.join(' and ')} modules disagree, as happens when a real face is paired with a synthetic voice or the other way round. No average is given as the verdict; read each module below.
                </span>
              </p>
            )}
            <p className="mt-4 text-xs text-ink-3">{report.notice}</p>
          </div>
        </div>
      </Card>

      {/* Breakdown and limitations */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card as="section" className="lg:col-span-2" aria-labelledby="breakdown">
          <CardHeader id="breakdown" title="How the verdict was reached" description="Each module's own score, how much it is trusted, and its share of the weighted average. Click a module to see its evidence." />
          <div className="mt-4">
            <ModuleBreakdown modules={report.modules} decidedBy={report.decided_by} onJump={jump} />
          </div>
          {report.modules.length > 1 && (
            <p className="mt-3 font-mono text-xs text-ink-2">
              Weighted average of all modules: {pct(report.weighted_average ?? report.manipulation_likelihood)}
              {report.decided_by ? ` · headline uses the deciding module: ${pct(report.manipulation_likelihood)}` : ''}
            </p>
          )}
          <FusionRules />
        </Card>
        <Card as="section" tone="muted" aria-labelledby="limits">
          <CardHeader
            id="limits"
            title={
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber" aria-hidden />
                Known limitations
              </span>
            }
            description="Generated from this file's properties and each module's reliability. Specific points first."
          />
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-ink-2">
            {report.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </div>

      {hasTimeline && (
        <Card as="section" aria-labelledby="timeline">
          <CardHeader id="timeline" title="Timeline" description="Where in the clip each module flagged something. Hover a block for its score." />
          <div className="mt-4">
            <EvidenceTimeline report={report} />
          </div>
        </Card>
      )}

      {/* Evidence per module */}
      <div className="space-y-6">
        {report.modules.map((module) => (
          <ModuleCard key={module.modality} module={module} imageUrl={imageUrl} />
        ))}
      </div>
    </section>
  )
}

function ScoreBar({ label, value, note, muted }: { label: string; value: number; note: string; muted?: boolean }) {
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="font-mono text-ink-2">{pct(value)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-2" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        <div className={`h-full rounded-full ${muted ? 'bg-ink-3' : 'bg-accent'}`} style={{ width: pct(value) }} />
      </div>
      <p className="mt-1 text-xs text-ink-3">{note}</p>
    </div>
  )
}

function ModuleCard({ module, imageUrl }: { module: ModuleResult; imageUrl: string | null }) {
  return (
    <Card as="section" id={moduleId(module.modality)} aria-label={MODALITY_LABELS[module.modality]} className="scroll-mt-24">
      <CardHeader
        title={MODALITY_LABELS[module.modality]}
        description={module.models.length ? `Model: ${module.models.join(', ')}` : undefined}
        actions={module.status === 'unavailable' ? <Badge tone="warning">Unavailable</Badge> : <Badge tone="neutral">Reliability {pct(module.reliability)}</Badge>}
      />
      {module.checks && (
        <dl className="mt-4 grid gap-3 rounded-xl border border-line bg-paper-2 p-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-ink-3">What it checks</dt>
            <dd className="mt-0.5 text-ink-2">{module.checks}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-xs font-medium text-ink-3">
              How well it is known
              {module.basis && <Badge tone={module.basis === 'measured' ? 'info' : 'simulated'}>{module.basis === 'measured' ? 'Measured' : 'Heuristic'}</Badge>}
            </dt>
            <dd className="mt-0.5 text-ink-2">{module.basis_note}</dd>
          </div>
        </dl>
      )}
      {module.status === 'ok' ? (
        <>
          <ScoreBar label="Module score" value={module.score} note="0 = looks authentic, 1 = looks manipulated, on this module's own scale." />
          <p className="mt-4 text-sm text-ink-2">{module.summary}</p>
        </>
      ) : (
        <p className="mt-4 text-sm text-amber">{module.error}</p>
      )}
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {module.evidence.map((item, index) => (
          <div key={`${item.type}-${index}`} className={item.type === 'heatmap' ? '' : 'md:col-span-2'}>
            <EvidenceView evidence={item} imageUrl={imageUrl} />
          </div>
        ))}
      </div>
    </Card>
  )
}

function EvidenceView({ evidence, imageUrl }: { evidence: Evidence; imageUrl: string | null }) {
  if (evidence.type === 'spectrogram') {
    return (
      <div>
        <h3 className="text-sm font-medium text-ink">{evidence.label}</h3>
        <Spectrogram data={evidence.data} className="mt-2" />
      </div>
    )
  }
  if (evidence.type === 'heatmap') {
    return (
      <div>
        <h3 className="text-sm font-medium text-ink">{evidence.label}</h3>
        <div className="mt-2">
          <Heatmap data={evidence.data} imageUrl={imageUrl} label={evidence.label} />
        </div>
      </div>
    )
  }
  if (evidence.type === 'timeline' && evidence.data.series) {
    return (
      <div>
        <h3 className="text-sm font-medium text-ink">{evidence.label}</h3>
        <p className="mt-0.5 text-xs text-ink-3">Both lines are scaled to their own maximum. On camera speech, the mouth line rises when the audio line does.</p>
        <SyncChart series={evidence.data.series} className="mt-2" />
      </div>
    )
  }
  if (evidence.type === 'timeline') {
    const windows = evidence.data.windows ?? []
    const cutoff = evidence.data.cutoff
    return (
      <div>
        <h3 className="text-sm font-medium text-ink">{evidence.label}</h3>
        <p className="mt-0.5 text-xs text-ink-3">Each bar is one window the detector scored. A window counts as flagged from a raw score of {cutoff}.</p>
        <ol className="mt-2 flex h-16 items-end gap-1" aria-label="Window scores">
          {windows.map((w) => (
            <li
              key={w.start_seconds}
              title={`${w.start_seconds.toFixed(1)}–${w.end_seconds.toFixed(1)} s: raw score ${w.score.toFixed(2)}${w.flagged ? ' (flagged)' : ''}`}
              className={`flex-1 rounded-t ${w.flagged ? 'bg-critical' : 'bg-accent-light'}`}
              style={{ height: `${Math.max(w.score * 100, 4)}%` }}
            />
          ))}
          {windows.length === 0 && <li className="text-xs text-ink-3">No windows were scored.</li>}
        </ol>
      </div>
    )
  }
  if (evidence.type === 'metadata' && evidence.label === 'Detector reading') return <DetectorReading data={evidence.data} />
  const entries = Object.entries(evidence.data).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
  return (
    <details className="rounded-xl border border-line bg-paper-2 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-ink">{evidence.label}</summary>
      <dl className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="font-mono text-xs text-ink-3">{key}</dt>
            <dd className="break-words text-ink-2">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

interface DetectorRow {
  model: string
  fake_probability: number | null
  raw_output: number | null
  error: string | null
  members?: { model: string; raw_output: number | null; error: string | null }[] | null
}

/** The learned detector's own numbers: each model's raw output, then the calibrated score the verdict is built on. */
function DetectorReading({ data }: { data: Record<string, unknown> }) {
  const detectors = (data.detectors as DetectorRow[] | undefined) ?? []
  return (
    <div className="rounded-xl border border-line bg-paper-2 p-3 text-sm">
      <h3 className="font-medium text-ink">Detector reading</h3>
      <p className="mt-0.5 text-xs text-ink-3">{String(data.input ?? '')}</p>
      <ul className="mt-2 space-y-2">
        {detectors.map((d) => (
          <li key={d.model}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span className="font-medium text-ink">{d.model}</span>
              <span className="font-mono tabular-nums text-ink-2">{d.error ? `failed: ${d.error}` : `calibrated ${d.fake_probability?.toFixed(3)}`}</span>
            </div>
            {d.members && (
              <ul className="mt-1 space-y-0.5 pl-4 text-xs text-ink-2">
                {d.members.map((m) => (
                  <li key={m.model} className="flex flex-wrap justify-between gap-x-4">
                    <span>{m.model}</span>
                    <span className="font-mono tabular-nums">{m.error ? `failed: ${m.error}` : `raw p(fake) ${m.raw_output?.toFixed(4)}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-3">{String(data.calibration ?? '')}</p>
    </div>
  )
}

/** A browser URL for the file, revoked when the file changes or the view unmounts. */
function useObjectUrl(file: File | null): string | null {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )
  return url
}
