import { useEffect, useState } from 'react'

import { AudioSync } from '../lib/demoAudio'
import type { SimulationStatus } from '../lib/liveSimulation'
import { decodeWaveform, type Waveform } from '../lib/waveform'

export type DemoVoiceMode = 'unsupported' | 'blocked' | 'on' | 'off'

/** Plays the demo caller's recorded (computer-generated) voice in step with the simulation. Sound is on by default. */
export function useDemoAudio(src: string | undefined, status: SimulationStatus, elapsed: number) {
  const [media] = useState(() => {
    if (!src || typeof Audio === 'undefined') return null
    const audio = new Audio(src)
    audio.preload = 'auto'
    return audio
  })
  const [failed, setFailed] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [blocked, setBlocked] = useState(false)
  const [sync] = useState(() => (media ? new AudioSync(media, () => setBlocked(true)) : null))

  useEffect(() => {
    if (!media) return
    const onError = () => setFailed(true)
    media.addEventListener('error', onError)
    return () => {
      media.removeEventListener('error', onError)
      media.pause()
    }
  }, [media])

  useEffect(() => {
    if (!failed) sync?.update(status, elapsed, enabled && !blocked)
  }, [sync, failed, status, elapsed, enabled, blocked])

  const mode: DemoVoiceMode = !media || failed ? 'unsupported' : blocked ? 'blocked' : enabled ? 'on' : 'off'
  return {
    mode,
    /** The audio position while it plays, for the simulation clock to follow. */
    time: () => (failed ? null : (sync?.time() ?? null)),
    toggle: () => setEnabled((value) => !value),
    enable: () => {
      setBlocked(false)
      setEnabled(true)
      sync?.unmute()
    },
  }
}

/** The real waveform of the demo audio, decoded in the browser. undefined while loading, null if it cannot be drawn. */
export function useDemoWaveform(src: string | undefined) {
  const [waveform, setWaveform] = useState<Waveform | null | undefined>(src ? undefined : null)
  useEffect(() => {
    if (!src) return
    let alive = true
    fetch(src)
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
      .then((blob) => decodeWaveform(new File([blob], 'demo.flac', { type: blob.type || 'audio/flac' }), 160))
      .then((result) => alive && setWaveform(result), () => alive && setWaveform(null))
    return () => {
      alive = false
    }
  }, [src])
  return waveform
}
