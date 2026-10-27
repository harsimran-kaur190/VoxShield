import { Ban, Hand, KeyRound, PhoneForwarded } from 'lucide-react'
import type { ReactNode } from 'react'

import { formatTimestamp } from '../../../lib/highlight'
import type { FoundIndicator, VoiceSummary } from '../../../lib/demoScenario'
import { FAKE_SCORE_NAME, formatFakeScore, VOICE_READING } from '../../../lib/score'
import type { ScamIntentBand } from '../../../lib/scamIntentScore'
import { VOICE_VIEW } from '../../../lib/views'
import { Badge, SimulatedBadge } from '../../ui/Badge'

function Panel({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h2 id={id} className="font-semibold text-ink">
          {title}
        </h2>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

const RADIUS = 42
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** The 0–100 score as a ring. The number and band are always written out, so colour is never the only cue. */
export function ScoreRing({ score, band, simulated }: { score: number; band: ScamIntentBand; simulated: boolean }) {
  return (
    <div role="img" aria-label={`Scam-intent score ${score} out of 100, ${band.label}${simulated ? ', simulated' : ''}`} className="relative size-32 shrink-0">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth="9" className="stroke-paper-2" />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - score / 100)}
          className={`${band.stroke} transition-[stroke-dashoffset] duration-500`}
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center" aria-hidden>
        <span className="text-3xl font-semibold tabular-nums text-ink">{score}</span>
        <span className="text-[11px] text-ink-3">of 100</span>
      </div>
    </div>
  )
}

export function ScamIntentCard({ score, band, found, simulated }: { score: number; band: ScamIntentBand; found: FoundIndicator[]; simulated: boolean }) {
  return (
    <Panel id="intent-score-heading" title="Scam-intent score" aside={simulated && <SimulatedBadge />}>
      <div className="flex items-center gap-5">
        <ScoreRing score={score} band={band} simulated={simulated} />
        <div className="min-w-0">
          <Badge tone={band.tone}>{band.label}</Badge>
          <p className="mt-2 text-sm text-ink-2">{band.summary}</p>
        </div>
      </div>
      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-3">Contributing evidence</h3>
      {found.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">Nothing flagged yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm">
          {found.map((indicator) => (
            <li key={indicator.id} className="flex items-baseline justify-between gap-3">
              <span className="text-ink">{indicator.label}</span>
              <span className="shrink-0 font-mono text-xs text-ink-3">+{indicator.weight}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 border-t border-line pt-3 text-xs text-ink-3">
        {simulated && 'Simulated demo data. '}Fixed, illustrative weights; not a calibrated probability. Voice analysis is reported separately and is not part of this score.
      </p>
    </Panel>
  )
}

export function VoiceAuthenticityCard({ voice, simulated, note }: { voice: VoiceSummary | null; simulated: boolean; note?: string }) {
  const verdict = voice?.verdict ?? 'unavailable'
  const view = VOICE_VIEW[verdict]
  const unavailable = verdict === 'unavailable'
  return (
    <Panel id="voice-heading" title="Voice authenticity" aside={simulated && !unavailable && <SimulatedBadge />}>
      <p className="inline-flex items-center gap-2 font-medium text-ink">
        <span className={`size-2.5 rounded-full ${view.dot}`} aria-hidden />
        {view.label}
      </p>
      <p className="mt-2 text-sm text-ink-2">{VOICE_READING[verdict]}</p>
      {voice && !unavailable && voice.fake_score_median !== null && (
        <p className="mt-2 font-mono text-xs text-ink-3">
          median {FAKE_SCORE_NAME} {formatFakeScore(voice.fake_score_median)} (not a probability) · {voice.windows_analyzed} windows{simulated && ' · simulated'}
        </p>
      )}
      {note && <p className="mt-3 rounded-control bg-paper-2 p-3 text-xs text-ink-2">{note}</p>}
      {voice && voice.limitations.length > 0 && (
        <details className="mt-3 text-xs text-ink-3">
          <summary className="flex min-h-6 cursor-pointer items-center underline-offset-4 hover:underline pointer-coarse:min-h-11">What this model cannot tell you</summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {voice.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">Separate from the scam-intent score. A genuine voice can be used for a scam, and a synthetic voice is not proof of one.</p>
    </Panel>
  )
}

export function IntentAnalysisCard({ found, onSelectEvidence }: { found: FoundIndicator[]; onSelectEvidence: (evidenceId: string, segmentId: string) => void }) {
  return (
    <Panel id="intent-analysis-heading" title="Intent analysis" aside={<span className="text-xs text-ink-3">{found.length} found</span>}>
      {found.length === 0 ? (
        <p className="text-sm text-ink-3">No indicators in the script so far.</p>
      ) : (
        <ul className="space-y-4">
          {found.map((indicator) => (
            <li key={indicator.id}>
              <p className="text-sm font-medium text-ink">{indicator.label}</p>
              <p className="mt-0.5 text-sm text-ink-2">{indicator.explanation}</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {indicator.evidence.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelectEvidence(item.id, item.segmentId)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2 hover:border-accent hover:text-accent-deep pointer-coarse:min-h-11"
                    >
                      <span className="font-mono text-ink-3">{formatTimestamp(item.start)}</span>“{item.phrase}”<span className="sr-only">, show in transcript</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 border-t border-line pt-3 text-xs text-ink-3">Illustrative indicators for a simulated scenario, not a determination that a caller is malicious.</p>
    </Panel>
  )
}

const ACTIONS = [
  { icon: Ban, text: 'Do not transfer money based solely on an urgent voice request.' },
  { icon: PhoneForwarded, text: 'Verify the caller through a known, independent contact method, such as a number you already have.' },
  { icon: KeyRound, text: 'Do not share passwords, OTPs or verification codes.' },
  { icon: Hand, text: 'End the interaction if you feel pressured.' },
]

export function RecommendationsCard() {
  return (
    <Panel id="actions-heading" title="Recommended next actions">
      <ul className="space-y-3">
        {ACTIONS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex gap-3 text-sm text-ink">
            <Icon className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            {text}
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-line pt-3 text-xs text-ink-3">VoxShield does not block calls or payments. These steps are yours to take.</p>
    </Panel>
  )
}
