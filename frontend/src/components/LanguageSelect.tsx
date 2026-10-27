import { Languages } from 'lucide-react'
import { useId } from 'react'

import { choiceStatus, isLanguageChoice, LANGUAGE_OPTIONS, VOICE_LANGUAGE_NOTE, type LanguageChoice } from '../lib/languages'

interface Props {
  value: LanguageChoice
  onChange: (value: LanguageChoice) => void
  disabled?: boolean
}

/** Which language is spoken. The status line says, before anything runs, what will and will not be available. */
export function LanguageSelect({ value, onChange, disabled = false }: Props) {
  const id = useId()
  return (
    <div className="border-b border-stage-line px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={`${id}-language`} className="inline-flex items-center gap-2 text-sm text-stage-muted">
          <Languages className="size-4" aria-hidden />
          Spoken language
        </label>
        <select
          id={`${id}-language`}
          value={value}
          disabled={disabled}
          aria-describedby={`${id}-status`}
          onChange={(event) => isLanguageChoice(event.target.value) && onChange(event.target.value)}
          className="min-h-9 rounded-xl bg-stage-2 px-3 py-1.5 text-sm text-stage-ink ring-1 ring-stage-line focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 pointer-coarse:min-h-11"
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <p id={`${id}-status`} className="mt-2 text-xs text-stage-muted">
        {choiceStatus(value)} {VOICE_LANGUAGE_NOTE}
      </p>
    </div>
  )
}
