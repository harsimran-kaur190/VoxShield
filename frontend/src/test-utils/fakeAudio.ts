import { vi } from 'vitest'

import { AudioController, type AudioEnv, type AudioLike } from '../lib/audioController'

export class FakeAudio implements AudioLike {
  src = ''
  currentTime = 0
  duration = NaN
  paused = true
  ended = false
  volume = 1
  muted = false
  listeners = new Map<string, Set<() => void>>()
  play = vi.fn(async () => {
    this.paused = false
    this.emit('play')
  })
  pause() {
    if (this.paused) return
    this.paused = true
    this.emit('pause')
  }
  load() {}
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
}

export const fakeEnv: AudioEnv = {
  createObjectURL: () => 'blob:fake',
  revokeObjectURL: () => {},
  requestFrame: () => 1,
  cancelFrame: () => {},
}

export type ControllerMode = 'ready' | 'playing' | 'unavailable' | 'error'

/** A controller in a known state, driven through a fake audio element rather than by poking its internals. */
export function controllerIn(mode: ControllerMode, { duration = 10.8, time = 0 } = {}) {
  const controller = new AudioController(fakeEnv, duration)
  const audio = new FakeAudio()
  controller.bind(audio)
  if (mode === 'unavailable') return { controller, audio }
  controller.setSource(new Blob(['x'], { type: 'audio/wav' }))
  if (mode === 'error') {
    audio.emit('error')
    return { controller, audio }
  }
  audio.duration = duration
  audio.emit('loadedmetadata')
  if (time) controller.seek(time)
  if (mode === 'playing') {
    audio.paused = false
    audio.emit('play')
  }
  return { controller, audio }
}
