import { afterEach, describe, expect, it, vi } from 'vitest'

import { englishReport } from '../test-utils/reports'
import { addEntry, clearHistory, getEntries, getEntry, HISTORY_LIMIT, latestSimulation, subscribe } from './history'

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
