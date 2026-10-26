import { AudioLines, MessageSquareText } from 'lucide-react'
import type { ReactNode } from 'react'

import { FAKE_SCORE_NAME, formatFakeScore } from '../../lib/score'
import type { FindingGroup } from '../../lib/playback'
import { INTENT_VIEW, VOICE_VIEW } from '../../lib/views'
import type { AnalysisReport } from '../../lib/types'
import { scrollToId } from './scroll'

interface Props {
  report: AnalysisReport
  groups: FindingGroup[]
}

interface PanelProps {
  id: string
  icon: ReactNode
  kicker: string
  label: string
  dot: string
  /** What this check looks at, so the two are never confused. */
  basis: string
  /** Numbers or counts taken from the result, never invented. */
  detail: string | null
  /** Shown only when the check could not give an answer, so that silence is not read as reassurance or alarm. */
  uncertainty: string | null
  target: string
}

function Panel({ id, icon, kicker, label, dot, basis, detail, uncertainty, target }: PanelProps) {
  return (
    <div className="py-5 first:pt-0 last:pb-0 md:py-0 md:first:pr-10 md:last:pl-10">
      <p className="flex items-center gap-2 font-mono text-sm text-ink-3">
        <span aria-hidden className="text-ink-2">
          {icon}
        </span>
        {kicker}
      </p>
      <h3 id={id} className="mt-2 flex items-center gap-2.5 font-display text-3xl font-medium leading-tight">
        <span className={`size-3 shrink-0 rounded-full ${dot}`} aria-hidden />
        {label}
      </h3>
      <p className="mt-2 text-sm text-ink-2">{basis}</p>
      {detail && <p className="mt-1 font-mono text-xs text-ink-3">{detail}</p>}
      {uncertainty && <p className="mt-2 text-ink-2">{uncertainty}</p>}
      <button
        type="button"
        onClick={() => scrollToId(target)}
        className="mt-1 inline-flex items-center rounded text-sm text-accent underline underline-offset-4 hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 pointer-coarse:min-h-11 lg:hidden"
      >
        See the details
      </button>
    </div>
  )
}

/** The two assessments side by side, each with its own label and its own basis. Nothing here combines them. */
export function Overview({ report, groups }: Props) {
  const { voice, intent } = report
  const voiceView = VOICE_VIEW[voice.verdict]
  const intentView = INTENT_VIEW[intent.risk]
  const voiceDetail =
    voice.fake_score_median !== null && voice.windows_analyzed > 0
      ? `median ${FAKE_SCORE_NAME} ${formatFakeScore(voice.fake_score_median)} (not a probability) · ${voice.windows_analyzed} window${voice.windows_analyzed === 1 ? '' : 's'}`
      : null
  const flagged = groups.filter((g) => g.context === 'direct').length
  const intentDetail = intent.risk === 'unavailable' ? null : flagged > 0 ? `${flagged} passage${flagged === 1 ? '' : 's'} quoted from the transcript` : null
  const unsure = (risk: string) => risk === 'inconclusive' || risk === 'unavailable'
  return (
    <section aria-labelledby="overview-heading">
      <h2 id="overview-heading" className="text-sm text-ink-2 sm:text-base">
        Two separate checks. A real voice can carry a scam, and a synthetic voice can be harmless.
      </h2>
      <div className="mt-4 divide-y divide-line border-y border-line py-5 md:grid md:grid-cols-2 md:divide-x md:divide-y-0">
        <Panel
          id="overview-intent"
          icon={<MessageSquareText className="size-4" />}
          kicker="Scam intent"
          label={intentView.label}
          dot={intentView.dot}
          basis="Looks at what is said in the transcript, not at how the voice sounds."
          detail={intentDetail}
          uncertainty={unsure(intent.risk) ? intent.summary : null}
          target="intent-heading"
        />
        <Panel
          id="overview-voice"
          icon={<AudioLines className="size-4" />}
          kicker="Voice authenticity"
          label={voiceView.label}
          dot={voiceView.dot}
          basis="Looks at how the audio sounds, not at what is said."
          detail={voiceDetail}
          uncertainty={unsure(voice.verdict) ? voice.summary : null}
          target="voice-heading"
        />
      </div>
    </section>
  )
}
