import { describe, expect, it } from 'vitest'

import { englishReport } from '../test-utils/reports'
import { threatAlert } from './threat'

const base = englishReport()

describe('threatAlert', () => {
  it('is a caution (amber) for an "elevated" result with a direct quoted request', () => {
    const alert = threatAlert(base)!
    expect(alert.level).toBe('caution')
    expect(alert.categories).toEqual(['Asks for a code or secret'])
    expect(alert.excerpts).toEqual([{ key: 'a', text: 'Read me the code we just sent you.', start_seconds: 0, translated: false }])
    expect(alert.reason).toBe(base.intent.summary)
    expect(alert.actions).toEqual(["Don't share codes, PINs or passwords"])
  })

  it('is critical (red) only for a "high" result with a direct quoted request', () => {
    expect(threatAlert(englishReport({ intent: { ...base.intent, risk: 'high' } }))!.level).toBe('critical')
  })

  it('never fires from the voice result: a "fake" lean with no scam indicators gives no alert', () => {
    const report = englishReport({
      voice: { ...base.voice, verdict: 'model_favors_fake', fake_score_median: 0.99 },
      intent: { ...base.intent, risk: 'none_detected', indicators: [], categories: [] },
    })
    expect(threatAlert(report)).toBeNull()
  })

  it('gives no alert when the only passages are quoted or recounted speech', () => {
    const reported = base.intent.indicators.map((item) => ({ ...item, context: 'reported' as const }))
    expect(threatAlert(englishReport({ intent: { ...base.intent, risk: 'high', indicators: reported } }))).toBeNull()
  })

  it('gives no alert for inconclusive, unavailable or failed results', () => {
    expect(threatAlert(englishReport({ intent: { ...base.intent, risk: 'inconclusive' } }))).toBeNull()
    expect(threatAlert(englishReport({ intent: { ...base.intent, risk: 'unavailable' } }))).toBeNull()
    expect(threatAlert(englishReport({ status: 'failed', intent: { ...base.intent, risk: 'high' } }))).toBeNull()
  })

  it('does not invent a timestamp the backend did not send', () => {
    const untimed = base.intent.indicators.map((item) => ({ ...item, start_seconds: null, end_seconds: null }))
    expect(threatAlert(englishReport({ intent: { ...base.intent, indicators: untimed } }))!.excerpts[0].start_seconds).toBeNull()
  })

  it('says a rules match came from rules, not a model', () => {
    expect(threatAlert(englishReport({ intent: { ...base.intent, detector: 'rules' } }))!.source).toContain('fixed text rules')
  })
})
