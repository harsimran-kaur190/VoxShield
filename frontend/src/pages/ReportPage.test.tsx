import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import App from '../App'
import { ResultsView } from '../components/results/ResultsView'
import { STRANDED_TRAVELLER } from '../lib/demoScenario'
import { addEntry, clearHistory } from '../lib/history'
import { englishReport } from '../test-utils/reports'

afterEach(clearHistory)

const at = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

const simulation = (elapsed: number, status: 'finished' | 'ended') =>
  addEntry({ kind: 'simulation', scenarioId: STRANDED_TRAVELLER.id, title: STRANDED_TRAVELLER.title, status, elapsed, duration: STRANDED_TRAVELLER.duration })

describe('real analysis report', () => {
  it('shows the ID, type, separate intent and voice results, quoted evidence and per-segment timestamps from the backend', () => {
    const entry = addEntry({ kind: 'analysis', source: 'upload', title: 'call.wav', report: englishReport() })
    const page = text(at(`/reports/${entry.id}`))
    expect(page).toContain(entry.id)
    expect(page).toContain('Assigned by your browser')
    expect(page).toContain('Real audio analysis of your file or recording')
    expect(page).toContain('Scam intent · from the transcript')
    expect(page).toContain('Voice authenticity · from the audio')
    expect(page).toContain('Model favors “real”')
    expect(page).toContain('“Read me the code we just sent you.”')
    expect(page).toContain('0:00–0:06')
    expect(page).toContain('not word-level timings')
    expect(page).not.toContain('Simulated')
  })

  it('shows a caution alert for an elevated result, and a red threat alert only for a high one', () => {
    const elevated = addEntry({ kind: 'analysis', source: 'upload', title: 'a.wav', report: englishReport() })
    expect(text(at(`/reports/${elevated.id}`))).toContain('Caution: notable scam-intent indicators')
    const base = englishReport()
    const high = addEntry({ kind: 'analysis', source: 'upload', title: 'b.wav', report: englishReport({ intent: { ...base.intent, risk: 'high' } }) })
    expect(text(at(`/reports/${high.id}`))).toContain('Threat alert: strong scam-intent indicators')
  })

  it('reports a partial analysis as partial, with the backend errors, and unavailable parts as unavailable', () => {
    const base = englishReport()
    const report = englishReport({
      status: 'partial',
      errors: [{ component: 'voice', code: 'model_unavailable', message: 'The voice model could not load.' }],
      voice: { ...base.voice, verdict: 'unavailable', fake_score_median: null, windows: [], windows_analyzed: 0, summary: 'Voice analysis did not run.' },
    })
    const entry = addEntry({ kind: 'analysis', source: 'upload', title: 'p.wav', report })
    const page = text(at(`/reports/${entry.id}`))
    expect(page).toContain('Partial: part of the analysis could not run')
    expect(page).toContain('The voice model could not load.')
    expect(page).toContain('Unavailable')
    expect(page).not.toContain('median fake-label score')
  })

  it('labels a Scenario Lab sample as a real analysis of synthetic speech', () => {
    const entry = addEntry({ kind: 'analysis', source: 'lab', title: 'Caller requesting a verification code', report: englishReport() })
    expect(text(at(`/reports/${entry.id}`))).toContain('Real analysis of a Scenario Lab sample (synthetic speech)')
  })
})

describe('simulation report', () => {
  it('is labelled as simulated throughout and reflects the finished run', () => {
    const entry = simulation(30, 'finished')
    const page = text(at(`/reports/${entry.id}`))
    expect(page).toContain('Simulated report')
    expect(page).toContain('Simulation: prewritten script with a fictional caller. Not a real analysis.')
    expect(page).toContain('Played to the end (0:30)')
    expect(page).toContain('Simulated alert')
    expect(page).toContain('No audio was sent to the VoxShield backend')
  })

  it('an early end shows only what was reached, and no alert before the configured point', () => {
    const entry = simulation(6, 'ended')
    const page = text(at(`/reports/${entry.id}`))
    expect(page).toContain('Ended by you at 0:06 of 0:30')
    expect(page).toContain('No simulated alert was shown')
    expect(page).not.toContain('Simulated alert:')
    expect(page).toContain('Not reached before the simulation was ended')
  })
})

describe('missing report', () => {
  it('says the report is unavailable instead of showing another one', () => {
    simulation(30, 'finished')
    const page = text(at('/reports/AN-GONE'))
    expect(page).toContain('This report is not available')
    expect(page).toContain('refreshing or closing the tab clears it')
  })
})

describe('history page', () => {
  it('lists real and simulated entries with their own labels, and keeps intent and voice separate', () => {
    const real = addEntry({ kind: 'analysis', source: 'upload', title: 'call.wav', report: englishReport() })
    const sim = simulation(12, 'ended')
    const html = at('/history')
    const page = text(html)
    expect(page).toContain('Real analysis')
    expect(page).toContain('Simulation')
    expect(page).toContain('Scam intent: Notable indicators')
    expect(page).toContain('Voice: Model favors “real”')
    expect(page).toContain('Ended at 0:12 of 0:30')
    expect(html).toContain(`href="/reports/${real.id}"`)
    expect(html).toContain(`href="/reports/${sim.id}"`)
    expect(page).toContain('Nothing is saved to the server or to browser storage')
  })
})

describe('results view', () => {
  it('links to its forensic report and shows the evidence-based alert', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultsView report={englishReport()} entryId="AN-TEST" onReset={() => {}} />
      </MemoryRouter>,
    )
    expect(html).toContain('href="/reports/AN-TEST"')
    expect(text(html)).toContain('Caution: notable scam-intent indicators')
  })

  it('keeps the results-view alert short: indicators and basis, without repeating the excerpt shown just below', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultsView report={englishReport()} onReset={() => {}} />
      </MemoryRouter>,
    )
    const alert = text(html.slice(html.indexOf('id="threat-heading"'), html.indexOf('</section>', html.indexOf('id="threat-heading"'))))
    expect(alert).toContain('Asks for a code or secret')
    expect(alert).toContain('The voice result did not raise this alert.')
    expect(alert).not.toContain('Read me the code we just sent you.')
    // The full alert, with the quoted excerpt and protective steps, stays in the forensic report.
    const entry = addEntry({ kind: 'analysis', source: 'upload', title: 'call.wav', report: englishReport() })
    const report = at(`/reports/${entry.id}`)
    const full = text(report.slice(report.indexOf('id="threat-heading"'), report.indexOf('</section>', report.indexOf('id="threat-heading"'))))
    expect(full).toContain('Read me the code we just sent you.')
    expect(full).toContain('Protective steps')
  })

  it('shows no alert when only the voice model leans "fake"', () => {
    const base = englishReport()
    const report = englishReport({
      voice: { ...base.voice, verdict: 'model_favors_fake', fake_score_median: 0.98 },
      intent: { ...base.intent, risk: 'none_detected', indicators: [], categories: [] },
      recommendations: { ...base.recommendations, state: 'none_detected', items: [] },
    })
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultsView report={report} onReset={() => {}} />
      </MemoryRouter>,
    )
    expect(html).not.toContain('threat-heading')
  })
})

describe('voice result from two detectors', () => {
  const base = englishReport()
  const model = (name: string) => ({ name, revision: null, method: 'm' })
  const report = englishReport({
    voice: {
      ...base.voice, verdict: 'model_favors_fake', fake_score_median: 0.88, windows_analyzed: 3, windows_favoring_fake: 3, fake_cutoff: 0.5, audio_band: 'full_band',
      windows: [{ start_seconds: 0, end_seconds: 6, fake_score: 0.88 }], model: model('Gustking/wav2vec2'),
      summary: "Flagged by the Gustking detector: the model's 'fake' label won in 3 of 3 windows. NII AntiDeepfake did not (leaned 'real').",
      detectors: [
        { model: model('nii-yamagishilab/mms-300m-anti-deepfake'), verdict: 'model_favors_real', fake_score_median: 0.0008, windows_analyzed: 3, windows_favoring_fake: 0, error: null },
        { model: model('Gustking/wav2vec2'), verdict: 'model_favors_fake', fake_score_median: 0.88, windows_analyzed: 3, windows_favoring_fake: 3, error: null },
      ],
    },
  })

  it('shows each detector’s own reading, so a disagreement is visible', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultsView report={report} onReset={() => {}} />
      </MemoryRouter>,
    )
    const list = text(html.slice(html.indexOf('data-testid="voice-detectors"'), html.indexOf('</ul>', html.indexOf('data-testid="voice-detectors"'))))
    expect(list).toContain('NII AntiDeepfake: Model favors “real”')
    expect(list).toContain('Gustking: Model favors “fake”')
    expect(text(html)).toContain('Flagged by the Gustking detector')
  })

  it('states the cut-off the backend used instead of assuming 50%', () => {
    const lowered = englishReport({ voice: { ...report.voice, fake_cutoff: 0.2, windows_favoring_fake: 2 } })
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultsView report={lowered} onReset={() => {}} />
      </MemoryRouter>,
    )
    expect(text(html)).toContain('3 windows analyzed · 2 at or above 20%')
    expect(text(html)).toContain('Audio quality: Full band.')
  })
})
