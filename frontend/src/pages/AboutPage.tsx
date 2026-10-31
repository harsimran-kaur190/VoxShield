import { useEffect, useState } from 'react'

import { ImageEvaluation } from '../components/evaluation/ImageEvaluation'
import { getModels } from '../lib/api'
import type { ModelsResponse } from '../lib/types'

const VOICE_MODEL_URL = 'https://huggingface.co/nii-yamagishilab/mms-300m-anti-deepfake'

/** Reported by the model's authors on its model page. Not measured by VoxShield. */
const reported = [
  ['ROC AUC', '0.996'],
  ['Accuracy', '0.973'],
  ['F1 score', '0.979'],
  ['Equal error rate', '0.029'],
] as const

const limitations = [
  'The voice model (NII AntiDeepfake, MMS-300M) is licensed for non-commercial use only. On VoxShield’s read-speech benchmark it caught most English neural voices but about six in ten Hindi ones, and over phone-quality audio it missed most neural voices. A “real” lean is not evidence that a voice is human.',
  'Over phone-quality audio a few real voices (3 to 8% in the benchmark) were called “fake”, so a “fake” label alone is not proof either.',
  'VoxShield has not evaluated any model on labeled, representative data. The only measurement is a small comparison of the scam-intent detectors on synthetic, developer-written transcripts.',
  'Voice scores are normalized two-way scores from raw logits, not calibrated probabilities. They change with window length and position, and the lean thresholds are fixed heuristics.',
  'Transcription errors can change meaning. The scam-intent detectors read English and can miss scams or flag harmless calls. The language model flags whole sentences, still mistakes negated advice and quoted scams for requests, and abstains (inconclusive) on about one example in five.',
  'Languages: English and Hindi can be selected. Hindi is transcribed in its own script, and scam detection for it runs on the speech-to-text model’s English translation of the audio, plus a short list of Hindi keyword rules on the original transcript; every translated finding shows the original sentence beside it. None of this has been validated: transcription and translation accuracy in Hindi has not been measured, and a mistranslation can add or hide a finding. Other languages, Punjabi included, get a transcript and a “not validated” message instead of a scam verdict. The voice model has not been evaluated in any language. The translation is shown next to the transcript and never replaces it.',
  'The two assessments are never merged into one score. A “real” label does not make a call safe, and a “fake” label does not prove fraud.',
  'When evidence is weak, the answer is Inconclusive rather than a guess. VoxShield never names anyone as a fraudster.',
]

/** Measured by backend/evaluation/run_eval.py on the synthetic held-out set; see backend/evaluation/RESULTS.md. */
const SYNTHETIC = {
  total: 168,
  dev: 75,
  test: 93,
  testScam: 42,
  testBenign: 51,
  rows: [
    { name: 'Transparent rules (v1.1)', precision: '0.84', recall: '0.38', f1: '0.52', fp: 3, fn: 26 },
    { name: 'Language model (DeBERTa-v3 NLI)', precision: '0.85', recall: '0.79', f1: '0.82', fp: 6, fn: 9 },
  ],
}

const SECTIONS = [
  ['models', 'Models'],
  ['published', 'Published metrics'],
  ['own', 'VoxShield evaluation'],
  ['image', 'Image detector (DeepTruth)'],
  ['limits', 'Known limitations'],
  ['privacy', 'Privacy'],
] as const

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="border-t border-line py-10 first:border-t-0 first:pt-0">
      <h2 id={`${id}-h`} className="font-display text-3xl font-medium">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function AboutPage() {
  const [models, setModels] = useState<ModelsResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getModels(controller.signal)
      .then(setModels)
      .catch(() => !controller.signal.aborted && setFailed(true))
    return () => controller.abort()
  }, [])

  return (
    <div className="rise">
      <header className="max-w-3xl">
        <p className="font-mono text-sm text-ink-3">Technical report</p>
        <h1 className="mt-1 font-display text-5xl font-medium tracking-tight">Evaluation &amp; limits</h1>
        <p className="mt-4 text-lg text-ink-2">The models behind each result, and what has and has not been measured.</p>
      </header>

      <div className="mt-12 grid gap-12 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 space-y-2 border-l border-line pl-4 text-sm">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-ink-2 hover:text-accent">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="max-w-3xl">
          <Section id="models" title="Models in use">
            {failed && <p className="text-amber">Could not load model details. Is the backend running?</p>}
            {!models && !failed && <p className="text-ink-3">Loading…</p>}
            <ul className="divide-y divide-line">
              {models?.models.map((model) => (
                <li key={model.role} className="py-5 first:pt-0">
                  <p className="text-sm text-ink-3">{model.role}</p>
                  <p className="mt-1 break-all font-mono text-base font-medium">{model.name}</p>
                  <p className="mt-2 text-ink-2">{model.details}</p>
                  <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-3">
                    <div className="flex gap-1.5">
                      <dt>License</dt>
                      <dd className="text-ink-2">{model.license}</dd>
                    </div>
                    {model.revision && (
                      <div className="flex gap-1.5">
                        <dt>Revision</dt>
                        <dd className="font-mono text-ink-2">{model.revision.slice(0, 8)}</dd>
                      </div>
                    )}
                    <div className="flex gap-1.5">
                      <dt>State</dt>
                      <dd className="text-ink-2">{model.loaded ? 'loaded in memory' : 'not loaded yet'}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="published" title="Published metrics (model authors)">
            <p className="text-ink-2">
              Reported by the authors of the voice model on the In-the-Wild deepfake dataset (zero-shot), as stated on{' '}
              <a href={VOICE_MODEL_URL} className="text-accent underline underline-offset-4" target="_blank" rel="noreferrer">
                the model page
              </a>
              . VoxShield did not measure these, and they may not hold for your recordings.
            </p>
            <dl className="mt-6 space-y-4">
              {reported.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[9rem_1fr_4rem] items-center gap-4">
                  <dt className="text-sm text-ink-2">{label}</dt>
                  <dd className="contents">
                    <span className="h-2 rounded-full bg-paper-2" role="img" aria-label={`${label} ${value} on a scale of 0 to 1`}>
                      <span className="block h-2 rounded-full bg-ink-3" style={{ width: `${Number(value) * 100}%` }} />
                    </span>
                    <span className="text-right font-mono text-sm tabular-nums">{value}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-ink-3">Bars show the authors’ reported value on a 0 to 1 scale.</p>
          </Section>

          <Section id="own" title="VoxShield’s own evaluation">
            <p className="text-lg">
              <strong className="font-semibold">Not performed on real or representative data.</strong> <span className="text-ink-2">No accuracy figure for this app on real calls exists.</span>
            </p>
            {models && (
              <p className="mt-5 border-l-2 border-amber-light pl-4 text-ink-2">
                {models.voice_spot_check}
              </p>
            )}
            <p className="mt-5 text-ink-2">
              The two scam-intent detectors (the zero-shot language model used by default, and the transparent rules kept as a baseline) were compared on {SYNTHETIC.total} transcripts written by the developers: {SYNTHETIC.dev} used for tuning and {SYNTHETIC.test} held out. These are synthetic, not recordings of real calls, so they show how each detector handles the scenarios we thought of, not real-world accuracy. The speech-to-text model has no accuracy figures measured here.
            </p>
            <table className="mt-5 w-full text-left text-sm">
              <caption className="pb-2 text-left text-ink-3">Held-out synthetic examples ({SYNTHETIC.test}: {SYNTHETIC.testScam} scam attempts, {SYNTHETIC.testBenign} not). Call counted as a scam when the risk level is “notable” or “strong”.</caption>
              <thead className="border-b border-line-strong text-ink-3">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-normal">Detector</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Precision</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Recall</th>
                  <th scope="col" className="py-2 pr-4 font-normal">F1</th>
                  <th scope="col" className="py-2 font-normal">Errors (false +/−)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono tabular-nums">
                {SYNTHETIC.rows.map((row) => (
                  <tr key={row.name}>
                    <th scope="row" className="py-2 pr-4 text-left font-sans font-medium">{row.name}</th>
                    <td className="py-2 pr-4">{row.precision}</td>
                    <td className="py-2 pr-4">{row.recall}</td>
                    <td className="py-2 pr-4">{row.f1}</td>
                    <td className="py-2">{row.fp} / {row.fn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-sm text-ink-3">
              With this few examples the F1 difference has a wide 95% interval (+0.12 to +0.47 in favour of the language model). Full method, confidence intervals, and error analysis are in <code className="font-mono text-xs">backend/evaluation/RESULTS.md</code>.
            </p>
          </Section>

          <Section id="image" title="Image detector (DeepTruth)">
            <ImageEvaluation />
          </Section>

          <Section id="limits" title="Known limitations">
            <ul className="list-disc space-y-3 pl-5 text-ink-2">
              {limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Section>

          <Section id="privacy" title="Privacy">
            <p className="text-ink-2">
              The language you choose is sent with the audio and is not stored; nothing is translated and nothing is sent to any other service. Uploaded audio is written to temporary files on the machine running the backend (the web framework spools larger uploads while they arrive, then the app copies the file for decoding), analyzed, and deleted when the analysis ends, including on errors or when you leave the page. Deleting a file is not a secure erase, and the host may still hold data in caches or swap. Transcripts are returned to your browser and not kept or logged by the server. History holds completed reports in this browser tab’s memory only, and a refresh clears it. The waveform preview is drawn in your browser from the file you chose. Models are downloaded once from Hugging Face on first use.
            </p>
          </Section>
        </div>
      </div>
    </div>
  )
}
