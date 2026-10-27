import { describe, expect, it } from 'vitest'

import { startsOverOnRenavigation } from './useAnalysis'

describe('choosing Analyze Audio or Scenario Lab again from the navigation', () => {
  it('returns to the empty form from a finished result or an error', () => {
    expect(startsOverOnRenavigation('done')).toBe(true)
    expect(startsOverOnRenavigation('error')).toBe(true)
  })

  it('does not cancel an analysis that is still running, which has its own Cancel', () => {
    expect(startsOverOnRenavigation('running')).toBe(false)
  })

  it('leaves the empty form as it is', () => {
    expect(startsOverOnRenavigation('idle')).toBe(false)
  })
})
