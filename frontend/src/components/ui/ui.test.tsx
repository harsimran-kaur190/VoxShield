import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ErrorNotice } from '../ErrorNotice'
import { Badge, Button, EmptyState, ErrorState, Field, LoadingState, SimulatedBadge, TextInput } from '.'
import { badgeClass, buttonClass } from './styles'

describe('Button', () => {
  it('defaults to a non-submitting primary button', () => {
    const html = renderToStaticMarkup(<Button>Analyze</Button>)
    expect(html).toContain('type="button"')
    expect(html).toContain('bg-accent')
    expect(html).toContain('>Analyze</button>')
  })

  it('is disabled and marked busy while loading, keeping its label', () => {
    const html = renderToStaticMarkup(<Button loading>Saving</Button>)
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Saving')
  })

  it('keeps a 44px touch target at every size', () => {
    for (const size of ['sm', 'md'] as const) expect(buttonClass({ size })).toContain('pointer-coarse:h-11')
    expect(buttonClass({ size: 'lg' })).toContain('h-12')
  })
})

describe('red is reserved for high-risk states', () => {
  it('uses the critical color only for the critical tone and variant', () => {
    expect(badgeClass('critical')).toContain('text-critical')
    expect(buttonClass({ variant: 'critical' })).toContain('bg-critical')
    for (const tone of ['neutral', 'info', 'success', 'warning', 'simulated'] as const) expect(badgeClass(tone)).not.toContain('critical')
  })

  it('shows operational errors in amber, as an alert, with retry and dismiss', () => {
    const html = renderToStaticMarkup(<ErrorNotice title="The analysis couldn't finish" message="Timed out" onRetry={vi.fn()} onDismiss={vi.fn()} dismissLabel="Dismiss" />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('text-amber')
    expect(html).not.toContain('critical')
    expect(html).toContain('Try again')
    expect(html).toContain('Dismiss')
  })
})

describe('Badge', () => {
  it('labels simulated content in words, not only by style', () => {
    expect(renderToStaticMarkup(<SimulatedBadge />)).toContain('Simulated')
    expect(renderToStaticMarkup(<SimulatedBadge>Simulated call</SimulatedBadge>)).toContain('Simulated call')
  })

  it('renders its text', () => {
    expect(renderToStaticMarkup(<Badge tone="info">English</Badge>)).toContain('English')
  })
})

describe('Field', () => {
  it('links the label, hint and error to the control', () => {
    const html = renderToStaticMarkup(<Field label="Case name" hint="Shown on the report" error="Required">{(props) => <TextInput {...props} />}</Field>)
    const id = html.match(/<label for="([^"]+)"/)?.[1]
    expect(id).toBeTruthy()
    expect(html).toContain(`id="${id}"`)
    expect(html).toContain(`aria-describedby="${id}-hint ${id}-error"`)
    expect(html).toContain('aria-invalid="true"')
  })

  it('omits aria-describedby when there is nothing to describe', () => {
    const html = renderToStaticMarkup(<Field label="Name">{(props) => <TextInput {...props} />}</Field>)
    expect(html).not.toContain('aria-describedby')
    expect(html).not.toContain('aria-invalid=')
  })
})

describe('feedback states', () => {
  it('announces loading', () => {
    const html = renderToStaticMarkup(<LoadingState label="Loading report" />)
    expect(html).toContain('role="status"')
    expect(html).toContain('Loading report')
  })

  it('renders an error without actions when none are given', () => {
    const html = renderToStaticMarkup(<ErrorState title="Server offline" message="Start the backend." />)
    expect(html).toContain('Server offline')
    expect(html).not.toContain('<button')
  })

  it('renders an empty state with its action', () => {
    const html = renderToStaticMarkup(<EmptyState title="No saved reports" action={<Button>Analyze a call</Button>} />)
    expect(html).toContain('No saved reports')
    expect(html).toContain('Analyze a call')
  })
})
