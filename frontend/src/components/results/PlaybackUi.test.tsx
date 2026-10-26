import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { AnalysisReport, IntentIndicator, TranscriptResult } from '../../lib/types'
import { groupFindings, uniqueEvidence } from '../../lib/playback'
import { controllerIn, type ControllerMode } from '../../test-utils/fakeAudio'
import { IntentSection } from './IntentSection'
import { PlaybackProvider } from './PlaybackProvider'
import { ResultsView } from './ResultsView'
import { Timeline } from './Timeline'
import { TranscriptWorkspace } from './TranscriptWorkspace'
import { VoiceSection } from './VoiceSection'

const transcript: TranscriptResult = {
  status: 'ok',
  text: 'Hello there. Please read me the code now.',
  language: 'en',
  language_probability: 0.99,
  segments: [
    { index: 0, start_seconds: 0, end_seconds: 2, text: 'Hello there.', char_start: 0, char_end: 12 },
    { index: 1, start_seconds: 2.5, end_seconds: 6, text: 'Please read me the code now.', char_start: 13, char_end: 41 },
  ],
  quality_notes: [],
  model: null,
  error: null,
}

const finding = (over: Partial<IntentIndicator> = {}): IntentIndicator => ({
  id: 'cred-13', rule_id: 'cred', category: 'credential_request', severity: 'high', segment_index: 1, char_start: 13, char_end: 41,
  start_seconds: 2.5, end_seconds: 6, excerpt: 'Please read me the code now.', sentence: 'Please read me the code now.', context: 'direct',
  detector: 'rules', score: null, trigger: 'Rule matched.', explanation: 'The speaker asks for a code.', suggested_action: 'Do not share it.', ...over,
})

const report = (indicators: IntentIndicator[]): AnalysisReport =>
  ({
    status: 'complete',
    audio: { filename: 'a-very-long-call-recording-name-that-should-not-dominate-the-page-2026-10-25.wav', format: 'wav', size_bytes: 368684, duration_seconds: 10.8, sample_rate_hz: 16000, channels: 1 },
    transcript,
    voice: {
      verdict: 'model_favors_real', summary: "The model's 'real' label won in 2 of 2 windows.", fake_score_median: 0.07, fake_score_max: 0.1,
      windows_analyzed: 2, windows_favoring_fake: 0,
      windows: [{ start_seconds: 0, end_seconds: 6, fake_score: 0.05 }, { start_seconds: 6, end_seconds: 10.8, fake_score: 0.1 }],
      score_note: 'Normalized score.', decision_rule: null, reliability_caution: null, limitations: [], model: null, error: null,
    },
    intent: {
      risk: indicators.length ? 'high' : 'none_detected', summary: 'Summary.', indicators, categories: ['credential_request'],
      suppressed_mentions: 0, reported_mentions: 0, uncertain_mentions: 0, detector: 'rules', score_note: null, limitations: [], method: null, error: null,
    },
    recommendations: {
      state: 'actions', headline: 'Based on 1 finding.', detail: null,
      items: [
        { id: 'credentials', title: "Don't share codes", detail: 'Never read these out.', priority: 'high', secondary: false, evidence: [{ source: 'intent', id: 'cred-13', label: 'read me the code', start_seconds: 2.5 }] },
        { id: 'pressure', title: "Don't let pressure set the pace", detail: 'Pause and verify.', priority: 'medium', secondary: false, evidence: [] },
      ],
    },
    errors: [], privacy: { audio_stored: false, transcript_stored: false }, timings_seconds: { total: 2.5 }, notice: 'x',
  }) as AnalysisReport

const noop = () => {}
/** The opening tag of the element carrying `marker`, so assertions look at real attributes and not class names. */
const tagWith = (html: string, marker: string) => html.match(new RegExp(`<[^>]*${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>`))?.[0] ?? ''
const isDisabled = (tag: string) => /\sdisabled(=""|\s|>)/.test(tag)
function renderWith(mode: ControllerMode, children: (r: AnalysisReport) => React.ReactNode, r = report([finding()]), time = 0) {
  const { controller } = controllerIn(mode, { time })
  return renderToStaticMarkup(
    <MemoryRouter>
      <PlaybackProvider controller={controller}>{children(r)}</PlaybackProvider>
    </MemoryRouter>,
  )
}
const timeline = (r: AnalysisReport, selected: string | null = null) => (
  <Timeline report={r} waveform={{ peaks: [0.2, 1, 0.5], duration: 10.8 }} groups={groupFindings(r.intent.indicators)} selected={selected} onSelect={noop} onChooseAgain={noop} />
)

describe('Recording timeline player', () => {
  it('offers working transport controls when the audio is ready: play, skip, seek slider, volume', () => {
    const html = renderWith('ready', timeline)
    expect(isDisabled(tagWith(html, 'aria-label="Play recording"'))).toBe(false)
    expect(html).toContain('aria-label="Back 5 seconds"')
    expect(html).toContain('aria-label="Forward 5 seconds"')
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-label="Recording position"')
    expect(html).toContain('aria-valuemax="11"')
    expect(html).toContain('aria-valuetext="0:00 of 0:10"')
    expect(html).toContain('aria-label="Volume"')
    expect(html).toContain('0:00')
  })

  it('shows Pause while playing', () => {
    expect(renderWith('playing', timeline)).toContain('aria-label="Pause recording"')
  })

  it('makes voice windows and finding markers jump targets, with descriptive labels', () => {
    const html = renderWith('ready', timeline)
    expect(html).toMatch(/aria-label="Voice window 0:00 to 0:06, model “fake” score 0.05. Press to jump here."/)
    expect(html).toContain('aria-label="Finding at 0:02: Please read me the code now."')
  })

  it('has a concise legend that distinguishes the playhead, voice windows and findings', () => {
    const html = renderWith('ready', timeline)
    for (const text of ['Playhead', 'Voice window and its score', 'Finding']) expect(html).toContain(text)
  })

  it('marks the selected passage on the timeline and in the legend', () => {
    expect(renderWith('ready', (r) => timeline(r, 'cred-13'))).toContain('Selected passage')
    expect(renderWith('ready', (r) => timeline(r, null))).not.toContain('Selected passage')
  })

  it('says the audio is unavailable, disables playback, and offers to choose it again, without pretending', () => {
    const html = renderWith('unavailable', timeline)
    expect(html).toContain('The audio isn’t available in this session')
    expect(html).toContain('Upload or record it again')
    expect(isDisabled(tagWith(html, 'aria-label="Play recording"'))).toBe(true)
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toContain('Press to jump here')
  })

  it('shows a playback error clearly', () => {
    const html = renderWith('error', timeline)
    expect(html).toContain('role="alert"')
    expect(html).toContain('could not play the recording')
  })

  it('keeps findings without a timestamp off the timeline and says so', () => {
    const r = report([finding({ start_seconds: null, end_seconds: null })])
    const html = renderWith('ready', timeline, r)
    expect(html).not.toContain('aria-label="Finding at')
    expect(html).toContain('No findings with a timestamp to place here.')
    expect(html).toContain('1 finding has no timestamp')
  })

  it('lays out a long and a very short recording without breaking (positions stay inside 0 to 100%)', () => {
    for (const duration of [0.9, 600]) {
      const r = report([finding({ start_seconds: duration * 2 })]) // out-of-range on purpose
      const { controller } = controllerIn('ready', { duration })
      const html = renderToStaticMarkup(
        <MemoryRouter>
          <PlaybackProvider controller={controller}>{timeline({ ...r, audio: { ...r.audio, duration_seconds: duration } })}</PlaybackProvider>
        </MemoryRouter>,
      )
      const lefts = [...html.matchAll(/left:([\d.]+)%/g)].map((m) => Number(m[1]))
      expect(lefts.every((n) => n >= 0 && n <= 100)).toBe(true)
    }
  })
})

describe('Findings and playback', () => {
  const intent = (r: AnalysisReport) => (
    <IntentSection intent={r.intent} transcript={r.transcript} groups={groupFindings(r.intent.indicators)} selected={null} onSelect={noop} onShowInTranscript={noop} />
  )

  it('makes a finding’s timestamp a play button only when the audio is playable and the timestamp is real', () => {
    expect(renderWith('ready', intent)).toContain('aria-label="Play from 0:02"')
    expect(renderWith('unavailable', intent)).not.toContain('Play from')
    const none = renderWith('ready', intent, report([finding({ start_seconds: null, end_seconds: null })]))
    expect(none).not.toContain('Play from')
    expect(none).toContain('no timestamp')
  })

  it('still lets a finding without a timestamp be inspected in the transcript', () => {
    expect(renderWith('ready', intent, report([finding({ start_seconds: null })]))).toContain('Show in transcript')
  })

  it('shows a passage flagged for several behaviors once, with each reason, strongest signal first', () => {
    const r = report([
      finding({ id: 'urgency-13', rule_id: 'urgency', category: 'urgency', severity: 'low', explanation: 'Time pressure.' }),
      finding({ id: 'cred-13', explanation: 'The speaker asks for a code.' }),
    ])
    const html = renderWith('ready', intent, r)
    expect((html.match(/<blockquote/g) ?? []).length).toBe(1)
    expect(html).toContain('Time pressure.')
    expect(html.indexOf('The speaker asks for a code.')).toBeLessThan(html.indexOf('Time pressure.'))
    expect(html).toContain('High signal')
    expect(html).toContain('data-finding-ids="cred-13 urgency-13"')
  })

  it('explains that an indicator is not confirmed fraudulent intent', () => {
    expect(renderWith('ready', intent)).toContain('don’t confirm fraudulent intent')
  })
})

describe('Transcript synchronized with playback', () => {
  const view = (r: AnalysisReport) => <TranscriptWorkspace transcript={r.transcript} indicators={r.intent.indicators} selected={null} onSelect={noop} />

  it('makes each timestamp a play button when playable', () => {
    const html = renderWith('ready', view)
    expect(html).toContain('aria-label="Play from 0:00"')
    expect(html).toContain('aria-label="Play from 0:02"')
  })

  it('highlights the segment being spoken at the playhead, and none in a silent gap', () => {
    const during = renderWith('ready', view, report([finding()]), 3)
    expect((during.match(/aria-current="true"/g) ?? []).length).toBe(1)
    expect(during).toMatch(/aria-current="true"[^>]*class="[^"]*border-accent[^"]*"[^>]*>.*Please read me/s)
    const gap = renderWith('ready', view, report([finding()]), 2.2)
    expect(gap).not.toContain('aria-current')
  })

  it('has no play buttons and says so when the audio is unavailable, but keeps the timestamps as text', () => {
    const html = renderWith('unavailable', view)
    expect(html).not.toContain('Play from')
    expect(html).toContain('Playback is not available for this transcript')
    expect(html).toContain('0:02')
  })

  it('keeps matched phrases highlighted and inspectable during playback', () => {
    const html = renderWith('playing', view, report([finding({ char_start: 13, char_end: 41 })]), 3)
    expect(html).toContain('data-marks="cred-13"')
  })
})

describe('Voice windows', () => {
  it('lets a person jump to a window when playable, and shows a plain list when not', () => {
    const r = report([])
    const ready = renderWith('ready', () => <VoiceSection voice={r.voice} />)
    expect(ready).toContain('Jump to this window.')
    const off = renderWith('unavailable', () => <VoiceSection voice={r.voice} />)
    expect(off).not.toContain('Jump to this window.')
    expect(off).toContain('aria-label="Scores by window"')
  })

  it('says which label the score is and does not present it as a calibrated probability or proof', () => {
    const html = renderWith('ready', () => <VoiceSection voice={report([]).voice} />)
    expect(html).toContain('output for its “fake” label')
    expect(html).toContain('not a calibrated probability')
    expect(html).toContain('does not show the recording was generated by AI')
  })
})

describe('Results header and layout', () => {
  const full = (r: AnalysisReport) => (
    <MemoryRouter>
      <ResultsView report={r} audio={null} onReset={noop} />
    </MemoryRouter>
  )

  it('leads with "Audio analysis", keeps the filename secondary and truncated, and shows compact metadata', () => {
    const html = renderToStaticMarkup(full(report([finding()])))
    expect(html).toMatch(/<h1[^>]*>Audio analysis<\/h1>/)
    expect(html).toMatch(/class="truncate"[^>]*title="a-very-long-call-recording-name/)
    expect(html).toContain('WAV · 10.8s · 360.0 KB')
    expect(html).toContain('Analysis complete')
    expect(html).toContain('Analyze another')
  })

  it('shows the two assessments side by side, each with its own label and basis, and no combined score', () => {
    const html = renderToStaticMarkup(full(report([finding()])))
    const overview = html.slice(html.indexOf('id="overview-heading"'), html.indexOf('id="next-heading"'))
    expect(overview).toContain('Two separate checks.')
    expect(overview).toContain('Strong indicators')
    expect(overview).toContain('Model favors “real”')
    expect(overview).toMatch(/Scam intent[\s\S]*Voice authenticity/)
    expect(overview).not.toMatch(/overall|combined (risk|score)|proven|%/i)
  })

  it('with no audio supplied, the whole page still renders and explains what happened', () => {
    const html = renderToStaticMarkup(full(report([finding()])))
    expect(html).toContain('isn’t available in this session')
    expect(html).toContain('Recording timeline')
  })

  it('renders an inconclusive, finding-free result with the calm recommendation state', () => {
    const r = report([])
    r.intent = { ...r.intent, risk: 'inconclusive', summary: 'Too short to judge.' }
    r.recommendations = { state: 'insufficient', headline: "There isn't enough reliable evidence to recommend a result-specific action.", detail: null, items: [] }
    const html = renderToStaticMarkup(full(r))
    const overview = html.slice(html.indexOf('id="overview-heading"'), html.indexOf('id="next-heading"'))
    expect(overview).toContain('Inconclusive')
    expect(overview).toContain('Too short to judge.') // an unanswered check says why, so silence is not read as safe or as a scam
    expect(html).toContain('enough reliable evidence')
    expect(html).not.toContain('Do this first')
  })

  it('puts one action first and the others in a compact list', () => {
    const html = renderToStaticMarkup(full(report([finding()])))
    expect(html).toContain('Do this first')
    expect(html).toMatch(/Do this first[\s\S]*Don&#x27;t share codes[\s\S]*Then[\s\S]*Don&#x27;t let pressure set the pace/)
  })

  it('shows a passage once in a recommendation even when two findings point at it', () => {
    const ref = { source: 'intent' as const, id: 'a-1', label: 'Do not tell anyone.', start_seconds: 4 }
    expect(uniqueEvidence([ref, { ...ref, id: 'b-1' }, { ...ref, label: 'Another passage', id: 'c-9' }])).toHaveLength(2)
    expect(uniqueEvidence([])).toEqual([])
  })
})
