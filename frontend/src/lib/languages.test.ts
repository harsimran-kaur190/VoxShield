import { describe, expect, it } from 'vitest'

import { choiceStatus, DEFAULT_LANGUAGE, isLanguageChoice, LANGUAGE_OPTIONS, languageLine, languageName, scamLanguageNotice, scamTranslationNotice, VOICE_LANGUAGE_NOTE } from './languages'
import { language } from '../test-utils/reports'

describe('language choices', () => {
  it('offers auto-detect, English and Hindi (not Punjabi), with auto-detect as the default', () => {
    expect(LANGUAGE_OPTIONS.map((o) => [o.code, o.label])).toEqual([['auto', 'Auto-detect'], ['en', 'English'], ['hi', 'Hindi']])
    expect(DEFAULT_LANGUAGE).toBe('auto')
  })

  it('recognizes only the offered codes', () => {
    for (const ok of ['auto', 'en', 'hi']) expect(isLanguageChoice(ok)).toBe(true)
    for (const bad of ['pa', 'fr', '', 'HI', 'hi-IN', 'english']) expect(isLanguageChoice(bad)).toBe(false)
  })

  it('names languages, falling back to the code for ones it does not know', () => {
    expect([languageName('hi'), languageName('pa'), languageName('ur'), languageName('xx'), languageName(null)]).toEqual(['Hindi', 'Punjabi', 'Urdu', 'xx', null])
  })

  it('says before anything runs what is available, and that Hindi goes through an unvalidated translation', () => {
    expect(choiceStatus('en')).toBe('Scam detection is available for English.')
    expect(choiceStatus('auto')).toMatch(/English is checked directly; Hindi through an English translation\. Other languages get a transcript but no scam check\./)
    expect(choiceStatus('hi')).toContain('Transcript in Hindi')
    expect(choiceStatus('hi')).toContain('English machine translation, which has not been validated')
    expect(choiceStatus('hi')).not.toMatch(/available for|supported|works|accurate/i)
    for (const text of [choiceStatus('auto'), choiceStatus('hi'), VOICE_LANGUAGE_NOTE]) expect(text).not.toContain('Punjabi')
    expect(VOICE_LANGUAGE_NOTE).toMatch(/not real calls/)
    expect(VOICE_LANGUAGE_NOTE).toMatch(/far less often in Hindi than in English/)
  })
})

describe('languageLine', () => {
  it('shows a detection score only for a detected language', () => {
    expect(languageLine(language({ source: 'detected', detection_score: 0.964 }))).toBe('English · detected (language-detection score 96%)')
  })

  it('shows a selected language as selected, with no score (none exists)', () => {
    expect(languageLine(language({ code: 'hi', name: 'Hindi', source: 'selected', detection_score: null }))).toBe('Hindi · selected by you')
  })

  it('does not invent a score when a detected language has none', () => {
    expect(languageLine(language({ source: 'detected', detection_score: null }))).toBe('English · detected')
  })

  it('says so when the language is unknown or missing, instead of guessing', () => {
    expect(languageLine(language({ code: null, name: null, source: 'unknown', detection_score: null }))).toBe('Language not reported')
    expect(languageLine(null)).toBe('Language not reported')
    expect(languageLine(undefined)).toBe('Language not reported')
  })
})

describe('scamLanguageNotice', () => {
  it('is set only when scam detection did not run because of the language', () => {
    expect(scamLanguageNotice(language())).toBeNull()
    expect(scamLanguageNotice(language({ scam_detection_supported: null }))).toBeNull()
    expect(scamLanguageNotice(null)).toBeNull()
    expect(scamLanguageNotice(language({ code: 'pa', scam_detection_supported: false, scam_detection_note: 'Not validated for Punjabi.' }))).toEqual({ label: 'Limited language support', text: 'Not validated for Punjabi.' })
  })

  it('names a language mismatch separately', () => {
    expect(scamLanguageNotice(language({ scam_detection_supported: false, mismatch: true, scam_detection_note: 'You selected English, but the audio sounded like Hindi.' }))?.label).toBe('Language mismatch')
  })

  it('falls back to a plain sentence when the note is missing', () => {
    expect(scamLanguageNotice(language({ scam_detection_supported: false, scam_detection_note: null }))?.text).toBe('Scam detection is not validated for this language.')
  })
})

describe('scamTranslationNotice', () => {
  it('is set only when scam detection read an English translation', () => {
    expect(scamTranslationNotice(language())).toBeNull()
    expect(scamTranslationNotice(language({ scam_detection_mode: 'not_run', scam_detection_supported: false }))).toBeNull()
    expect(scamTranslationNotice(null)).toBeNull()
    const notice = scamTranslationNotice(language({ code: 'hi', name: 'Hindi', scam_detection_mode: 'translated' }))
    expect(notice).toContain('English machine translation of the Hindi speech')
    expect(notice).toContain('has not validated')
  })
})
