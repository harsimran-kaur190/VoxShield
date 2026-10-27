/**
 * Class builders for the shared UI primitives. They live apart from the components so that links, native
 * elements and existing markup can take the same look without being wrapped (e.g. a router <Link> styled as a button).
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'critical'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white shadow-card hover:bg-accent-deep active:bg-accent-deep',
  secondary: 'border border-line-strong bg-card text-ink shadow-card hover:bg-paper-2 active:bg-line',
  ghost: 'text-ink-2 hover:bg-paper-2 hover:text-ink active:bg-line',
  // Only for actions taken in response to a genuinely high-risk finding.
  critical: 'bg-critical text-white shadow-card hover:bg-[#b91c1c] active:bg-[#b91c1c]',
}

// Every size keeps at least a 44px target on touch screens.
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm pointer-coarse:h-11',
  md: 'h-10 px-4 text-sm pointer-coarse:h-11',
  lg: 'h-12 px-6 text-base',
}

export function buttonClass({ variant = 'primary', size = 'md', className = '' }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`.trim()
}

export type CardTone = 'default' | 'muted'

export function cardClass({ tone = 'default', padded = true, className = '' }: { tone?: CardTone; padded?: boolean; className?: string } = {}) {
  const surface = tone === 'muted' ? 'bg-paper-2' : 'bg-card shadow-card'
  return `rounded-card border border-line ${surface} ${padded ? 'p-5 sm:p-6' : ''} ${className}`.trim()
}

/**
 * Badge tones. "critical" is for high-risk states only. "simulated" marks demo or mock content so it is never
 * mistaken for a real analysis result.
 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'critical' | 'simulated'

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-paper-2 text-ink-2 ring-1 ring-inset ring-line',
  info: 'bg-accent-tint/60 text-accent-deep ring-1 ring-inset ring-accent-tint',
  success: 'bg-ok-tint text-ok ring-1 ring-inset ring-ok/20',
  warning: 'bg-amber-tint/70 text-amber ring-1 ring-inset ring-amber-light/40',
  critical: 'bg-critical-tint text-critical ring-1 ring-inset ring-critical/25',
  simulated: 'border border-dashed border-ink-3 bg-card text-ink-2',
}

export function badgeClass(tone: BadgeTone = 'neutral', className = '') {
  return `inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_TONES[tone]} ${className}`.trim()
}

export const inputClass =
  'block w-full min-h-10 rounded-control border border-line-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-3 shadow-card transition-colors hover:border-ink-3 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:bg-paper-2 disabled:opacity-60 aria-invalid:border-amber pointer-coarse:min-h-11'
