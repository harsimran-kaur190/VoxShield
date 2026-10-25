export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <path d="M16 2.5 4.5 7v8.2c0 7 4.6 12.2 11.5 14.3 6.9-2.1 11.5-7.3 11.5-14.3V7L16 2.5Z" fill="var(--color-ink)" />
        {[9.5, 12.8, 16, 19.2, 22.5].map((x, i) => {
          const h = [5, 10, 14, 8, 4][i]
          return <rect key={x} x={x - 0.8} y={15.5 - h / 2} width="1.6" height={h} rx="0.8" fill={i === 2 ? 'var(--color-accent-light)' : 'var(--color-paper)'} />
        })}
      </svg>
      <span className="font-display text-xl font-semibold tracking-tight">VoxShield</span>
    </span>
  )
}
