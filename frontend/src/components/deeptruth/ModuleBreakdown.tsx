import { MODALITY_LABELS, weightShares, type Modality, type ModuleResult } from '../../lib/deeptruth'
import { Badge } from '../ui'

const pct = (v: number) => `${Math.round(v * 100)}%`

/** One row per module: what it scored, how much the fusion trusted it, and what it ran. */
export function ModuleBreakdown({ modules, decidedBy, onJump }: { modules: ModuleResult[]; decidedBy?: Modality | null; onJump: (modality: string) => void }) {
  const shares = weightShares(modules)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th scope="col" className="py-2 pr-4 font-medium">
              Module
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Score
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Reliability
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Share of average
            </th>
            <th scope="col" className="py-2 font-medium">
              Role
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {modules.map((m) => (
            <tr key={m.modality}>
              <td className="py-3 pr-4 align-top">
                <button type="button" onClick={() => onJump(m.modality)} className="font-medium text-ink underline-offset-4 hover:underline">
                  {MODALITY_LABELS[m.modality]}
                </button>
                {m.models.length > 0 && <span className="block max-w-[16rem] truncate font-mono text-[11px] text-ink-3">{m.models.map((n) => n.split('/').pop()).join(', ')}</span>}
              </td>
              <td className="py-3 pr-4 align-top">
                <Bar value={m.score} tone={m.status === 'ok' ? (m.score >= 0.6 ? 'critical' : m.score <= 0.4 ? 'ok' : 'neutral') : 'muted'} label={m.status === 'ok' ? pct(m.score) : 'n/a'} />
              </td>
              <td className="py-3 pr-4 align-top">
                <Bar value={m.reliability} tone="accent" label={pct(m.reliability)} />
              </td>
              <td className="py-3 pr-4 align-top font-mono text-xs text-ink-2">{pct(shares.get(m.modality) ?? 0)}</td>
              <td className="py-3 align-top">
                <div className="flex flex-wrap gap-1">
                  {m.status !== 'ok' ? (
                    <Badge tone="warning">Unavailable</Badge>
                  ) : m.modality === decidedBy ? (
                    <Badge tone="critical">Decided the verdict</Badge>
                  ) : (
                    <Badge tone="neutral">Ran</Badge>
                  )}
                  {m.basis && <Badge tone={m.basis === 'measured' ? 'info' : 'simulated'}>{m.basis === 'measured' ? 'Measured' : 'Heuristic'}</Badge>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const TONES = { ok: 'bg-ok', critical: 'bg-critical', neutral: 'bg-ink-3', accent: 'bg-accent', muted: 'bg-line-strong' }

function Bar({ value, tone, label }: { value: number; tone: keyof typeof TONES; label: string }) {
  return (
    <div className="flex min-w-[8rem] items-center gap-2" title={label}>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-2">
        <span className={`block h-full rounded-full ${TONES[tone]}`} style={{ width: `${Math.max(value * 100, 2)}%` }} />
      </span>
      <span className="w-10 text-right font-mono text-xs text-ink-2">{label}</span>
    </div>
  )
}

/** The three fusion rules, in the order they are applied, in words a judge can follow. */
export function FusionRules() {
  return (
    <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-ink-3">
      <li>
        <span className="font-medium text-ink-2">One strong signal decides.</span> A measured detector scoring 80% or more with reliability of 60% or more makes the file &quot;Likely manipulated&quot;: one faked part (a cloned voice, a generated frame) is enough, and a &quot;looks real&quot; reading elsewhere does not cancel it.
      </li>
      <li>
        <span className="font-medium text-ink-2">Conflicts are not averaged away.</span> If trusted modules point in opposite directions and none is strong, the verdict is &quot;Mixed signals&quot;.
      </li>
      <li>
        <span className="font-medium text-ink-2">Otherwise, a weighted average.</span> Each score counts in proportion to its reliability (the share column). Below 40% reads authentic, above 60% manipulated, in between inconclusive.
      </li>
    </ol>
  )
}
