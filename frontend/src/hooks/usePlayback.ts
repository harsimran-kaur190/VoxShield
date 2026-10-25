import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { AudioController, browserAudioEnv, type PlaybackState } from '../lib/audioController'
import { PlaybackContext } from './playbackContext'

const UNAVAILABLE: PlaybackState = { status: 'unavailable', playing: false, duration: 0, volume: 1, muted: false, error: null }
const NO_SUBSCRIPTION = () => () => {}

/**
 * Owns playback of the analyzed recording for one results view. The audio is the user's own file or recording, held in
 * memory: the object URL is created here and revoked when the source changes or the view closes.
 */
export function useAudioPlayback(audio: Blob | null, fallbackDuration: number) {
  const [controller] = useState(() => new AudioController(browserAudioEnv, fallbackDuration))
  const element = useRef<HTMLAudioElement>(null)

  useEffect(() => (element.current ? controller.bind(element.current) : undefined), [controller])
  useEffect(() => {
    controller.setSource(audio)
    return () => controller.release()
  }, [controller, audio])

  return { controller, element }
}

/** The controller, or null when a component is shown without a player (for example in isolation). */
export const usePlayback = () => useContext(PlaybackContext)

export function usePlaybackState(): PlaybackState {
  const controller = usePlayback()
  const getState = () => controller?.getState() ?? UNAVAILABLE
  return useSyncExternalStore(controller?.subscribe ?? NO_SUBSCRIPTION, getState, getState)
}

/**
 * Subscribe to a value derived from the playhead. The component re-renders only when the derived value changes, so
 * "which transcript segment is active" updates a few times a minute rather than on every animation frame.
 */
export function usePlaybackTime<T extends string | number | boolean | null>(select: (seconds: number) => T): T {
  const controller = usePlayback()
  const getValue = () => select(controller?.getTime() ?? 0)
  return useSyncExternalStore(controller?.subscribeTime ?? NO_SUBSCRIPTION, getValue, getValue)
}
