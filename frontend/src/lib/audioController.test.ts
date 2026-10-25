import { describe, expect, it, vi } from 'vitest'

import { AudioController, type AudioEnv, type AudioLike } from './audioController'

class FakeAudio implements AudioLike {
  src = ''
  currentTime = 0
  duration = NaN
  paused = true
  ended = false
  volume = 1
  muted = false
  loads = 0
  playError: Error | null = null
  listeners = new Map<string, Set<() => void>>()
  play = vi.fn(async () => {
    if (this.playError) throw this.playError
    this.paused = false
    this.emit('play')
    this.emit('playing')
  })
  pause() {
    if (this.paused) return
    this.paused = true
    this.emit('pause')
  }
  load() {
    this.loads++
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = ''
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener))
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener)
  }
  emit(type: string) {
    this.listeners.get(type)?.forEach((listener) => listener())
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0)
  }
  loadMetadata(duration: number) {
    this.duration = duration
    this.emit('loadedmetadata')
  }
}

function setup(fallback = 20) {
  const urls: string[] = []
  const revoked: string[] = []
  const frames = new Map<number, () => void>()
  let nextFrame = 1
  const env: AudioEnv = {
    createObjectURL: () => {
      const url = `blob:fake-${urls.length + 1}`
      urls.push(url)
      return url
    },
    revokeObjectURL: (url) => revoked.push(url),
    requestFrame: (callback) => {
      frames.set(nextFrame, callback)
      return nextFrame++
    },
    cancelFrame: (handle) => frames.delete(handle as number),
  }
  const audio = new FakeAudio()
  const controller = new AudioController(env, fallback)
  const unbind = controller.bind(audio)
  const runFrame = () => {
    const [id, callback] = [...frames][0] ?? []
    if (id !== undefined) {
      frames.delete(id)
      callback?.()
    }
  }
  return { controller, audio, unbind, urls, revoked, frames, runFrame }
}

const blob = (name = 'a') => new Blob([name], { type: 'audio/wav' })

describe('AudioController', () => {
  it('has no audio until a source is set, and says so instead of pretending to play', async () => {
    const { controller, audio } = setup()
    expect(controller.getState()).toMatchObject({ status: 'unavailable', playing: false })
    await controller.play()
    expect(audio.play).not.toHaveBeenCalled()
    controller.seek(5)
    expect(controller.getTime()).toBe(0)
  })

  it('loads the real blob through one object URL and becomes ready when the metadata arrives', () => {
    const { controller, audio, urls } = setup()
    controller.setSource(blob())
    expect(urls).toHaveLength(1)
    expect(audio.src).toBe(urls[0])
    expect(controller.getState()).toMatchObject({ status: 'loading', duration: 20 })
    audio.loadMetadata(11.4)
    expect(controller.getState()).toMatchObject({ status: 'ready', duration: 11.4 })
  })

  it('falls back to the analysis duration when the element reports an unusable one', () => {
    const { controller, audio } = setup(9.8)
    controller.setSource(blob())
    audio.duration = Infinity
    audio.emit('durationchange')
    expect(controller.getState().duration).toBe(9.8)
  })

  it('plays and pauses the real element and mirrors its state', async () => {
    const { controller, audio } = setup()
    controller.setSource(blob())
    audio.loadMetadata(10)
    await controller.play()
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(controller.getState().playing).toBe(true)
    controller.toggle()
    expect(audio.paused).toBe(true)
    expect(controller.getState().playing).toBe(false)
    controller.toggle()
    await vi.waitFor(() => expect(controller.getState().playing).toBe(true))
  })

  it('moves the playhead as the real element advances, per animation frame while playing and on timeupdate', async () => {
    const { controller, audio, runFrame, frames } = setup()
    controller.setSource(blob())
    audio.loadMetadata(10)
    await controller.play()
    const seen: number[] = []
    controller.subscribeTime(() => seen.push(controller.getTime()))
    audio.currentTime = 1.5
    runFrame()
    audio.currentTime = 2.5
    runFrame()
    expect(seen).toEqual([1.5, 2.5])
    controller.pause()
    expect(frames.size).toBe(0) // no frame loop while paused
    audio.currentTime = 4
    audio.emit('timeupdate')
    expect(controller.getTime()).toBe(4)
  })

  it('seeks within bounds, updates the playhead immediately, and clamps out-of-range requests', () => {
    const { controller, audio } = setup()
    controller.setSource(blob())
    audio.loadMetadata(10)
    controller.seek(4.2)
    expect(audio.currentTime).toBe(4.2)
    expect(controller.getTime()).toBe(4.2)
    controller.seek(99)
    expect(audio.currentTime).toBe(10)
    controller.seek(-3)
    expect(audio.currentTime).toBe(0)
    controller.seek(NaN)
    expect(audio.currentTime).toBe(0)
    controller.seek(6)
    controller.skip(-5)
    expect(controller.getTime()).toBe(1)
  })

  it('controls volume and mute on the element', () => {
    const { controller, audio } = setup()
    controller.setSource(blob())
    controller.setVolume(0.4)
    expect(audio.volume).toBe(0.4)
    controller.toggleMute()
    expect(audio.muted).toBe(true)
    expect(controller.getState().muted).toBe(true)
    controller.setVolume(0.7) // raising the volume un-mutes
    expect(controller.getState()).toMatchObject({ muted: false, volume: 0.7 })
    controller.setVolume(5)
    expect(audio.volume).toBe(1)
  })

  describe('errors', () => {
    it('reports a clear error when the browser cannot load the recording, and stops accepting playback', async () => {
      const { controller, audio } = setup()
      controller.setSource(blob())
      audio.emit('error')
      expect(controller.getState()).toMatchObject({ status: 'error', playing: false })
      expect(controller.getState().error).toMatch(/could not play/)
      await controller.play()
      expect(audio.play).not.toHaveBeenCalled()
    })

    it('reports a blocked play() but ignores an interruption by pause or a new load', async () => {
      const { controller, audio } = setup()
      controller.setSource(blob())
      audio.loadMetadata(10)
      audio.playError = Object.assign(new Error('interrupted'), { name: 'AbortError' })
      await controller.play()
      expect(controller.getState().status).toBe('ready')
      audio.playError = Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
      await controller.play()
      expect(controller.getState()).toMatchObject({ status: 'error', error: 'Playback could not start. Press play again.' })
    })

    it('a new source clears an earlier error', () => {
      const { controller, audio } = setup()
      controller.setSource(blob('a'))
      audio.emit('error')
      controller.setSource(blob('b'))
      expect(controller.getState()).toMatchObject({ status: 'loading', error: null })
    })
  })

  describe('cleanup', () => {
    it('revokes the previous object URL whenever the source changes, never holding two', () => {
      const { controller, urls, revoked } = setup()
      controller.setSource(blob('a'))
      controller.setSource(blob('b'))
      controller.setSource(blob('c'))
      expect(urls).toHaveLength(3)
      expect(revoked).toEqual(urls.slice(0, 2))
    })

    it('release pauses, drops the source, revokes the URL, and returns to unavailable', async () => {
      const { controller, audio, urls, revoked, frames } = setup()
      controller.setSource(blob())
      audio.loadMetadata(10)
      await controller.play()
      controller.release()
      expect(audio.paused).toBe(true)
      expect(audio.src).toBe('')
      expect(revoked).toEqual(urls)
      expect(frames.size).toBe(0)
      expect(controller.getState().status).toBe('unavailable')
      expect(controller.getTime()).toBe(0)
    })

    it('unbinding removes every listener and the frame loop, so nothing updates after the page is gone', async () => {
      const { controller, audio, unbind, frames } = setup()
      controller.setSource(blob())
      audio.loadMetadata(10)
      await controller.play()
      expect(audio.listenerCount()).toBeGreaterThan(0)
      unbind()
      expect(audio.listenerCount()).toBe(0)
      expect(frames.size).toBe(0)
      audio.currentTime = 7
      audio.emit('timeupdate')
      expect(controller.getTime()).not.toBe(7)
    })

    it('binding twice (as React may in development) does not leave duplicate listeners', () => {
      const { controller, audio, unbind } = setup()
      unbind()
      const before = audio.listenerCount()
      const again = controller.bind(audio)
      expect(audio.listenerCount()).toBeGreaterThan(before)
      again()
      expect(audio.listenerCount()).toBe(0)
    })

    it('a source set before the element exists is applied when it is bound', () => {
      const urls: string[] = []
      const controller = new AudioController(
        { createObjectURL: () => (urls.push('u'), `blob:${urls.length}`), revokeObjectURL: () => {}, requestFrame: () => 1, cancelFrame: () => {} },
        12,
      )
      controller.setSource(blob())
      expect(controller.getState().status).toBe('loading')
      const audio = new FakeAudio()
      controller.bind(audio)
      expect(audio.src).toBe('blob:1')
    })
  })
})
