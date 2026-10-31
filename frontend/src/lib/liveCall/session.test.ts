import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callSocketUrl } from '../api'
import { Downsampler, FrameBuilder } from './pcmCapture'
import { CallSession, frameLevel, micError, type CallEnv } from './session'
import { delayed, frames, syntheticVoice } from './testAudio'
import type { LiveAlert } from './types'
import { callStatus, highestScamLevel, parseRoomInput, toHistoryEntry } from './view'

class FakeSocket {
  readyState = 0
  binaryType = ''
  bufferedAmount = 0
  sent: unknown[] = []
  closed: number | null = null
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
  }
  send(data: unknown) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data)
  }
  close(code: number) {
    this.closed = code
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
  json() {
    return this.sent.filter((item) => !(item instanceof ArrayBuffer)) as Record<string, unknown>[]
  }
}

class FakePeer {
  connectionState: RTCPeerConnectionState = 'new'
  signalingState = 'stable'
  remoteDescription: unknown = null
  tracks: unknown[] = []
  candidates: unknown[] = []
  closed = false
  onicecandidate: ((event: { candidate: { toJSON(): unknown } | null }) => void) | null = null
  ontrack: ((event: { streams: unknown[]; track: unknown }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  config: RTCConfiguration
  constructor(config: RTCConfiguration) {
    this.config = config
  }
  addTrack(track: unknown) {
    this.tracks.push(track)
  }
  async createOffer(options?: { iceRestart?: boolean }) {
    return { type: 'offer', sdp: options?.iceRestart ? 'offer-restart' : 'offer-sdp' }
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'answer-sdp' }
  }
  async setLocalDescription(description: { type: string }) {
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable'
  }
  async setRemoteDescription(description: unknown) {
    this.remoteDescription = description
    this.signalingState = 'stable'
  }
  async addIceCandidate(candidate: unknown) {
    this.candidates.push(candidate)
  }
  close() {
    this.closed = true
  }
  setState(state: RTCPeerConnectionState) {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }
}

function setup(options: { mic?: Error; micPending?: boolean } = {}) {
  let micCalls = 0
  let releaseMic: (value: unknown) => void = () => undefined
  const sockets: FakeSocket[] = []
  const peers: FakePeer[] = []
  const track = { enabled: true, stopped: false, stop() { this.stopped = true } }
  const local = { getTracks: () => [track], getAudioTracks: () => [track] }
  const context = { closed: false, currentTime: 0, resume: async () => undefined, close: async function () { this.closed = true } }
  const captured: { stream: unknown; onFrame: (frame: ArrayBuffer) => void; stopped: boolean }[] = []
  const env: CallEnv = {
    supported: () => null,
    getUserMedia: async () => {
      micCalls++
      if (options.micPending) await new Promise((resolve) => (releaseMic = resolve))
      if (options.mic) throw options.mic
      return local as unknown as MediaStream
    },
    createSocket: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    createPeer: (config) => {
      const peer = new FakePeer(config)
      peers.push(peer)
      return peer as unknown as RTCPeerConnection
    },
    createAudioContext: () => context as unknown as AudioContext,
    capture: async (_context, stream, _rate, _seconds, onFrame) => {
      const entry = { stream, onFrame, stopped: false }
      captured.push(entry)
      return { stop: () => void (entry.stopped = true) }
    },
    now: () => 1_000_000,
  }
  // The session taps two streams: the other person's audio (sent for analysis) and the microphone (only a reference).
  const incoming = () => captured.filter((c) => c.stream !== local)
  const mic = () => captured.find((c) => c.stream === local)!
  return { env, sockets, peers, track, micCalls: () => micCalls, releaseMic: () => releaseMic(undefined), context, captured, incoming, mic, session: new CallSession(env) }
}

const WELCOME = {
  type: 'welcome',
  participant_id: 'me',
  token: 'tok',
  resumed: false,
  peer: null,
  ice_servers: [{ urls: ['stun:stun.example'] }],
  analysis: { enabled: true, sample_rate: 16000, window_seconds: 12, step_seconds: 5, max_frame_seconds: 2 },
  notice: 'Audio is analysed.',
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function joined(options?: { mic?: Error }) {
  const t = setup(options)
  await t.session.start('Room1234567890', 'en')
  t.sockets[0].open()
  t.sockets[0].receive(WELCOME)
  return t
}

describe('call session', () => {
  it('asks for the microphone, then joins with consent and the chosen language', async () => {
    const t = setup()
    await t.session.start('Room1234567890', 'en')
    expect(t.sockets[0].url).toBe('ws://localhost/api/v1/calls/Room1234567890/ws')
    t.sockets[0].open()
    expect(t.sockets[0].json()[0]).toEqual({ type: 'join', consent: true, analyze: true, language: 'en', resume: null, has_media: false })
    t.sockets[0].receive(WELCOME)
    const s = t.session.getSnapshot()
    expect(s.phase).toBe('in-call')
    expect(s.peer).toBe('none')
    expect(s.analysis.state).toBe('waiting')
  })

  it('a blocked microphone fails clearly and never opens the socket', async () => {
    const error = Object.assign(new Error('no'), { name: 'NotAllowedError' })
    const t = setup({ mic: error })
    await t.session.start('Room1234567890')
    expect(t.session.getSnapshot().phase).toBe('error')
    expect(t.session.getSnapshot().error?.code).toBe('mic_denied')
    expect(t.sockets).toHaveLength(0)
    expect(micError(Object.assign(new Error(), { name: 'NotFoundError' })).code).toBe('no_mic')
  })

  it('offers when the other person joins, and applies their answer and candidates', async () => {
    const t = await joined()
    t.sockets[0].receive({ type: 'peer-joined', peer_id: 'them' })
    await flush()
    const peer = t.peers[0]
    expect(peer.config.iceServers).toEqual(WELCOME.ice_servers)
    expect(peer.tracks).toEqual([t.track])
    expect(t.sockets[0].json().at(-1)).toEqual({ type: 'signal', data: { kind: 'offer', sdp: 'offer-sdp' } })
    t.sockets[0].receive({ type: 'signal', from: 'them', data: { kind: 'answer', sdp: 'answer' } })
    await flush()
    expect(peer.remoteDescription).toEqual({ type: 'answer', sdp: 'answer' })
    t.sockets[0].receive({ type: 'signal', from: 'them', data: { kind: 'ice', candidate: { candidate: 'c1' } } })
    await flush()
    expect(peer.candidates).toEqual([{ candidate: 'c1' }])
  })

  it('answers an offer, queuing candidates that arrive before it', async () => {
    const t = await joined()
    t.sockets[0].receive({ type: 'signal', from: 'them', data: { kind: 'ice', candidate: { candidate: 'early' } } })
    t.sockets[0].receive({ type: 'signal', from: 'them', data: { kind: 'offer', sdp: 'their-offer' } })
    await flush()
    await flush()
    expect(t.peers[0].candidates).toEqual([{ candidate: 'early' }])
    expect(t.sockets[0].json().at(-1)).toEqual({ type: 'signal', data: { kind: 'answer', sdp: 'answer-sdp' } })
  })

  it('captures the remote stream, not the microphone, and streams it as binary frames', async () => {
    const t = await joined()
    t.sockets[0].receive({ type: 'peer-joined', peer_id: 'them' })
    await flush()
    const remote = { id: 'remote-stream' }
    t.peers[0].ontrack?.({ streams: [remote], track: {} })
    await flush()
    expect(t.incoming()).toHaveLength(1)
    expect(t.incoming()[0].stream).toBe(remote)
    // Frames are sent a little late, once the own-voice check has heard what follows them (at the start of a call, up
    // to two frames); the microphone never is.
    const frame = new Int16Array(16000).buffer
    t.incoming()[0].onFrame(frame)
    t.incoming()[0].onFrame(new Int16Array(16000).buffer)
    expect(t.sockets[0].sent.some((item) => item instanceof ArrayBuffer)).toBe(false)
    t.incoming()[0].onFrame(new Int16Array(16000).buffer)
    expect(t.sockets[0].sent.at(-2)).toBe(frame)
    const sent = t.sockets[0].sent.length
    t.mic().onFrame(new Int16Array(1600).fill(9000).buffer)
    expect(t.sockets[0].sent).toHaveLength(sent)
    expect(t.session.getSnapshot().analysis.state).toBe('collecting')

    t.peers[0].setState('connected')
    expect(t.session.getSnapshot().connectedAt).toBe(1_000_000)
    expect(callStatus(t.session.getSnapshot()).label).toBe('Connected')
  })

  it('shows analysis results and alerts as they arrive', async () => {
    const t = await joined()
    t.sockets[0].receive({ type: 'analysis-status', state: 'analyzing', detail: 'Analysing.' })
    t.sockets[0].receive({ type: 'analysis', window: [0, 5], status: 'complete', transcript: [{ start: 0, end: 3, text: 'hello' }], language: 'en', intent: { risk: 'high', summary: '', error: null, detector: 'nli' }, voice: {}, errors: [], skipped_seconds: 0, seconds: 1.2 })
    t.sockets[0].receive({ type: 'alert', alert: { id: 'AL-1', kind: 'scam', level: 'high' } })
    const s = t.session.getSnapshot()
    expect(s.analysis.runs).toBe(1)
    expect(s.transcript).toEqual([{ start: 0, end: 3, text: 'hello', source: null }])
    expect(s.alerts.map((a) => a.id)).toEqual(['AL-1'])
  })

  it('mutes the microphone track and releases everything when the call ends', async () => {
    const t = await joined()
    const finished = vi.fn()
    t.session.setOnFinished(finished)
    t.sockets[0].receive({ type: 'peer-joined', peer_id: 'them' })
    await flush()
    t.peers[0].ontrack?.({ streams: [{}], track: {} })
    await flush()
    t.session.setMicMuted(true)
    expect(t.track.enabled).toBe(false)

    t.session.end()
    expect(t.sockets[0].json().at(-1)).toEqual({ type: 'leave' })
    expect(t.sockets[0].closed).toBe(1000)
    expect(t.peers[0].closed).toBe(true)
    expect(t.track.stopped).toBe(true)
    expect(t.context.closed).toBe(true)
    expect(t.captured.every((c) => c.stopped)).toBe(true) // the other person's audio and the microphone reference
    expect(t.session.getSnapshot().phase).toBe('ended')
    expect(finished).toHaveBeenCalledTimes(1)
    t.session.end()
    expect(finished).toHaveBeenCalledTimes(1)
  })

  it('adds the sentence released before a pause to the transcript, attributed to the other person', async () => {
    const t = await joined()
    t.sockets[0].receive({ type: 'transcript', transcript: [{ start: 4.5, end: 11.5, text: 'Read me the code now.' }], source_participant_id: 'them' })
    await flush()
    expect(t.session.getSnapshot().transcript).toEqual([{ start: 4.5, end: 11.5, text: 'Read me the code now.', source: 'them' }])
  })

  it('tells the user when the microphone is unplugged or revoked mid-call, and keeps that for the report', async () => {
    const t = await joined()
    ;(t.track as { onended?: () => void }).onended?.()
    const snapshot = t.session.getSnapshot()
    expect(snapshot.warning).toMatch(/microphone stopped working/i)
    expect(snapshot.issues.some((issue) => /microphone stopped working/i.test(issue))).toBe(true)
    expect(snapshot.phase).toBe('in-call')
  })

  it('closes the peer connection when the other person leaves, and waits for them', async () => {
    const t = await joined()
    t.sockets[0].receive({ type: 'peer-joined', peer_id: 'them' })
    await flush()
    t.sockets[0].receive({ type: 'peer-left', peer_id: 'them', reason: 'ended' })
    expect(t.peers[0].closed).toBe(true)
    expect(t.session.getSnapshot().peer).toBe('left')
    expect(t.session.getSnapshot().phase).toBe('in-call')
  })

  describe('reconnecting', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('reconnects after a dropped socket and resumes its place', async () => {
      const t = await joined()
      t.sockets[0].drop()
      expect(t.session.getSnapshot().signaling).toBe('reconnecting')
      vi.advanceTimersByTime(1000)
      expect(t.sockets).toHaveLength(2)
      t.sockets[1].open()
      expect(t.sockets[1].json()[0]).toMatchObject({ type: 'join', resume: 'tok' })
      t.sockets[1].receive({ ...WELCOME, resumed: true })
      expect(t.session.getSnapshot().signaling).toBe('open')
      expect(t.session.getSnapshot().warning).toBeNull()
    })

    it('fails fast with a plain message when the server cannot be reached at all', async () => {
      const t = setup()
      await t.session.start('Room1234567890')
      t.sockets[0].drop()
      expect(t.session.getSnapshot().signaling).not.toBe('reconnecting') // never connected: not "reconnecting"
      vi.advanceTimersByTime(1000)
      t.sockets[1].drop()
      expect(t.session.getSnapshot().phase).toBe('error')
      expect(t.session.getSnapshot().error?.message).toContain('Could not reach the VoxShield server')
    })

    it('explains a server restart instead of reconnecting forever', async () => {
      const t = await joined()
      t.sockets[0].drop(1012)
      vi.advanceTimersByTime(1000)
      t.sockets[1].open()
      t.sockets[1].receive({ type: 'error', code: 'room_not_found', message: 'This call room does not exist or has expired.' })
      t.sockets[1].drop(4404)
      expect(t.session.getSnapshot().phase).toBe('error')
      expect(t.session.getSnapshot().error?.message).toContain('may have restarted')
    })

    it('does not retry when the room is full', async () => {
      const t = setup()
      await t.session.start('Room1234567890')
      t.sockets[0].open()
      t.sockets[0].receive({ type: 'error', code: 'room_full', message: 'This call already has two participants.' })
      t.sockets[0].drop(4409)
      vi.advanceTimersByTime(10_000)
      expect(t.sockets).toHaveLength(1)
      expect(t.session.getSnapshot().phase).toBe('error')
      expect(t.session.getSnapshot().error?.message).toContain('two participants')
    })
  })
})

describe('call session hardening', () => {
  it('a double click on Join asks for the microphone and opens the socket once', async () => {
    const t = setup()
    await Promise.all([t.session.start('Room1234567890'), t.session.start('Room1234567890')])
    expect(t.micCalls()).toBe(1)
    expect(t.sockets).toHaveLength(1)
  })

  it('cancelling while the permission prompt is open releases the microphone and never connects', async () => {
    const t = setup({ micPending: true })
    const starting = t.session.start('Room1234567890')
    expect(t.session.getSnapshot().startStep).toBe('mic')
    t.session.end()
    t.releaseMic()
    await starting
    expect(t.sockets).toHaveLength(0)
    expect(t.track.stopped).toBe(true)
    expect(t.session.getSnapshot().phase).toBe('ended')
  })

  it('ignores stale or repeated results and duplicate alerts, and merges evidence updates', async () => {
    const t = await joined()
    const analysis = (seq: number) => ({ type: 'analysis', seq, analyzed_at: '', window: [0, 5], status: 'complete', transcript: [{ start: seq, end: seq + 1, text: `line ${seq}` }], language: 'en', intent: { risk: 'none_detected', summary: '', error: null, detector: 'nli' }, voice: {}, errors: [], skipped_seconds: 0, seconds: 1 })
    t.sockets[0].receive(analysis(2))
    t.sockets[0].receive(analysis(1))
    t.sockets[0].receive(analysis(2))
    expect(t.session.getSnapshot().analysis.runs).toBe(1)
    expect(t.session.getSnapshot().transcript).toHaveLength(1)
    const alert = { id: 'AL-1', kind: 'scam', level: 'elevated', evidence: [{ sentence: 'first' }] }
    t.sockets[0].receive({ type: 'alert', alert })
    t.sockets[0].receive({ type: 'alert', alert })
    t.sockets[0].receive({ type: 'alert-update', alert_id: 'AL-1', evidence: [{ sentence: 'second' }] })
    const alerts = t.session.getSnapshot().alerts
    expect(alerts).toHaveLength(1)
    expect(alerts[0].evidence.map((e) => e.sentence)).toEqual(['first', 'second'])
  })

  it('keeps every analysis problem for the report, not only the last', async () => {
    const t = await joined()
    t.sockets[0].receive({ type: 'analysis-status', state: 'busy', detail: 'busy' })
    t.sockets[0].receive({ type: 'analysis-status', state: 'listening', detail: 'Listening.' })
    t.sockets[0].receive({ type: 'analysis-status', state: 'degraded', detail: 'The scam check could not run.' })
    t.sockets[0].receive({ type: 'analysis-status', state: 'analyzing', detail: '' })
    const entry = toHistoryEntry(t.session.getSnapshot())
    expect(entry.limitations.some((l) => l.includes('busy'))).toBe(true)
    expect(entry.limitations).toContain('The scam check could not run.')
    expect(entry.limitations.some((l) => l.includes('still running when the call ended'))).toBe(true)
  })

  it('says when the models are still loading instead of claiming analysis is ready', async () => {
    const t = setup()
    await t.session.start('Room1234567890')
    t.sockets[0].open()
    t.sockets[0].receive({ ...WELCOME, analysis: { ...WELCOME.analysis, models_ready: false } })
    expect(t.session.getSnapshot().analysis.state).toBe('loading')
  })

  it('starts only one capture even if the track event fires twice', async () => {
    const t = await joined()
    t.sockets[0].receive({ type: 'peer-joined', peer_id: 'them' })
    await flush()
    const remote = { id: 'r' }
    t.peers[0].ontrack?.({ streams: [remote], track: {} })
    t.peers[0].ontrack?.({ streams: [remote], track: {} })
    await flush()
    expect(t.incoming()).toHaveLength(1)
  })

  it('measures the incoming level from the frames it captures', async () => {
    const t = await joined()
    t.sockets[0].receive({ type: 'peer-joined', peer_id: 'them' })
    await flush()
    t.peers[0].ontrack?.({ streams: [{}], track: {} })
    await flush()
    const loud = new Int16Array(16000).fill(8000).buffer
    t.incoming()[0].onFrame(loud)
    expect(t.session.getSnapshot().incoming.lastHeardAt).toBe(1_000_000)
    expect(frameLevel(loud)).toBeCloseTo(8000 / 32768, 3)
    expect(frameLevel(new Int16Array(10).buffer)).toBe(0)
  })

  it('when both sides offer at once, exactly one gives way', async () => {
    const t = await joined() // our participant_id is 'me'
    t.sockets[0].receive({ type: 'peer-joined', peer_id: 'them' })
    await flush()
    expect(t.peers[0].signalingState).toBe('have-local-offer')
    t.sockets[0].receive({ type: 'signal', from: 'zzz', data: { kind: 'offer', sdp: 'theirs' } })
    await flush()
    expect(t.peers[0].remoteDescription).toBeNull() // 'me' < 'zzz': we keep our offer and ignore theirs
    t.sockets[0].receive({ type: 'signal', from: 'aaa', data: { kind: 'offer', sdp: 'theirs' } })
    await flush()
    await flush()
    expect(t.peers[0].remoteDescription).toEqual({ type: 'offer', sdp: 'theirs' }) // 'me' > 'aaa': we give way
    expect(t.sockets[0].json().at(-1)).toEqual({ type: 'signal', data: { kind: 'answer', sdp: 'answer-sdp' } })
  })

  it('shows a button when the browser blocks the call audio, and clears it once playback starts', async () => {
    const t = await joined()
    let allow = false
    const audio = { muted: false, srcObject: null as unknown, play: () => (allow ? Promise.resolve() : Promise.reject(new Error('blocked'))), pause: () => undefined }
    t.session.attachAudio(audio as unknown as HTMLAudioElement)
    t.sockets[0].receive({ type: 'peer-joined', peer_id: 'them' })
    await flush()
    t.peers[0].ontrack?.({ streams: [{}], track: {} })
    await flush()
    expect(t.session.getSnapshot().audioBlocked).toBe(true)
    allow = true
    t.session.resumeAudio()
    await flush()
    expect(t.session.getSnapshot().audioBlocked).toBe(false)
    t.session.end()
    expect(audio.srcObject).toBeNull() // playback stops when the call ends
  })

  it('ignores anything that arrives after the call ended', async () => {
    const t = await joined()
    const socket = t.sockets[0]
    t.session.end()
    const ended = t.session.getSnapshot()
    socket.onmessage?.({ data: JSON.stringify({ type: 'alert', alert: { id: 'late', kind: 'scam', level: 'high' } }) })
    expect(t.session.getSnapshot()).toBe(ended)
  })

  it('tells the user why the other person went away', async () => {
    const t = await joined()
    t.sockets[0].receive({ type: 'peer-joined', peer_id: 'them' })
    t.sockets[0].receive({ type: 'peer-left', peer_id: 'them', reason: 'connection_lost' })
    expect(callStatus(t.session.getSnapshot()).label).toBe('The other person lost connection')
  })
})

describe('alert direction', () => {
  const analysis = (seq: number, source: string, text: string) => ({ type: 'analysis', seq, analyzed_at: '', window: [0, 12], status: 'complete', transcript: [{ start: 1, end: 4, text }], language: 'en', intent: { risk: 'elevated', summary: '', error: null, detector: 'rules' }, voice: {}, errors: [], skipped_seconds: 0, seconds: 1, source_participant_id: source })

  it('keeps results about the other participant, attributed to them, through to the History entry', async () => {
    const t = await joined() // this participant is 'me'
    t.sockets[0].receive(analysis(1, 'them', 'Send the money today.'))
    t.sockets[0].receive({ type: 'alert', alert: { id: 'AL-1', kind: 'scam', level: 'elevated', evidence: [], source_participant_id: 'them' } })
    const s = t.session.getSnapshot()
    expect(s.transcript).toEqual([{ start: 1, end: 4, text: 'Send the money today.', source: 'them' }])
    expect(s.alerts.map((a) => a.source_participant_id)).toEqual(['them'])
    const entry = toHistoryEntry(s)
    expect(entry.alerts[0].source_participant_id).toBe('them')
    expect(entry.transcript[0].source).toBe('them')
  })

  // Synthetic voices (testAudio.ts), not speech: these check which audio each browser sends for analysis.
  const USER1 = syntheticVoice(11, 12)
  const USER2 = syntheticVoice(22, 12)
  const NETWORK_MS = 120

  /** Plays a call into a joined session: `mic` into its microphone, `incoming` as the other person's audio. Returns the
   * audio frames it sent for analysis. */
  async function play(t: Awaited<ReturnType<typeof joined>>, mic: Float32Array, incoming: Float32Array) {
    t.sockets[0].receive({ type: 'peer-joined', peer_id: 'them' })
    await flush()
    t.peers[0].ontrack?.({ streams: [{ id: 'remote' }], track: {} })
    await flush()
    const micFrames = frames(mic, 0.1)
    frames(incoming, 1).forEach((frame, k) => {
      for (let m = k * 10; m < (k + 1) * 10; m++) t.mic().onFrame(micFrames[m])
      t.incoming()[0].onFrame(frame)
    })
    return t.sockets[0].sent.filter((item) => item instanceof ArrayBuffer) as ArrayBuffer[]
  }

  const silent = (frame: ArrayBuffer) => new Int16Array(frame).every((v) => v === 0)

  it('each browser sends only the other participant’s speech for analysis, in both directions', async () => {
    const user1 = await joined()
    const user2 = await joined()
    // Separate devices: each microphone hears its own user, and each browser receives the other user's microphone.
    const at1 = await play(user1, USER1, delayed(USER2, NETWORK_MS))
    const at2 = await play(user2, USER2, delayed(USER1, NETWORK_MS))

    // User 1's browser sends user 2's audio, unchanged, and never user 1's own; and the other way round.
    const user2Speech = frames(delayed(USER2, NETWORK_MS), 1)
    const user1Speech = frames(delayed(USER1, NETWORK_MS), 1)
    expect(at1).toEqual(user2Speech.slice(0, -1)) // the last frame is still held
    expect(at2).toEqual(user1Speech.slice(0, -1))
    expect(at1.some((frame) => user1Speech.some((own) => new Int16Array(own).every((v, i) => v === new Int16Array(frame)[i])))).toBe(false)
    for (const t of [user1, user2]) {
      expect(t.session.getSnapshot().analysis.framesOwnVoice).toBe(0)
      expect(t.session.getSnapshot().warning).toBeNull()
    }
  })

  it('on one shared microphone, the listener’s own voice is never sent as the other person’s speech', async () => {
    const user1 = await joined()
    const user2 = await joined()
    // Two tabs, one microphone: user 1 speaks, both tabs' microphones hear it, and each tab receives it back from the other.
    const at1 = await play(user1, USER1, delayed(USER1, NETWORK_MS))
    const at2 = await play(user2, USER1, delayed(USER1, NETWORK_MS))
    for (const [t, sent] of [[user1, at1], [user2, at2]] as const) {
      expect(sent.length).toBeGreaterThan(0)
      expect(sent.every(silent)).toBe(true) // sent as silence, so the server's call clock still advances
      const s = t.session.getSnapshot()
      expect(s.analysis.framesOwnVoice).toBe(sent.length)
      expect(s.warning).toMatch(/own voice is coming back/)
      expect(toHistoryEntry(s).limitations.some((l) => /own voice is coming back/.test(l))).toBe(true)
    }
  })

  it('audio held back from someone who left is dropped, never sent as the next person’s speech', async () => {
    const t = await joined()
    // Two seconds of user 1 arrive, then they leave: both frames are still held, nothing has been sent.
    expect(await play(t, USER2, delayed(USER1, NETWORK_MS).subarray(0, 2 * 16000))).toEqual([])
    t.sockets[0].receive({ type: 'peer-left', peer_id: 'them', reason: 'ended' })
    // Someone else joins and is silent for three seconds: only their audio is sent.
    const sent = await play(t, USER2, new Float32Array(3 * 16000))
    expect(sent).toHaveLength(2)
    expect(sent.every(silent)).toBe(true)
  })

  it('never shows a result about the listener’s own speech, and records the fault for the report', async () => {
    const t = await joined()
    t.sockets[0].receive(analysis(1, 'me', 'my own words'))
    t.sockets[0].receive({ type: 'alert', alert: { id: 'AL-9', kind: 'scam', level: 'high', evidence: [], source_participant_id: 'me' } })
    t.sockets[0].receive({ type: 'alert-update', alert_id: 'AL-9', evidence: [], source_participant_id: 'me' })
    const s = t.session.getSnapshot()
    expect(s.alerts).toEqual([])
    expect(s.transcript).toEqual([])
    expect(s.analysis.runs).toBe(0)
    expect(s.issues).toContain('A result about your own speech reached this call and was discarded.')
  })
})

describe('call helpers', () => {
  it('builds the socket address next to the API', () => {
    expect(callSocketUrl('abc', '/api/v1', 'https://app.example/call/abc')).toBe('wss://app.example/api/v1/calls/abc/ws')
    expect(callSocketUrl('abc', 'https://api.example/api/v1', 'http://localhost:5173/')).toBe('wss://api.example/api/v1/calls/abc/ws')
    expect(callSocketUrl('abc', '/api/v1', 'http://localhost:5173/')).toBe('ws://localhost:5173/api/v1/calls/abc/ws')
  })

  it('accepts a room ID or a full invitation link', () => {
    expect(parseRoomInput(' AbCdEfGhIjKl0123 ')).toBe('AbCdEfGhIjKl0123')
    expect(parseRoomInput('https://voxshield.example/call/AbCdEfGhIjKl0123')).toBe('AbCdEfGhIjKl0123')
    expect(parseRoomInput('https://voxshield.example/other/x')).toBeNull()
    expect(parseRoomInput('../etc')).toBeNull()
  })

  it('voice alerts never raise the scam-risk level', () => {
    const alert = (kind: LiveAlert['kind'], level: LiveAlert['level']) => ({ kind, level }) as LiveAlert
    expect(highestScamLevel([alert('voice', 'caution')])).toBe('none')
    expect(highestScamLevel([alert('scam', 'low'), alert('scam', 'high'), alert('scam', 'elevated')])).toBe('high')
  })

  it('a call with no completed analysis says so in its History entry', async () => {
    const t = await joined()
    const entry = toHistoryEntry(t.session.getSnapshot())
    expect(entry.kind).toBe('live-call')
    expect(entry.limitations[0]).toContain('No analysis completed')
  })

  it('downsamples 48 kHz to 16 kHz by averaging, across chunk boundaries', () => {
    const down = new Downsampler(48_000)
    const first = down.push(new Float32Array([0.3, 0.3, 0.3, 0.6, 0.6]))
    const second = down.push(new Float32Array([0.6, 0.9]))
    expect(Array.from(first).map((v) => +v.toFixed(3))).toEqual([0.3])
    expect(Array.from(second).map((v) => +v.toFixed(3))).toEqual([0.6])
    const odd = new Downsampler(44_100)
    expect(odd.push(new Float32Array(44_100)).length).toBe(16_000)
  })

  it('cuts 16-bit frames of a fixed size', () => {
    const frames: ArrayBuffer[] = []
    const builder = new FrameBuilder(4, (frame) => frames.push(frame))
    builder.push(new Float32Array([1, -1, 0.5, 2, 0]))
    expect(frames).toHaveLength(1)
    expect(Array.from(new Int16Array(frames[0]))).toEqual([32767, -32768, 16383, 32767])
  })
})
