import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from '../App'
import { LabBanner, LessonPanel } from '../components/lab/LabContext'
import { ScenarioPicker } from '../components/lab/ScenarioPicker'
import { SCENARIOS } from '../lib/scenarios'
import type { AnalysisReport } from '../lib/types'

const noop = () => {}
const picker = (selectedId: string, extra: Partial<Parameters<typeof ScenarioPicker>[0]> = {}) =>
  renderToStaticMarkup(<ScenarioPicker selectedId={selectedId} onSelect={noop} onAnalyze={noop} busy={false} blockedReason={null} {...extra} />)

describe('ScenarioPicker', () => {
  it('lists all six scenarios as one radio group and marks only the selected one', () => {
    const html = picker('payment')
    expect((html.match(/type="radio"/g) ?? []).length).toBe(6)
    expect((html.match(/checked=""/g) ?? []).length).toBe(1)
    for (const s of SCENARIOS) expect(html).toContain(s.title)
  })

  it('shows what the chosen scenario tests, what to look at, its labelled script, and labelled sample audio', () => {
    for (const s of SCENARIOS) {
      const html = picker(s.id)
      expect(html).toContain(s.testing)
      expect(html).toContain(s.lookFor)
      expect(html).toContain(s.script.replace(/'/g, '&#x27;'))
      expect(html).toContain(`src="${s.audioUrl}"`)
    }
    const html = picker('otp')
    expect(html).toContain('Script spoken in the sample. Not a recording of a real person and not a detection result.')
    expect(html).toContain('computer-generated speech')
    expect(html).not.toContain('Strong indicators') // no outcome is shown before anything has run
  })

  it('only shows the details of the selected scenario', () => {
    const html = picker('otp')
    expect(html).toContain(SCENARIOS[1].testing)
    expect(html).not.toContain(SCENARIOS[2].testing)
  })

  it('disables analysis, and says why, when the backend is unreachable or a sample is loading', () => {
    expect(picker('otp', { blockedReason: 'The backend is not reachable.' })).toMatch(/disabled=""[^>]*>[\s\S]*The backend is not reachable\./)
    const loading = picker('otp', { busy: true })
    expect(loading).toContain('Loading sample')
    expect(loading).toContain('disabled=""')
    expect(picker('otp')).not.toContain('disabled=""')
  })
})

describe('results context', () => {
  const report = { intent: { risk: 'none_detected', indicators: [], suppressed_mentions: 0 }, voice: { verdict: 'model_favors_fake' } } as unknown as AnalysisReport

  it('labels the input as synthetic, says the analysis was real, and offers both ways back', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LabBanner scenario={SCENARIOS[4]} onBack={noop} />
      </MemoryRouter>,
    )
    expect(html).toContain('Harmless message, synthetic voice')
    expect(html).toContain('computer-generated speech')
    expect(html).toContain('analyzed just now by the VoxShield backend')
    expect(html).toContain('Try another scenario')
    expect(html).toContain('href="/"')
    expect(html).toContain('Script spoken in this sample')
  })

  it('explains what the actual report can and cannot show, without calling a synthetic voice a scam', () => {
    const html = renderToStaticMarkup(<LessonPanel report={report} />)
    expect(html).toContain('What this result can and cannot show')
    expect(html).toContain('matches how it was made')
    expect(html).toMatch(/nothing about whether the words are a scam/)
    expect(html).not.toMatch(/proves?\b[^.]*\bscam\b(?!\.)/)
  })
})

describe('routing', () => {
  const at = (path: string) =>
    renderToStaticMarkup(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )

  it('serves the lab at /lab and links to it from the main navigation', () => {
    const html = at('/lab')
    expect(html).toContain('Scam Scenario Lab')
    expect(html).toContain('href="/lab"')
    expect(html).toContain('Choose a scenario')
  })

  it('keeps the normal upload workflow at the home page', () => {
    const html = at('/')
    expect(html).toContain('Beyond the Voice.')
    expect(html).not.toContain('Choose a scenario')
  })
})
