import summary from '../../data/imageEval.json'

/**
 * The image detector's measured accuracy, read from frontend/src/data/imageEval.json, which backend/eval/summarize.py
 * writes from the evaluation runs. Nothing here is typed by hand: every number and the "where it fails" paragraph come
 * from the held-out test half of the labelled set.
 */

export interface Run {
  name: string
  transform: string | null
  n: number
  accuracy: number | null
  precision_fake: number | null
  recall_fake: number | null
  specificity_real: number | null
  auc: number | null
  confusion: { tp: number; fp: number; tn: number; fn: number }
  verdicts: Record<string, Record<string, number>>
}

export interface ImageEvalSummary {
  generated_at: string
  detector: string[]
  dataset: { total: number; calibration: number; test: number; test_real: number; test_fake: number; sources: { key: string; name: string; dataset: string; licence: string }[] }
  main: Run
  baseline: Run | null
  by_source: Record<string, { name: string; n: number; accuracy: number | null; recall_fake: number | null; specificity_real: number | null; auc: number | null }>
  by_generator: Record<string, { name: string; n: number; detected: number }>
  robustness: Run[]
  where_it_fails: string
}

// The JSON is typed explicitly: an empty robustness list would otherwise be inferred as never[].
const imageEval = summary as ImageEvalSummary

const pct = (x: number | null) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`)
const TRANSFORMS: Record<string, string> = { jpeg50: 'JPEG recompressed at quality 50', half: 'Downscaled to 50%', screenshot: 'Screenshot-style re-save (PNG, 1280 px wide)' }

export function ImageEvaluation() {
  const { dataset, main, baseline, by_source, by_generator, robustness, where_it_fails, detector, generated_at } = imageEval
  const generators = Object.entries(by_generator).filter(([, g]) => g.n >= 2)
  return (
    <div className="space-y-6 text-ink-2">
      <p>
        Measured by <code className="font-mono text-xs">backend/eval/run_image_eval.py</code> on {generated_at}, through the same code path the website and the browser extension use. Detector: <span className="font-medium text-ink">{detector.join(', ')}</span>.
      </p>

      <div>
        <h3 className="font-semibold text-ink">Dataset and split</h3>
        <p className="mt-1">
          {dataset.total} labelled images, half real photos and half AI-generated, from three public sets. {dataset.calibration} were used to fit the score calibration and {dataset.test} were held out ({dataset.test_real} real, {dataset.test_fake} fake). Every number below is from the held-out half, which was never used for tuning.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {dataset.sources.map((s) => (
            <li key={s.key}>
              {s.name}: <code className="font-mono text-xs">{s.dataset}</code> ({s.licence})
            </li>
          ))}
        </ul>
      </div>

      <MetricsTable main={main} baseline={baseline} />

      <div>
        <h3 className="font-semibold text-ink">By source</h3>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="border-b border-line-strong text-ink-3">
            <tr>
              <th scope="col" className="py-2 pr-4 font-normal">Images</th>
              <th scope="col" className="py-2 pr-4 font-normal">n</th>
              <th scope="col" className="py-2 pr-4 font-normal">Accuracy</th>
              <th scope="col" className="py-2 pr-4 font-normal">Fakes caught</th>
              <th scope="col" className="py-2 pr-4 font-normal">Real kept real</th>
              <th scope="col" className="py-2 font-normal">AUC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono tabular-nums">
            {Object.entries(by_source).map(([key, s]) => (
              <tr key={key}>
                <th scope="row" className="py-2 pr-4 text-left font-sans font-medium">{s.name}</th>
                <td className="py-2 pr-4">{s.n}</td>
                <td className="py-2 pr-4">{pct(s.accuracy)}</td>
                <td className="py-2 pr-4">{pct(s.recall_fake)}</td>
                <td className="py-2 pr-4">{pct(s.specificity_real)}</td>
                <td className="py-2">{s.auc ?? 'n/a'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm text-ink-3">
          Fakes caught per generator (test half): {generators.map(([, g]) => `${g.name} ${g.detected}/${g.n}`).join(' · ')}.
        </p>
      </div>

      {robustness.length > 0 && (
        <div>
          <h3 className="font-semibold text-ink">Robustness</h3>
          <p className="mt-1 text-sm">The same test images after the changes media goes through on its way around the web.</p>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="border-b border-line-strong text-ink-3">
              <tr>
                <th scope="col" className="py-2 pr-4 font-normal">Condition</th>
                <th scope="col" className="py-2 pr-4 font-normal">Accuracy</th>
                <th scope="col" className="py-2 pr-4 font-normal">Fakes caught</th>
                <th scope="col" className="py-2 pr-4 font-normal">Real kept real</th>
                <th scope="col" className="py-2 font-normal">AUC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line font-mono tabular-nums">
              <RobustnessRow label="Original files" run={main} />
              {robustness.map((r) => (
                <RobustnessRow key={r.name} label={TRANSFORMS[r.transform ?? ''] ?? r.transform ?? r.name} run={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h3 className="font-semibold text-ink">Where it fails</h3>
        <p className="mt-1 border-l-2 border-amber-light pl-4">{where_it_fails}</p>
      </div>
    </div>
  )
}

function MetricsTable({ main, baseline }: { main: Run; baseline: Run | null }) {
  const rows: [string, (r: Run) => string][] = [
    ['Accuracy', (r) => pct(r.accuracy)],
    ['Precision (fake)', (r) => pct(r.precision_fake)],
    ['Recall (fake)', (r) => pct(r.recall_fake)],
    ['Specificity (real)', (r) => pct(r.specificity_real)],
    ['AUC', (r) => String(r.auc ?? 'n/a')],
    ['Confusion (TP / FP / TN / FN)', (r) => `${r.confusion.tp} / ${r.confusion.fp} / ${r.confusion.tn} / ${r.confusion.fn}`],
  ]
  return (
    <div>
      <h3 className="font-semibold text-ink">Held-out test set ({main.n} images)</h3>
      <table className="mt-2 w-full text-left text-sm">
        <thead className="border-b border-line-strong text-ink-3">
          <tr>
            <th scope="col" className="py-2 pr-4 font-normal">Metric</th>
            <th scope="col" className="py-2 pr-4 font-normal">Current detector</th>
            {baseline && <th scope="col" className="py-2 font-normal">Before the fix (UnivFD alone)</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line font-mono tabular-nums">
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" className="py-2 pr-4 text-left font-sans font-medium">{label}</th>
              <td className="py-2 pr-4">{value(main)}</td>
              {baseline && <td className="py-2 text-ink-3">{value(baseline)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-ink-3">
        “Fake” is the positive class; a verdict counts as fake when the calibrated score is at or above 0.5. Scores between 0.4 and 0.6 are shown to users as Inconclusive: {Object.entries(main.verdicts).map(([label, v]) => `${label}: ${Object.entries(v).map(([verdict, n]) => `${n} ${verdict}`).join(', ')}`).join('; ')}.
      </p>
    </div>
  )
}

function RobustnessRow({ label, run }: { label: string; run: Run }) {
  return (
    <tr>
      <th scope="row" className="py-2 pr-4 text-left font-sans font-medium">{label}</th>
      <td className="py-2 pr-4">{pct(run.accuracy)}</td>
      <td className="py-2 pr-4">{pct(run.recall_fake)}</td>
      <td className="py-2 pr-4">{pct(run.specificity_real)}</td>
      <td className="py-2">{run.auc ?? 'n/a'}</td>
    </tr>
  )
}
