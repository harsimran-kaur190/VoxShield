import { describe, expect, it, vi } from 'vitest'

import { analyzeScenario, loadScenarioFile, SAMPLE_LABEL, SampleLoadError, SCENARIOS, SCRIPT_LABEL } from './scenarios'

const audio = (body = 'abc', type = 'audio/flac', status = 200) => new Response(body, { status, headers: { 'content-type': type } })

describe('scenario definitions', () => {
  it('offers the six required situations, each with a unique id and its own audio file', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(['protective', 'otp', 'payment', 'discourage', 'harmless', 'ambiguous'])
    expect(new Set(SCENARIOS.map((s) => s.audioUrl)).size).toBe(6)
    for (const s of SCENARIOS) {
      expect(s.title && s.testing && s.lookFor && s.script).toBeTruthy()
      expect(s.audioUrl).toMatch(/^\/lab\/[a-z]+\.flac$/)
    }
  })

  it('never states an outcome, score, or accuracy: it only says what is being tested and what to look at', () => {
    for (const s of SCENARIOS) {
      const copy = `${s.testing} ${s.lookFor}`
      expect(copy).not.toMatch(/\d\s?%|score of|\bwill (be )?(flag|detect|catch|find|score)|is (a )?scam\b|detected as|correctly/i)
    }
  })

  it('labels the samples as computer-generated speech and the scripts as scripts, not detection results', () => {
    expect(SAMPLE_LABEL).toMatch(/computer-generated speech/i)
    expect(SAMPLE_LABEL).toMatch(/not a real call/i)
    expect(SCRIPT_LABEL).toMatch(/not a detection result/i)
  })
})

describe('loadScenarioFile', () => {
  const scenario = SCENARIOS[1]

  it('fetches the scenario audio and wraps it as a flac File named for the scenario', async () => {
    const fetcher = vi.fn().mockResolvedValue(audio())
    const file = await loadScenarioFile(scenario, fetcher)
    expect(fetcher).toHaveBeenCalledWith('/lab/otp.flac')
    expect(file).toBeInstanceOf(File)
    expect([file.name, file.type, file.size]).toEqual(['otp-sample.flac', 'audio/flac', 3])
  })

  it('rejects a missing file even when a single-page-app host answers 200 with its HTML page', async () => {
    await expect(loadScenarioFile(scenario, vi.fn().mockResolvedValue(audio('<html></html>', 'text/html; charset=utf-8')))).rejects.toThrow(SampleLoadError)
  })

  it.each([
    ['a server error', () => audio('x', 'audio/flac', 404)],
    ['an empty file', () => audio('')],
  ])('rejects %s with a readable message', async (_name, make) => {
    await expect(loadScenarioFile(scenario, vi.fn().mockResolvedValue(make()))).rejects.toBeInstanceOf(SampleLoadError)
  })

  it('turns a network failure into a readable message', async () => {
    await expect(loadScenarioFile(scenario, vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).rejects.toThrow(/could not be loaded/)
  })
})

describe('analyzeScenario', () => {
  it('hands the chosen scenario audio to the normal analysis as a File, unchanged and unscored', async () => {
    const file = new File(['x'], 'payment-sample.flac', { type: 'audio/flac' })
    const load = vi.fn().mockResolvedValue(file)
    const start = vi.fn().mockResolvedValue(undefined)
    await analyzeScenario(SCENARIOS[2], start, load)
    expect(load).toHaveBeenCalledWith(SCENARIOS[2])
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(file)
  })

  it('does not start an analysis when the sample cannot be loaded', async () => {
    const start = vi.fn()
    await expect(analyzeScenario(SCENARIOS[0], start, vi.fn().mockRejectedValue(new SampleLoadError('nope')))).rejects.toThrow('nope')
    expect(start).not.toHaveBeenCalled()
  })
})
