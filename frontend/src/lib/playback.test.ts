import { describe, expect, it } from 'vitest'

import { activeSegmentIndex, findingSeekTime, groupFindings, summaryLine } from './playback'
import type { AnalysisReport, IntentIndicator, TranscriptSegment } from './types'

const segment = (index: number, start: number, end: number): TranscriptSegment => ({
  index, start_seconds: start, end_seconds: end, text: `s${index}`, char_start: index * 10, char_end: index * 10 + 5,
})

const indicator = (over: Partial<IntentIndicator>): IntentIndicator => ({
  id: 'r-0', rule_id: 'r', category: 'urgency', severity: 'low', segment_index: 0, char_start: 0, char_end: 5,
  start_seconds: 1, end_seconds: 2, excerpt: 'abc', sentence: 'abc', context: 'direct', detector: 'rules', score: null,
  trigger: '', explanation: '', suggested_action: '', ...over,
})

describe('activeSegmentIndex', () => {
  const segments = [segment(0, 0, 2), segment(1, 2.5, 5), segment(2, 6, 8)]
  it('finds the segment being spoken, including its start and excluding its end', () => {
    expect(activeSegmentIndex(segments, 0)).toBe(0)
    expect(activeSegmentIndex(segments, 1.99)).toBe(0)
    expect(activeSegmentIndex(segments, 2.5)).toBe(1)
    expect(activeSegmentIndex(segments, 7)).toBe(2)
  })
  it('highlights nothing in a silent gap, after the end, or when there are no segments', () => {
    expect(activeSegmentIndex(segments, 2.2)).toBeNull()
    expect(activeSegmentIndex(segments, 5.5)).toBeNull()
    expect(activeSegmentIndex(segments, 9)).toBeNull()
    expect(activeSegmentIndex([], 1)).toBeNull()
  })
})

describe('findingSeekTime', () => {
  it('uses the real timestamp only', () => {
    expect(findingSeekTime({ start_seconds: 3.2 })).toBe(3.2)
    expect(findingSeekTime({ start_seconds: 0 })).toBe(0)
  })
  it('has no position for a finding without a reliable timestamp, instead of guessing one', () => {
    expect(findingSeekTime({ start_seconds: null })).toBeNull()
    expect(findingSeekTime({ start_seconds: NaN })).toBeNull()
    expect(findingSeekTime({ start_seconds: -1 })).toBeNull()
  })
})

describe('groupFindings', () => {
  it('shows a passage once, with every reason, and keeps all ids so any of them selects the group', () => {
    const groups = groupFindings([
      indicator({ id: 'a-0', rule_id: 'a', category: 'payment_pressure', severity: 'medium' }),
      indicator({ id: 'b-0', rule_id: 'b', category: 'urgency', severity: 'low' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].ids).toEqual(['a-0', 'b-0'])
    expect(groups[0].items.map((i) => i.category)).toEqual(['payment_pressure', 'urgency'])
    expect(groups[0].severity).toBe('medium')
  })

  it('orders groups strongest first, direct before reported, then by position, dropping nothing', () => {
    const groups = groupFindings([
      indicator({ id: 'low-0', char_start: 0, char_end: 4, severity: 'low' }),
      indicator({ id: 'rep-20', char_start: 20, char_end: 24, severity: 'high', context: 'reported' }),
      indicator({ id: 'high-40', char_start: 40, char_end: 44, severity: 'high' }),
      indicator({ id: 'med-10', char_start: 10, char_end: 14, severity: 'medium' }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['high-40', 'med-10', 'low-0', 'rep-20'])
  })

  it('keeps a missing timestamp missing', () => {
    const [group] = groupFindings([indicator({ start_seconds: null, end_seconds: null })])
    expect(group.start_seconds).toBeNull()
  })

  it('handles no findings', () => {
    expect(groupFindings([])).toEqual([])
  })
})

describe('summaryLine', () => {
  const report = (risk: string, verdict: string) => ({ intent: { risk }, voice: { verdict } }) as unknown as AnalysisReport
  it('reports the two assessments separately and never as one score or a verdict of fraud', () => {
    const line = summaryLine(report('high', 'model_favors_real'))
    expect(line).toBe('Strong scam indicators were found in the conversation, and the voice model favors “real”. These are two separate assessments.')
    expect(line).not.toMatch(/\d|fraud|scammer|proven|%/i)
  })
  it.each([
    ['none_detected', 'inconclusive', 'No scam indicators were found in the transcript, and the voice check was inconclusive.'],
    ['unavailable', 'unavailable', 'The conversation check is unavailable, and the voice check is unavailable.'],
    ['weak_signals', 'model_favors_fake', 'Only weak signals were found in the conversation, and the voice model favors “fake”.'],
  ])('covers %s / %s', (risk, verdict, expected) => {
    expect(summaryLine(report(risk, verdict))).toContain(expected)
  })
})
