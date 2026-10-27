import { Info } from 'lucide-react'
import { useState } from 'react'

import { formatTimestamp } from '../../lib/highlight'
import { DEMO_CALL_PATH } from '../../lib/callSimulation'
import {
  alertReached,
  demoScore,
  indicatorsFound,
  segmentDomId,
  segmentsReached,
  SIMULATION_NOTICE,
  SPOKEN_VOICE_NOTE,
  splitByEvidence,
  type DemoScenario,
} from '../../lib/demoScenario'
import type { SimulationEntry } from '../../lib/history'
import { scamIntentBand } from '../../lib/scamIntentScore'
import { SimulatedAlert } from '../demo/dashboard/DashboardChrome'
import { IntentAnalysisCard, RecommendationsCard, ScamIntentCard, VoiceAuthenticityCard } from '../demo/dashboard/Panels'
import { scrollToId } from '../results/scroll'
import { SimulatedBadge } from '../ui/Badge'
import { ReportFrame, ReportSection } from './ReportFrame'

/**
 * The report for one simulated call. Every value is recomputed from the prewritten scenario and how far that run
 * played, exactly as the simulated dashboard showed it. Nothing here came from the backend or a model.
 */
export function SimulationReportDocument({ entry, scenario }: { entry: SimulationEntry; scenario: DemoScenario }) {
  const [selected, setSelected] = useState<string | null>(null)
  const reached = segmentsReached(scenario, entry.elapsed)
  const reachedIds = new Set(reached.map((segment) => segment.id))
  const found = indicatorsFound(scenario, reached)
  const score = demoScore(found)
  const band = scamIntentBand(score, found.reduce((n, indicator) => n + indicator.evidence.length, 0))
  const alertShown = alertReached(scenario, entry.elapsed)
  const label = (id: string) => scenario.indicators.find((indicator) => indicator.id === id)?.label ?? id

  const select = (evidenceId: string, segmentId: string) => {
    setSelected(evidenceId)
    scrollToId(segmentDomId(segmentId))
  }

  return (
    <ReportFrame
      id={entry.id}
      completedAt={entry.completedAt}
      typeBadge={<SimulatedBadge>Simulated report</SimulatedBadge>}
      typeLabel="Simulation: prewritten script with a fictional caller. Not a real analysis."
      title={scenario.title}
      back={{ to: DEMO_CALL_PATH, label: 'Run the simulation again' }}
      facts={[
        ['Caller', `${scenario.caller.name} (fictional) · ${scenario.caller.claimed}`],
        [
          'Outcome',
          entry.status === 'finished'
            ? `Played to the end (${formatTimestamp(entry.duration)})`
            : `Ended by you at ${formatTimestamp(entry.elapsed)} of ${formatTimestamp(entry.duration)}`,
        ],
      ]}
    >
      <p className="flex items-start gap-2 rounded-card border border-dashed border-ink-3 bg-paper-2 p-4 text-sm text-ink-2">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {SIMULATION_NOTICE}
      </p>

      {alertShown ? (
        <SimulatedAlert band={band} />
      ) : (
        <p className="rounded-card border border-line bg-card p-4 text-sm text-ink-2">
          No simulated alert was shown: the simulation ended before the point the scenario is configured to raise one.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <ScamIntentCard score={score} band={band} found={found} simulated />
        <VoiceAuthenticityCard voice={scenario.voice} simulated note={SPOKEN_VOICE_NOTE} />
        <IntentAnalysisCard found={found} onSelectEvidence={select} />
        <RecommendationsCard />
      </div>

      <ReportSection id="sim-transcript" kicker="Transcript" title="The simulation script">
        <p className="text-sm text-ink-3">Prewritten script, not speech recognition. Times are the script’s own cue points.</p>
        <ol className="mt-3 divide-y divide-line rounded-card border border-line bg-card">
          {scenario.segments.map((segment) => {
            const played = reachedIds.has(segment.id)
            return (
              <li key={segment.id} id={segmentDomId(segment.id)} className={`scroll-mt-24 px-4 py-3 ${played ? '' : 'opacity-60'}`}>
                <div className="flex gap-3">
                  <span className="w-10 shrink-0 font-mono text-xs text-ink-3">{formatTimestamp(segment.start)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="leading-relaxed text-ink">
                      {splitByEvidence(segment).map((part, i) =>
                        part.evidence && played ? (
                          <mark key={i} className={`rounded px-0.5 text-ink ${selected === part.evidence.id ? 'bg-amber-light/60' : 'bg-amber-tint'}`}>
                            {part.text}
                          </mark>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                    </p>
                    {played ? (
                      segment.evidence.map((item) => (
                        <p key={item.id} className="mt-1 text-xs text-ink-2">
                          <span className="font-medium">“{item.phrase}”</span> · {label(item.indicatorId)}: {item.why}
                        </p>
                      ))
                    ) : (
                      <p className="mt-1 text-xs text-ink-3">Not reached before the simulation was ended, so not counted above.</p>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </ReportSection>

      <section aria-labelledby="sim-limits" className="rounded-card border border-line bg-paper-2 p-5">
        <h2 id="sim-limits" className="font-semibold text-ink">
          Limits of this report
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>The script, the flagged phrases, the score weights, the alert point and the voice values are all written in advance for this demonstration.</li>
          <li>No audio was sent to the VoxShield backend, and no model produced any value on this page.</li>
          <li>VoxShield does not intercept, record or end phone calls. To check a real recording, use Analyze Audio.</li>
        </ul>
      </section>
    </ReportFrame>
  )
}
