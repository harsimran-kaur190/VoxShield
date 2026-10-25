import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { AnalysisReport } from '../../lib/types'
import { ResultsView } from './ResultsView'

const base: AnalysisReport = {
  status: 'complete',
  audio: { filename: 'call.wav', format: 'wav', size_bytes: 1000, duration_seconds: 11, sample_rate_hz: 16000, channels: 1 },
  transcript: {
    status: 'ok',
    text: 'Please read me the one time password.',
    language: 'en',
    language_probability: 0.99,
    segments: [{ index: 0, start_seconds: 2.4, end_seconds: 5, text: 'Please read me the one time password.', char_start: 0, char_end: 37 }],
    quality_notes: [],
    model: null,
    error: null,
  },
  voice: {
    verdict: 'model_favors_real',
    summary: "The model's 'real' label won in 2 of 2 windows.",
    fake_score_median: 0.07,
    fake_score_max: 0.1,
    windows_analyzed: 2,
    windows_favoring_fake: 0,
    windows: [
      { start_seconds: 0, end_seconds: 6, fake_score: 0.05 },
      { start_seconds: 6, end_seconds: 11, fake_score: 0.1 },
    ],
    score_note: 'Normalized score, not a calibrated probability.',
    decision_rule: null,
    reliability_caution: 'Informal spot check, not an evaluation.',
    limitations: [],
    model: null,
    error: null,
  },
  intent: {
    risk: 'elevated',
    summary: 'At least one notable indicator was found in the conversation.',
    indicators: [
      {
        id: 'cred_ask_me-7',
        rule_id: 'cred_ask_me',
        category: 'credential_request',
        severity: 'high',
        segment_index: 0,
        char_start: 7,
        char_end: 36,
        start_seconds: 2.4,
        end_seconds: 5,
        excerpt: 'read me the one time password',
        sentence: 'Please read me the one time password.',
        context: 'direct',
        detector: 'rules',
        score: null,
        trigger: "Rule 'cred_ask_me' matched this wording.",
        explanation: 'The speaker asks for a code.',
        suggested_action: 'Do not share it.',
      },
    ],
    categories: ['credential_request'],
    suppressed_mentions: 0,
    reported_mentions: 0,
    uncertain_mentions: 0,
    detector: 'rules',
    score_note: null,
    limitations: [],
    method: null,
    error: null,
  },
  recommendations: {
    state: 'actions',
    headline: 'Based on 1 finding: a request for a code, PIN or password.',
    detail: null,
    items: [
      {
        id: 'credentials',
        title: "Don't share codes, PINs or passwords",
        detail: 'Never read these out to a caller.',
        priority: 'high',
        secondary: false,
        evidence: [{ source: 'intent', id: 'cred_ask_me-7', label: 'read me the one time password', start_seconds: 2.4 }],
      },
    ],
  },
  errors: [],
  privacy: { audio_stored: false, transcript_stored: false },
  timings_seconds: { total: 2.5, model_load: 0 },
  notice: 'x',
}

const renderStatic = (report: AnalysisReport) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ResultsView report={report} onReset={() => {}} onRetry={() => {}} />
    </MemoryRouter>,
  )
const render = renderStatic
const count = (html: string, phrase: RegExp) => (html.match(phrase) ?? []).length

describe('ResultsView', () => {
  it('has one shared "Understanding these results" section and no repeated disclaimers', () => {
    const html = render(base)
    expect(count(html, /Understanding these results/g)).toBe(1)
    expect(count(html, /not (definitive )?proof/gi)).toBe(2) // the shared section only: one voice bullet, one scam bullet
    expect(count(html, /decision aid/gi)).toBe(0)
    expect(count(html, /does not (mean|make)/gi)).toBe(0)
  })

  it('shows evidence: the exact excerpt, its timestamp, why it triggered, and what to do', () => {
    const html = render(base)
    expect(html).toContain('read me the one time password')
    expect(html).toContain('0:02')
    expect(html).toContain('Why: ')
    expect(html).toContain('What to do: ')
  })

  it('shows the real score and does not call it a probability of fraud', () => {
    const html = render(base)
    expect(html).toContain('0.07')
    expect(html).toMatch(/not a (calibrated )?probability/)
    expect(html).not.toMatch(/\d+% (fake|real|likely)/i)
  })

  it('keeps an unavailable assessment visible when one assessment fails', () => {
    const html = render({
      ...base,
      status: 'partial',
      voice: { ...base.voice, verdict: 'unavailable', summary: 'Voice authenticity could not be assessed.', windows: [], fake_score_median: null },
      errors: [{ component: 'voice', code: 'model_load_failed', message: 'The voice authenticity model could not be loaded.' }],
    })
    expect(html).toContain('Unavailable')
    expect(html).toContain('Part of the analysis could not run')
    expect(html).not.toContain('How this score is produced')
    expect(html).not.toContain('Informal spot check')
    expect(html).toContain('Notable indicators')
  })

  it('links every located finding to its transcript text and puts timed findings on the timeline', () => {
    const html = render(base)
    expect(html).toContain('Show in transcript')
    expect(html).toContain('data-marks="cred_ask_me-7"')
    expect(html).toContain('aria-label="Finding at 0:02: read me the one time password"')
  })

  it('handles a finding with no timestamp and no transcript location without inventing either', () => {
    const [item] = base.intent.indicators
    const html = render({
      ...base,
      intent: { ...base.intent, indicators: [{ ...item, start_seconds: null, end_seconds: null, segment_index: null }] },
    })
    expect(html).toContain('no timestamp')
    expect(html).toContain('Not located in the transcript')
    expect(html).not.toContain('Show in transcript')
    expect(html).toContain('has no timestamp')
  })

  it('shows a calm empty state for no findings that never calls the call safe', () => {
    const html = render({ ...base, intent: { ...base.intent, risk: 'none_detected', summary: 'No scam indicators were found in the transcript.', indicators: [], categories: [] } })
    expect(html).toContain('Nothing in the transcript matched the scam check')
    expect(html).toContain('not a clearance')
    expect(html).not.toMatch(/\bsafe\b/i)
  })

  it('renders evidence-linked recommendations: priority, the finding that triggered it, and a working link target', () => {
    const html = render(base)
    expect(html).toContain("Don&#x27;t share codes, PINs or passwords")
    expect(html).toContain('High priority')
    expect(html).toContain('Triggered by')
    expect(html).toContain('“read me the one time password” · 0:02')
    expect(html).toContain('<button')
  })

  it('does not link a recommendation to a finding that is not in the report', () => {
    const plan = { ...base.recommendations, items: [{ ...base.recommendations.items[0], evidence: [{ source: 'intent' as const, id: 'gone-1', label: 'x', start_seconds: null }] }] }
    const html = render({ ...base, recommendations: plan })
    expect(html).toContain('Triggered by')
    expect(html).not.toMatch(/<button[^>]*>“x”/)
  })

  it('puts lower-ranked actions behind "Also worth doing"', () => {
    const extra = (id: string) => ({ ...base.recommendations.items[0], id, title: `Action ${id}`, secondary: true })
    const html = render({ ...base, recommendations: { ...base.recommendations, items: [base.recommendations.items[0], extra('a'), extra('b')] } })
    expect(html).toContain('Also worth doing (2)')
  })

  it('shows a calm message, not a checklist, when nothing suspicious was found', () => {
    const html = render({
      ...base,
      intent: { ...base.intent, risk: 'none_detected', indicators: [], categories: [] },
      recommendations: {
        state: 'none_detected',
        headline: 'No suspicious indicators were detected in the analyzed transcript.',
        detail: 'This is not a guarantee of safety.',
        items: [],
      },
    })
    expect(html).toContain('No suspicious indicators were detected in the analyzed transcript.')
    expect(html).toContain('not a guarantee of safety')
    expect(html).not.toContain('Triggered by')
    expect(html).not.toContain('Analyze this recording again')
  })

  it('offers a retry when there is not enough evidence', () => {
    const html = renderStatic({
      ...base,
      recommendations: { state: 'insufficient', headline: "There isn't enough reliable evidence to recommend a result-specific action.", detail: 'No speech was detected.', items: [] },
    })
    expect(html).toContain('enough reliable evidence')
    expect(html).toContain('Analyze this recording again')
  })

  it('shows the model score for a language-model finding and says how it was found, without calling it a probability', () => {
    const [item] = base.intent.indicators
    const html = render({
      ...base,
      intent: {
        ...base.intent,
        detector: 'nli',
        score_note: 'Each score is the probability an NLI model assigns to entailment. It is not a calibrated probability.',
        indicators: [{ ...item, detector: 'nli', score: 0.973, trigger: 'Model score 0.97 for a statement on this sentence.' }],
      },
    })
    expect(html).toContain('model score 0.97')
    expect(html).toContain('How this was found')
    expect(html).toContain('not a calibrated probability')
    expect(html).not.toMatch(/\d+(\.\d+)?% (likely|scam|fraud)/i)
  })

  it('does not show a score for a rule finding', () => {
    expect(render(base)).not.toMatch(/model score \d/)
  })
})
