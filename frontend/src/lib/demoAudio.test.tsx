import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SimulatedWaveform, SoundControl } from '../components/demo/dashboard/DashboardChrome'
import { VoiceAuthenticityCard } from '../components/demo/dashboard/Panels'
import { LiveDashboard } from '../pages/DemoDashboardPage'
import { AudioSync, SEEK_TOLERANCE, type MediaLike } from './demoAudio'
import { SIMULATION_NOTICE, SPOKEN_VOICE_NOTE, STRANDED_TRAVELLER } from './demoScenario'
import { simulationReducer, startSimulation } from './liveSimulation'

function fakeMedia(playResult: () => Promise<void> = () => Promise.resolve()) {
  const media = {
    currentTime: 0,
    muted: false,
    paused: true,
    ended: false,
    readyState: 4,
    error: null,
    play: vi.fn(() => {
      const result = playResult()
      return result.then(() => {
        media.paused = false
      })
    }),
    pause: vi.fn(() => {
      media.paused = true
    }),
  }
  return media as typeof media & MediaLike
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AudioSync', () => {
  it('plays while running and pauses when paused or ended', async () => {
    const media = fakeMedia()
    const sync = new AudioSync(media, vi.fn())
    sync.update('running', 0, true)
    await flush()
    expect(media.play).toHaveBeenCalledTimes(1)
    expect(media.paused).toBe(false)
    sync.update('paused', 3, true)
    expect(media.pause).toHaveBeenCalledTimes(1)
    sync.update('running', 3, true)
    await flush()
    expect(media.play).toHaveBeenCalledTimes(2)
    sync.update('ended', 4, true)
    expect(media.paused).toBe(true)
  })

  it('does not start a second play() while one is pending', () => {
    const media = fakeMedia(() => new Promise(() => {}))
    const sync = new AudioSync(media, vi.fn())
    sync.update('running', 0, true)
    sync.update('running', 0.25, true)
    expect(media.play).toHaveBeenCalledTimes(1)
  })

  it('mutes when sound is off, without stopping, so it stays in step', async () => {
    const media = fakeMedia()
    const sync = new AudioSync(media, vi.fn())
    sync.update('running', 0, false)
    await flush()
    expect(media.muted).toBe(true)
    expect(media.paused).toBe(false)
    sync.update('running', 1, true)
    expect(media.muted).toBe(false)
  })

  it('moves the audio only when it is clearly out of step, e.g. after a restart', () => {
    const media = fakeMedia()
    const sync = new AudioSync(media, vi.fn())
    media.currentTime = 12
    sync.update('running', 12 + SEEK_TOLERANCE / 2, true)
    expect(media.currentTime).toBe(12)
    sync.update('running', 0, true)
    expect(media.currentTime).toBe(0)
  })

  it('reports when the browser blocks sound, so the page can offer Enable Sound', async () => {
    const onBlocked = vi.fn()
    const media = fakeMedia(() => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })))
    const sync = new AudioSync(media, onBlocked)
    sync.update('running', 0, true)
    await flush()
    expect(onBlocked).toHaveBeenCalledTimes(1)
  })

  it('after a refusal it stops retrying, keeps the audio at the clock position, and starts again on unmute()', async () => {
    let allowed = false
    const media = fakeMedia(() => (allowed ? Promise.resolve() : Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }))))
    const sync = new AudioSync(media, vi.fn())
    sync.update('running', 0, true)
    await flush()
    sync.update('running', 0.25, false)
    sync.update('running', 4, false)
    expect(media.play).toHaveBeenCalledTimes(1)
    expect(media.currentTime).toBe(4)
    allowed = true
    sync.unmute()
    await flush()
    expect(media.play).toHaveBeenCalledTimes(2)
    expect(media.paused).toBe(false)
  })

  it('gives the clock the audio position only while it is really playing', async () => {
    const media = fakeMedia()
    const sync = new AudioSync(media, vi.fn())
    expect(sync.time()).toBeNull()
    sync.update('running', 0, true)
    await flush()
    media.currentTime = 7.5
    expect(sync.time()).toBe(7.5)
    media.readyState = 1
    expect(sync.time()).toBeNull()
  })

  it('unmute() turns sound on straight away', () => {
    const media = fakeMedia()
    media.muted = true
    new AudioSync(media, vi.fn()).unmute()
    expect(media.muted).toBe(false)
    expect(media.play).toHaveBeenCalled()
  })
})

describe('clock following the audio', () => {
  it('syncTo moves the clock to the audio position while running, and finishes at the end', () => {
    const running = startSimulation(30)
    expect(simulationReducer(running, { type: 'syncTo', elapsed: 9.8 }).elapsed).toBe(9.8)
    expect(simulationReducer(running, { type: 'syncTo', elapsed: 30 }).status).toBe('finished')
    expect(simulationReducer(running, { type: 'syncTo', elapsed: Number.NaN }).elapsed).toBe(0)
  })

  it('ignores the audio while paused or ended', () => {
    const paused = { ...startSimulation(30), status: 'paused' as const, elapsed: 5 }
    expect(simulationReducer(paused, { type: 'syncTo', elapsed: 9 }).elapsed).toBe(5)
  })
})

describe('demo audio file', () => {
  it('exists in public/ at the path the scenario plays', () => {
    const files = Object.keys(import.meta.glob('../../public/demo/*.flac'))
    expect(files.map((file) => file.replace('../../public', ''))).toContain(STRANDED_TRAVELLER.audioUrl)
  })
})

describe('sound controls and labelling', () => {
  const control = (mode: Parameters<typeof SoundControl>[0]['mode']) => renderToStaticMarkup(<SoundControl mode={mode} onToggle={vi.fn()} onEnable={vi.fn()} />)

  it('offers Mute/Unmute, Enable Sound when blocked, and a note when audio cannot play', () => {
    expect(control('on')).toContain('Mute Caller')
    expect(control('off')).toContain('Unmute Caller')
    expect(control('blocked')).toContain('Enable Sound')
    expect(control('unsupported')).toContain('Audio playback isn’t available in this browser.')
  })

  it('says the voice is computer-generated, and that the voice card was not measured from it', () => {
    expect(SIMULATION_NOTICE).toContain('voiced by computer-generated speech (text-to-speech)')
    const card = renderToStaticMarkup(<VoiceAuthenticityCard voice={STRANDED_TRAVELLER.voice} simulated note={SPOKEN_VOICE_NOTE} />)
    expect(card).toContain('they were not measured from that recording')
  })

  it('draws the real waveform when it is decoded, and a plain progress bar otherwise', () => {
    const real = renderToStaticMarkup(<SimulatedWaveform progress={0.5} waveform={{ peaks: [0.2, 1, 0.4], duration: 30 }} />)
    expect((real.match(/viewBox="0 0 12 100"/g) ?? []).length).toBe(2) // the full shape, and the part already heard
    expect(real).toContain('Computer-generated speech')
    const none = renderToStaticMarkup(<SimulatedWaveform progress={0.5} waveform={null} />)
    expect(none).not.toContain('<svg viewBox')
    expect(none).toContain('width:50%')
  })

  it('renders without audio support (no browser), saying so', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LiveDashboard scenario={STRANDED_TRAVELLER} />
      </MemoryRouter>,
    )
    expect(html).toContain('Audio playback isn’t available in this browser.')
    expect(html).not.toContain(SPOKEN_VOICE_NOTE)
  })
})
