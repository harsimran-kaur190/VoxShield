import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import App from '../App'
import { CallScreen } from '../components/demo/CallScreen'
import { CALL_DISCLAIMER, callReducer, INITIAL_CALL_PHASE, type CallPhase } from '../lib/callSimulation'

const screen = (phase: CallPhase) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <CallScreen phase={phase} onAccept={vi.fn()} onDecline={vi.fn()} onRestart={vi.fn()} />
    </MemoryRouter>,
  )

const linkTo = (html: string, label: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)].find(([, , inner]) => inner.replace(/<[^>]+>/g, '').trim() === label)?.[1]

describe('call simulation state', () => {
  it('starts ringing', () => {
    expect(INITIAL_CALL_PHASE).toBe('ringing')
  })

  it('accepting a ringing call moves to accepted', () => {
    expect(callReducer('ringing', 'accept')).toBe('accepted')
  })

  it('declining a ringing call moves to declined', () => {
    expect(callReducer('ringing', 'decline')).toBe('declined')
  })

  it('ignores a second answer once the call is accepted or declined', () => {
    expect(callReducer('accepted', 'decline')).toBe('accepted')
    expect(callReducer('declined', 'accept')).toBe('declined')
  })

  it('restarts to ringing from any state', () => {
    for (const phase of ['ringing', 'accepted', 'declined'] as const) expect(callReducer(phase, 'restart')).toBe('ringing')
  })
})

describe('CallScreen', () => {
  it('ringing: shows the simulated caller, the badge, the disclaimer and both buttons', () => {
    const html = screen('ringing')
    expect(html).toContain('Unknown Caller')
    expect(html).toContain('Simulated call')
    expect(html).toContain('Incoming call')
    expect(html).toContain(CALL_DISCLAIMER)
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>(?:<svg.*?<\/svg>)?Accept Call<\/button>/)
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>(?:<svg.*?<\/svg>)?Decline<\/button>/)
  })

  it('never plays audio or asks for the microphone', () => {
    for (const phase of ['ringing', 'accepted', 'declined'] as const) {
      const html = screen(phase)
      expect(html).not.toContain('<audio')
      expect(html).not.toContain('autoplay')
      expect(html).not.toMatch(/microphone access/i)
    }
  })

  it('accepted: prepares the simulated analysis and hands off to it', () => {
    const html = screen('accepted')
    expect(html).toContain('Simulated call accepted')
    expect(html).toContain('Preparing simulated analysis')
    expect(linkTo(html, 'Continue to Analysis Demo')).toBe('/demo/analysis')
    expect(html).not.toContain('Accept Call')
    expect(html).toContain(CALL_DISCLAIMER)
  })

  it('declined: confirms, says no real call was affected, and offers Home and Analyze', () => {
    const html = screen('declined')
    expect(html).toContain('Simulation declined')
    expect(html).toContain('no real call was declined or affected')
    expect(linkTo(html, 'Return Home')).toBe('/')
    expect(linkTo(html, 'Open Analyze')).toBe('/analyze')
    expect(html).not.toContain('Accept Call')
  })

  it('is served at /demo/call, ringing, inside the normal layout', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/demo/call']}>
        <App />
      </MemoryRouter>,
    )
    expect(html).toContain('aria-label="Simulated incoming call"')
    expect(html).toContain('Accept Call')
    expect(html).toContain('aria-label="Main"')
  })
})
