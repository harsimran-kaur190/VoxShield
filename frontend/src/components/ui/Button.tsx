import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

import { buttonClass, type ButtonSize, type ButtonVariant } from './styles'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  /** Shows a spinner in place of the icon and blocks clicks, while keeping the label so the width does not jump. */
  loading?: boolean
}

export function Button({ variant, size, icon: Icon, loading = false, className, children, type = 'button', disabled, ...rest }: Props) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass({ variant, size, className })} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </button>
  )
}
