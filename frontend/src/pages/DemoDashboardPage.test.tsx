import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import App from '../App'
import { LiveTranscript } from '../components/demo/dashboard/LiveTranscript'
import { VoiceAuthenticityCard } from '../components/demo/dashboard/Panels'
import { alertReached, demoScore, indicatorsFound, segmentsReached, splitByEvidence, STRANDED_TRAVELLER, type DemoScenario } from '../lib/demoScenario'
import { simulationReducer, startSimulation, type SimulationState } from '../lib/liveSimulation'
import { scamIntentBand } from '../lib/scamIntentScore'
import { LiveDashboard } from './DemoDashboardPage'

const S = STRANDED_TRAVELLER
const at = (elapsed: number, status: SimulationState['status'] = 'running'): SimulationState => ({ status, elapsed, duration: S.duration })

const dashboard = (props: Partial<Parameters<typeof LiveDashboard>[0]> = {}) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <LiveDashboard scenario={S} {...props} />
    </MemoryRouter>,
  )

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const hrefOf = (html: string, label: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)].find(([, , inner]) => inner.replace(/<[^>]+>/g, '').trim() === label)?.[1]
const section = (html: string, headingId: string) => {
  const start = html.indexOf(`aria-labelledby="${headingId}"`)
  return html.slice(start, html.indexOf('</section>', start))
}

describe('scam-intent bands', () => {
  it('uses one set of thresholds: Low, Moderate, High, Critical', () => {
    expect(scamIntentBand(0, 0).label).toBe('Low')
    expect(scamIntentBand(24, 1).label).toBe('Low')
    expect(scamIntentBand(25, 1).label).toBe('Moderate')
    expect(scamIntentBand(50, 1).label).toBe('High')
    expect(scamIntentBand(75, 1).label).toBe('Critical')
    expect(scamIntentBand(100, 3).label).toBe('Critical')
  })

  it('never reaches the red Critical band without quoted evidence', () => {
    expect(scamIntentBand(95, 0).label).toBe('High')
    expect(scamIntentBand(95, 0).tone).not.toBe('critical')
  })

  it('clamps and tolerates bad input', () => {
    expect(scamIntentBand(-10, 0).label).toBe('Low')
    expect(scamIntentBand(Number.NaN, 0).label).toBe('Low')
    expect(scamIntentBand(250, 1).label).toBe('Critical')
  })
})

describe('demo scenario', () => {
  it('does not flag every sentence', () => {
    const flagged = S.segments.filter((segment) => segment.evidence.length > 0)
    expect(flagged.length).toBeGreaterThan(0)
    expect(flagged.length).toBeLessThan(S.segments.length)
  })

  it('every highlighted phrase occurs in its sentence and explains why it matters', () => {
    for (const segment of S.segments)
      for (const evidence of segment.evidence) {
        expect(segment.text).toContain(evidence.phrase)
        expect(evidence.why.length).toBeGreaterThan(10)
        expect(S.indicators.some((indicator) => indicator.id === evidence.indicatorId)).toBe(true)
      }
  })

  it('splits a sentence into plain text and evidence, losing nothing', () => {
    const s3 = S.segments.find((segment) => segment.id === 's3')!
    const parts = splitByEvidence(s3)
    expect(parts.map((part) => part.text).join('')).toBe(s3.text)
    expect(parts.filter((part) => part.evidence).map((part) => part.text)).toEqual(['send me money', 'immediately'])
  })

  it('the score grows only as evidence is reached, and the alert waits for its trigger', () => {
    expect(demoScore(indicatorsFound(S, segmentsReached(S, 0)))).toBe(0)
    expect(alertReached(S, 9)).toBe(false)
    expect(alertReached(S, 10)).toBe(true)
    const final = demoScore(indicatorsFound(S, S.segments))
    expect(final).toBeGreaterThan(demoScore(indicatorsFound(S, segmentsReached(S, 10))) - 1)
    expect(final).toBeLessThanOrEqual(100)
  })
})

describe('simulation clock', () => {
  it('advances only while running and finishes at the end of the script', () => {
    let state = startSimulation(30)
    state = simulationReducer(state, { type: 'tick', seconds: 10 })
    expect(state).toMatchObject({ status: 'running', elapsed: 10 })
    state = simulationReducer(state, { type: 'tick', seconds: 50 })
    expect(state).toMatchObject({ status: 'finished', elapsed: 30 })
  })

  it('pauses and resumes; a paused clock does not move', () => {
    const paused = simulationReducer(at(8), { type: 'pause' })
    expect(paused.status).toBe('paused')
    expect(simulationReducer(paused, { type: 'tick', seconds: 5 }).elapsed).toBe(8)
    expect(simulationReducer(paused, { type: 'resume' })).toMatchObject({ status: 'running', elapsed: 8 })
  })

  it('End Simulation stops the clock for good, from running or paused', () => {
    for (const status of ['running', 'paused'] as const) {
      const ended = simulationReducer(at(12, status), { type: 'end' })
      expect(ended).toMatchObject({ status: 'ended', elapsed: 12 })
      expect(simulationReducer(ended, { type: 'tick', seconds: 5 }).elapsed).toBe(12)
      expect(simulationReducer(ended, { type: 'resume' }).status).toBe('ended')
    }
  })

  it('restart begins again from zero', () => {
    expect(simulationReducer(at(30, 'finished'), { type: 'restart' })).toMatchObject({ status: 'running', elapsed: 0 })
  })
})

describe('LiveDashboard', () => {
  it('renders the header with the SIMULATED badge, duration, controls and notice', () => {
    const html = dashboard({ initialState: at(12) })
    expect(html).toContain('Simulated Live Analysis')
    expect(html).toMatch(/>Simulated<\/span>/)
    expect(html).toContain('uppercase')
    expect(html).toContain('0:12 / 0:30')
    expect(html).toContain('Pause Analysis')
    expect(html).toContain('End Simulation')
    expect(html).toContain('No real call or real person is involved, and the transcript is the script, not speech recognition.')
    expect(hrefOf(html, 'Analyze a real recording')).toBe('/')
  })

  it('keeps scam intent and voice authenticity in separate cards', () => {
    const html = dashboard({ initialState: at(30, 'finished') })
    const intent = section(html, 'intent-score-heading')
    const voice = section(html, 'voice-heading')
    expect(intent).toContain('Scam-intent score')
    expect(intent).toContain('not a calibrated probability')
    expect(intent).toContain('Voice analysis is reported separately and is not part of this score')
    expect(intent).not.toContain('Inconclusive')
    expect(voice).toContain('Inconclusive')
    expect(voice).toContain('not a liveness detector')
    expect(voice).not.toContain('Scam-intent score')
  })

  it('labels the score as simulated and writes it out, not only as colour', () => {
    const html = dashboard({ initialState: at(30, 'finished') })
    const score = demoScore(indicatorsFound(S, S.segments))
    expect(html).toContain(`aria-label="Scam-intent score ${score} out of 100, Critical, simulated"`)
    expect(html).toContain('Simulated demo data.')
    expect(html).toContain('Critical')
  })

  it('shows only the part of the script that has played', () => {
    const html = dashboard({ initialState: at(6, 'paused') })
    expect(html).toContain('my payment is not going through')
    expect(html).not.toContain('send me money')
    expect(html).toContain('Resume Analysis')
    expect(html).not.toContain('Pause Analysis')
  })

  it('shows no alert before the trigger point, and a simulated alert after it', () => {
    expect(dashboard({ initialState: at(9) })).not.toContain('role="alert"')
    const html = dashboard({ initialState: at(11) })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Simulated alert')
  })

  it('end state: stops, says so, and offers the report, full transcript, real analysis and restart', () => {
    const html = dashboard({ initialState: at(12, 'ended') })
    expect(html).toContain('Simulation ended')
    expect(html).toContain('Stopped at 0:12 of 0:30')
    expect(html).toContain('The timers have stopped')
    expect(html).not.toContain('Pause Analysis')
    expect(html).not.toContain('End Simulation')
    expect(hrefOf(html, 'View Forensic Report')).toBe('/demo/report')
    expect(text(html)).toContain('View Full Transcript')
    expect(hrefOf(html, 'Analyze Real Audio')).toBe('/')
    expect(text(html)).toContain('Restart Simulation')
  })

  it('full transcript shows the whole script after an early end, including parts not yet played', () => {
    const html = dashboard({ initialState: at(12, 'ended'), initialFull: true })
    expect(html).toContain('Full transcript')
    expect(html).toContain('I’ll message you the details.')
  })

  it('full transcript is not offered while the simulation is still running', () => {
    const html = dashboard({ initialState: at(12), initialFull: true })
    expect(html).toContain('Live transcript')
    expect(html).not.toContain('I’ll message you the details.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:<svg.*?<\/svg>)?View Full Transcript/)
  })

  it('evidence chips in the intent card point at transcript segments', () => {
    const html = dashboard({ initialState: at(30, 'finished') })
    const intent = section(html, 'intent-analysis-heading')
    for (const label of ['Unexpected request for money', 'Urgency and pressure', 'Promise of repayment', 'Claimed account or payment problem']) expect(intent).toContain(label)
    expect(intent).toContain('“send me money”')
    expect(intent).toContain('show in transcript')
  })

  it('lists the four recommendations without promising protection', () => {
    const html = dashboard({ initialState: at(0) })
    expect(html).toContain('Do not transfer money based solely on an urgent voice request.')
    expect(html).toContain('Verify the caller through a known, independent contact method')
    expect(html).toContain('Do not share passwords, OTPs or verification codes.')
    expect(html).toContain('End the interaction if you feel pressured.')
    expect(html).toContain('VoxShield does not block calls or payments.')
  })
})

describe('LiveTranscript evidence', () => {
  const transcript = (selected: string | null) =>
    renderToStaticMarkup(
      <LiveTranscript segments={S.segments} indicators={S.indicators} selectedEvidence={selected} onToggleEvidence={vi.fn()} full={false} canViewFull={false} onToggleFull={vi.fn()} />,
    )

  it('highlights flagged phrases as keyboard-reachable buttons, collapsed by default', () => {
    const html = transcript(null)
    expect(html).toMatch(/<span role="button" tabindex="0" aria-expanded="false" aria-controls="why-e2"[^>]*>send me money/)
    expect(html).not.toContain('id="why-e2"')
    expect(html).toContain('Hello? Hi, it’s me.') // unflagged sentences are plain text
  })

  it('opening a phrase explains why it matters, as a simulated, illustrative indicator', () => {
    const html = transcript('e2')
    expect(html).toMatch(/aria-expanded="true"[^>]*aria-controls="why-e2"/)
    expect(html).toContain('id="why-e2"')
    expect(html).toContain('A direct request for a transfer, made on an unexpected call.')
    expect(html).toContain('Unexpected request for money')
    expect(html).toContain('not a finding about a real person')
  })

  it('puts a small evidence indicator beside flagged segments only', () => {
    const html = transcript(null)
    expect((html.match(/flagged phrases? at /g) ?? []).length).toBe(S.segments.filter((segment) => segment.evidence.length > 0).length)
  })
})

describe('VoiceAuthenticityCard', () => {
  it('shows a neutral unavailable state when there is no voice result', () => {
    const html = renderToStaticMarkup(<VoiceAuthenticityCard voice={null} simulated={false} />)
    expect(html).toContain('Unavailable')
    expect(html).toContain('The voice check could not run')
    expect(html).not.toMatch(/critical|amber/)
    expect(html).not.toContain('Simulated')
  })

  it('a dashboard whose scenario has no voice result still renders, with voice unavailable', () => {
    const noVoice: DemoScenario = { ...S, voice: null }
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LiveDashboard scenario={noVoice} initialState={at(30, 'finished')} />
      </MemoryRouter>,
    )
    expect(section(html, 'voice-heading')).toContain('Unavailable')
  })

  it('never says a fake lean proves a deepfake', () => {
    const html = renderToStaticMarkup(<VoiceAuthenticityCard voice={{ ...S.voice!, verdict: 'model_favors_fake' }} simulated />)
    expect(html).toContain('does not show the recording was generated')
    expect(html).not.toMatch(/confirmed deepfake|is a deepfake|liveness detected/i)
  })
})

describe('demo navigation', () => {
  it('before the run is recorded, View Forensic Report falls back to /demo/report, which says no report exists yet', async () => {
    const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: ['/demo/analysis'] })
    renderToStaticMarkup(<RouterProvider router={router} />)
    const html = dashboard({ initialState: at(30, 'finished') })
    await router.navigate(hrefOf(html, 'View Forensic Report')!)
    expect(router.state.location.pathname).toBe('/demo/report')
    expect(renderToStaticMarkup(<RouterProvider router={router} />)).toContain('No simulated report yet')
  })

  it('the accepted call hands off to the dashboard', async () => {
    const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: ['/demo/analysis'] })
    expect(renderToStaticMarkup(<RouterProvider router={router} />)).toContain('Simulated Live Analysis')
  })

  it('the existing Analyze workflow at / is unchanged and free of demo data', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(html).toContain('Drop a call recording here')
    expect(html).not.toContain('Simulated')
    expect(html).not.toContain(S.segments[2].text)
  })
})
