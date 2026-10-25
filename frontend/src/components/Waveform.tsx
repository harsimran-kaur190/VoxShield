/** Draws normalized peak values as bars. Pass real peaks only; there is no placeholder pattern. */
export function Waveform({ peaks, className = '' }: { peaks: number[]; className?: string }) {
  return (
    <svg viewBox={`0 0 ${peaks.length * 4} 100`} preserveAspectRatio="none" className={className} aria-hidden>
      {peaks.map((peak, index) => {
        const height = Math.max(3, peak * 94)
        return <rect key={index} x={index * 4 + 0.5} y={50 - height / 2} width={3} height={height} fill="currentColor" />
      })}
    </svg>
  )
}
