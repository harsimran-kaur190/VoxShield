import {
  ArrowRight,
  Check,
  Copy,
  FileText,
  Info,
  LogIn,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  Play,
  ShieldCheck,
  User,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { AlertCard } from '../components/live/AlertCard'
import { SafetySteps, TranscriptPanel } from '../components/live/LivePanels'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/Feedback'
import { Field, Select, TextInput } from '../components/ui/Field'
import { buttonClass } from '../components/ui/styles'
import { useLiveCall, useNow } from '../hooks/useLiveCall'
import { ApiError, createCallRoom } from '../lib/api'
import { addEntry, reportPath } from '../lib/history'
import { isLanguageChoice, LANGUAGE_OPTIONS, type LanguageChoice } from '../lib/languages'
import type { CallSession } from '../lib/liveCall/session'
import type { CallSnapshot } from '../lib/liveCall/types'
import {
  ALERT_TITLE,
  ANALYSIS_VIEW,
  callDuration,
  callPath,
  callStatus,
  CONSENT_TEXT,
  formatClock,
  highestScamLevel,
  incomingAudio,
  LIVE_CALL_PATH,
  parseRoomInput,
  qualityLabel,
  RISK_VIEW,
  SCOPE_NOTE,
  toHistoryEntry,
} from '../lib/liveCall/view'
import { INTENT_VIEW, VOICE_VIEW } from '../lib/views'

const ROOM_ID = /^[A-Za-z0-9_-]{10,32}$/

export function LiveCallPage() {
  const { roomId } = useParams()
  // A new session for every room, so moving to another invitation never reuses a finished call.
  return <LiveCall key={roomId ?? 'lobby'} roomId={roomId ?? null} />
}

function LiveCall({ roomId }: { roomId: string | null }) {
  const { session, snapshot, reset } = useLiveCall()
  const [savedId, setSavedId] = useState<string | null>(null)

  // A call that connected or raised alerts is kept in this tab's History, like any other analysis.
  useEffect(() => {
    session.setOnFinished((final) => {
      if (final.connectedAt || final.alerts.length) setSavedId(addEntry(toHistoryEntry(final)).id)
    })
    return () => session.setOnFinished(null)
  }, [session])

  if (roomId && !ROOM_ID.test(roomId)) {
    return (
      <div className="mx-auto max-w-xl py-8">
        <EmptyState title="This invitation link is not valid" description="Check that the whole link was copied, or start a new call." action={<Link to={LIVE_CALL_PATH} className={buttonClass()}>Live Call</Link>} />
      </div>
    )
  }
  if (snapshot.phase === 'starting' || snapshot.phase === 'in-call') return <InCall session={session} s={snapshot} />
  if (snapshot.phase === 'ended' || snapshot.phase === 'error') {
    return (
      <CallOver
        s={snapshot}
        savedId={savedId}
        onRetry={() => {
          setSavedId(null)
          reset()
        }}
      />
    )
  }
  return roomId ? <JoinScreen roomId={roomId} onJoin={(language) => void session.start(roomId, language)} /> : <Lobby />
}

function Intro() {
  return (
    <header>
      <p className="inline-flex items-center gap-2 text-sm font-medium text-accent">
        <ShieldCheck className="size-4" aria-hidden />
        Live Call Protection
      </p>
      <h1 className="mt-2 font-display text-4xl font-medium tracking-tight">Call inside VoxShield, protected while you talk</h1>
      <p className="mt-3 max-w-2xl text-ink-2">
        A private two-person browser call. VoxShield analyses the audio you receive from the other person and warns you, during the call, when it hears scam tactics such as requests for codes or payments, urgency, or impersonation.
      </p>
      <p className="mt-3 flex max-w-2xl items-start gap-2 text-sm text-ink-3">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {SCOPE_NOTE}
      </p>
    </header>
  )
}

function Lobby() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  const inFlight = useRef(false)
  const create = async () => {
    if (inFlight.current) return // one room per click, however fast the clicks
    inFlight.current = true
    setCreating(true)
    setError(null)
    try {
      const room = await createCallRoom()
      navigate(callPath(room.room_id))
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'The call room could not be created.')
      setCreating(false)
      inFlight.current = false
    }
  }

  const join = (event: FormEvent) => {
    event.preventDefault()
    const id = parseRoomInput(input)
    if (!id) return setInputError('Paste the invitation link or the room ID you were sent.')
    navigate(callPath(id))
  }

  return (
    <div className="space-y-8">
      <Intro />
      <div className="grid gap-4 md:grid-cols-2">
        <Card as="section" aria-labelledby="start-call">
          <CardHeader id="start-call" title="Start a call" description="Creates a private room and an invitation link for one other person." />
          <Button className="mt-5" icon={PhoneCall} loading={creating} onClick={create}>
            Create call room
          </Button>
          {error && (
            <p role="alert" className="mt-3 text-sm text-amber">
              {error}
            </p>
          )}
        </Card>
        <Card as="section" aria-labelledby="join-call">
          <CardHeader id="join-call" title="Join a call" description="Use the link or room ID the other person sent you." />
          <form className="mt-4 space-y-3" onSubmit={join}>
            <Field label="Invitation link or room ID" error={inputError ?? undefined}>
              {(control) => (
              <TextInput
                {...control}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value)
                  setInputError(null)
                }}
                placeholder="https://…/call/AbCd… or AbCd…"
                autoComplete="off"
                spellCheck={false}
              />
              )}
            </Field>
            <Button type="submit" variant="secondary" icon={LogIn}>
              Continue
            </Button>
          </form>
        </Card>
      </div>
      <SafetySteps id="lobby-safety" />
    </div>
  )
}

function CopyLink({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}${callPath(roomId)}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <code className="min-w-0 flex-1 truncate rounded-control border border-line bg-paper-2 px-3 py-2 font-mono text-xs leading-6 text-ink" title={link}>
        {link}
      </code>
      <Button variant="secondary" size="md" icon={copied ? Check : Copy} onClick={copy}>
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  )
}

function JoinScreen({ roomId, onJoin }: { roomId: string; onJoin: (language: LanguageChoice) => void }) {
  const consentId = useId()
  const [consent, setConsent] = useState(false)
  const [language, setLanguage] = useState<LanguageChoice>('auto')
  return (
    <div className="space-y-8">
      <Intro />
      <div className="grid gap-4 lg:grid-cols-12">
        <Card as="section" aria-labelledby="join-room" className="lg:col-span-7">
          <CardHeader id="join-room" title="Ready to join" description="Send this link to the one person you want to talk to. Anyone with it can take the second place." />
          <div className="mt-4">
            <CopyLink roomId={roomId} />
          </div>
          <div className="mt-5 max-w-xs">
            <Field label="Language the other person speaks">
              {(control) => (
              <Select {...control} value={language} onChange={(event) => isLanguageChoice(event.target.value) && setLanguage(event.target.value)}>
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </Select>
              )}
            </Field>
          </div>
          <label htmlFor={consentId} className="mt-5 flex items-start gap-3 rounded-control border border-line bg-paper-2 p-3 text-sm text-ink-2">
            <input id={consentId} type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-accent" />
            <span>{CONSENT_TEXT}</span>
          </label>
          <Button className="mt-5" size="lg" icon={Phone} disabled={!consent} onClick={() => onJoin(language)}>
            Allow microphone and join
          </Button>
          <p className="mt-2 text-xs text-ink-3">Your browser will ask for microphone access. The call cannot start without it.</p>
        </Card>
        <div className="lg:col-span-5">
          <SafetySteps id="join-safety" />
        </div>
      </div>
    </div>
  )
}

function InCall({ session, s }: { session: CallSession; s: CallSnapshot }) {
  const now = useNow(s.phase === 'in-call')
  const status = callStatus(s)
  const level = highestScamLevel(s.alerts)
  const risk = RISK_VIEW[level]
  const latest = s.alerts[0]
  const latestScam = s.alerts.find((alert) => alert.kind === 'scam')
  // Scam alerts lead; a voice reading from the same window must not push the scam finding down.
  const ordered = [...s.alerts.filter((alert) => alert.kind === 'scam'), ...s.alerts.filter((alert) => alert.kind !== 'scam')]
  const analysis = ANALYSIS_VIEW[s.analysis.state]
  const lastVoice = s.analysis.last?.voice
  const flagged = s.alerts.flatMap((alert) => alert.evidence.map((item) => item.sentence))
  const [confirmEnd, setConfirmEnd] = useState(false)
  // A stable ref: an inline callback would detach and reattach the audio element on every render.
  const audioRef = useCallback((element: HTMLAudioElement | null) => session.attachAudio(element), [session])
  const askToEnd = () => {
    setConfirmEnd(true)
    setTimeout(() => setConfirmEnd(false), 5000)
  }

  if (s.phase === 'starting') {
    return (
      <div className="mx-auto max-w-md">
        <LoadingState
          label={s.startStep === 'signaling' ? 'Connecting to the call room…' : 'Waiting for microphone permission…'}
          detail={s.startStep === 'signaling' ? 'Microphone ready. Joining the room on the VoxShield server.' : 'Choose “Allow” when your browser asks to use the microphone.'}
        />
        <div className="flex justify-center">
          <Button variant="ghost" onClick={() => session.end('you')}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }
  const hearing = incomingAudio(s, now)
  const quality = qualityLabel(s.quality)
  const lastIntent = s.analysis.last?.intent.risk
  const lastAgo = s.analysis.lastAt ? Math.max(0, Math.round((now - s.analysis.lastAt) / 1000)) : null
  const riskDetail =
    latestScam && level !== 'none'
      ? latestScam.reason
      : !s.analysis.enabled
        ? 'Analysis is off for this call.'
        : s.analysis.runs === 0
          ? 'No analysis has finished yet, so VoxShield cannot say anything about this call so far.'
          : lastIntent === 'inconclusive' || lastIntent === 'unavailable'
            ? `The latest scam check was ${lastIntent}. ${risk.detail}`
            : risk.detail

  const riskBox =
    level === 'high' ? 'border-critical/40 bg-critical-tint' : level === 'elevated' ? 'border-amber-light/50 bg-amber-tint/50' : 'border-line bg-card'

  return (
    <div className="space-y-5">
      <audio ref={audioRef} autoPlay className="hidden" />
      <p className="sr-only" aria-live="assertive">
        {latest ? `${ALERT_TITLE[latest.level]}. ${latest.reason}` : ''}
      </p>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-medium tracking-tight">Live call</h1>
          <span aria-live="polite">
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        </div>
        <p className="font-mono text-2xl tabular-nums text-ink" aria-label={`Call time ${formatClock(callDuration(s, now))}`}>
          {formatClock(callDuration(s, now))}
        </p>
      </header>

      {s.audioBlocked && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-amber-light/50 bg-amber-tint/40 px-4 py-2 text-sm text-amber">
          Your browser paused the call audio until you click.
          <Button size="sm" icon={Play} onClick={() => session.resumeAudio()}>
            Play call audio
          </Button>
        </div>
      )}

      {s.warning && (
        <p role="status" className="rounded-control border border-amber-light/50 bg-amber-tint/40 px-4 py-2 text-sm text-amber">
          {s.warning}
        </p>
      )}

      <section aria-label="Scam risk" className={`flex flex-col gap-3 rounded-card border p-4 sm:flex-row sm:items-center sm:justify-between ${riskBox}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-3">Scam risk</span>
            <Badge tone={risk.tone}>{risk.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-2">{riskDetail}</p>
        </div>
        {(level === 'high' || level === 'elevated') && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={s.remoteSilenced ? Volume2 : VolumeX} onClick={() => session.setRemoteSilenced(!s.remoteSilenced)}>
              {s.remoteSilenced ? 'Unsilence caller' : 'Silence caller'}
            </Button>
            <Button variant="critical" size="sm" icon={PhoneOff} onClick={() => session.end('you')}>
              End call now
            </Button>
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-5">
          <Card as="section" aria-labelledby="call-people">
            <CardHeader id="call-people" title="Call" />
            <ul className="mt-4 space-y-3">
              <Person label="You" detail={s.micMuted ? 'Microphone muted' : 'Microphone on'} tone={s.micMuted ? 'warning' : 'success'} icon={s.micMuted ? MicOff : Mic} />
              <Person
                label="Other person"
                detail={
                  s.peer === 'present'
                    ? s.media === 'connected'
                      ? `${hearing.label}${s.remoteSilenced ? ' · silenced on this device' : ''}`
                      : s.media === 'failed' || s.media === 'disconnected'
                        ? 'Audio interrupted'
                        : 'Connecting audio…'
                    : s.peer === 'reconnecting'
                      ? 'Reconnecting…'
                      : s.peer === 'left'
                        ? s.peerLeftReason === 'connection_lost'
                          ? 'Lost connection'
                          : 'Left the call'
                        : 'Not joined yet'
                }
                tone={s.peer === 'present' && s.media === 'connected' ? hearing.tone : s.peer === 'reconnecting' || s.media === 'failed' ? 'warning' : 'neutral'}
                icon={User}
              />
            </ul>
            {quality && s.media === 'connected' && <p className="mt-3 text-xs text-ink-3">Connection: {quality}</p>}
            {(s.peer === 'none' || s.peer === 'left') && s.roomId && (
              <div className="mt-4">
                <p className="mb-2 text-sm text-ink-2">{s.peer === 'left' ? 'They can rejoin with the same link.' : 'Waiting for them to open your invitation link:'}</p>
                <CopyLink roomId={s.roomId} />
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
              <Button variant="secondary" icon={s.micMuted ? Mic : MicOff} aria-pressed={s.micMuted} onClick={() => session.setMicMuted(!s.micMuted)}>
                {s.micMuted ? 'Unmute' : 'Mute mic'}
              </Button>
              <Button variant="secondary" icon={s.remoteSilenced ? Volume2 : VolumeX} aria-pressed={s.remoteSilenced} onClick={() => session.setRemoteSilenced(!s.remoteSilenced)}>
                {s.remoteSilenced ? 'Unsilence' : 'Silence caller'}
              </Button>
              {confirmEnd ? (
                <Button variant="critical" icon={PhoneOff} onClick={() => session.end('you')} className="col-span-2 sm:col-span-1 lg:col-span-2 xl:col-span-1">
                  Confirm end
                </Button>
              ) : (
                <Button variant="critical" icon={PhoneOff} onClick={askToEnd} className="col-span-2 sm:col-span-1 lg:col-span-2 xl:col-span-1">
                  End call
                </Button>
              )}
            </div>
            {s.notice && <p className="mt-4 text-xs text-ink-3">{s.notice}</p>}
          </Card>

          <Card as="section" aria-labelledby="call-analysis">
            <CardHeader id="call-analysis" title="Analysis" description={`Every ${s.analysis.stepSeconds} s of new audio, VoxShield checks the last ${s.analysis.windowSeconds} s the other person said.`} />
            <dl className="mt-4 grid gap-2 text-sm">
              <Row label="Status">
                <Badge tone={analysis.tone}>{analysis.label}</Badge>
                {s.analysis.detail && <span className="block pt-1 text-ink-3">{s.analysis.detail}</span>}
              </Row>
              <Row label="Windows analysed">
                {s.analysis.runs}
                {lastAgo !== null && <span className="text-ink-3"> · last result {lastAgo} s ago</span>}
              </Row>
              <Row label="Latest scam check">
                {lastIntent ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`size-2 rounded-full ${INTENT_VIEW[lastIntent].dot}`} aria-hidden />
                    {INTENT_VIEW[lastIntent].label}
                  </span>
                ) : (
                  <span className="text-ink-3">No result yet</span>
                )}
              </Row>
              {s.analysis.last && (
                <>
                  <Row label="Last window">
                    {formatClock(s.analysis.last.window[0])}–{formatClock(s.analysis.last.window[1])}
                    {s.analysis.last.seconds !== null && <span className="text-ink-3"> · took {s.analysis.last.seconds.toFixed(1)} s</span>}
                  </Row>
                  {s.analysis.last.skipped_seconds > 0 && (
                    <Row label="Not analysed">
                      <span className="text-amber">{s.analysis.last.skipped_seconds.toFixed(0)} s skipped while the server was catching up</span>
                    </Row>
                  )}
                </>
              )}
              <Row label="Synthetic voice">
                {lastVoice ? (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`size-2 rounded-full ${VOICE_VIEW[lastVoice.verdict].dot}`} aria-hidden />
                      {VOICE_VIEW[lastVoice.verdict].label}
                    </span>
                    {lastVoice.fake_score_median !== null && <span className="block text-xs text-ink-3">Score {lastVoice.fake_score_median.toFixed(2)} (uncalibrated, not a probability)</span>}
                    <span className="block pt-1 text-xs text-ink-3">{lastVoice.caution ?? lastVoice.summary}</span>
                  </>
                ) : (
                  <span className="text-ink-3">No reading yet</span>
                )}
              </Row>
              {s.analysis.last && s.analysis.last.errors.length > 0 && (
                <Row label="Limitations">
                  <ul className="text-amber">
                    {[...new Set(s.analysis.last.errors.map((error) => error.message))].map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </Row>
              )}
            </dl>
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-7">
          <Card as="section" aria-labelledby="call-alerts">
            <CardHeader id="call-alerts" title={`Alerts${s.alerts.length ? ` (${s.alerts.length})` : ''}`} description="From the analysis of the other person’s audio. Scam risk and the voice check are separate." />
            <div className="mt-4 space-y-3">
              {s.alerts.length === 0 ? (
                <p className="rounded-control border border-dashed border-line-strong p-4 text-sm text-ink-3">No alerts. VoxShield will warn you here as soon as it hears enough to do so.</p>
              ) : (
                ordered.map((alert, index) => <AlertCard key={alert.id} alert={alert} defaultOpen={index === 0 && alert.level === 'high'} />)
              )}
            </div>
          </Card>
          <TranscriptPanel id="call-transcript" lines={s.transcript} flagged={flagged} />
          <SafetySteps id="call-safety" />
        </div>
      </div>
    </div>
  )
}

function Person({ label, detail, tone, icon: Icon }: { label: string; detail: string; tone: 'success' | 'warning' | 'neutral'; icon: typeof User }) {
  const dot = tone === 'success' ? 'bg-ok' : tone === 'warning' ? 'bg-amber-light' : 'bg-line-strong'
  return (
    <li className="flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-full bg-paper-2 text-ink-2">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-ink">{label}</span>
        <span className="inline-flex items-center gap-1.5 text-sm text-ink-3">
          <span className={`size-2 rounded-full ${dot}`} aria-hidden />
          {detail}
        </span>
      </span>
    </li>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 text-ink-2">{children}</dd>
    </div>
  )
}

function CallOver({ s, savedId, onRetry }: { s: CallSnapshot; savedId: string | null; onRetry: () => void }) {
  const level = highestScamLevel(s.alerts)
  const summary = (
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
      <Row label="Duration">{formatClock(callDuration(s, s.endedAt ?? s.connectedAt ?? 0))}</Row>
      <Row label="Alerts">{s.alerts.length}</Row>
      <Row label="Highest scam risk">{RISK_VIEW[level].label}</Row>
    </dl>
  )
  const actions = (
    <div className="mt-5 flex flex-wrap gap-2">
      {savedId && (
        <Link to={reportPath(savedId)} className={buttonClass()}>
          <FileText className="size-4" aria-hidden />
          Review the call report
        </Link>
      )}
      <Link to={LIVE_CALL_PATH} className={buttonClass({ variant: 'secondary' })}>
        Start a new call
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  )

  if (s.phase === 'error') {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-4">
        {/* Retrying a room the server no longer has cannot work, so that case offers a new call instead. */}
        {s.error?.code === 'room_gone' || s.error?.code === 'room_not_found' ? (
          <ErrorState title="This call is no longer available" message={s.error.message}>
            <Link to={LIVE_CALL_PATH} className={buttonClass({ size: 'sm' })}>
              Start a new call
            </Link>
          </ErrorState>
        ) : (
          <ErrorState title="The call could not continue" message={s.error?.message ?? 'Something went wrong.'} onRetry={onRetry} retryLabel="Try again" />
        )}
        {(s.connectedAt || s.alerts.length > 0) && <Card>{summary}{actions}</Card>}
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-2xl py-4">
      <Card as="section" aria-labelledby="call-over">
        <CardHeader id="call-over" title="Call ended" description="Microphone released and call audio discarded. Alerts and transcript are kept in this tab’s History only." />
        {summary}
        {actions}
      </Card>
    </div>
  )
}
