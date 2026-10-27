import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from '../App'
import { DEMO_CALL } from '../lib/demo'

const at = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

/** The href of the link whose visible text ends with `label` (icons come first inside the link). */
const hrefOf = (html: string, label: string) => {
  const match = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)].find(([, , inner]) => inner.replace(/<[^>]+>/g, '').trim() === label)
  if (!match) throw new Error(`No link labelled "${label}"`)
  return match[1]
}

/** Renders the app at `from`, follows the link labelled `label`, and returns the page it lands on. */
async function follow(from: string, label: string) {
  const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: [from] })
  const href = hrefOf(renderToStaticMarkup(<RouterProvider router={router} />), label)
  await router.navigate(href)
  return { href, html: renderToStaticMarkup(<RouterProvider router={router} />), pathname: router.state.location.pathname }
}

describe('HomePage', () => {
  const html = at('/home')

  it('shows the headline and both main calls to action', () => {
    expect(html).toContain('Hear the threat before it’s too late.')
    expect(hrefOf(html, 'Simulate an Incoming Call')).toBe('/demo/call')
    expect(hrefOf(html, 'Analyze Audio')).toBe('/')
  })

  it('says it analyzes provided audio and does not intercept calls', () => {
    expect(html).toContain('It does not listen to, intercept or block phone calls')
  })

  it('shows how it works as two independent paths into one report, keeping scam intent and voice apart', () => {
    const figure = html.slice(html.indexOf('<figure'), html.indexOf('</figure>'))
    for (const text of ['Audio recording', 'Speech analysis', 'Detects suspicious requests and scam indicators', 'Voice analysis', 'Assesses signs of synthetic speech', 'Evidence-based report'])
      expect(figure).toContain(text)
    expect(figure).toContain('What is said')
    expect(figure).toContain('How it sounds')
    expect(figure).toContain('Never merged into one score.')
    expect(html).toContain('never combined into one score')
  })

  it('the hero graphic shows no scores, percentages, callers or verdicts', () => {
    const figure = html.slice(html.indexOf('<figure'), html.indexOf('</figure>'))
    expect(figure.replace(/style="[^"]*"/g, '')).not.toMatch(/\d+\s?%|\/100|Critical|Inconclusive|favors/)
    expect(figure).not.toContain(DEMO_CALL.caller.name)
  })

  it('covers how it works and the limits, including language support, and links the limits page', () => {
    for (const text of ['Provide an audio sample', 'Analyze it', 'Review the evidence']) expect(html).toContain(text)
    expect(html).toContain('Hindi is checked through an English translation')
    expect(html).not.toContain('Punjabi')
    expect(html).toContain('has not been validated')
    expect(html).toContain('A genuine human voice can be used for a scam.')
    expect(html).toContain('Synthetic speech does not automatically mean a scam.')
    expect(hrefOf(html, 'Read the evaluation and limits')).toBe('/about')
  })

  it('does not promise perfect detection', () => {
    expect(html).not.toMatch(/guarantee|100%|always detects|never miss/i)
  })
})

describe('navigation', () => {
  it('Home → Analyze opens the existing upload and record workflow', async () => {
    const { pathname, html } = await follow('/home', 'Analyze Audio')
    expect(pathname).toBe('/')
    expect(html).toContain('Drop a call recording here')
  })

  it('Home → Simulate an Incoming Call opens the simulated call', async () => {
    const { pathname, html } = await follow('/home', 'Simulate an Incoming Call')
    expect(pathname).toBe('/demo/call')
    expect(html).toContain('Accept Call')
  })

  it('the header offers Home, Analyze Audio, Scenario Lab, History, Evaluation & Limits and Launch Simulation, and the logo goes Home', () => {
    const html = at('/lab')
    expect(hrefOf(html, 'Home')).toBe('/home')
    expect(hrefOf(html, 'Analyze Audio')).toBe('/')
    expect(hrefOf(html, 'Scenario Lab')).toBe('/lab')
    expect(hrefOf(html, 'History')).toBe('/history')
    expect(hrefOf(html, 'Evaluation &amp; Limits')).toBe('/about')
    expect(hrefOf(html, 'Launch Simulation')).toBe('/demo/call')
    expect(html).toMatch(/<a [^>]*aria-label="VoxShield home"[^>]*href="\/home"|<a [^>]*href="\/home"[^>]*aria-label="VoxShield home"/)
  })

  it('keeps the header Launch Simulation label for screen readers but hides it visually on phones, so the menu button fits', () => {
    const link = at('/home').match(/<a [^>]*href="\/demo\/call"[^>]*>.*?<\/a>/)![0]
    expect(link).toContain('<span class="max-sm:sr-only">Launch Simulation</span>')
    expect(link).toContain('max-sm:w-11')
  })

  it('has a collapsed mobile menu button', () => {
    expect(at('/home')).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-label="Open menu"/)
  })

  it('Launch Simulation in the header opens the simulated call', async () => {
    const { pathname } = await follow('/about', 'Launch Simulation')
    expect(pathname).toBe('/demo/call')
  })
})

describe('existing routes stay available', () => {
  it.each([
    ['/', 'Drop a call recording here'],
    ['/lab', 'Scam Scenario Lab'],
    ['/about', 'Evaluation'],
    ['/demo/analysis', 'Simulated Live Analysis'],
    ['/demo/report', 'No simulated report yet'],
    ['/history', 'No completed analyses yet'],
    ['/reports/AN-UNKNOWN', 'This report is not available'],
    ['/no-such-page', 'That page isn&#x27;t here.'],
  ])('%s renders', (path, text) => {
    expect(at(path)).toContain(text)
  })
})
