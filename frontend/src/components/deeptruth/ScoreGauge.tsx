import { useId } from 'react'

import { bandFor, type Verdict } from '../../lib/deeptruth'

const R = 80
const CX = 100
const CY = 96
const STROKE = 10

/** Point on the arc for a 0-1 value: 0 on the left, 1 on the right. */
function at(value: number, radius = R) {
  const angle = Math.PI * (1 - value)
  return { x: CX + radius * Math.cos(angle), y: CY - radius * Math.sin(angle) }
}

function arc(from: number, to: number) {
  const a = at(from)
  const b = at(to)
  return `M ${a.x} ${a.y} A ${R} ${R} 0 0 1 ${b.x} ${b.y}`
}

/**
 * Half-circle gauge for the fused score. The three bands are the verdict bands (authentic to 0.4, inconclusive to 0.6,
 * manipulated above), coloured with the app's status tokens and always named in text next to the number, so colour is
 * never the only carrier. With "Mixed signals" the needle still shows the average but the label says not to read it.
 */
export function ScoreGauge({ likelihood, verdict }: { likelihood: number; verdict: Verdict }) {
  const id = useId()
  const band = bandFor(likelihood)
  const needle = at(likelihood, R - STROKE)
  const mixed = verdict === 'Mixed signals'
  const percent = Math.round(likelihood * 100)
  return (
    <figure className="flex flex-col items-center" aria-labelledby={id}>
      <svg viewBox="0 0 200 110" className="w-full max-w-[18rem]" role="img" aria-labelledby={id}>
        {/* One string child: React 19 renders a <title> with several children as empty. */}
        <title id={id}>{`Manipulation likelihood ${percent} percent, ${band.label.toLowerCase()}`}</title>
        {/* Bands, with a 2px surface gap between them. */}
        <path d={arc(0, 0.39)} fill="none" stroke="var(--color-ok)" strokeWidth={STROKE} strokeLinecap="butt" opacity={mixed ? 0.35 : 1} />
        <path d={arc(0.41, 0.59)} fill="none" stroke="var(--color-line-strong)" strokeWidth={STROKE} opacity={mixed ? 0.35 : 1} />
        <path d={arc(0.61, 1)} fill="none" stroke="var(--color-critical)" strokeWidth={STROKE} opacity={mixed ? 0.35 : 1} />
        {/* Needle: a thin line from the hub to the inner edge of the arc. */}
        <line x1={CX} y1={CY} x2={needle.x} y2={needle.y} stroke="var(--color-ink)" strokeWidth={2} strokeLinecap="round" strokeDasharray={mixed ? '3 3' : undefined} />
        <circle cx={CX} cy={CY} r={4} fill="var(--color-ink)" />
        <text x={CX - R} y={CY + 14} textAnchor="middle" className="fill-ink-3 font-mono text-[9px]">
          0
        </text>
        <text x={CX + R} y={CY + 14} textAnchor="middle" className="fill-ink-3 font-mono text-[9px]">
          100
        </text>
      </svg>
      <figcaption className="-mt-2 text-center">
        <span className="block font-display text-4xl font-medium text-ink">{percent}%</span>
        <span className="block text-sm text-ink-2">Manipulation likelihood</span>
        <span className="mt-1 block text-xs text-ink-3">{mixed ? 'Average shown for reference only: the modules disagree.' : band.label}</span>
      </figcaption>
    </figure>
  )
}
