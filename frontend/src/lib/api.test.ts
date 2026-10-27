import { afterEach, describe, expect, it, vi } from 'vitest'

import { analyzeAudio, ApiError } from './api'
import { recordingToFile } from './recording'

const encoder = new TextEncoder()

function streamOf(chunks: string[], status = 200) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
  return new Response(body, { status })
}

const file = new File(['x'], 'a.wav')
const report = { status: 'complete' }

afterEach(() => vi.unstubAllGlobals())

describe('analyzeAudio', () => {
  it('reports stages and returns the final report even when JSON lines are split across chunks', async () => {
    const lines = [
      JSON.stringify({ type: 'stage', stage: 'decode', state: 'running' }),
      JSON.stringify({ type: 'stage', stage: 'decode', state: 'done' }),
      JSON.stringify({ type: 'report', report }),
    ].join('\n') + '\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamOf([lines.slice(0, 40), lines.slice(40, 90), lines.slice(90)])))
    const seen: string[] = []
    const result = await analyzeAudio(file, (stage, state) => seen.push(`${stage}:${state}`))
    expect(seen).toEqual(['decode:running', 'decode:done'])
    expect(result).toEqual(report)
  })

  it('surfaces the server error message for rejected uploads', async () => {
    const response = new Response(JSON.stringify({ detail: { code: 'unrecognized_audio', message: 'Not audio.' } }), { status: 415 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(analyzeAudio(file, () => {})).rejects.toMatchObject({ code: 'unrecognized_audio', message: 'Not audio.' })
  })

  it('turns a stream error event into an ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamOf([JSON.stringify({ type: 'error', message: 'stopped' }) + '\n'])))
    await expect(analyzeAudio(file, () => {})).rejects.toBeInstanceOf(ApiError)
  })

  it('fails clearly when the stream ends without a report', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamOf([JSON.stringify({ type: 'stage', stage: 'voice', state: 'running' }) + '\n'])))
    await expect(analyzeAudio(file, () => {})).rejects.toMatchObject({ code: 'no_report' })
  })

  it('reports a network failure without leaking details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(analyzeAudio(file, () => {})).rejects.toMatchObject({ code: 'network' })
  })

  it('submits a recording to the existing streaming endpoint as an ordinary file upload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamOf([JSON.stringify({ type: 'report', report }) + '\n']))
    vi.stubGlobal('fetch', fetchMock)
    const recorded = recordingToFile({ blob: new Blob(['RIFF....WAVE'], { type: 'audio/wav' }) }, new Date(2026, 9, 25, 9, 8, 7))
    await analyzeAudio(recorded, () => {})
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/analysis/stream')
    expect(init.method).toBe('POST')
    const sent = (init.body as FormData).get('file') as File
    expect(sent.name).toBe('recording-20261025-090807.wav')
    expect(sent.type).toBe('audio/wav')
  })

  describe('language', () => {
    const sentForm = async (language?: 'auto' | 'en' | 'hi') => {
      const fetchMock = vi.fn().mockResolvedValue(streamOf([JSON.stringify({ type: 'report', report }) + '\n']))
      vi.stubGlobal('fetch', fetchMock)
      await (language === undefined ? analyzeAudio(file, () => {}) : analyzeAudio(file, () => {}, undefined, language))
      return fetchMock.mock.calls[0][1].body as FormData
    }

    it('sends nothing when the language is not chosen, exactly as clients did before language selection', async () => {
      expect((await sentForm()).has('language')).toBe(false)
      expect((await sentForm('auto')).has('language')).toBe(false)
    })

    it.each(['en', 'hi'] as const)('sends the chosen language code %s with the audio', async (code) => {
      const form = await sentForm(code)
      expect(form.get('language')).toBe(code)
      expect((form.get('file') as File).name).toBe('a.wav')
    })

    it('surfaces the server message when a language is rejected', async () => {
      const rejected = new Response(JSON.stringify({ detail: { code: 'unsupported_language', message: 'Unsupported language. Choose one of: auto, en, hi, pa.' } }), { status: 422 })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rejected))
      await expect(analyzeAudio(file, () => {}, undefined, 'hi')).rejects.toMatchObject({ code: 'unsupported_language', message: expect.stringContaining('auto, en, hi, pa') })
    })
  })
})

