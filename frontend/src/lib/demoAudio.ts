import type { SimulationStatus } from './liveSimulation'

/**
 * Plays the demo caller's voice (a computer-generated recording, see scripts/make_demo_audio.py) in step with the
 * simulation. While it plays, the simulation clock follows the audio, so what is shown always matches what is heard.
 */

/** The parts of an <audio> element this uses, so tests can pass a stand-in. */
export interface MediaLike {
  currentTime: number
  muted: boolean
  readonly paused: boolean
  readonly ended: boolean
  readonly readyState: number
  readonly error: unknown
  play(): Promise<void>
  pause(): void
}

/** How far the audio may be from the clock before it is moved, e.g. after a restart. */
export const SEEK_TOLERANCE = 0.6
const HAVE_CURRENT_DATA = 2

export class AudioSync {
  private media: MediaLike
  private onBlocked: () => void
  private starting = false
  /** The browser refused playback until the page is clicked; no more attempts until unmute() is called from a click. */
  private blocked = false

  constructor(media: MediaLike, onBlocked: () => void) {
    this.media = media
    this.onBlocked = onBlocked
  }

  /** Call on every change: plays while running, pauses otherwise, and mutes when sound is off or blocked. */
  update(status: SimulationStatus, elapsed: number, sound: boolean) {
    const media = this.media
    media.muted = !sound
    if (status !== 'running') {
      if (!media.paused) media.pause()
      return
    }
    if (Math.abs(media.currentTime - elapsed) > SEEK_TOLERANCE) media.currentTime = elapsed
    if (media.paused && !media.ended && !this.starting && !this.blocked) {
      this.starting = true
      media.play().then(
        () => (this.starting = false),
        (error: unknown) => {
          this.starting = false
          // Playback is not allowed before the page is clicked. Stop trying; the clock keeps time without the audio,
          // and the audio is kept at the right position so a click on "Enable Sound" starts it in step.
          if ((error as { name?: string } | null)?.name === 'NotAllowedError') {
            this.blocked = true
            this.onBlocked()
          }
        },
      )
    }
  }

  /** The audio's position while it is actually playing, or null so the clock keeps time on its own. */
  time(): number | null {
    const media = this.media
    if (media.paused || media.error || media.readyState < HAVE_CURRENT_DATA) return null
    return media.currentTime
  }

  /** From a click: the browser now allows sound, so unmute straight away. */
  unmute() {
    this.blocked = false
    this.media.muted = false
    if (this.media.paused && !this.media.ended) void this.media.play().catch(() => undefined)
  }

  stop() {
    this.media.pause()
    this.starting = false
  }
}
