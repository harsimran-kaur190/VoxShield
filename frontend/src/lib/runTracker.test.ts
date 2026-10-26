import { describe, expect, it } from 'vitest'

import { RunTracker } from './runTracker'

describe('RunTracker', () => {
  it('makes a run current until something newer starts', () => {
    const tracker = new RunTracker()
    const first = tracker.begin()
    expect(first.isCurrent()).toBe(true)
    expect(first.signal.aborted).toBe(false)
  })

  it('aborts the previous request and marks its results stale when a new run begins', () => {
    const tracker = new RunTracker()
    const first = tracker.begin()
    const second = tracker.begin()
    expect(first.signal.aborted).toBe(true)
    expect(first.isCurrent()).toBe(false)
    expect(second.signal.aborted).toBe(false)
    expect(second.isCurrent()).toBe(true)
  })

  it('cancelling (leaving the page, or pressing Cancel) aborts the in-flight request and drops its results', () => {
    const tracker = new RunTracker()
    const run = tracker.begin()
    tracker.cancel()
    expect(run.signal.aborted).toBe(true)
    expect(run.isCurrent()).toBe(false)
  })

  it('can be cancelled with nothing running, and used again afterwards', () => {
    const tracker = new RunTracker()
    expect(() => tracker.cancel()).not.toThrow()
    const run = tracker.begin()
    expect(run.isCurrent()).toBe(true)
  })

  it('a late result from run 1 cannot overwrite run 2 even if it arrives after run 2 finished', () => {
    const tracker = new RunTracker()
    const shown: string[] = []
    const first = tracker.begin()
    const second = tracker.begin()
    for (const [run, name] of [[second, 'second'], [first, 'first']] as const) if (run.isCurrent()) shown.push(name)
    expect(shown).toEqual(['second'])
  })
})
