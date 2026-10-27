import type { AnalysisReport } from './types'

export interface Lesson {
  can: string[]
  cannot: string[]
}

/**
 * What a finished result can and cannot establish. Every line that depends on the result is chosen from the report that
 * the backend actually returned; no outcome is assumed. `syntheticInput` is true only for the lab's samples, which are
 * known to be computer-generated speech.
 */
export function lessonFor(report: AnalysisReport, syntheticInput: boolean): Lesson {
  const can: string[] = []
  const cannot: string[] = [
    'It cannot say who the speaker is or what they intend. It looks only at the words that were transcribed and at how the audio sounds.',
    'The two checks are separate. A natural-sounding voice does not make a call legitimate, and a synthetic voice does not make it a scam.',
  ]

  const { intent, voice } = report
  const direct = intent.indicators.filter((i) => i.context === 'direct')
  if (direct.length > 0) {
    can.push(`The scam check quoted ${direct.length === 1 ? 'a passage' : `${direct.length} passages`} from the transcript that read like a request or pressure. Each quote shows what was said and why it was flagged.`)
    cannot.push('A flagged passage is a clue, not proof of fraud. Real organizations also say some of these things.')
  } else if (intent.risk === 'none_detected') {
    can.push('The scam check found no suspicious request in the transcript.')
    cannot.push(
      intent.analyzed_text === 'translation'
        ? 'Finding nothing is not a clearance. The check read a machine translation, which can lose a request, and depends on the transcript and translation being correct.'
        : 'Finding nothing is not a clearance. The check looks for common English wording and depends on the transcript being correct.',
    )
  } else if (intent.risk === 'inconclusive' || intent.risk === 'unavailable') {
    can.push('The scam check could not reach an answer for this recording, and says so instead of guessing.')
  } else if (intent.risk === 'weak_signals') {
    can.push('The scam check found only quoted or low-signal wording, which does not raise the risk level.')
  }
  if (intent.suppressed_mentions > 0) {
    can.push('Some wording that resembled a request was held back because the sentence read as protective advice, and the result says how many.')
  }

  if (voice.verdict === 'model_favors_fake') {
    can.push(syntheticInput ? 'The voice model leaned toward “fake”. This sample is computer-generated speech, so that matches how it was made.' : 'The voice model leaned toward “fake” for this audio.')
    cannot.push('A lean toward “fake” says nothing about whether the words are a scam, and the model can be wrong on real voices.')
  } else if (voice.verdict === 'model_favors_real') {
    can.push(syntheticInput ? 'The voice model leaned toward “real” even though this sample is computer-generated speech.' : 'The voice model leaned toward “real” for this audio.')
    cannot.push(syntheticInput ? 'That is a reminder that the voice score can miss synthetic speech, so a “real” lean cannot confirm a voice is genuine or a call is safe.' : 'A “real” lean cannot confirm a voice is genuine or a call is safe.')
  } else if (voice.verdict === 'inconclusive') {
    can.push('The voice check was inconclusive, so no lean is reported.')
  } else {
    can.push('The voice check could not run for this recording.')
  }
  return { can, cannot }
}
