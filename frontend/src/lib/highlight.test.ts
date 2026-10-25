import { describe, expect, it } from 'vitest'

import { buildPieces, indicatorKey } from './highlight'
import type { IntentIndicator, TranscriptSegment } from './types'

const segment = (text: string, char_start: number): TranscriptSegment => ({
  index: 0,
  start_seconds: 0,
  end_seconds: 1,
  text,
  char_start,
  char_end: char_start + text.length,
})

const indicator = (char_start: number, char_end: number, rule_id = 'r'): IntentIndicator => ({
  id: `${rule_id}-${char_start}`,
  rule_id,
  category: 'credential_request',
  severity: 'high',
  segment_index: 0,
  char_start,
  char_end,
  start_seconds: null,
  end_seconds: null,
  excerpt: '',
  sentence: '',
  context: 'direct',
  detector: 'rules',
  score: null,
  trigger: '',
  explanation: '',
  suggested_action: '',
})

const marked = (pieces: ReturnType<typeof buildPieces>) => pieces.filter((p) => p.keys.length > 0)

describe('buildPieces', () => {
  it('returns the whole text unmarked when nothing is flagged', () => {
    expect(buildPieces(segment('Hello there', 0), [])).toEqual([{ text: 'Hello there', keys: [] }])
  })

  it('marks exactly the matched span and keeps the text around it', () => {
    const pieces = buildPieces(segment('Please read me the code now', 0), [indicator(7, 23)])
    expect(pieces.map((p) => p.text).join('')).toBe('Please read me the code now')
    expect(marked(pieces).map((p) => p.text)).toEqual(['read me the code'])
  })

  it('converts global offsets into segment offsets', () => {
    const pieces = buildPieces(segment('send the money', 100), [indicator(105, 114)])
    expect(marked(pieces).map((p) => p.text)).toEqual(['the money'])
  })

  it('clips an indicator that runs past the segment', () => {
    expect(marked(buildPieces(segment('read me the', 0), [indicator(5, 30)])).map((p) => p.text)).toEqual(['me the'])
  })

  it('ignores indicators that do not touch the segment', () => {
    expect(marked(buildPieces(segment('hello', 0), [indicator(50, 60)]))).toEqual([])
  })

  it('keeps overlapping matches: the shared text lists both, nothing is duplicated or lost', () => {
    const a = indicator(0, 10, 'a')
    const b = indicator(5, 15, 'b')
    const pieces = buildPieces(segment('0123456789abcdefgh', 0), [a, b])
    expect(pieces.map((p) => p.text).join('')).toBe('0123456789abcdefgh')
    const shared = pieces.find((p) => p.text === '56789')
    expect(shared?.keys).toEqual([indicatorKey(a), indicatorKey(b)])
  })
})
