import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DeepTruthReport } from './deeptruth'
import { handleMessage, receiveResults, RESULTS_MESSAGE } from './extensionBridge'
import { clearHistory, getEntries, getEntry } from './history'

afterEach(clearHistory)
// The tests run without a DOM; handleMessage only compares against `window`, so a stand-in object is enough.
const fakeWindow = {}
vi.stubGlobal('window', fakeWindow)

const report: DeepTruthReport = {
  verdict: 'Inconclusive',
  verdict_reason: '',
  disagreement: null,
  manipulation_likelihood: 0.5,
  confidence: 0.3,
  modules: [],
  limitations: ['Small image.'],
  media: { filename: 'a.jpg', kind: 'image', format: 'jpeg', size_bytes: 1, duration_seconds: null, width: 1, height: 1, has_audio: null, has_video: null },
  status: 'complete',
  timings_seconds: {},
  notice: '',
}
const result = { externalId: 'EXT-1', title: 'a.jpg', pageUrl: 'https://news.example/x', report }

describe('extension bridge', () => {
  it('adds well-formed results once, as extension-sourced DeepTruth entries, findable by the extension ID', () => {
    expect(receiveResults([result, { ...result, externalId: 'EXT-2' }])).toBe(2)
    expect(receiveResults([result])).toBe(0)
    // The extension sends newest first, and the newest ends up at the top of History.
    expect(getEntries().map((e) => e.kind === 'deeptruth' && e.externalId)).toEqual(['EXT-1', 'EXT-2'])
    expect(getEntry('EXT-1')).toMatchObject({ source: 'extension', pageUrl: 'https://news.example/x' })
  })

  it('ignores malformed results and messages from other windows', () => {
    expect(receiveResults([{ externalId: 'EXT-3', title: 'x' }, 'junk', null])).toBe(0)
    handleMessage({ source: null, data: { type: RESULTS_MESSAGE, results: [result] } } as unknown as MessageEvent)
    handleMessage({ source: fakeWindow, data: { type: 'other', results: [result] } } as unknown as MessageEvent)
    expect(getEntries()).toEqual([])
    handleMessage({ source: fakeWindow, data: { type: RESULTS_MESSAGE, results: [result] } } as unknown as MessageEvent)
    expect(getEntries()).toHaveLength(1)
  })
})
