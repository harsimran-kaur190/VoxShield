import { afterEach, describe, expect, it, vi } from 'vitest'

import { englishReport } from '../test-utils/reports'
import type { DeepTruthReport } from './deeptruth'
import { addEntry, clearHistory, entrySource, getEntries, getEntry, HISTORY_LIMIT, latestSimulation, subscribe } from './history'

afterEach(clearHistory)

const simulation = { kind: 'simulation' as const, scenarioId: 'stranded-traveller', title: 'Sim', status: 'ended' as const, elapsed: 12, duration: 30 }

describe('session history', () => {
  it('starts empty', () => {
    expect(getEntries()).toEqual([])
    expect(latestSimulation()).toBeNull()
  })

  it('keeps real analyses and simulations as separate kinds with distinct IDs, newest first', () => {
    const report = englishReport()
    const a = addEntry({ kind: 'analysis', source: 'upload', title: 'call.wav', report }, new Date('2026-10-27T10:00:00Z'))
    const b = addEntry(simulation, new Date('2026-10-27T10:05:00Z'))
    expect(a.id).toMatch(/^AN-/)
    expect(b.id).toMatch(/^SIM-/)
    expect(getEntries().map((entry) => entry.id)).toEqual([b.id, a.id])
    expect(getEntry(a.id)).toMatchObject({ kind: 'analysis', completedAt: '2026-10-27T10:00:00.000Z' })
    // The backend's response is stored as it was returned, not copied into a different shape.
    const saved = getEntry(a.id)
    expect(saved?.kind === 'analysis' && saved.report).toBe(report)
    expect(latestSimulation()?.id).toBe(b.id)
  })

  it('returns null for an unknown ID instead of a stand-in report', () => {
    expect(getEntry('AN-NOPE')).toBeNull()
    expect(getEntry(undefined)).toBeNull()
  })

  it(`keeps at most ${HISTORY_LIMIT} entries`, () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) addEntry(simulation)
    expect(getEntries()).toHaveLength(HISTORY_LIMIT)
  })

  it('notifies subscribers on add and clear, and stops after unsubscribing', () => {
    const listener = vi.fn()
    const stop = subscribe(listener)
    addEntry(simulation)
    clearHistory()
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    addEntry(simulation)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('DeepTruth entries and the source filter', () => {
  const report: DeepTruthReport = {
    verdict: 'No manipulation detected',
    verdict_reason: '',
    disagreement: null,
    manipulation_likelihood: 0.2,
    confidence: 0.7,
    modules: [],
    limitations: [],
    media: { filename: 'photo.jpg', kind: 'image', format: 'jpeg', size_bytes: 10, duration_seconds: null, width: 10, height: 10, has_audio: null, has_video: null },
    status: 'complete',
    timings_seconds: {},
    notice: '',
  }

  it('stores DeepTruth results from the page and the extension with their own ID prefix and source', () => {
    const page = addEntry({ kind: 'deeptruth', source: 'upload', title: 'photo.jpg', report })
    const ext = addEntry({ kind: 'deeptruth', source: 'extension', title: 'photo.jpg', pageUrl: 'https://news.example/story', report })
    expect(page.id).toMatch(/^DT-/)
    expect(entrySource(page)).toBe('upload')
    expect(entrySource(ext)).toBe('extension')
    expect(getEntry(ext.id)).toMatchObject({ kind: 'deeptruth', pageUrl: 'https://news.example/story' })
  })

  it('old record kinds have no source, so a source filter only ever shows them under "all"', () => {
    addEntry(simulation)
    expect(entrySource(getEntries()[0])).toBeNull()
    expect(entrySource(addEntry({ kind: 'analysis', source: 'lab', title: 'Sample', report: englishReport() }))).toBe('lab')
  })
})
