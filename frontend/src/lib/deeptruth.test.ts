import { afterEach, describe, expect, it, vi } from 'vitest'

import { analyzeMedia, guessKind, verdictTone } from './deeptruth'

afterEach(() => vi.unstubAllGlobals())

describe('analyzeMedia', () => {
  it('posts the file as multipart and returns the parsed report', async () => {
    const report = { verdict: 'Inconclusive', manipulation_likelihood: 0.5, modules: [] }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(report), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await analyzeMedia(new File(['x'], 'a.png'))
    expect(result).toEqual(report)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/deeptruth\/analyze$/)
    expect(init.method).toBe('POST')
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('surfaces the server message for unsupported modalities', async () => {
    const body = { detail: { code: 'modality_not_supported_yet', message: 'Detected an image (png).' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 415 })))
    await expect(analyzeMedia(new File(['x'], 'a.png'))).rejects.toMatchObject({ code: 'modality_not_supported_yet', message: 'Detected an image (png).' })
  })

  it('reports an unreachable backend as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(analyzeMedia(new File(['x'], 'a.png'))).rejects.toMatchObject({ code: 'network' })
  })
})

describe('helpers', () => {
  it('guesses the kind from the browser MIME type', () => {
    expect(guessKind(new File([''], 'a.png', { type: 'image/png' }))).toBe('image')
    expect(guessKind(new File([''], 'a.mp4', { type: 'video/mp4' }))).toBe('video')
    expect(guessKind(new File([''], 'a.bin'))).toBeNull()
  })

  it('maps verdicts to badge tones', () => {
    expect(verdictTone('Likely manipulated')).toBe('critical')
    expect(verdictTone('No manipulation detected')).toBe('success')
    expect(verdictTone('Mixed signals')).toBe('warning')
    expect(verdictTone('Inconclusive')).toBe('neutral')
  })
})
