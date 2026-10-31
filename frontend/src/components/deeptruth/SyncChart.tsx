import { useId, useState, type PointerEvent } from 'react'

import type { SyncSeries } from '../../lib/deeptruth'
import { endLabels, SYNC_CHART_PAD } from '../../lib/syncChart'

const W = 640
const H = 160
const PAD = SYNC_CHART_PAD
// Two categorical slots, checked with the dataviz palette validator against the light surface (CVD ΔE 32.9).
const MOUTH = 'var(--color-accent)'
const AUDIO = '#d97706'

/**
 * Mouth openness and audio energy over time, on one 0-1 scale (each line divided by its own maximum, which the caption
 * says, so no second axis is needed). Direct labels at the line ends and a legend carry identity, not colour alone.
 * Hovering shows both values at that instant.
 */
export function SyncChart({ series, className = '' }: { series: SyncSeries; className?: string }) {
  const titleId = useId()
  const [hover, setHover] = useState<number | null>(null)
  const { times, mouth, audio } = series
  const t0 = times[0] ?? 0
  const t1 = times.at(-1) ?? 1
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - v) * (H - PAD.top - PAD.bottom)

  // A gap in the mouth line where no face was found, rather than a line drawn through missing data.
  const mouthPath = mouth.reduce((d, v, i) => (v === null ? d : `${d}${i > 0 && mouth[i - 1] !== null ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`), '')
  const audioPath = audio.map((v, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const lastMouth = [...mouth].reverse().find((v) => v !== null) ?? 0
  const labels = endLabels(y(lastMouth) + 4, y(audio.at(-1) ?? 0) + 4)

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - box.left) / box.width) * W
    const t = t0 + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (t1 - t0)
    let best = 0
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i
    setHover(best)
  }

  return (
    <figure className={className}>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" role="img" aria-labelledby={titleId} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <title id={titleId}>{`Mouth openness and audio energy over ${(t1 - t0).toFixed(1)} seconds`}</title>
          {[0, 0.5, 1].map((v) => (
            <line key={v} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
          ))}
          <path d={audioPath} fill="none" stroke={AUDIO} strokeWidth={2} strokeLinejoin="round" />
          <path d={mouthPath} fill="none" stroke={MOUTH} strokeWidth={2} strokeLinejoin="round" />
          <text x={W - PAD.right + 6} y={labels.mouth} className="fill-ink-2 text-[11px]">
            Mouth
          </text>
          <text x={W - PAD.right + 6} y={labels.audio} className="fill-ink-2 text-[11px]">
            Audio
          </text>
          <text x={PAD.left} y={H - 6} className="fill-ink-3 font-mono text-[10px]">
            {t0.toFixed(1)} s
          </text>
          <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-ink-3 font-mono text-[10px]">
            {t1.toFixed(1)} s
          </text>
          {hover !== null && (
            <g>
              <line x1={x(times[hover])} x2={x(times[hover])} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--color-ink-3)" strokeWidth={1} strokeDasharray="2 3" />
              {mouth[hover] !== null && <circle cx={x(times[hover])} cy={y(mouth[hover] ?? 0)} r={4} fill={MOUTH} stroke="var(--color-card)" strokeWidth={2} />}
              <circle cx={x(times[hover])} cy={y(audio[hover])} r={4} fill={AUDIO} stroke="var(--color-card)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-0 rounded-md border border-line bg-card px-2 py-1 font-mono text-[11px] text-ink-2 shadow-card" style={{ left: `${Math.min((x(times[hover]) / W) * 100, 75)}%` }}>
            {times[hover].toFixed(1)} s · mouth {mouth[hover] === null ? 'no face' : mouth[hover]?.toFixed(2)} · audio {audio[hover].toFixed(2)}
          </div>
        )}
      </div>
      <figcaption className="mt-1 flex flex-wrap gap-4 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: MOUTH }} aria-hidden /> Mouth openness
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: AUDIO }} aria-hidden /> Audio energy (RMS)
        </span>
        <span>Gaps in the mouth line: no face found.</span>
      </figcaption>
    </figure>
  )
}

