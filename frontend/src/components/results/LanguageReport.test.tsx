import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from '../../App'
import { detectedPunjabiReport, englishReport, HINDI_TEXT, language, PUNJABI_TEXT, translatedReport, unsupportedLanguageReport } from '../../test-utils/reports'
import type { AnalysisReport } from '../../lib/types'
import { SCENARIOS } from '../../lib/scenarios'
import { LanguageSelect } from '../LanguageSelect'
import { InputStage } from '../InputStage'
import { LabBanner, LabLanguageStatus } from '../lab/LabContext'
import { ScenarioPicker } from '../lab/ScenarioPicker'
import { ResultsView } from './ResultsView'

const noop = () => {}
const results = (r: AnalysisReport) => renderToStaticMarkup(<MemoryRouter><ResultsView report={r} onReset={noop} onRetry={noop} /></MemoryRouter>)
const between = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to))
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

describe('English reports are unchanged', () => {
  it('shows the detected language with its detection score and runs scam detection as before', () => {
    const html = results(englishReport())
    expect(text(html)).toContain('Language: English · detected (language-detection score 97%)')
    const overview = between(html, 'id="overview-heading"', 'id="next-heading"')
    expect(overview).toContain('Notable indicators')
    expect(html).not.toMatch(/Limited language support|Language mismatch/)
    expect(html).toContain('Read me the code we just sent you.')
  })

  it('a report from an older server, with no language metadata at all, still renders and says the language is not reported', () => {
    const { language: _omitted, ...older } = englishReport()
    const html = results(older as AnalysisReport)
    expect(text(html)).toContain('Language: Language not reported')
    expect(html).not.toMatch(/Limited language support|Language mismatch/)
    expect(between(html, 'id="overview-heading"', 'id="next-heading"')).toContain('Notable indicators')
    expect(html).not.toMatch(/<h3[^>]*>Language<\/h3>/) // no empty language group in the details
  })

  it('a failed transcription reports the language as unknown instead of guessing', () => {
    const r = englishReport({
      status: 'partial',
      transcript: { ...englishReport().transcript, status: 'unavailable', text: '', language: null, language_probability: null, language_source: null, segments: [], error: 'The audio could not be transcribed.' },
      language: language({ requested: 'hi', code: null, name: null, source: 'unknown', detection_score: null, scam_detection_supported: null, voice_note: 'v' }),
    })
    const html = results(r)
    expect(text(html)).toContain('Language: Language not reported')
    expect(text(html)).toContain('Asked for Hindi')
    expect(html).not.toContain('Limited language support')
  })
})

describe('Hindi reports, checked through a translation', () => {
  it.each([['hi', 'Hindi', HINDI_TEXT]] as const)('%s: original-language transcript, a real scam result, and the translation caveat beside it', (code, name, original) => {
    const html = results(translatedReport(code))
    const plain = text(html)
    expect(plain).toContain(`Language: ${name} · selected by you`)
    expect(plain).not.toMatch(/language-detection score/) // a selected language has no detection score
    expect(html).toContain(original) // the transcript is shown in the original script
    expect(plain).toContain('Original-language transcript, not translated')
    const overview = text(between(html, 'id="overview-heading"', 'id="next-heading"'))
    expect(overview).toContain('Notable indicators')
    expect(overview).toContain(`Checked through an English machine translation of the ${name} speech`)
    expect(overview).not.toMatch(/Limited language support|Language mismatch/)
  })

  it('shows the English translation in its own panel, after the transcript, with its warning and the matched phrase marked', () => {
    const html = results(translatedReport('hi'))
    expect(html.indexOf('aria-label="Transcript text"')).toBeLessThan(html.indexOf('data-testid="translation"'))
    const panel = between(html, 'data-testid="translation"', 'id="next-heading"') || html.slice(html.indexOf('data-testid="translation"'))
    expect(text(panel)).toContain('English translation')
    expect(text(panel)).toContain('Machine translation from Hindi')
    expect(text(panel)).toContain('It is not what was said')
    expect(text(panel)).toContain('Translation warning')
    expect(panel).toContain('data-marks="tr-a"')
  })

  it('marks a keyword-rule finding in the Hindi transcript, not in the translation', () => {
    const html = results(translatedReport('hi'))
    const transcript = between(html, 'aria-label="Transcript text"', 'data-testid="translation"')
    expect(transcript).toMatch(/data-marks="indic_cred_request-\d+"/)
    expect(transcript).not.toContain('data-marks="tr-a"')
  })

  it('shows, for a translated finding, the sentence that was actually said, and labels where each finding came from', () => {
    const html = results(translatedReport('hi'))
    const findings = text(between(html, '01 · Scam intent', 'id="voice-heading"'))
    expect(findings).toContain(`Said in Hindi: ${HINDI_TEXT}`)
    expect(findings).toContain('From the English translation')
    expect(findings).toContain('Hindi keyword rule')
    expect(findings).toContain('Show in translation')
    expect(findings).toContain('Show in transcript')
  })

  it('a detected Hindi language shows its detection score', () => {
    expect(text(results(translatedReport('hi', 'detected')))).toContain('Language: Hindi · detected (language-detection score 91%)')
  })

  it('detected Punjabi speech keeps its transcript and voice result, but gets no scam verdict', () => {
    const html = results(detectedPunjabiReport())
    const plain = text(html)
    expect(plain).toContain('Language: Punjabi · detected')
    expect(html).toContain(PUNJABI_TEXT)
    expect(plain).toContain('Scam detection is not validated for Punjabi')
    expect(between(html, 'id="overview-heading"', 'id="next-heading"')).not.toMatch(/Notable indicators|Strong indicators|No indicators found/)
    expect(between(html, 'id="overview-heading"', 'id="next-heading"')).toContain('Model favors “real”')
  })

  it('warns that the speech-to-text accuracy has not been measured, in the transcript warning', () => {
    const html = results(translatedReport('hi'))
    const warning = between(html, 'Transcription warning', 'aria-label="Transcript text"')
    expect(text(warning)).toContain('VoxShield has not measured its accuracy')
  })

  it('discloses the voice model\'s weaker results outside English, and keeps the voice result separate', () => {
    const html = results(translatedReport('hi'))
    const voice = between(html, 'id="voice-heading"', 'id="timeline-heading"')
    expect(text(voice)).toContain('far less often in Hindi than in English')
    expect(voice).toContain('7%') // the voice score is still shown, as its own assessment
    expect(between(html, 'id="overview-heading"', 'id="next-heading"')).toContain('Model favors “real”')
  })

  it('explains in the report details how scam detection ran and what was translated', () => {
    const plain = text(results(translatedReport('hi')))
    for (const fact of ['Asked for Hindi', 'Transcribed as Hindi · selected by you', 'Translation English machine translation, used only for scam detection', 'Text checked English machine translation', 'Voice check The voice check was tested by VoxShield only on read speech']) {
      expect(plain).toContain(fact)
    }
    expect(plain).toMatch(/Scam detection Runs on an English machine translation[^.]*\. Not validated\./)
  })

  it('a failed translation is said plainly in the translation panel', () => {
    const base = translatedReport('hi')
    const r = translatedReport('hi', 'selected', { translation: { ...base.translation!, status: 'unavailable', text: '', segments: [], quality_notes: [], error: 'The speech could not be translated to English.' } })
    expect(text(results(r))).toContain('The speech could not be translated to English.')
  })
})

describe('a language with no scam detection (Spanish)', () => {
  it('shows an explicit "not validated" result instead of a verdict', () => {
    const html = results(unsupportedLanguageReport())
    const overview = between(html, 'id="overview-heading"', 'id="next-heading"')
    expect(overview).toContain('Limited language support')
    expect(overview).toContain('Scam detection is not validated for Spanish')
    expect(overview).not.toMatch(/Strong indicators|Notable indicators|No indicators found/)
    expect(text(html)).toContain('Limited language support. Scam detection is not validated for')
    expect(html).not.toContain('data-testid="translation"')
  })

  it('never claims that scam detection works, or a scam verdict', () => {
    const html = results(unsupportedLanguageReport())
    expect(html).not.toMatch(/No suspicious indicators were identified|No scam indicators were found|Strong indicators|Notable indicators|Scam detection is available/i)
    expect(html).not.toMatch(/bg-(green|emerald|ok|success)|\bsafe\b/i)
    expect(html).not.toContain('Pause any payment')
  })

  it('gives no scam-specific next step and does not call the call safe', () => {
    const html = results(unsupportedLanguageReport())
    const next = text(between(html, 'id="next-heading"', '01 · Scam intent'))
    expect(next).toContain("There isn't enough reliable evidence")
    expect(next).toContain('Scam detection is not validated for Spanish')
    expect(next).not.toMatch(/\bsafe\b|no suspicious/i)
  })
})

describe('language mismatch', () => {
  const mismatched = () => {
    const note = 'You selected English, but the audio sounded like Hindi, so the transcript may not match what was said and no scam result is shown. Check the language and analyze again.'
    const base = unsupportedLanguageReport()
    return englishReport({
      intent: { ...base.intent, summary: note },
      recommendations: { ...base.recommendations, detail: note },
      language: language({ requested: 'en', code: 'en', name: 'English', source: 'selected', detection_score: null, detected_code: 'hi', detected_name: 'Hindi', detected_score: 0.94, mismatch: true, scam_detection_supported: false, scam_detection_note: note, scam_detection_mode: 'not_run' }),
    })
  }

  it('is named as a mismatch, not as unsupported, and no scam verdict is shown', () => {
    const html = results(mismatched())
    const overview = between(html, 'id="overview-heading"', 'id="next-heading"')
    expect(overview).toContain('Language mismatch')
    expect(overview).toContain('sounded like Hindi')
    expect(overview).not.toContain('Limited language support')
    expect(overview).not.toMatch(/Strong indicators|Notable indicators|No indicators found/)
  })

  it('explains in the report details what the audio sounded like', () => {
    expect(text(results(mismatched()))).toContain('Audio sounded like Hindi (language-detection score 94%): does not match your selection')
  })
})

describe('report details', () => {
  it('English details say scam detection is available, and that nothing was translated', () => {
    const plain = text(results(englishReport()))
    expect(plain).toContain('Scam detection Available for this language')
    expect(plain).toContain('Translation None.')
    expect(plain).not.toContain('English translation')
  })
})

describe('language selector', () => {
  const select = (value: 'auto' | 'en' | 'hi', disabled = false) => renderToStaticMarkup(<LanguageSelect value={value} onChange={noop} disabled={disabled} />)

  it('offers the three choices with the current one selected, labelled for assistive technology', () => {
    const html = select('hi')
    for (const label of ['Auto-detect', 'English', 'Hindi']) expect(html).toContain(`>${label}</option>`)
    expect(html).not.toContain('Punjabi')
    expect(html).not.toContain('value="pa"')
    expect(html).toMatch(/<option value="hi" selected/)
    expect(html).toMatch(/<label for="([^"]+)-language"[^>]*>[\s\S]*Spoken language/)
    expect(html).toMatch(/<select id="([^"]+)-language"[^>]*aria-describedby="\1-status"/)
  })

  it('says what is available for each choice and never promises Hindi scam detection', () => {
    expect(text(select('en'))).toContain('Scam detection is available for English.')
    const plain = text(select('hi'))
    expect(plain).toContain('Scam detection runs on an English machine translation, which has not been validated')
    expect(plain).toContain('far less often in Hindi than in English')
  })

  it('is disabled while a recording is in progress', () => {
    expect(select('auto', true)).toMatch(/<select[^>]*\sdisabled=""/)
    expect(select('auto')).not.toMatch(/<select[^>]*\sdisabled=""/)
  })

  it('is part of the upload and record workflow, and the choice shown is the one passed in', () => {
    const html = renderToStaticMarkup(<InputStage limits={null} onFile={noop} language="hi" onLanguageChange={noop} />)
    expect(html).toMatch(/<option value="hi" selected/)
    expect(html.indexOf('Spoken language')).toBeLessThan(html.indexOf('Upload audio'))
    expect(html).toContain('Record audio')
  })

  it('appears on the home page', () => {
    const html = renderToStaticMarkup(<MemoryRouter><App /></MemoryRouter>)
    expect(html).toContain('Spoken language')
    expect(html).toMatch(/<option value="auto" selected/)
  })
})

describe('Scenario Lab language status', () => {
  it('says which languages have samples, lists only supported languages, and claims no test results', () => {
    const plain = text(renderToStaticMarkup(<LabLanguageStatus />))
    expect(plain).toContain('English Six samples.')
    expect(plain).toMatch(/Hindi Two samples\./)
    expect(plain).not.toContain('Punjabi')
    expect(plain).toMatch(/Not validated/)
    expect(plain).not.toMatch(/\d+%|accura|works well|tested in Hindi/i)
  })

  it('shows the sample language, set rather than guessed, for every scenario', () => {
    for (const s of SCENARIOS) {
      const name = s.language === 'hi' ? 'Hindi' : 'English'
      const html = renderToStaticMarkup(<ScenarioPicker selectedId={s.id} onSelect={noop} onAnalyze={noop} busy={false} blockedReason={null} />)
      expect(text(html)).toContain(`Language ${name} (set for this sample, not guessed)`)
    }
  })

  it('says the language on the results banner', () => {
    const html = renderToStaticMarkup(<MemoryRouter><LabBanner scenario={SCENARIOS[1]} onBack={noop} /></MemoryRouter>)
    expect(text(html)).toContain('Language: English, set for this sample.')
  })

  it('the Lab page shows the language status', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/lab']}><App /></MemoryRouter>)
    expect(html).toContain('Language support in this Lab')
  })
})
