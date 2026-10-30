import { callSocketUrl } from '../api'
import { OwnVoiceGate } from './ownVoice'
import { capturePcm, type PcmCapture } from './pcmCapture'
import type { CallError, CallSnapshot, ConnectionQuality, ServerMessage, SignalData, Welcome } from './types'

/**
 * One browser-to-browser call, independent of React. It owns the signaling socket, the peer connection, the
 * microphone, and the capture of the *other* participant's audio for analysis, and it releases all of them on end().
 *
 * Who offers: when the server says another participant joined (or rejoined without a media session), the participant
 * already in the room creates the offer. If both ever offer at once (both rejoined together), the participant with the
 * larger ID gives way, so the call still settles on one connection.
 */

export interface CallEnv {
  supported(): string | null
  getUserMedia(): Promise<MediaStream>
  createSocket(url: string): WebSocket
  createPeer(config: RTCConfiguration): RTCPeerConnection
  createAudioContext(): AudioContext
  capture: typeof capturePcm
  now(): number
}

export const browserEnv: CallEnv = {
  supported() {
    if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      return 'Calls need a secure page (https, or localhost during development) and a browser with microphone access.'
    }
    if (typeof RTCPeerConnection === 'undefined' || typeof AudioWorkletNode === 'undefined' || typeof WebSocket === 'undefined') {
      return 'This browser does not support browser calls. Use a current version of Chrome, Edge, Firefox or Safari.'
    }
    return null
  },
  getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }),
  createSocket: (url) => new WebSocket(url),
  createPeer: (config) => new RTCPeerConnection(config),
  createAudioContext: () => new AudioContext(),
  capture: capturePcm,
  now: () => Date.now(),
}

/** Close codes after which reconnecting cannot help. */
const FATAL_CLOSE = new Set([4400, 4403, 4404, 4409, 4429, 4001])
const FATAL_ERRORS = new Set(['room_not_found', 'room_full', 'bad_join', 'unsupported_language', 'replaced', 'too_many_messages'])
const MAX_RECONNECTS = 6
/** Before the first successful join, a failure is reported quickly instead of retrying for half a minute. */
const MAX_FIRST_CONNECT_RETRIES = 1
const MAX_BUFFERED_BYTES = 256 * 1024
const PING_MS = 20_000
const STATS_MS = 2_000
const RECOVERY_MS = 10_000
const MAX_RECOVERIES = 3
/** Incoming level (RMS of 16-bit samples, 0 to 1) above which the other person counts as audible. */
const HEARD_LEVEL = 0.003
/** The microphone is tapped in short frames, so it is always nearly up to date when incoming audio is compared with it. */
const LOCAL_FRAME_SECONDS = 0.1
/** The own-voice check compares 16 kHz audio, the rate the backend analyses. */
const OWN_VOICE_RATE = 16_000
const OWN_VOICE =
  'Your own voice is coming back through the other person’s audio (the same microphone, or speakers without headphones). VoxShield leaves those moments out of the analysis, so your words are not shown as theirs. Use headphones or separate devices.'
const OPEN = 1 // WebSocket.OPEN

const SERVER_LOST =
  'VoxShield’s server no longer has this call (it may have restarted or the room expired). Start a new call and send a new invitation.'
const UNREACHABLE = 'Could not reach the VoxShield server. Check your internet connection and that the server is running, then try again.'

export function micError(error: unknown): CallError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return { code: 'mic_denied', message: 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.' }
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { code: 'no_mic', message: 'No microphone was found. Connect one and try again.' }
  if (name === 'NotReadableError' || name === 'AbortError') return { code: 'mic_busy', message: 'The microphone is in use by another app or could not be started. Close the other app and try again.' }
  return { code: 'mic_failed', message: 'The microphone could not be started.' }
}

export function initialSnapshot(): CallSnapshot {
  return {
    phase: 'idle',
    startStep: null,
    roomId: null,
    signaling: 'closed',
    peer: 'none',
    media: 'none',
    micMuted: false,
    remoteSilenced: false,
    audioBlocked: false,
    incoming: { level: 0, lastHeardAt: null },
    quality: null,
    peerLeftReason: null,
    connectedAt: null,
    endedAt: null,
    analysis: { enabled: false, state: 'off', detail: '', windowSeconds: 12, stepSeconds: 5, runs: 0, last: null, lastAt: null, framesSent: 0, framesDropped: 0, framesOwnVoice: 0 },
    transcript: [],
    alerts: [],
    issues: [],
    error: null,
    warning: null,
    notice: null,
    endReason: null,
  }
}

/**
 * End times (ms on the audio clock) of one capture's successive frames, counted in samples from when it started. Frames
 * reach the page late by however busy the page is; counting keeps the microphone and the incoming audio on one timeline
 * regardless, which the own-voice check depends on.
 */
function frameTimes(context: AudioContext, frameSeconds: number) {
  let start = context.currentTime * 1000
  let frames = 0
  return {
    /** Call once the capture is connected: its first sample is at the current audio time. */
    started: () => void ((start = context.currentTime * 1000), (frames = 0)),
    next: () => start + ++frames * frameSeconds * 1000,
  }
}

/** Root mean square of a 16-bit PCM frame, from 0 to 1. */
export function frameLevel(frame: ArrayBuffer): number {
  const samples = new Int16Array(frame)
  if (!samples.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += (samples[i] / 32768) ** 2
  return Math.sqrt(sum / samples.length)
}

/** Problems worth keeping in the report, from a status message. Ordinary states return null. */
function issueFor(state: string, detail: string): string | null {
  if (state === 'busy') return 'The server was busy for part of the call, so some audio was not analysed.'
  if (state === 'delayed') return 'At least one analysis took longer than usual, so its alerts arrived late.'
  if (state === 'unavailable' || state === 'degraded' || state === 'error') return detail
  return null
}

export class CallSession {
  private snapshot = initialSnapshot()
  private listeners = new Set<() => void>()
  private ws: WebSocket | null = null
  private pc: RTCPeerConnection | null = null
  private local: MediaStream | null = null
  private remote: MediaStream | null = null
  private audio: HTMLAudioElement | null = null
  private context: AudioContext | null = null
  private capture: PcmCapture | null = null
  private capturing: MediaStream | null = null
  /** The microphone, tapped only to recognise the listener's own voice in the incoming audio. Never sent anywhere. */
  private localCapture: PcmCapture | null = null
  private ownVoice = new OwnVoiceGate()
  private welcome: Welcome | null = null
  private welcomed = false
  private language = 'auto'
  private offerer = false
  private pendingIce: RTCIceCandidateInit[] = []
  private reconnects = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null
  private recoveries = 0
  private lastPackets: { lost: number; received: number } | null = null
  private lastError: CallError | null = null
  /** Lets a dropped socket reclaim this participant's place. Memory only: nothing is written to browser storage. */
  private resumeToken: string | null = null
  private finished = false
  private onFinished: ((snapshot: CallSnapshot) => void) | null = null

  private readonly env: CallEnv

  constructor(env: CallEnv = browserEnv) {
    this.env = env
  }

  getSnapshot = () => this.snapshot

  /** `callback` runs once, with the final state, when the call ends or fails. */
  setOnFinished(callback: ((snapshot: CallSnapshot) => void) | null) {
    this.onFinished = callback
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(update: Partial<CallSnapshot> | ((current: CallSnapshot) => Partial<CallSnapshot>)) {
    if (this.finished && this.snapshot.endedAt !== null) return // nothing changes after the call has ended
    const patch = typeof update === 'function' ? update(this.snapshot) : update
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private setAnalysis(patch: Partial<CallSnapshot['analysis']>) {
    this.set((s) => ({ analysis: { ...s.analysis, ...patch } }))
  }

  private noteIssue(issue: string | null) {
    if (issue && !this.snapshot.issues.includes(issue)) this.set((s) => ({ issues: [...s.issues, issue] }))
  }

  /** The element that plays the other person's audio. Pass a stable ref: the session attaches the remote stream to it. */
  attachAudio(element: HTMLAudioElement | null) {
    if (this.audio === element) return
    this.audio = element
    if (element) {
      element.muted = this.snapshot.remoteSilenced
      if (this.remote) this.playRemote()
    }
  }

  /** Retries playback from a click, for browsers that blocked autoplay of the call audio. */
  resumeAudio() {
    void this.context?.resume().catch(() => undefined)
    this.playRemote()
  }

  async start(roomId: string, language = 'auto') {
    if (this.snapshot.phase !== 'idle') return // a second click while starting does nothing
    this.language = language
    this.set({ phase: 'starting', startStep: 'mic', roomId, error: null })
    const unsupported = this.env.supported()
    if (unsupported) return this.fail({ code: 'unsupported', message: unsupported })
    // Created inside the click that started the call, so the browser lets it run.
    this.context = this.env.createAudioContext()
    void this.context.resume().catch(() => undefined)
    try {
      this.local = await this.env.getUserMedia()
    } catch (error) {
      if (this.finished) return
      return this.fail(micError(error))
    }
    if (this.finished) return this.releaseMedia() // cancelled while the permission prompt was open
    this.set({ startStep: 'signaling' })
    this.connect()
    void this.startOwnVoiceReference()
  }

  /**
   * Taps the microphone, only as a reference for recognising the listener's own voice in the incoming audio; it is
   * never sent. It runs from the start, so the first second of incoming audio already has something to compare with.
   * Without it the incoming audio is still analysed, just without that check.
   */
  private async startOwnVoiceReference() {
    if (!this.context || !this.local || this.localCapture) return
    const times = frameTimes(this.context, LOCAL_FRAME_SECONDS)
    const local = await this.env.capture(this.context, this.local, OWN_VOICE_RATE, LOCAL_FRAME_SECONDS, (frame) => this.ownVoice.pushLocal(frame, times.next())).catch(() => null)
    times.started()
    if (local && (this.finished || this.localCapture)) local.stop()
    else this.localCapture = local
  }

  private connect() {
    if (this.finished) return
    const roomId = this.snapshot.roomId!
    this.set((s) => ({ signaling: s.signaling === 'reconnecting' ? 'reconnecting' : 'connecting' }))
    let ws: WebSocket
    try {
      ws = this.env.createSocket(callSocketUrl(roomId))
    } catch {
      return this.fail({ code: 'socket', message: UNREACHABLE })
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws) return
      const pc = this.pc
      const hasMedia = !!pc && pc.connectionState !== 'closed' && pc.connectionState !== 'failed'
      ws.send(JSON.stringify({ type: 'join', consent: true, analyze: true, language: this.language, resume: this.resumeToken, has_media: hasMedia }))
    }
    ws.onmessage = (event) => {
      if (this.ws !== ws || typeof event.data !== 'string') return
      let message: ServerMessage
      try {
        message = JSON.parse(event.data) as ServerMessage
      } catch {
        return
      }
      void this.handle(message)
    }
    ws.onclose = (event) => {
      if (this.ws === ws) this.socketClosed(event.code)
    }
  }

  private socketClosed(code: number) {
    this.ws = null
    this.stopPing()
    if (this.finished) return
    const error = this.lastError
    if (error?.code === 'room_not_found' && this.welcomed) return this.fail({ code: 'room_gone', message: SERVER_LOST }, 'lost')
    if (FATAL_CLOSE.has(code) || (error && FATAL_ERRORS.has(error.code))) {
      return this.fail(error ?? { code: 'closed', message: 'The server closed the call.' })
    }
    const limit = this.welcomed ? MAX_RECONNECTS : MAX_FIRST_CONNECT_RETRIES
    if (this.reconnects >= limit) {
      return this.fail({ code: 'lost', message: this.welcomed ? 'Lost the connection to the VoxShield server and could not reconnect. The call has ended.' : UNREACHABLE }, 'lost')
    }
    this.reconnects++
    const delay = Math.min(1000 * 2 ** (this.reconnects - 1), 5000)
    if (this.welcomed) {
      this.set({ signaling: 'reconnecting', warning: 'Reconnecting to VoxShield… The call audio may continue meanwhile, but analysis is paused.' })
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === OPEN) this.ws.send(JSON.stringify(payload))
  }

  private signal(data: SignalData) {
    this.send({ type: 'signal', data })
  }

  private async handle(message: ServerMessage) {
    if (this.finished) return
    switch (message.type) {
      case 'welcome': {
        this.welcome = message
        this.welcomed = true
        this.reconnects = 0
        this.lastError = null
        this.resumeToken = message.token
        this.startPing()
        const { analysis } = message
        const loading = analysis.enabled && analysis.models_ready === false
        if (loading) this.noteIssue('The analysis models were still loading when the call started, so the first analysis took longer.')
        this.set((s) => ({
          phase: 'in-call',
          startStep: null,
          signaling: 'open',
          warning: s.signaling === 'reconnecting' ? null : s.warning,
          notice: message.notice,
          peer: message.peer ? (message.peer.connected ? 'present' : 'reconnecting') : s.peer === 'left' ? 'left' : 'none',
          analysis: {
            ...s.analysis,
            enabled: analysis.enabled,
            windowSeconds: analysis.window_seconds,
            stepSeconds: analysis.step_seconds,
            ...(!analysis.enabled
              ? { state: 'off' as const, detail: 'Analysis is off for this call.' }
              : s.analysis.state === 'off' || s.analysis.state === 'loading'
                ? loading
                  ? { state: 'loading' as const, detail: 'The analysis models are still loading on the server. The call works meanwhile.' }
                  : { state: 'waiting' as const, detail: 'Analysis starts when the other person’s audio arrives.' }
                : {}),
          },
        }))
        return
      }
      case 'peer-joined':
        this.set({ peer: 'present', peerLeftReason: null, warning: null })
        return this.call()
      case 'peer-resumed':
        return this.set({ peer: 'present', peerLeftReason: null, warning: null })
      case 'peer-reconnecting':
        return this.set({ peer: 'reconnecting' })
      case 'peer-left':
        this.closePeer()
        if (this.snapshot.analysis.enabled) this.setAnalysis({ state: 'waiting', detail: 'Analysis resumes when the other person’s audio arrives again.' })
        return this.set({ peer: 'left', peerLeftReason: message.reason, media: 'none', incoming: { level: 0, lastHeardAt: null }, quality: null, audioBlocked: false })
      case 'signal':
        return this.onSignal(message.from, message.data)
      case 'analysis-status':
        this.noteIssue(issueFor(message.state, message.detail))
        return this.setAnalysis({ state: message.state, detail: message.detail })
      case 'analysis': {
        if (this.isOwnSpeech(message.source_participant_id)) return
        if (this.snapshot.analysis.last && message.seq <= this.snapshot.analysis.last.seq) return // stale or repeated result
        message.errors.forEach((error) => this.noteIssue(error.message))
        if (message.skipped_seconds > 0) this.noteIssue('Analysis fell behind at least once, so some stretches of audio were not analysed.')
        return this.set((s) => ({
          transcript: [...s.transcript, ...message.transcript.map((line) => ({ ...line, source: message.source_participant_id ?? null }))],
          analysis: { ...s.analysis, runs: s.analysis.runs + 1, last: message, lastAt: this.env.now() },
        }))
      }
      case 'alert':
        if (this.isOwnSpeech(message.alert.source_participant_id)) return
        if (this.snapshot.alerts.some((alert) => alert.id === message.alert.id)) return
        return this.set((s) => ({ alerts: [message.alert, ...s.alerts] }))
      case 'alert-update':
        if (this.isOwnSpeech(message.source_participant_id)) return
        return this.set((s) => ({
          alerts: s.alerts.map((alert) => (alert.id === message.alert_id ? { ...alert, evidence: [...alert.evidence, ...message.evidence] } : alert)),
        }))
      case 'error':
        this.lastError = { code: message.code, message: message.message }
        if (!FATAL_ERRORS.has(message.code)) this.set({ warning: message.message })
        return
      case 'pong':
        return
    }
  }

  /**
   * Results are always about the OTHER participant's speech. One attributed to this participant would mean a routing
   * fault, so it is never shown as a warning about the other person; it is recorded for the report instead.
   */
  private isOwnSpeech(source: string | null | undefined): boolean {
    const own = !!source && source === this.welcome?.participant_id
    if (own) this.noteIssue('A result about your own speech reached this call and was discarded.')
    return own
  }

  // ---- WebRTC ----

  private makePeer(): RTCPeerConnection {
    this.closePeer()
    const pc = this.env.createPeer({ iceServers: this.welcome?.ice_servers ?? [] })
    this.local?.getTracks().forEach((track) => pc.addTrack(track, this.local!))
    pc.onicecandidate = (event) => this.signal({ kind: 'ice', candidate: event.candidate ? event.candidate.toJSON() : null })
    pc.ontrack = (event) => {
      if (this.pc !== pc) return
      this.remote = event.streams[0] ?? new MediaStream([event.track])
      this.playRemote()
      void this.startCapture()
    }
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return
      const state = pc.connectionState
      if (state === 'connected') this.clearRecovery()
      this.set((s) => ({
        media: state,
        connectedAt: state === 'connected' ? (s.connectedAt ?? this.env.now()) : s.connectedAt,
        warning: state === 'connected' ? null : state === 'disconnected' ? 'Call audio interrupted. Trying to recover…' : s.warning,
      }))
      if (state === 'failed') void this.recover()
    }
    this.pc = pc
    this.lastPackets = null
    this.startStats()
    this.set({ media: 'new' })
    return pc
  }

  private async call(iceRestart = false) {
    if (!this.local || this.finished) return
    this.offerer = true
    const pc = iceRestart && this.pc ? this.pc : this.makePeer()
    try {
      const offer = await pc.createOffer({ iceRestart })
      if (this.pc !== pc) return
      await pc.setLocalDescription(offer)
      this.signal({ kind: 'offer', sdp: offer.sdp ?? '' })
    } catch {
      this.set({ warning: 'Could not start the audio connection. Waiting for the other person to rejoin.' })
    }
  }

  /** ICE restart after a failure, retried a few times; after that the user is told plainly. */
  private async recover() {
    if (this.recoveryTimer || this.finished) return
    if (this.recoveries >= MAX_RECOVERIES) {
      this.set({ warning: 'The audio connection could not be restored. End the call and start a new one.' })
      return
    }
    this.recoveries++
    this.set({ warning: 'The audio connection failed. Trying to reconnect…' })
    if (this.offerer) await this.call(true)
    else this.signal({ kind: 'restart' })
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      if (this.pc && this.pc.connectionState !== 'connected') void this.recover()
    }, RECOVERY_MS)
  }

  private clearRecovery() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = null
    this.recoveries = 0
  }

  private async onSignal(from: string, data: SignalData) {
    try {
      if (data.kind === 'offer') {
        const existing = this.pc && this.pc.connectionState !== 'closed' ? this.pc : null
        if (existing?.signalingState === 'have-local-offer') {
          // Both sides offered at once. The larger participant ID gives way; the other ignores the incoming offer.
          if ((this.welcome?.participant_id ?? '') < from) return
          await existing.setLocalDescription({ type: 'rollback' })
        }
        this.offerer = false
        const queued = this.pendingIce // candidates can arrive just before the offer; a new connection must keep them
        const pc = existing ?? this.makePeer()
        this.pendingIce = queued
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
        await this.flushIce()
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        this.signal({ kind: 'answer', sdp: answer.sdp ?? '' })
      } else if (data.kind === 'answer') {
        if (this.pc?.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
          await this.flushIce()
        }
      } else if (data.kind === 'ice') {
        if (!data.candidate) return
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(data.candidate)
        else this.pendingIce.push(data.candidate)
      } else if (data.kind === 'restart' && this.offerer) {
        await this.call(true)
      }
    } catch {
      this.set({ warning: 'A connection message from the other person could not be applied. If you cannot hear each other, end the call and start a new one.' })
    }
  }

  private async flushIce() {
    const pending = this.pendingIce
    this.pendingIce = []
    for (const candidate of pending) await this.pc?.addIceCandidate(candidate).catch(() => undefined)
  }

  private playRemote() {
    const audio = this.audio
    if (!audio || !this.remote) return
    if (audio.srcObject !== this.remote) audio.srcObject = this.remote
    audio.play().then(
      () => this.snapshot.audioBlocked && this.set({ audioBlocked: false }),
      () => !this.snapshot.audioBlocked && this.audio === audio && this.set({ audioBlocked: true }),
    )
  }

  /** Taps the other participant's audio (never the local microphone) and streams it to the backend for analysis. */
  private async startCapture() {
    const remote = this.remote
    if (!this.context || !remote || this.capturing === remote) return
    this.capture?.stop()
    this.capture = null
    this.ownVoice.resetIncoming()
    this.capturing = remote // claimed before the await, so a second track event cannot start a second capture
    try {
      await this.context.resume().catch(() => undefined)
      const times = frameTimes(this.context, 1)
      const capture = await this.env.capture(this.context, remote, this.welcome?.analysis.sample_rate ?? 16_000, 1, (frame) => this.onFrame(frame, times.next()))
      times.started()
      if (this.remote !== remote || this.finished) return capture.stop()
      this.capture = capture
      if (this.snapshot.analysis.enabled && (this.snapshot.analysis.state === 'waiting' || this.snapshot.analysis.state === 'off')) {
        this.setAnalysis({ state: 'collecting', detail: 'Collecting the first seconds of the other person’s audio.' })
      }
    } catch {
      if (this.capturing === remote) this.capturing = null
      this.setAnalysis({ state: 'error', detail: 'This browser could not capture the call audio for analysis. The call itself still works.' })
      this.noteIssue('This browser could not capture the call audio for analysis.')
    }
  }

  /** `at`: when the frame ended, on the audio clock (ms). */
  private onFrame(frame: ArrayBuffer, at: number) {
    if (this.finished) return
    const level = frameLevel(frame)
    this.set((s) => ({ incoming: { level, lastHeardAt: level >= HEARD_LEVEL ? this.env.now() : s.incoming.lastHeardAt } }))
    if (!this.snapshot.analysis.enabled) return
    // Frames are sent a frame late, once the own-voice check has heard what follows them.
    for (const ready of this.ownVoice.next(frame, at)) {
      if (ready.ownVoice) {
        // Sent as silence, not skipped, so the server's call clock stays in step with the call.
        this.snapshot.analysis.framesOwnVoice++
        if (!this.snapshot.issues.includes(OWN_VOICE)) {
          this.noteIssue(OWN_VOICE)
          this.set({ warning: OWN_VOICE })
        }
      }
      const ws = this.ws
      if (ws?.readyState === OPEN && ws.bufferedAmount < MAX_BUFFERED_BYTES) {
        ws.send(ready.frame)
        this.snapshot.analysis.framesSent++ // read on the next render; not worth a notification of its own
      } else {
        this.snapshot.analysis.framesDropped++
      }
    }
  }

  private startStats() {
    if (this.statsTimer) return
    this.statsTimer = setInterval(() => void this.readStats(), STATS_MS)
  }

  private async readStats() {
    const pc = this.pc
    if (!pc || typeof pc.getStats !== 'function' || pc.connectionState !== 'connected') return
    try {
      const report = await pc.getStats()
      let lost = 0
      let received = 0
      let roundTripMs: number | null = null
      let relayed: boolean | null = null
      const byId = new Map<string, Record<string, unknown>>()
      report.forEach((stat: Record<string, unknown>) => byId.set(stat.id as string, stat))
      byId.forEach((stat) => {
        if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
          lost += Number(stat.packetsLost ?? 0)
          received += Number(stat.packetsReceived ?? 0)
        }
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && (stat.nominated || stat.selected)) {
          if (typeof stat.currentRoundTripTime === 'number') roundTripMs = Math.round(stat.currentRoundTripTime * 1000)
          const local = byId.get(stat.localCandidateId as string)
          const remote = byId.get(stat.remoteCandidateId as string)
          if (local || remote) relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay'
        }
      })
      const previous = this.lastPackets
      this.lastPackets = { lost, received }
      const dLost = previous ? lost - previous.lost : 0
      const dReceived = previous ? received - previous.received : 0
      const lossPercent = previous && dLost + dReceived > 0 ? Math.round((100 * Math.max(0, dLost)) / (dLost + dReceived)) : null
      if (this.pc === pc) this.set({ quality: { lossPercent, roundTripMs, relayed } satisfies ConnectionQuality })
    } catch {
      // statistics are a nicety; the call does not depend on them
    }
  }

  // ---- Controls ----

  setMicMuted(muted: boolean) {
    this.local?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
    this.set({ micMuted: muted })
  }

  /** Silences the other person on this device. Their audio is still analysed. */
  setRemoteSilenced(silenced: boolean) {
    if (this.audio) this.audio.muted = silenced
    this.set({ remoteSilenced: silenced })
  }

  /** Ends the call for this participant and releases everything. Safe to call more than once. */
  end(reason: CallSnapshot['endReason'] = 'you') {
    if (this.finished) return
    this.finished = true
    this.send({ type: 'leave' })
    this.resumeToken = null
    this.teardown()
    const patch = (s: CallSnapshot): Partial<CallSnapshot> => ({
      phase: s.phase === 'error' ? 'error' : 'ended',
      startStep: null,
      endedAt: this.env.now(),
      endReason: s.endReason ?? reason,
      signaling: 'closed',
      media: 'none',
      audioBlocked: false,
    })
    this.snapshot = { ...this.snapshot, ...patch(this.snapshot) }
    this.listeners.forEach((listener) => listener())
    this.onFinished?.(this.snapshot)
  }

  private fail(error: CallError, reason: CallSnapshot['endReason'] = 'error') {
    if (this.finished) return
    this.set({ phase: 'error', error, endReason: reason })
    this.end(reason)
  }

  private stopStats() {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
  }

  private closePeer() {
    this.capture?.stop()
    this.capture = null
    this.capturing = null
    this.ownVoice.resetIncoming()
    this.stopStats()
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = null
    if (this.pc) {
      this.pc.onicecandidate = null
      this.pc.ontrack = null
      this.pc.onconnectionstatechange = null
      this.pc.close()
      this.pc = null
    }
    this.pendingIce = []
    this.remote = null
    if (this.audio) {
      this.audio.pause()
      this.audio.srcObject = null
    }
  }

  private releaseMedia() {
    this.localCapture?.stop()
    this.localCapture = null
    this.ownVoice.clear()
    this.local?.getTracks().forEach((track) => track.stop())
    this.local = null
    void this.context?.close().catch(() => undefined)
    this.context = null
  }

  private teardown() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.stopPing()
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onclose = null
      ws.onmessage = null
      ws.onopen = null
      try {
        ws.close(1000)
      } catch {
        // already closed
      }
    }
    this.closePeer()
    this.releaseMedia()
  }

  private startPing() {
    this.stopPing()
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_MS)
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }
}
