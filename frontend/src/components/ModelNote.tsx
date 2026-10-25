import type { ModelInfo } from '../lib/types'

export function ModelNote({ model }: { model: ModelInfo | null }) {
  if (!model) return null
  return (
    <p className="mt-3 text-sm text-ink-2">
      <span className="font-medium text-ink">Method:</span> {model.method}.{' '}
      <span className="font-medium text-ink">Model:</span> <code className="break-all font-mono text-xs">{model.name}</code>
      {model.revision && <span className="font-mono text-xs"> @ {model.revision.slice(0, 8)}</span>}
    </p>
  )
}

export function Limitations({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}
