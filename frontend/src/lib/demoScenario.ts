import type { VoiceAssessment } from './types'

/**
 * The prewritten, fictional scenario behind the simulated call and dashboard. Nothing here comes from the backend or a
 * model, and nothing here is mixed into real analysis results: real reports never read this file. Every screen that
 * shows these values must label them as simulated.
 */

export interface DemoIndicator {
  id: string
  label: string
  /** Why this kind of signal matters, in general. */
  explanation: string
  /** Fixed, illustrative points this indicator adds to the demo score. Not learned, not calibrated. */
  weight: number
}

export interface DemoEvidence {
  id: string
  /** Exact text inside the segment that is highlighted. */
  phrase: string
  indicatorId: string
  /** Why this particular phrase was marked. */
  why: string
}

export interface DemoSegment {
  id: string
  /** Seconds from the start of the simulated call. */
  start: number
  text: string
  evidence: DemoEvidence[]
}

/** The part of a voice result the dashboard shows. A real VoiceAssessment from the backend fits this shape. */
export type VoiceSummary = Pick<VoiceAssessment, 'verdict' | 'fake_score_median' | 'windows_analyzed' | 'limitations'>

export interface DemoScenario {
  id: string
  title: string
  caller: { name: string; claimed: string; number: string; initials: string }
  /** Length of the simulated call in seconds. */
  duration: number
  /** The simulated alert appears once this segment has been reached. */
  alertAtSegment: string
  segments: DemoSegment[]
  indicators: DemoIndicator[]
  /** null shows the neutral "unavailable" state. */
  voice: VoiceSummary | null
  /** The caller's voice: computer-generated speech, timed to the segments (scripts/make_demo_audio.py). */
  audioUrl?: string
}

export const SIMULATION_NOTICE = 'Simulated scenario. A prewritten script with a fictional caller, voiced by computer-generated speech (text-to-speech). No real call or real person is involved, and the transcript is the script, not speech recognition.'

/** Shown on the voice card while the script is read aloud, so the simulated values are not mistaken for a measurement. */
export const SPOKEN_VOICE_NOTE =
  'The caller you hear is a computer-generated (text-to-speech) recording made for this demo. The values on this card are prewritten demo data; they were not measured from that recording.'

export const STRANDED_TRAVELLER: DemoScenario = {
  id: 'stranded-traveller',
  title: 'Stranded traveller asks for money',
  caller: { name: 'Unknown Caller', claimed: 'Says they are a friend travelling abroad', number: 'Number withheld', initials: '?' },
  duration: 30,
  audioUrl: '/demo/stranded-traveller.flac',
  alertAtSegment: 's3',
  indicators: [
    {
      id: 'account-problem',
      label: 'Claimed account or payment problem',
      explanation: 'A sudden problem with a card or account is a common opening that makes an unusual request sound reasonable.',
      weight: 15,
    },
    {
      id: 'money-request',
      label: 'Unexpected request for money',
      explanation: 'Being asked to send money on a call you did not expect is the core of most payment scams.',
      weight: 40,
    },
    {
      id: 'urgency',
      label: 'Urgency and pressure',
      explanation: 'Pressure to act at once leaves no time to check who is really calling.',
      weight: 25,
    },
    {
      id: 'repayment',
      label: 'Promise of repayment',
      explanation: 'A promise to pay you back is used to make the request feel low-risk. It cannot be checked during the call.',
      weight: 10,
    },
  ],
  segments: [
    { id: 's1', start: 0, text: 'Hello? Hi, it’s me. Sorry, I’m calling from a different phone.', evidence: [] },
    {
      id: 's2',
      start: 5,
      text: 'I’m stuck while travelling and my payment is not going through.',
      evidence: [{ id: 'e1', phrase: 'my payment is not going through', indicatorId: 'account-problem', why: 'Sets up a reason why the caller cannot pay for themselves.' }],
    },
    {
      id: 's3',
      start: 10,
      text: 'Could you send me money immediately?',
      evidence: [
        { id: 'e2', phrase: 'send me money', indicatorId: 'money-request', why: 'A direct request for a transfer, made on an unexpected call.' },
        { id: 'e3', phrase: 'immediately', indicatorId: 'urgency', why: 'Asks for the transfer right now, before you can check.' },
      ],
    },
    {
      id: 's4',
      start: 15,
      text: 'I will pay you back once I regain access to my account.',
      evidence: [{ id: 'e4', phrase: 'I will pay you back', indicatorId: 'repayment', why: 'Reassurance that cannot be verified while you are on the call.' }],
    },
    {
      id: 's5',
      start: 21,
      text: 'Please act quickly. I can’t really talk for long.',
      evidence: [{ id: 'e5', phrase: 'Please act quickly', indicatorId: 'urgency', why: 'Repeats the pressure to act without checking.' }],
    },
    { id: 's6', start: 26, text: 'Thank you. I’ll message you the details.', evidence: [] },
  ],
  // Inconclusive on purpose: the scam signals are in the words, and a natural-sounding voice does not make a call safe.
  voice: {
    verdict: 'inconclusive',
    fake_score_median: 0.47,
    windows_analyzed: 7,
    limitations: [
      'A pretrained classifier, not a liveness detector. It cannot tell whether a live person is speaking.',
      'A “fake” lean does not prove a recording was generated, and a “real” lean does not prove a voice is human.',
      'In VoxShield’s benchmark it missed most neural voices over phone-quality audio, and caught fewer in Hindi than in English.',
    ],
  },
}

export interface FoundIndicator extends DemoIndicator {
  evidence: (DemoEvidence & { segmentId: string; start: number })[]
}

export const segmentsReached = (scenario: DemoScenario, elapsed: number) => scenario.segments.filter((segment) => segment.start <= elapsed)

/** Indicators with at least one piece of evidence in the given segments, in the scenario's order. */
export function indicatorsFound(scenario: DemoScenario, segments: DemoSegment[]): FoundIndicator[] {
  return scenario.indicators
    .map((indicator) => ({
      ...indicator,
      evidence: segments.flatMap((segment) =>
        segment.evidence.filter((item) => item.indicatorId === indicator.id).map((item) => ({ ...item, segmentId: segment.id, start: segment.start })),
      ),
    }))
    .filter((indicator) => indicator.evidence.length > 0)
}

/** The demo score: each indicator found adds its fixed weight once, capped at 100. */
export const demoScore = (found: FoundIndicator[]) => Math.min(100, found.reduce((sum, indicator) => sum + indicator.weight, 0))

export const alertReached = (scenario: DemoScenario, elapsed: number) => segmentsReached(scenario, elapsed).some((segment) => segment.id === scenario.alertAtSegment)

export function indicatorOf(scenario: DemoScenario, evidenceId: string) {
  for (const segment of scenario.segments) {
    const item = segment.evidence.find((evidence) => evidence.id === evidenceId)
    if (item) return { segment, evidence: item, indicator: scenario.indicators.find((indicator) => indicator.id === item.indicatorId)! }
  }
  return null
}

export const segmentDomId = (id: string) => `demo-seg-${id}`

export type TextPart = { text: string; evidence?: DemoEvidence }

/** Splits a segment into plain text and highlighted evidence phrases, in reading order. */
export function splitByEvidence(segment: Pick<DemoSegment, 'text' | 'evidence'>): TextPart[] {
  const hits = segment.evidence
    .map((evidence) => ({ evidence, at: segment.text.indexOf(evidence.phrase) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)
  const parts: TextPart[] = []
  let cursor = 0
  for (const { evidence, at } of hits) {
    if (at < cursor) continue // overlapping phrases: keep the first
    if (at > cursor) parts.push({ text: segment.text.slice(cursor, at) })
    parts.push({ text: evidence.phrase, evidence })
    cursor = at + evidence.phrase.length
  }
  if (cursor < segment.text.length) parts.push({ text: segment.text.slice(cursor) })
  return parts
}

/** Every scenario a simulation report can refer to, by id. */
export const DEMO_SCENARIOS: Record<string, DemoScenario> = { [STRANDED_TRAVELLER.id]: STRANDED_TRAVELLER }
