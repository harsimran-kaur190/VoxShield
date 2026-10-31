import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { DeepTruthReport, ModuleResult } from '../../lib/deeptruth'
import { DeepTruthResult } from './DeepTruthResult'
import { endLabels } from '../../lib/syncChart'

const audio: ModuleResult = {
  modality: 'audio',
  score: 0.9,
  reliability: 0.7,
  status: 'ok',
  summary: 'Flagged by the detector.',
  models: ['nii-yamagishilab/mms-300m-anti-deepfake'],
  error: null,
  limitations: ['Phone-quality audio.'],
  evidence: [
    { type: 'timeline', label: 'Voice detector windows', data: { cutoff: 0.2, duration_seconds: 12, windows: [{ start_seconds: 0, end_seconds: 6, score: 0.9, flagged: true }, { start_seconds: 6, end_seconds: 12, score: 0.1, flagged: false }] } },
    { type: 'metadata', label: 'Detector reading', data: { verdict: 'model_favors_fake' } },
  ],
}
const image: ModuleResult = { ...audio, modality: 'image', score: 0.1, reliability: 0.6, models: ['x/y'], evidence: [], limitations: [] }

const base: DeepTruthReport = {
  verdict: 'Likely manipulated',
  verdict_reason: 'Reliability-weighted score 0.90 from 1 module, above 0.6.',
  disagreement: null,
  manipulation_likelihood: 0.9,
  confidence: 0.7,
  modules: [audio],
  limitations: ['Only 2 s of audio.', 'Phone-quality audio.'],
  media: { filename: 'call.wav', kind: 'audio', format: 'wav', size_bytes: 2048, duration_seconds: 12, width: null, height: null, has_audio: true, has_video: false },
  status: 'complete',
  timings_seconds: {},
  notice: 'Not a calibrated probability.',
}

const render = (report: DeepTruthReport) => renderToStaticMarkup(<DeepTruthResult report={report} file={null} onReset={() => {}} />)

describe('DeepTruthResult', () => {
  it('shows the verdict, the gauge value, the reason, the breakdown and the limitations', () => {
    const html = render(base)
    expect(html).toContain('Likely manipulated')
    expect(html).toContain('90%')
    expect(html).toContain('Manipulation likelihood 90 percent, manipulated band') // the gauge's accessible title
    expect(html).toContain('Reliability-weighted score 0.90')
    expect(html).toContain('How the verdict was reached')
    expect(html).toContain('One strong signal decides.')
    expect(html).toContain('Voice authenticity')
    expect(html).toContain('Only 2 s of audio.')
    expect(html).toContain('1 of 2 windows flagged') // shared timeline
  })

  it('explains mixed signals instead of presenting the average as the verdict', () => {
    const html = render({ ...base, verdict: 'Mixed signals', disagreement: ['image', 'voice'], modules: [image, audio], manipulation_likelihood: 0.53 })
    expect(html).toContain('Mixed signals')
    expect(html).toContain('image and voice modules disagree')
    expect(html).toContain('Average shown for reference only')
  })

  it('shows an unavailable module with its error and no score', () => {
    const html = render({ ...base, status: 'partial', modules: [audio, { ...image, status: 'unavailable', error: 'The model could not be loaded.' }] })
    expect(html).toContain('Some modules unavailable')
    expect(html).toContain('The model could not be loaded.')
    expect(html).toContain('n/a')
  })

  it('draws the sync chart for the audio-visual sync module and keeps it off the shared timeline', () => {
    const lipsync: ModuleResult = {
      ...audio,
      modality: 'lipsync',
      score: 0.25,
      reliability: 0.5,
      summary: 'Mouth openness and audio loudness correlate at r = 0.78, in step.',
      evidence: [{ type: 'timeline', label: 'Mouth openness vs audio energy', data: { duration_seconds: 2, series: { times: [0, 1, 2], mouth: [0.1, null, 0.9], audio: [0.2, 0.5, 1] } } }],
    }
    const html = render({ ...base, media: { ...base.media, kind: 'video', format: 'mp4' }, modules: [audio, lipsync] })
    expect(html).toContain('Audio-visual sync consistency')
    expect(html).toContain('Mouth openness and audio energy over 2.0 seconds')
    expect(html).toContain('Gaps in the mouth line')
    expect(html).not.toContain('Audio-visual sync consistency<span class="block text-xs text-ink-3">') // no timeline row
  })

  it('keeps the sync chart end labels apart', () => {
    const close = endLabels(28.6, 28)
    expect(Math.abs(close.mouth - close.audio)).toBeCloseTo(14)
    expect(close.audio).toBeLessThan(close.mouth) // audio ended higher on screen, so its label stays on top
    expect(endLabels(40, 100)).toEqual({ mouth: 40, audio: 100 })
  })

  it('names the module that decided the verdict and still shows the weighted average', () => {
    const frames: ModuleResult = { ...image, modality: 'video_frames', score: 0.15, reliability: 0.6, checks: 'Whether frames look generated.', basis: 'measured', basis_note: 'Measured on stills.' }
    const voice: ModuleResult = { ...audio, checks: 'Whether the voice sounds synthetic.', basis: 'measured', basis_note: 'VoxShield benchmark.' }
    const html = render({ ...base, verdict: 'Likely manipulated', decided_by: 'audio', manipulation_likelihood: 0.9, weighted_average: 0.55, disagreement: ['video-frame', 'voice'], modules: [frames, voice] })
    expect(html).toContain('Decided by <span class="font-medium text-ink">Voice authenticity</span>')
    expect(html).toContain('Weighted average of all modules: 55%')
    expect(html).toContain('Decided the verdict')
    expect(html).toContain('What it checks')
    expect(html).toContain('Whether the voice sounds synthetic.')
    expect(html).toContain('Measured')
    expect(html).not.toContain('No average is given') // not a Mixed-signals report
  })
})
