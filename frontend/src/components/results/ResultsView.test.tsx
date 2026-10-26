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
    expect(html).toContain('No suspicious indicators were identified by the available analysis')
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

describe('ResultsView evidence investigation', () => {
  const nli = { ...base.intent.indicators[0], detector: 'nli' as const, score: 0.97, rule_id: 'nli_x', id: 'nli_x-7' }

  it('shows the overview with the two assessments kept separate and no combined score', () => {
    const html = render(base)
    expect(html).toContain('id="overview-heading"')
    expect(html).toContain('Looks at how the audio sounds, not at what is said.')
    expect(html).toContain('Looks at what is said in the transcript, not at how the voice sounds.')
    expect(html).toContain('Model favors “real”')
    expect(html).toContain('Notable indicators')
    expect(html).toContain('not a probability')
    expect(html).not.toMatch(/overall|combined (risk|score)|probability of (a )?scam/i)
  })

  it('keeps a real voice with scam findings, and a synthetic-leaning voice with no findings, as independent outcomes', () => {
    const fake = { ...base.voice, verdict: 'model_favors_fake' as const, summary: 'Fake label won.' }
    const quiet = { ...base.intent, risk: 'none_detected' as const, summary: 'No scam indicators were found in the transcript.', indicators: [], categories: [] }
    const html = render({ ...base, voice: fake, intent: quiet, recommendations: { state: 'none_detected', headline: 'Nothing suspicious found.', detail: null, items: [] } })
    expect(html).toContain('Model favors “fake”')
    expect(html).toContain('No indicators found')
    expect(html).not.toContain('Do this first')
  })

  it('states the source and limits of each finding, using only what the detector reported', () => {
    const html = render({ ...base, intent: { ...base.intent, detector: 'nli', indicators: [nli] } })
    expect(html).toContain('Source: </span>Scam-intent analysis (language model) of the speech-to-text transcript')
    expect(html).toContain('The voice analysis was not used.')
    expect(html).toContain('not the chance that a scam occurred')
    expect(html).toContain('Depends on the transcript being correct.')
    expect(html).not.toContain('low-confidence')
  })

  it('flags low-confidence speech recognition only when the transcriber reported it', () => {
    const shaky = { ...base.transcript, segments: [{ ...base.transcript.segments[0], avg_logprob: -1.6 }] }
    expect(render({ ...base, transcript: shaky })).toContain('Speech recognition was low-confidence')
    const fine = { ...base.transcript, segments: [{ ...base.transcript.segments[0], avg_logprob: -0.2 }] }
    expect(render({ ...base, transcript: fine })).not.toContain('low-confidence')
  })

  it('says the voice classifier gives no explanation instead of inventing one', () => {
    const html = render(base)
    expect(html).toContain('does not say which sounds or features led to it')
    expect(html).toContain('voice-related signal')
  })

  it('does not link the transcript to the audio when segment timestamps are unusable', () => {
    const broken = { ...base.transcript, segments: [{ ...base.transcript.segments[0], start_seconds: Number.NaN, end_seconds: Number.NaN }] }
    const html = render({ ...base, transcript: broken })
    expect(html).toContain('This transcript has no timestamps')
    expect(html).not.toContain('Play from')
  })

  it('falls back to plain text when the transcript has no segments', () => {
    const html = render({ ...base, transcript: { ...base.transcript, segments: [] } })
    expect(html).toContain('came back without segments')
    expect(html).toContain('Please read me the one time password.')
  })

  it('explains an inconclusive scam check as neither warning nor reassurance', () => {
    const html = render({ ...base, intent: { ...base.intent, risk: 'inconclusive', summary: 'Could not decide.', indicators: [], categories: [] } })
    expect(html).toContain('neither as a warning nor as reassurance')
    expect(html).not.toMatch(/\bsafe\b/i)
  })
})

describe('ResultsView next step', () => {
  const plan = (overrides: Partial<AnalysisReport['recommendations']>): AnalysisReport['recommendations'] => ({ state: 'none_detected', headline: 'No suspicious indicators were detected in the analyzed transcript.', detail: 'Not a guarantee.', items: [], general: [], ...overrides })
  const generalVerify = {
    id: 'general_verify', title: 'If a message about your account worries you, check it yourself', detail: 'Open your bank app.', priority: 'low' as const,
    why: 'This is an ordinary precaution.', basis: 'general' as const, evidence: [], secondary: false,
  }
  const quiet = { ...base.intent, risk: 'none_detected' as const, summary: 'No scam indicators were found in the transcript.', indicators: [], categories: [] }
  const topOf = (html: string) => html.slice(html.indexOf('id="next-heading"'), html.indexOf('Recording timeline'))

  it('1. a genuine OTP request leads with the action, its evidence, and why it matters', () => {
    const top = topOf(render({ ...base, recommendations: { ...base.recommendations, items: [{ ...base.recommendations.items[0], why: 'Organizations do not ask for codes.', basis: 'finding' }] } }))
    expect(top).toContain('What should I do next?')
    expect(top).toContain("Don&#x27;t share codes, PINs or passwords")
    expect(top).toContain('read me the one time password')
    expect(top).toContain('Organizations do not ask for codes.')
    expect(top).toContain('From a finding in this recording')
  })

  it('2. a protective awareness message with no indicators gets a labelled general precaution and no action', () => {
    const html = render({ ...base, intent: quiet, recommendations: plan({ general: [generalVerify] }) })
    const top = topOf(html)
    expect(top).toContain('No suspicious indicators were detected')
    expect(top).toContain('check it yourself')
    expect(top).toContain('General precaution. Not a result of this analysis')
    expect(html).not.toContain('Do this first')
  })

  it('3. a possibly synthetic voice with harmless content is explained as a voice limitation, not a scam', () => {
    const voiceItem = { id: 'voice', title: "Don't rely on the voice to confirm who it is", detail: 'Leaned fake in 3 of 3 windows.', priority: 'medium' as const, why: 'Voice models can be wrong.', basis: 'voice' as const, evidence: [{ source: 'voice' as const, id: null, label: 'Model favored “fake”', start_seconds: null }], secondary: false }
    const html = render({ ...base, intent: quiet, voice: { ...base.voice, verdict: 'model_favors_fake' }, recommendations: plan({ state: 'actions', headline: 'The voice model leaned “fake”, but no direct scam request was found in the conversation.', items: [voiceItem] }) })
    const top = topOf(html)
    expect(top).toContain('leaned “fake”, but no direct scam request')
    expect(top).toContain('From the voice model only. This is not a scam finding')
    expect(top).not.toMatch(/code|password|payment|hang up/i)
  })

  it('4. a payment request leads with independent verification', () => {
    const item = { id: 'payment', title: 'Pause any payment', detail: 'Verify the request through a trusted contact method.', priority: 'high' as const, why: 'Money sent on request is hard to recover.', basis: 'finding' as const, evidence: [{ source: 'intent' as const, id: 'p-1', label: 'transfer two thousand dollars', start_seconds: 3 }], secondary: false }
    const top = topOf(render({ ...base, recommendations: { ...base.recommendations, items: [item] } }))
    expect(top).toContain('Pause any payment')
    expect(top).toContain('transfer two thousand dollars')
    expect(top).toContain('0:03')
  })

  it('5. an ambiguous bank notification gets ordinary verification and never the words scam or fraud', () => {
    const html = render({ ...base, intent: { ...quiet, risk: 'inconclusive' }, recommendations: plan({ state: 'insufficient', headline: "There isn't enough reliable evidence to recommend a result-specific action.", general: [generalVerify] }) })
    const top = topOf(html)
    expect(top).toContain('check it yourself')
    expect(top).not.toMatch(/scam|fraud|fake/i)
  })

  it('6. a protective warning followed by a request still leads with the request', () => {
    const intent = { ...base.intent, suppressed_mentions: 1 }
    const top = topOf(render({ ...base, intent }))
    expect(top).toContain('read me the one time password')
    expect(top).not.toContain('Never share')
  })

  it('7. with no usable evidence it says so, offers a retry, and adds no generic filler', () => {
    const html = render({ ...base, transcript: { ...base.transcript, status: 'no_speech', segments: [], text: '' }, intent: { ...quiet, risk: 'inconclusive' }, recommendations: plan({ state: 'insufficient', headline: "There isn't enough reliable evidence to recommend a result-specific action.", general: [] }) })
    const top = topOf(html)
    expect(top).toContain('enough reliable evidence')
    expect(top).toContain('Analyze this recording again')
    expect(top).not.toContain('General precaution')
  })

  it('shows each step once with its basis, says why only once for the first step, and omits the top summary when the analysis failed', () => {
    const [first] = base.recommendations.items
    const second = { ...first, id: 'pressure', title: 'Do not let pressure set the pace', why: 'Second why.', basis: 'finding' as const, priority: 'medium' as const }
    const html = render({ ...base, recommendations: { ...base.recommendations, items: [{ ...first, why: 'First why.', basis: 'finding' }, second] } })
    expect(count(html, /First why\./g)).toBe(1) // in the top summary, not repeated under "Do this first"
    expect(html).toContain('Why: Second why.')
    expect(html).toContain('Do this first')
    expect(render({ ...base, status: 'failed' })).not.toContain('What should I do next?')
  })

  it('still renders a report from an older server with no basis, why, or general list', () => {
    const html = render(base)
    expect(html).toContain('From a finding in this recording')
  })

  it('shows the general precaution under a voice-only plan for an ambiguous message', () => {
    const voiceItem = { id: 'voice', title: 'Voice item', detail: 'Leaned fake.', priority: 'medium' as const, basis: 'voice' as const, evidence: [], secondary: false }
    const html = render({ ...base, recommendations: plan({ state: 'actions', headline: 'Voice leaned fake.', items: [voiceItem], general: [generalVerify] }) })
    expect(html).toContain('check it yourself')
    expect(html).toContain('General precaution. Not a result of this analysis')
  })

  it('puts the two checks before the next step, scam intent first, each with its own basis', () => {
    const html = render(base)
    expect(html.indexOf('id="overview-heading"')).toBeLessThan(html.indexOf('id="next-heading"'))
    const overview = html.slice(html.indexOf('id="overview-heading"'), html.indexOf('id="next-heading"'))
    expect(overview.indexOf('Scam intent')).toBeLessThan(overview.indexOf('Voice authenticity'))
    expect(overview).toContain('A real voice can carry a scam, and a synthetic voice can be harmless.')
  })

  it('does not repeat the same guidance twice when there is nothing to act on', () => {
    const quiet = { ...base.intent, risk: 'none_detected' as const, summary: 'No scam indicators were found in the transcript.', indicators: [], categories: [] }
    const html = render({ ...base, intent: quiet, recommendations: plan({ general: [generalVerify] }) })
    expect(count(html, /No suspicious indicators were detected/g)).toBe(1)
    expect(count(html, /check it yourself/g)).toBe(1)
    expect(html).not.toContain('id="steps-heading"')
  })

  it('keeps the full steps section, with its retry, when the analysis failed', () => {
    const html = render({ ...base, status: 'failed', recommendations: plan({ state: 'insufficient', headline: "There isn't enough reliable evidence to recommend a result-specific action." }) })
    expect(html).toContain('id="steps-heading"')
    expect(html).toContain('Analyze this recording again')
    expect(html).not.toContain('What should I do next?')
  })

  it('explains an inconclusive voice check in the overview rather than leaving a bare label', () => {
    const html = render({ ...base, voice: { ...base.voice, verdict: 'inconclusive', summary: 'Windows disagreed, so no lean is reported.', fake_score_median: 0.5, windows_analyzed: 2 } })
    const overview = html.slice(html.indexOf('id="overview-heading"'), html.indexOf('id="next-heading"'))
    expect(overview).toContain('Inconclusive')
    expect(overview).toContain('Windows disagreed, so no lean is reported.')
    expect(overview).not.toContain('Strong')
  })

  it('shows the voice score as a label score, never as a probability', () => {
    const html = render(base)
    expect(html).toContain('median “fake” label score, not a probability')
    expect(html).not.toMatch(/\d+(\.\d+)?\s?%\s*(fake|synthetic|likely|chance)/i)
  })

  it('says when an offer to send money was not counted as a request, and gives no payment advice for it', () => {
    const intent = {
      ...base.intent, risk: 'none_detected' as const, indicators: [], categories: [], offer_mentions: 1,
      summary: "No scam indicators were found in the transcript. 1 sentence(s) offered or asked about sending money from the speaker's side, which is not counted as a request for money.",
    }
    const html = render({ ...base, intent, recommendations: { state: 'none_detected', headline: 'No suspicious indicators were detected in the analyzed transcript.', detail: null, items: [], general: [] } })
    expect(html).toContain("offered or asked about sending money from the speaker&#x27;s side")
    expect(html).not.toContain('Pause any payment')
    expect(html).not.toContain('Do this first')
  })
})
