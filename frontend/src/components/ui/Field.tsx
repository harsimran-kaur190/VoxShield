import { AlertCircle } from 'lucide-react'
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

import { inputClass } from './styles'

interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** Receives the ids to put on the control so the label, hint and error are announced with it. */
  children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode
}

/** A labelled form control with optional hint and error text, wired up for screen readers. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId()
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="mt-1.5">{children({ id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}</div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 inline-flex items-start gap-1.5 text-xs text-amber">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`.trim()} {...rest} />
}

export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${inputClass} pr-8 ${className}`.trim()} {...rest} />
}
