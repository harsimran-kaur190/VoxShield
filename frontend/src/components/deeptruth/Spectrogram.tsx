import { useEffect, useRef } from 'react'

import type { SpectrogramData } from '../../lib/deeptruth'

/**
 * Draws the server's coarse spectrogram (time across, frequency up, loudness as colour) and shades the windows the
 * voice detector flagged, so a reader can see where in the clip the suspicious segments fall.
 */
export function Spectrogram({ data, className = '' }: { data: SpectrogramData; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rows = data.values.length // time steps
    const bins = data.bins
    canvas.width = rows
    canvas.height = bins
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const image = ctx.createImageData(rows, bins)
    for (let t = 0; t < rows; t++) {
      const column = data.values[t]
      for (let f = 0; f < bins; f++) {
        const v = column[f] ?? 0
        const i = ((bins - 1 - f) * rows + t) * 4 // low frequencies at the bottom
        // Dark navy to pale amber: quiet to loud. Plain lerp, so no library and no surprises in dark mode.
        image.data[i] = 15 + (v / 255) * (251 - 15)
        image.data[i + 1] = 23 + (v / 255) * (191 - 23)
        image.data[i + 2] = 42 + (v / 255) * (36 - 42)
        image.data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
  }, [data])

  const total = data.duration_seconds || 1
  return (
    <figure className={`relative overflow-hidden rounded-xl border border-line ${className}`}>
      <canvas ref={canvasRef} className="block h-40 w-full" style={{ imageRendering: 'pixelated' }} aria-label="Spectrogram of the audio" />
      {data.flagged.map((w) => (
        <span
          key={`${w.start_seconds}-${w.end_seconds}`}
          title={`Flagged ${w.start_seconds.toFixed(1)}–${w.end_seconds.toFixed(1)} s, score ${w.score.toFixed(2)}`}
          className="absolute inset-y-0 border-x-2 border-critical/80 bg-critical/25"
          style={{ left: `${(w.start_seconds / total) * 100}%`, width: `${((w.end_seconds - w.start_seconds) / total) * 100}%` }}
        />
      ))}
      <figcaption className="flex justify-between px-2 py-1 font-mono text-[11px] text-ink-3">
        <span>0 s</span>
        <span>0–{(data.freq_max_hz / 1000).toFixed(0)} kHz · red = flagged window</span>
        <span>{total.toFixed(1)} s</span>
      </figcaption>
    </figure>
  )
}
