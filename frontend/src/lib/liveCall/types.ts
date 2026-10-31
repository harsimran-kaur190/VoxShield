import type { IntentRisk, VoiceVerdict } from '../types'

/** Messages and state for Live Call Protection. The shapes mirror backend/app/api/calls.py and services/live_calls.py. */

export interface LiveVoice {
  verdict: VoiceVerdict
  fake_score_median: number | null
  windows_analyzed: number
  summary: string
  /** Why this live reading is weak evidence. Present whenever the model leaned either way. */
  caution: string | null
  window_seconds: number
  error: string | null
}

export interface LiveEvidence {
  category: string
  severity: 'low' | 'medium' | 'high'
  excerpt: string
  sentence: string
  original_text: string | null
  call_time_seconds: number | null
  explanation: string
  detector: 'rules' | 'nli'
  score: number | null
}

export interface LiveAlert {
  id: string
  kind: 'scam' | 'voice'
  /** Scam alerts: the backend's intent risk for that window. Voice alerts are always 'caution'. */
  level: 'low' | 'elevated' | 'high' | 'caution'
  created_at: string
  call_time_seconds: number
  window: [number, number]
  risk: IntentRisk
  reason: string
  summary?: string
  tactics: string[]
  evidence: LiveEvidence[]
  voice: LiveVoice
  actions: string[]
  limitations: string[]
  detector?: 'rules' | 'nli'
  /** The participant whose speech this alert is about: always the other person, never the listener. */
  source_participant_id?: string | null
}

export interface TranscriptLine {
  start: number
  end: number
  text: string
  /** Who said it (the other participant's ID). */
  source?: string | null
}

export interface AnalysisEvent {
  type: 'analysis'
  /** Increases with every completed window; an older result never replaces a newer one. */
  seq: number
  analyzed_at: string
  window: [number, number]
  status: 'complete' | 'partial' | 'failed'
  transcript: TranscriptLine[]
  language: string | null
  intent: { risk: IntentRisk; summary: string; error: string | null; detector: string }
  voice: LiveVoice
  errors: { component: string; message: string }[]
  skipped_seconds: number
  seconds: number | null
  source_participant_id?: string | null
}

export type AnalysisState =
  | 'off'
  | 'loading'
  | 'waiting'
  | 'collecting'
  | 'silence'
  | 'analyzing'
  | 'delayed'
  | 'listening'
  | 'degraded'
  | 'busy'
  | 'unavailable'
  | 'error'

export interface Welcome {
  type: 'welcome'
  participant_id: string
  token: string
  resumed: boolean
  peer: { id: string; connected: boolean } | null
  ice_servers: RTCIceServer[]
  analysis: { enabled: boolean; models_ready?: boolean; sample_rate: number; window_seconds: number; step_seconds: number; max_frame_seconds: number }
  notice: string
}

export type SignalData =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit | null }
  | { kind: 'restart' }

export type ServerMessage =
  | Welcome
  | { type: 'peer-joined' | 'peer-resumed' | 'peer-reconnecting'; peer_id: string }
  | { type: 'peer-left'; peer_id: string; reason: 'ended' | 'connection_lost' }
  | { type: 'signal'; from: string; data: SignalData }
  | { type: 'analysis-status'; state: Exclude<AnalysisState, 'off' | 'waiting' | 'loading'>; detail: string }
  | AnalysisEvent
  /** The last sentence before a pause, released once no later analysis will confirm it. */
  | { type: 'transcript'; transcript: TranscriptLine[]; source_participant_id?: string | null }
  | { type: 'alert'; alert: LiveAlert }
  /** More evidence for an earlier alert, found while that tactic's cooldown ran. */
  | { type: 'alert-update'; alert_id: string; evidence: LiveEvidence[]; source_participant_id?: string | null }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' }

export type CallPhase = 'idle' | 'starting' | 'in-call' | 'ended' | 'error'
/** While starting: waiting for microphone permission, then for the signaling server. */
export type StartStep = 'mic' | 'signaling'
export type SignalingState = 'connecting' | 'open' | 'reconnecting' | 'closed'
export type PeerState = 'none' | 'present' | 'reconnecting' | 'left'
export type MediaState = 'none' | RTCPeerConnectionState

export interface CallError {
  code: string
  message: string
}

export interface ConnectionQuality {
  /** Share of the other person's audio packets lost over the last few seconds, in percent. */
  lossPercent: number | null
  roundTripMs: number | null
  /** True when audio goes through a TURN relay rather than directly between the browsers. */
  relayed: boolean | null
}

export interface CallSnapshot {
  phase: CallPhase
  startStep: StartStep | null
  roomId: string | null
  signaling: SignalingState
  peer: PeerState
  media: MediaState
  micMuted: boolean
  /** The other person's audio is silenced on this device. Analysis keeps running. */
  remoteSilenced: boolean
  /** The browser refused to start playback of the other person's audio; a click on "Play call audio" fixes it. */
  audioBlocked: boolean
  /** Measured from the other person's decoded audio, so it shows sound actually arriving, not just a connection. */
  incoming: { level: number; lastHeardAt: number | null }
  quality: ConnectionQuality | null
  peerLeftReason: 'ended' | 'connection_lost' | null
  /** When audio first connected (ms since epoch), for the call timer. */
  connectedAt: number | null
  endedAt: number | null
  analysis: {
    enabled: boolean
    state: AnalysisState
    detail: string
    windowSeconds: number
    stepSeconds: number
    runs: number
    last: AnalysisEvent | null
    /** When the last window's result arrived (ms since epoch). */
    lastAt: number | null
    framesSent: number
    framesDropped: number
    /** Incoming frames that held the listener’s own voice coming back; those parts were sent as silence. */
    framesOwnVoice: number
  }
  transcript: TranscriptLine[]
  alerts: LiveAlert[]
  /** Analysis problems seen at any point in the call, kept for the report. */
  issues: string[]
  error: CallError | null
  /** Shown in the call: a temporary problem that does not end it. */
  warning: string | null
  notice: string | null
  endReason: 'you' | 'peer' | 'lost' | 'error' | null
}
