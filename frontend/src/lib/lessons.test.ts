import { describe, expect, it } from 'vitest'

import { lessonFor } from './lessons'
import type { AnalysisReport, IntentIndicator } from './types'

const indicator = (context: 'direct' | 'reported' = 'direct'): IntentIndicator => ({
  id: 'x', rule_id: 'x', category: 'credential_request', severity: 'high', segment_index: 0, char_start: 0, char_end: 3, start_seconds: 0, end_seconds: 1,
  excerpt: 'abc', sentence: 'abc', context, detector: 'nli', score: 0.9, trigger: '', explanation: '', suggested_action: '',
})
const report = (risk: string, verdict: string, indicators: IntentIndicator[] = [], suppressed = 0) =>
  ({ intent: { risk, indicators, suppressed_mentions: suppressed }, voice: { verdict } }) as unknown as AnalysisReport
const all = (l: { can: string[]; cannot: string[] }) => [...l.can, ...l.cannot].join(' ')

describe('lessonFor', () => {
  it('always says the two checks are separate and that neither proves identity or intent', () => {
    for (const r of [report('high', 'model_favors_fake', [indicator()]), report('none_detected', 'model_favors_real'), report('unavailable', 'unavailable')]) {
      const text = lessonFor(r, true).cannot.join(' ')
      expect(text).toMatch(/cannot say who the speaker is/)
      expect(text).toMatch(/synthetic voice does not make it a scam/)
      expect(text).toMatch(/natural-sounding voice does not make a call legitimate/)
    }
  })

  it('describes findings only when the report has direct findings, and calls them clues, not proof', () => {
    const found = lessonFor(report('high', 'model_favors_fake', [indicator(), indicator()]), true)
    expect(found.can.join(' ')).toContain('2 passages')
    expect(found.cannot.join(' ')).toMatch(/clue, not proof/)
    const none = lessonFor(report('none_detected', 'model_favors_fake'), true)
    expect(none.can.join(' ')).toContain('found no suspicious request')
    expect(none.cannot.join(' ')).toMatch(/not a clearance/)
    expect(all(none)).not.toMatch(/passages? from the transcript that read like/)
  })

  it('reports an inconclusive or unavailable scam check as no answer, never as reassurance', () => {
    for (const risk of ['inconclusive', 'unavailable']) {
      const l = lessonFor(report(risk, 'inconclusive'), true)
      expect(l.can.join(' ')).toContain('could not reach an answer')
      expect(all(l)).not.toMatch(/found no suspicious/)
    }
  })

  it('mentions held-back protective wording only when the report counted some', () => {
    expect(lessonFor(report('none_detected', 'model_favors_real', [], 2), true).can.join(' ')).toMatch(/held back/)
    expect(lessonFor(report('none_detected', 'model_favors_real', [], 0), true).can.join(' ')).not.toMatch(/held back/)
  })

  it('ties the voice lines to the actual verdict and to the sample being synthetic', () => {
    const fake = lessonFor(report('none_detected', 'model_favors_fake'), true)
    expect(fake.can.join(' ')).toMatch(/matches how it was made/)
    expect(fake.cannot.join(' ')).toMatch(/nothing about whether the words are a scam/)
    const real = lessonFor(report('none_detected', 'model_favors_real'), true)
    expect(real.can.join(' ')).toMatch(/even though this sample is computer-generated/)
    expect(real.cannot.join(' ')).toMatch(/cannot confirm a voice is genuine/)
    // for audio that is not a known synthetic sample the page does not claim how it was made
    expect(all(lessonFor(report('none_detected', 'model_favors_fake'), false))).not.toMatch(/computer-generated|how it was made/)
  })
})
