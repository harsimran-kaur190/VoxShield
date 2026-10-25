import { Loader2, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { memo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { usePlayback, usePlaybackState, usePlaybackTime } from '../../hooks/usePlayback'
import type { AudioController, PlaybackState } from '../../lib/audioController'
import { formatTimestamp } from '../../lib/highlight'
import { findingSeekTime, positionLabel, type FindingGroup } from '../../lib/playback'
import type { AnalysisReport } from '../../lib/types'
import type { Waveform as WaveformData } from '../../lib/waveform'
import { Waveform } from '../Waveform'

interface Props {
  report: AnalysisReport
  waveform: WaveformData | null | undefined
  groups: FindingGroup[]
  selected: string | null
  onSelect: (key: string) => void
  /** Offered when there is no audio to play, so the person can choose or record it again. */
  onChooseAgain: () => void
}

const pct = (seconds: number, duration: number) => `${Math.min(100, Math.max(0, (seconds / duration) * 100))}%`
const BUTTON = 'grid place-items-center rounded-full text-stage-ink transition hover:bg-stage-line disabled:cursor-not-allowed disabled:opacity-40'

/** The drawn waveform does not depend on playback, so it is not redrawn as the playhead moves. */
const StaticWaveform = memo(function StaticWaveform({ peaks, className }: { peaks: number[]; className: string }) {
  return <Waveform peaks={peaks} className={className} />
})

function TimeReadout({ duration }: { duration: number }) {
  const seconds = usePlaybackTime((t) => Math.floor(t))
  return (
    <p className="font-mono text-sm tabular-nums text-stage-ink" aria-hidden>
      {formatTimestamp(seconds)} <span className="text-stage-muted">/ {formatTimestamp(duration)}</span>
    </p>
  )
}

function PlayerBar({ controller, state }: { controller: AudioController | null; state: PlaybackState }) {
  const playable = state.status === 'ready' || state.status === 'loading'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <button
        type="button"
        onClick={() => controller?.toggle()}
        disabled={!playable}
        aria-label={state.playing ? 'Pause recording' : 'Play recording'}
        className="grid size-11 place-items-center rounded-full bg-accent text-white transition hover:bg-accent-light hover:text-stage disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state.status === 'loading' ? <Loader2 className="size-5 animate-spin" aria-hidden /> : state.playing ? <Pause className="size-5 fill-current" aria-hidden /> : <Play className="ml-0.5 size-5 fill-current" aria-hidden />}
      </button>
      <button type="button" onClick={() => controller?.skip(-5)} disabled={!playable} aria-label="Back 5 seconds" className={`${BUTTON} h-9 px-3 font-mono text-xs`}>
        −5s
      </button>
      <button type="button" onClick={() => controller?.skip(5)} disabled={!playable} aria-label="Forward 5 seconds" className={`${BUTTON} h-9 px-3 font-mono text-xs`}>
        +5s
      </button>
      <TimeReadout duration={state.duration} />
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => controller?.toggleMute()}
          disabled={!playable}
          aria-label={state.muted || state.volume === 0 ? 'Unmute' : 'Mute'}
          aria-pressed={state.muted}
          className={`${BUTTON} size-9`}
        >
          {state.muted || state.volume === 0 ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={state.muted ? 0 : state.volume}
          onChange={(event) => controller?.setVolume(Number(event.target.value))}
          disabled={!playable}
          aria-label="Volume"
          className="h-1.5 w-20 cursor-pointer accent-accent-light disabled:cursor-not-allowed disabled:opacity-40"
        />
      </div>
    </div>
  )
}

function Playhead({ duration, peaks }: { duration: number; peaks: number[] | undefined }) {
  const time = usePlaybackTime((t) => t)
  const progress = Math.min(100, Math.max(0, (time / duration) * 100))
  return (
    <>
      {peaks && (
        <div className="pointer-events-none absolute inset-0" style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }} aria-hidden>
          <StaticWaveform peaks={peaks} className="h-full w-full text-accent-light" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(13,16,23,0.6)]" style={{ left: `${progress}%` }} aria-hidden>
        <span className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-white" />
      </div>
    </>
  )
}

function Scrubber({ controller, state, waveform, selectedRange, duration }: { controller: AudioController | null; state: PlaybackState; waveform: WaveformData | null | undefined; selectedRange: { start: number; end: number } | null; duration: number }) {
  const lane = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const second = usePlaybackTime((t) => Math.floor(t))
  const enabled = state.status === 'ready' || state.status === 'loading'

  const seekTo = (event: PointerEvent) => {
    const box = lane.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    controller?.seek(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * duration)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!enabled || !controller) return
    const steps: Record<string, () => void> = {
      ArrowLeft: () => controller.skip(-5),
      ArrowDown: () => controller.skip(-5),
      ArrowRight: () => controller.skip(5),
      ArrowUp: () => controller.skip(5),
      PageDown: () => controller.skip(-15),
      PageUp: () => controller.skip(15),
      Home: () => controller.seek(0),
      End: () => controller.seek(duration),
      ' ': () => controller.toggle(),
    }
    const step = steps[event.key]
    if (step) {
      event.preventDefault()
      step()
    }
  }

  return (
    <div
      ref={lane}
      role="slider"
      tabIndex={enabled ? 0 : -1}
      aria-label="Recording position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={second}
      aria-valuetext={positionLabel(second, duration)}
      aria-disabled={!enabled}
      aria-description="Left and right arrow keys move 5 seconds. Space plays or pauses."
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (!enabled) return
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        seekTo(event)
      }}
      onPointerMove={(event) => dragging.current && seekTo(event)}
      onPointerUp={(event) => {
        dragging.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => (dragging.current = false)}
      className={`relative h-28 touch-pan-y select-none overflow-hidden rounded-xl bg-stage-2 ${enabled ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {waveform && <StaticWaveform peaks={waveform.peaks} className="absolute inset-0 h-full w-full text-[#4a5670]" />}
      {!waveform && (
        <p className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-stage-muted">
          {waveform === undefined ? 'Reading the waveform…' : 'No waveform preview for this file in your browser.'}
        </p>
      )}
      {selectedRange && (
        <div
          className="pointer-events-none absolute inset-y-0 rounded-sm border-x-2 border-amber-light bg-amber-light/15"
          style={{ left: pct(selectedRange.start, duration), width: `max(4px, ${((selectedRange.end - selectedRange.start) / duration) * 100}%)` }}
          aria-hidden
        />
      )}
      {enabled && <Playhead duration={duration} peaks={waveform?.peaks} />}
    </div>
  )
}

export function Timeline({ report, waveform, groups, selected, onSelect, onChooseAgain }: Props) {
  const controller = usePlayback()
  const state = usePlaybackState()
  const duration = state.duration || report.audio.duration_seconds
  const timed = groups.filter((group) => findingSeekTime({ start_seconds: group.start_seconds }) !== null)
  const untimed = groups.length - timed.length
  const selectedGroup = groups.find((group) => selected !== null && group.ids.includes(selected))
  const selectedRange =
    selectedGroup && selectedGroup.start_seconds !== null
      ? { start: selectedGroup.start_seconds, end: Math.max(selectedGroup.end_seconds ?? selectedGroup.start_seconds, selectedGroup.start_seconds) }
      : null
  const [announce, setAnnounce] = useState('')
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <section aria-labelledby="timeline-heading" className="on-stage rounded-3xl bg-stage p-5 text-stage-ink sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="timeline-heading" className="font-display text-xl font-medium">
          Recording timeline
        </h2>
        <p className="text-sm text-stage-muted">Listen, and see where the voice model and the scam check looked</p>
      </div>

      <div className="mt-5">
        <PlayerBar controller={controller} state={state} />
        {state.status === 'unavailable' && (
          <p role="status" className="mt-3 text-sm text-stage-muted">
            The audio isn’t available in this session, because VoxShield doesn’t keep recordings after analysis.{' '}
            <button type="button" onClick={onChooseAgain} className="text-accent-light underline underline-offset-4 hover:text-white">
              Upload or record it again
            </button>{' '}
            to listen.
          </p>
        )}
        {state.status === 'error' && (
          <p role="alert" className="mt-3 text-sm text-amber-light">
            {state.error}{' '}
            <button type="button" onClick={onChooseAgain} className="underline underline-offset-4 hover:text-white">
              Choose the file again
            </button>
          </p>
        )}
      </div>

      <div className="mt-4">
        <Scrubber controller={controller} state={state} waveform={waveform} selectedRange={selectedRange} duration={duration} />

        <ul aria-label="Voice analysis windows" className="relative mt-1.5 h-9 overflow-hidden rounded-lg bg-stage-2/60">
          {report.voice.windows.map((window) => {
            const label = `Voice window ${formatTimestamp(window.start_seconds)} to ${formatTimestamp(window.end_seconds)}, model “fake” score ${window.fake_score.toFixed(2)}${state.status === 'ready' ? '. Press to jump here.' : ''}`
            return (
              <li
                key={window.start_seconds}
                className="absolute inset-y-0"
                style={{ left: pct(window.start_seconds, duration), width: `${((window.end_seconds - window.start_seconds) / duration) * 100}%` }}
              >
                <button
                  type="button"
                  onClick={() => controller?.seek(window.start_seconds)}
                  disabled={state.status !== 'ready'}
                  aria-label={label}
                  title={label}
                  className="h-full w-full truncate border-l-2 border-accent-light px-1.5 text-left font-mono text-xs text-stage-ink disabled:cursor-default"
                  style={{ backgroundColor: `rgba(126,160,255,${0.12 + window.fake_score * 0.4})` }}
                >
                  {window.fake_score.toFixed(2)}
                </button>
              </li>
            )
          })}
          {report.voice.windows.length === 0 && <p className="grid h-full place-items-center text-xs text-stage-muted">No voice windows were scored.</p>}
        </ul>

        <div className="relative mt-1.5 h-10" role="group" aria-label="Scam-check findings on the timeline">
          <div className="absolute inset-x-0 top-1/2 h-px bg-stage-line" aria-hidden />
          {timed.map((group, index) => {
            const active = selectedGroup?.key === group.key
            const reported = group.context === 'reported'
            const when = formatTimestamp(group.start_seconds ?? 0)
            const label = `${reported ? 'Reported-speech finding' : 'Finding'} at ${when}: ${group.excerpt}`
            return (
              <button
                key={group.key}
                type="button"
                aria-pressed={active}
                aria-label={label}
                title={`${when}  “${group.excerpt}”`}
                onClick={() => {
                  onSelect(group.key)
                  if (group.start_seconds !== null) controller?.seek(group.start_seconds)
                  setAnnounce(`Selected the finding at ${when}`)
                }}
                className={`absolute top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition ${active ? 'scale-125 ring-2 ring-white' : ''}`}
                style={{ left: pct(group.start_seconds ?? 0, duration), marginTop: index % 2 ? 5 : -5 }}
              >
                <span className={`size-3.5 rounded-full ${reported ? 'border-2 border-accent-light bg-stage' : 'bg-amber-light'}`} />
              </button>
            )
          })}
          {timed.length === 0 && <p className="absolute inset-0 grid place-items-center text-sm text-stage-muted">No findings with a timestamp to place here.</p>}
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {announce}
        </p>

        <div className="mt-1 flex justify-between font-mono text-xs text-stage-muted" aria-hidden>
          {ticks.map((fraction) => (
            <span key={fraction}>{formatTimestamp(duration * fraction)}</span>
          ))}
        </div>
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-stage-muted">
        <li className="flex items-center gap-2">
          <span className="h-3.5 w-0.5 bg-white" aria-hidden /> Playhead
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-5 rounded-sm bg-accent-light/40" aria-hidden /> Voice window and its score
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-amber-light" aria-hidden /> Finding
        </li>
        {groups.some((group) => group.context === 'reported') && (
          <li className="flex items-center gap-2">
            <span className="size-3 rounded-full border-2 border-accent-light" aria-hidden /> Reported speech
          </li>
        )}
        {selectedRange && (
          <li className="flex items-center gap-2">
            <span className="h-3 w-4 rounded-sm border-x-2 border-amber-light bg-amber-light/15" aria-hidden /> Selected passage
          </li>
        )}
      </ul>
      <p className="mt-2 text-sm text-stage-muted">
        Timestamps are for the transcript segment a finding sits in. Gaps between voice windows were not scored: silent or very short stretches are skipped, and long recordings are sampled.
        {untimed > 0 && ` ${untimed} finding${untimed > 1 ? 's have' : ' has'} no timestamp and ${untimed > 1 ? 'are' : 'is'} listed only below.`}
      </p>
    </section>
  )
}
