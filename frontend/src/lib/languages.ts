import type { LanguageInfo } from './types'

/** What the user can ask for. "auto" lets the speech-to-text model detect the language. */
export type LanguageChoice = 'auto' | 'en' | 'hi'

export interface LanguageOption {
  code: LanguageChoice
  label: string
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
]

export const DEFAULT_LANGUAGE: LanguageChoice = 'auto'

// Punjabi is not selectable, but auto-detection can still report it, so it keeps a readable name.
const NAME: Record<string, string> = { auto: 'Auto-detect', en: 'English', hi: 'Hindi', pa: 'Punjabi', ur: 'Urdu' }
export const languageName = (code: string | null | undefined): string | null => (code ? (NAME[code] ?? code) : null)

/**
 * What is and is not available for a choice, said before the user runs anything. English is checked directly; Hindi is
 * checked through an English machine translation, which has not been validated. The voice model has not been
 * evaluated in any language.
 */
export function choiceStatus(choice: LanguageChoice): string {
  switch (choice) {
    case 'auto':
      return 'The language is detected from the audio. English is checked directly; Hindi through an English translation. Other languages get a transcript but no scam check.'
    case 'en':
      return 'Scam detection is available for English.'
    case 'hi':
      return `Transcript in ${languageName(choice)}. Scam detection runs on an English machine translation, which has not been validated.`
  }
}

export const VOICE_LANGUAGE_NOTE = 'The voice check was tested only on read speech and computer voices, not real calls. It catches neural voices far less often in Hindi than in English.'

export function isLanguageChoice(value: string): value is LanguageChoice {
  return LANGUAGE_OPTIONS.some((option) => option.code === value)
}

/** One line for the report header. Never shows a score for a language the user selected, because none exists. */
export function languageLine(info: LanguageInfo | null | undefined): string {
  if (!info || !info.code) return 'Language not reported'
  const name = info.name ?? info.code
  if (info.source === 'selected') return `${name} · selected by you`
  if (info.source === 'detected') {
    return info.detection_score !== null ? `${name} · detected (language-detection score ${Math.round(info.detection_score * 100)}%)` : `${name} · detected`
  }
  return name
}

export interface ScamLanguageNotice {
  /** The plain label that replaces the scam-intent verdict when there is none to show. */
  label: string
  text: string
}

/** Set when scam detection read an English translation instead of the transcript, so every result is said to rest on it. */
export function scamTranslationNotice(info: LanguageInfo | null | undefined): string | null {
  if (!info || info.scam_detection_mode !== 'translated') return null
  return `Checked through an English machine translation of the ${info.name ?? 'non-English'} speech, which VoxShield has not validated. Compare each finding with the original sentence.`
}

/** Set when scam detection did not run because of the language: neither a warning nor a clearance. */
export function scamLanguageNotice(info: LanguageInfo | null | undefined): ScamLanguageNotice | null {
  if (!info || info.scam_detection_supported !== false) return null
  return {
    label: info.mismatch ? 'Language mismatch' : 'Limited language support',
    text: info.scam_detection_note ?? 'Scam detection is not validated for this language.',
  }
}
