import type { HTMLAttributes, ReactNode } from 'react'

import { cardClass, type CardTone } from './styles'

interface Props extends HTMLAttributes<HTMLElement> {
  tone?: CardTone
  padded?: boolean
  as?: 'div' | 'section' | 'article'
}

export function Card({ tone, padded, as: Tag = 'div', className, ...rest }: Props) {
  return <Tag className={cardClass({ tone, padded, className })} {...rest} />
}

/** Title row for a card: a heading, optional supporting line, and optional actions on the right. */
export function CardHeader({ title, description, actions, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
