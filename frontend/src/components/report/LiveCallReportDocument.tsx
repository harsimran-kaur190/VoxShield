import { Badge } from '../ui/Badge'
import { AlertCard } from '../live/AlertCard'
import { SafetySteps, TranscriptPanel } from '../live/LivePanels'
import { formatCompletedAt, type LiveCallEntry } from '../../lib/history'
import { formatClock, highestScamLevel, LIVE_CALL_PATH, RISK_VIEW } from '../../lib/liveCall/view'
import { ReportFrame, ReportSection, Unavailable } from './ReportFrame'

const ENDED = { you: 'Ended by you', peer: 'Ended by the other person', lost: 'Connection lost', error: 'Ended by an error' } as const

/** The record of one live call: the alerts this listener received and the transcript of the other person's audio. */
export function LiveCallReportDocument({ entry }: { entry: LiveCallEntry }) {
  const level = highestScamLevel(entry.alerts)
  const flagged = entry.alerts.flatMap((alert) => alert.evidence.map((item) => item.sentence))
  return (
    <ReportFrame
      id={entry.id}
      completedAt={entry.completedAt}
      typeBadge={<Badge tone="info">Real analysis · Live call</Badge>}
      typeLabel="Live Call Protection: the other participant's audio, analysed during the call in overlapping windows."
      title="Live call report"
      back={{ to: LIVE_CALL_PATH, label: 'Start a new call' }}
      facts={[
        ['Call started', entry.startedAt ? formatCompletedAt(entry.startedAt) : 'Audio never connected'],
        ['Duration', `${formatClock(entry.durationSeconds)}${entry.endReason ? ` · ${ENDED[entry.endReason]}` : ''}`],
        ['Windows analysed', `${entry.analysisRuns}${entry.lastAnalysisAt ? ` · last result ${formatCompletedAt(entry.lastAnalysisAt)}` : ''}`],
        ['Highest scam risk', RISK_VIEW[level].label],
      ]}
    >
      {entry.limitations.length > 0 && (
        <section aria-label="Analysis limitations" className="rounded-card border border-amber-light/50 bg-amber-tint/40 p-4 text-sm text-amber">
          <p className="font-semibold">The analysis of this call was incomplete or limited</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {entry.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      <ReportSection id="live-alerts" kicker="01" title="Alerts during the call">
        {entry.alerts.length === 0 ? (
          <Unavailable>No alerts were raised. That means the analysis did not flag anything it heard, not that the call was safe.</Unavailable>
        ) : (
          <div className="space-y-3">
            {/* In the order they were raised, so the report reads as a timeline of the call. */}
            {[...entry.alerts].reverse().map((alert) => (
              <AlertCard key={alert.id} alert={alert} defaultOpen />
            ))}
          </div>
        )}
      </ReportSection>
      <ReportSection id="live-transcript" kicker="02" title="Transcript of the other person">
        <TranscriptPanel lines={entry.transcript} flagged={flagged} />
      </ReportSection>
      <ReportSection id="live-steps" kicker="03" title="Safety steps">
        <SafetySteps />
      </ReportSection>
    </ReportFrame>
  )
}
