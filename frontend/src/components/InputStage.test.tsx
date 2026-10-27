import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { RecorderSnapshot } from '../lib/recorderSession'
import { InputStage } from './InputStage'
import { RecordPanel } from './RecordPanel'

const IDLE: RecorderSnapshot = { status: 'idle', elapsed: 0, levels: [], error: null, result: null }
const handlers = { onStart: vi.fn(), onStop: vi.fn(), onDiscard: vi.fn(), onAnalyze: vi.fn(), onUseUpload: vi.fn() }
const panel = (snapshot: Partial<RecorderSnapshot>, maxSeconds = 600) =>
  renderToStaticMarkup(<RecordPanel snapshot={{ ...IDLE, ...snapshot }} maxSeconds={maxSeconds} {...handlers} />)

describe('InputStage', () => {
  const html = renderToStaticMarkup(<InputStage limits={null} onFile={() => {}} language="auto" onLanguageChange={() => {}} />)

  it('offers Upload audio and Record audio as two equal tabs, with upload selected and unchanged', () => {
    expect(html).toContain('role="tablist"')
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>(?:<svg.*?<\/svg>)?Upload audio/)
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>(?:<svg.*?<\/svg>)?Record audio/)
    expect(html).toContain('Choose audio file')
    expect(html).toContain('Drop a call recording here')
    expect(html).toContain('type="file"')
  })

  it('does not ask for the microphone or show a recorder until Record is chosen', () => {
    expect(html).not.toContain('Start recording')
    expect(html).not.toContain('<audio')
  })
})

describe('RecordPanel', () => {
  it('idle: explains what is captured, the limit, and that nothing is recorded or sent until asked', () => {
    const out = panel({})
    expect(out).toContain('Start recording')
    expect(out).toContain('only when you press Start')
    expect(out).toContain('nothing is sent until you press Analyze')
    expect(out).toContain('10:00')
    expect(out).toContain('can’t record a phone call’s audio directly')
    expect(out).not.toContain('<audio')
  })

  it('requesting: shows that it is waiting for permission', () => {
    expect(panel({ status: 'requesting' })).toContain('Waiting for microphone access')
  })

  it('recording: shows the indicator, a live timer, the remaining time, a level display, and Stop', () => {
    const out = panel({ status: 'recording', elapsed: 12.4, levels: [0.1, 0.6, 0.3] }, 60)
    expect(out).toContain('Recording · microphone is on')
    expect(out).toContain('role="timer"')
    expect(out).toContain('0:12')
    expect(out).toContain('48s remaining')
    expect(out).toContain('Live microphone level')
    expect(out).toContain('Stop recording')
    expect(out).not.toContain('Analyze recording')
  })

  it('warns when little time is left', () => {
    expect(panel({ status: 'recording', elapsed: 55 }, 60)).toContain('text-amber-light">5s remaining')
  })

  it('processing: shows a preparing state with no controls that could double-submit', () => {
    const out = panel({ status: 'processing' })
    expect(out).toContain('Preparing your recording')
    expect(out).not.toContain('Analyze recording')
  })

  it('ready: lets the user listen, then analyze, record again, or discard', () => {
    const out = panel({ status: 'ready', result: { blob: new Blob(['x'], { type: 'audio/wav' }), url: 'blob:x', duration: 7.2, peaks: [0.2, 1, 0.4], interrupted: false } })
    expect(out).toContain('<audio')
    expect(out).toContain('src="blob:x"')
    expect(out).toContain('Analyze recording')
    expect(out).toContain('Record again')
    expect(out).toContain('Discard')
    expect(out).toContain('0:07')
    expect(out).not.toContain('stopped on its own')
  })

  it('ready after an interruption: says so instead of pretending the recording is complete', () => {
    const out = panel({ status: 'ready', result: { blob: new Blob(['x']), url: 'blob:x', duration: 3, peaks: [1], interrupted: true } })
    expect(out).toContain('stopped on its own')
  })

  it.each([
    ['denied', 'Microphone access was blocked.', 'Microphone blocked'],
    ['no_device', 'No microphone was found.', 'Recording problem'],
    ['empty', 'Nothing was recorded.', 'Recording problem'],
    ['decode', 'could not read back', 'Recording problem'],
    ['too_short', 'too short to analyze', 'Recording problem'],
  ] as const)('error %s: shows a specific message with a way forward', (code, message, title) => {
    const out = panel({ status: 'error', error: { code, message: `${message} xx` } })
    expect(out).toContain(message)
    expect(out).toContain(title)
    expect(out).toContain('role="alert"')
    expect(out).toContain('Try again')
    expect(out).toContain('Upload a file instead')
  })

  it('unsupported browser: does not offer a retry that cannot work, only upload', () => {
    const out = panel({ status: 'error', error: { code: 'unsupported', message: 'Recording is not available in this browser.' } })
    expect(out).not.toContain('Try again')
    expect(out).toContain('Upload a file instead')
  })
})
