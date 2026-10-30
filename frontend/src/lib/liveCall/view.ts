import type { BadgeTone } from '../../components/ui/styles'
import type { LiveCallEntry } from '../history'
import type { AnalysisState, CallSnapshot, LiveAlert } from './types'

export const LIVE_CALL_PATH = '/call'
export const callPath = (roomId: string) => `${LIVE_CALL_PATH}/${roomId}`

export const SCOPE_NOTE =
  'Live Call Protection works only for calls made inside VoxShield in a browser. It cannot listen to or monitor ordinary phone, cellular, or WhatsApp calls.'

export const CONSENT_TEXT =
  'I understand that during this call VoxShield analyses the audio each participant receives (speech-to-text, scam-intent and voice checks) to warn them about scams. The other person is told the same before they join. Audio is analysed in memory and not stored.'

/** General precautions, written in advance. They do not depend on what was said in the call. */
export const SAFETY_STEPS = [
  'Never read out one-time codes, PINs, passwords, or card numbers on a call.',
  'Do not send money, gift cards, or crypto because a caller asks, however urgent it sounds.',
  'Hang up and call back on a number you look up yourself, such as the one on your card or the official website.',
  'Do not install apps or give anyone remote access to your phone or computer.',
  'Talk to someone you trust before you act. Real requests can wait.',
]

const ROOM_ID = /^[A-Za-z0-9_-]{10,32}$/

/** A room ID from what the user pasted: the bare ID or a full invitation link. */
export function parseRoomInput(input: string): string | null {
  const value = input.trim()
  if (ROOM_ID.test(value)) return value
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean)
    const index = parts.lastIndexOf('call')
    const candidate = index >= 0 ? parts[index + 1] : undefined
    return candidate && ROOM_ID.test(candidate) ? candidate : null
  } catch {
    return null
  }
}

export type ScamLevel = 'none' | 'low' | 'elevated' | 'high'
const RANK: Record<ScamLevel, number> = { none: 0, low: 1, elevated: 2, high: 3 }

/** The highest scam-risk level alerted so far. Voice alerts never raise it: a synthetic-sounding voice is not a scam finding. */
export function highestScamLevel(alerts: LiveAlert[]): ScamLevel {
  return alerts.reduce<ScamLevel>((best, alert) => {
    if (alert.kind !== 'scam') return best
    const level = alert.level as ScamLevel
    return RANK[level] > RANK[best] ? level : best
  }, 'none')
}

export const RISK_VIEW: Record<ScamLevel, { label: string; tone: BadgeTone; detail: string }> = {
  none: { label: 'No scam alerts', tone: 'neutral', detail: 'Nothing the analysis flagged so far. That is not proof the call is safe.' },
  low: { label: 'Weak signals', tone: 'info', detail: 'Something worth noticing, not enough on its own to call this a scam.' },
  elevated: { label: 'Notable risk', tone: 'warning', detail: 'The other person used tactics common in scams. Slow down and verify.' },
  high: { label: 'High risk', tone: 'critical', detail: 'Strong scam indicators. Do not share codes or send money. Consider ending the call.' },
}

export const ALERT_TITLE: Record<LiveAlert['level'], string> = {
  high: 'High scam risk',
  elevated: 'Notable scam risk',
  low: 'Weak scam signal',
  caution: 'Voice may be synthetic',
}

export const ANALYSIS_VIEW: Record<AnalysisState, { label: string; tone: BadgeTone }> = {
  off: { label: 'Analysis off', tone: 'neutral' },
  loading: { label: 'Models loading', tone: 'warning' },
  waiting: { label: 'Waiting for audio', tone: 'neutral' },
  collecting: { label: 'Collecting audio', tone: 'info' },
  silence: { label: 'No speech heard', tone: 'neutral' },
  analyzing: { label: 'Analysing', tone: 'info' },
  delayed: { label: 'Analysis delayed', tone: 'warning' },
  listening: { label: 'Listening', tone: 'success' },
  degraded: { label: 'Partly unavailable', tone: 'warning' },
  busy: { label: 'Server busy', tone: 'warning' },
  unavailable: { label: 'Analysis unavailable', tone: 'warning' },
  error: { label: 'Analysis problem', tone: 'warning' },
}

/** One line on where the call stands, for the status pill. */
export function callStatus(s: CallSnapshot): { label: string; tone: BadgeTone } {
  if (s.phase === 'starting') return { label: s.startStep === 'signaling' ? 'Connecting to VoxShield…' : 'Waiting for microphone permission…', tone: 'info' }
  if (s.phase === 'ended') return { label: 'Call ended', tone: 'neutral' }
  if (s.phase === 'error') return { label: 'Call failed', tone: 'warning' }
  if (s.signaling === 'reconnecting') return { label: 'Reconnecting…', tone: 'warning' }
  if (s.signaling === 'connecting') return { label: 'Connecting…', tone: 'info' }
  if (s.peer === 'none') return { label: 'Waiting for the other person', tone: 'neutral' }
  if (s.peer === 'left') return { label: s.peerLeftReason === 'connection_lost' ? 'The other person lost connection' : 'The other person left', tone: 'neutral' }
  if (s.peer === 'reconnecting') return { label: 'Other person reconnecting…', tone: 'warning' }
  if (s.media === 'connected') return { label: 'Connected', tone: 'success' }
  if (s.media === 'disconnected' || s.media === 'failed') return { label: 'Audio interrupted', tone: 'warning' }
  return { label: 'Connecting audio…', tone: 'info' }
}

/** Whether sound from the other person is actually arriving, measured from the decoded audio. */
export function incomingAudio(s: Pick<CallSnapshot, 'media' | 'incoming' | 'connectedAt'>, now: number): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (s.media !== 'connected') return { label: 'No audio connection', tone: 'neutral' }
  const quietFor = s.incoming.lastHeardAt ? (now - s.incoming.lastHeardAt) / 1000 : s.connectedAt ? (now - s.connectedAt) / 1000 : 0
  if (s.incoming.lastHeardAt && quietFor < 3) return { label: 'Hearing them', tone: 'success' }
  if (quietFor < 10) return { label: 'Connected, quiet', tone: 'neutral' }
  return { label: `No sound from them for ${Math.floor(quietFor)} s`, tone: 'warning' }
}

export function qualityLabel(q: CallSnapshot['quality']): string | null {
  if (!q) return null
  const parts = [q.lossPercent === null ? null : q.lossPercent >= 5 ? `poor (${q.lossPercent}% packets lost)` : 'good', q.roundTripMs === null ? null : `${q.roundTripMs} ms delay`, q.relayed === null ? null : q.relayed ? 'relayed via TURN' : 'direct']
  const text = parts.filter(Boolean).join(' · ')
  return text || null
}

export function callDuration(s: Pick<CallSnapshot, 'connectedAt' | 'endedAt'>, now: number): number {
  if (!s.connectedAt) return 0
  return Math.max(0, Math.floor(((s.endedAt ?? now) - s.connectedAt) / 1000))
}

export function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const sec = Math.floor(seconds % 60)
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/** What the History entry keeps of a finished call: alerts and transcript text, never audio. */
export function toHistoryEntry(s: CallSnapshot): Omit<LiveCallEntry, 'id' | 'completedAt'> {
  const limitations: string[] = []
  if (!s.analysis.enabled) limitations.push('Analysis was off for this call.')
  else if (s.analysis.runs === 0) limitations.push('No analysis completed during this call (too little speech, the call ended first, or the analysis was unavailable).')
  if (s.analysis.state === 'analyzing' || s.analysis.state === 'delayed') limitations.push('An analysis was still running when the call ended; its result is not included.')
  limitations.push(...s.issues.filter((issue) => !limitations.includes(issue)))
  return {
    kind: 'live-call',
    title: s.connectedAt ? 'Live call' : 'Live call (never connected)',
    startedAt: s.connectedAt ? new Date(s.connectedAt).toISOString() : null,
    durationSeconds: callDuration(s, s.endedAt ?? Date.now()),
    lastAnalysisAt: s.analysis.lastAt ? new Date(s.analysis.lastAt).toISOString() : null,
    endReason: s.endReason,
    alerts: s.alerts,
    transcript: s.transcript,
    analysisRuns: s.analysis.runs,
    limitations,
  }
}
