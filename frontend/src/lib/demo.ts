import { demoScore, indicatorsFound, STRANDED_TRAVELLER } from './demoScenario'
import { scamIntentBand } from './scamIntentScore'
import { VOICE_VIEW } from './views'

/**
 * The homepage preview of the demo scenario, derived from the same fictional script as the simulated call and dashboard.
 * None of it comes from the backend or from a model. Anything that displays it must label it as simulated.
 */

export const DEMO_DATA_LABEL = 'Demo data, written by hand. Not produced by the analysis models.'

const scenario = STRANDED_TRAVELLER
const found = indicatorsFound(scenario, scenario.segments)
const score = demoScore(found)
const band = scamIntentBand(score, found.reduce((n, indicator) => n + indicator.evidence.length, 0))
const voiceVerdict = scenario.voice?.verdict ?? 'unavailable'

export const DEMO_CALL = {
  caller: scenario.caller,
  // Only the flagged lines, so the preview stays short.
  transcript: scenario.segments.filter((segment) => segment.evidence.length > 0).slice(0, 3),
  intent: { label: `${band.label} · ${score}/100`, dot: band.dot, categories: found.map((indicator) => indicator.label) },
  // Not "fake": the preview shows that a scam can be made with a natural-sounding voice.
  voice: {
    ...VOICE_VIEW[voiceVerdict],
    note: 'The voice model did not lean either way. That is not evidence the voice is human, and it does not make the call safe.',
  },
}
