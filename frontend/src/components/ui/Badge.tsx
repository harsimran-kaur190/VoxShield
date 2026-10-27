import type { LucideIcon } from 'lucide-react'
import { FlaskConical } from 'lucide-react'
import type { ReactNode } from 'react'

import { badgeClass, type BadgeTone } from './styles'

export function Badge({ tone, icon: Icon, className, children }: { tone?: BadgeTone; icon?: LucideIcon; className?: string; children: ReactNode }) {
  return (
    <span className={badgeClass(tone, className)}>
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  )
}

/** Marks demo or mock content. Use it on anything that is not the output of a real analysis. */
export function SimulatedBadge({ children = 'Simulated' }: { children?: ReactNode }) {
  return (
    <Badge tone="simulated" icon={FlaskConical}>
      {children}
    </Badge>
  )
}
