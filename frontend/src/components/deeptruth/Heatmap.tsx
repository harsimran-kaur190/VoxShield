import { useEffect, useRef, useState } from 'react'

import type { FaceBox, HeatmapData } from '../../lib/deeptruth'

/**
 * Draws a forensic heatmap (ELA or noise) over the uploaded image, with the detected face boxes outlined. The
 * slider fades between the photo and the map so a reader can see which part of the picture a hot spot belongs to.
 */
export function Heatmap({ data, imageUrl, label }: { data: HeatmapData; imageUrl: string | null; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [opacity, setOpacity] = useState(imageUrl ? 0.7 : 1)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rows = data.values.length
    const cols = data.values[0]?.length ?? 0
    if (!rows || !cols) return
    canvas.width = cols
    canvas.height = rows
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const image = ctx.createImageData(cols, rows)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = (data.values[y][x] ?? 0) / 255
        const i = (y * cols + x) * 4
        // Dark blue through magenta to yellow ("inferno-like"), so hot spots stand out on any photo.
        image.data[i] = Math.min(255, v < 0.5 ? v * 2 * 200 : 200 + (v - 0.5) * 2 * 55)
        image.data[i + 1] = v < 0.5 ? v * 2 * 30 : 30 + (v - 0.5) * 2 * 200
        image.data[i + 2] = v < 0.5 ? 60 + v * 2 * 100 : 160 - (v - 0.5) * 2 * 160
        image.data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
  }, [data])

  return (
    <figure>
      <div className="relative overflow-hidden rounded-xl border border-line bg-paper-2">
        {imageUrl && <img src={imageUrl} alt="" className="block w-full" />}
        <canvas
          ref={canvasRef}
          aria-label={`${label} heatmap`}
          className={`${imageUrl ? 'absolute inset-0 h-full w-full' : 'block w-full'}`}
          style={{ imageRendering: 'pixelated', opacity, mixBlendMode: imageUrl ? 'normal' : undefined }}
        />
        {data.faces.map((f: FaceBox, i) => (
          <span key={i} className="pointer-events-none absolute border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }} aria-label={`Face ${i + 1}`} />
        ))}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
        <span>{data.note}</span>
        {imageUrl && (
          <label className="inline-flex items-center gap-2">
            Overlay
            <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-24 accent-accent" />
          </label>
        )}
      </figcaption>
      <dl className="mt-1 flex flex-wrap gap-x-4 font-mono text-[11px] text-ink-3">
        {Object.entries(data.stats).map(([k, v]) => (
          <div key={k}>
            <dt className="inline">{k}: </dt>
            <dd className="inline text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
    </figure>
  )
}
