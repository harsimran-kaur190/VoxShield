import { describe, expect, it } from 'vitest'

import { computePeaks } from './waveform'

describe('computePeaks', () => {
  it('returns nothing for empty input', () => {
    expect(computePeaks(new Float32Array(), 10)).toEqual([])
  })

  it('normalizes so the loudest bucket is 1 and keeps relative levels', () => {
    const samples = new Float32Array([0.1, -0.1, 0.4, -0.4, 0.2, 0.2])
    expect(computePeaks(samples, 3)).toEqual([0.25, 1, 0.5])
  })

  it('keeps silence at zero instead of inventing a signal', () => {
    expect(computePeaks(new Float32Array(100), 4)).toEqual([0, 0, 0, 0])
  })

  it('uses every sample, including a remainder in the last bucket', () => {
    const samples = new Float32Array(10)
    samples[9] = 1
    const peaks = computePeaks(samples, 3)
    expect(peaks[peaks.length - 1]).toBe(1)
  })
})
