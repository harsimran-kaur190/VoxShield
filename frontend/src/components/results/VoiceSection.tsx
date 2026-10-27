import { usePlayback, usePlaybackState } from '../../hooks/usePlayback'
import { formatTimestamp } from '../../lib/highlight'
import { AUDIO_BAND_LABEL, detectorName, FAKE_SCORE_NAME, fakeCutoffPercent, formatFakeScore, scaleOffset, splitVoiceSummary, VOICE_READING } from '../../lib/score'
import { VOICE_LANGUAGE_NOTE } from '../../lib/languages'
import type { LanguageInfo, VoiceAssessment } from '../../lib/types'
import { VOICE_VIEW } from '../../lib/views'
import { Limitations, ModelNote } from '../ModelNote'

export function VoiceSection({ voice, language }: { voice: VoiceAssessment; language?: LanguageInfo | null }) {
  const controller = usePlayback()
  const playback = usePlaybackState()
  const scored = voice.windows.length > 0 && voice.fake_score_median !== null
  const { lead, aside } = splitVoiceSummary(voice.summary)
  const detectors = voice.detectors ?? []
  return (
    <section aria-labelledby="voice-heading">
      <p className="font-mono text-sm text-accent">02 · Voice authenticity · from the audio</p>
      <h2 id="voice-heading" className="mt-2 font-display text-2xl font-medium sm:text-3xl">
        Voice analysis
      </h2>
      <p className="mt-3 text-ink-2">{lead}</p>
      <p className="mt-2 text-ink-2">{VOICE_READING[voice.verdict]}</p>
      {detectors.length > 1 && (
        <ul aria-label="Each detector's own result" className="mt-3 space-y-1 text-sm text-ink-2" data-testid="voice-detectors">
          {detectors.map((d) => (
            <li key={d.model.name}>
              <span className="font-medium text-ink">{detectorName(d.model.name)}:</span> {VOICE_VIEW[d.verdict].label}
              {d.fake_score_median !== null && <span className="font-mono text-xs text-ink-3"> · median {formatFakeScore(d.fake_score_median)}</span>}
            </li>
          ))}
        </ul>
      )}
      {voice.error && <p className="mt-2 text-amber">{voice.error}</p>}
      {language?.code && language.code !== 'en' && <p className="mt-2 text-sm text-ink-3">{VOICE_LANGUAGE_NOTE}</p>}

      {scored && voice.fake_score_median !== null && (
        <div className="mt-6">
          <div className="flex items-end gap-4">
            <p className="font-display text-5xl font-medium leading-none tabular-nums">{formatFakeScore(voice.fake_score_median)}</p>
            <p className="pb-1 text-sm text-ink-2">
              median {FAKE_SCORE_NAME}, not a probability
              <br />
              {voice.windows_analyzed} window{voice.windows_analyzed === 1 ? '' : 's'} analyzed · {voice.windows_favoring_fake} at or above {fakeCutoffPercent(voice.fake_cutoff)}
            </p>
          </div>

          <div className="mt-6" role="img" aria-label={`Scale from 0% to 100%. Median ${FAKE_SCORE_NAME} ${formatFakeScore(voice.fake_score_median)}. Window scores: ${voice.windows.map((w) => formatFakeScore(w.fake_score)).join(', ')}.`}>
            <div className="relative h-8">
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-accent-tint via-paper-2 to-amber-tint" />
              <div className="absolute left-1/2 top-1/2 h-5 w-px -translate-y-1/2 bg-ink-3" />
              {voice.windows.map((window) => (
                <span
                  key={window.start_seconds}
                  className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink bg-card"
                  style={{ left: scaleOffset(window.fake_score) }}
                />
              ))}
              <span className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-4 ring-paper" style={{ left: scaleOffset(voice.fake_score_median) }} />
            </div>
            <div className="mt-1 grid grid-cols-3 text-xs text-ink-3">
              <span>0% · “real” label</span>
              <span className="text-center">50%</span>
              <span className="text-right">“fake” label · 100%</span>
            </div>
          </div>
        </div>
      )}

      {!scored && voice.verdict !== 'unavailable' && (
        <p className="mt-4 text-sm text-ink-3">No window scores were returned for this recording, so no voice score is shown.</p>
      )}

      {voice.verdict !== 'unavailable' && (
        <details className="mt-5 text-sm">
          <summary className="flex cursor-pointer items-center text-accent underline-offset-4 hover:underline pointer-coarse:min-h-11">Window scores and how the score is produced</summary>

          {scored && (
            <>
              <p className="mt-2 text-ink-3">Each dot on the bar is one window. Press a row to jump to it in the recording.</p>
              <ul aria-label="Scores by window" className="mt-2 space-y-1">
                {voice.windows.map((window) => {
                  const label = `${formatTimestamp(window.start_seconds)} to ${formatTimestamp(window.end_seconds)}, ${FAKE_SCORE_NAME} ${formatFakeScore(window.fake_score)}`
                  const row = (
                    <>
                      <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-ink-2">
                        {formatTimestamp(window.start_seconds)}–{formatTimestamp(window.end_seconds)}
                      </span>
                      <span className="h-1.5 flex-1 rounded-full bg-paper-2" aria-hidden>
                        <span className="block h-1.5 rounded-full bg-ink-3" style={{ width: scaleOffset(window.fake_score) }} />
                      </span>
                      <span className="w-12 text-right font-mono text-xs tabular-nums">{formatFakeScore(window.fake_score)}</span>
                    </>
                  )
                  return (
                    <li key={window.start_seconds}>
                      {playback.status === 'ready' ? (
                        <button type="button" onClick={() => controller?.seek(window.start_seconds)} aria-label={`${label}. Jump to this window.`} className="flex w-full items-center gap-3 rounded-md px-1 py-1 hover:bg-paper-2 pointer-coarse:min-h-11">
                          {row}
                        </button>
                      ) : (
                        <p className="flex items-center gap-3 px-1 py-1" aria-label={label}>
                          {row}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-ink-3">Highest window: {formatFakeScore(voice.fake_score_max)}.</p>
            </>
          )}

          <p className="mt-3 text-ink-2">
            The percentage is a normalized model output, shown this way for display only. It is not calibrated and not the chance that the voice is fake. The classifier returns a score and does not say which sounds or features led to it, so this page cannot explain why. It detected a voice-related signal, nothing more specific.
          </p>
          {voice.audio_band && <p className="mt-2 text-ink-2">Audio quality: {AUDIO_BAND_LABEL[voice.audio_band]}.</p>}
          {language?.voice_note && <p className="mt-2 text-ink-2">{language.voice_note}</p>}
          {voice.score_note && <p className="mt-2 text-ink-2">{voice.score_note}</p>}
          {voice.decision_rule && <p className="mt-2 text-ink-2">{voice.decision_rule}</p>}
          {(aside || voice.reliability_caution) && (
            <p className="mt-3 border-l-2 border-amber-light pl-4 text-ink-2">
              {aside} {voice.reliability_caution}
            </p>
          )}
          <ModelNote model={voice.model} />
          <Limitations items={voice.limitations} />
        </details>
      )}
    </section>
  )
}
