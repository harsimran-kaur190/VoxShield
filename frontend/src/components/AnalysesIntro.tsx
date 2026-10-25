import { AudioWaveform, Quote } from 'lucide-react'

export function AnalysesIntro() {
  return (
    <section aria-labelledby="two-heading" className="mt-20 border-t border-line pt-12">
      <h2 id="two-heading" className="font-display text-3xl font-medium sm:text-4xl">
        Two questions, answered separately.
      </h2>
      <div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-0">
        <article className="md:pr-12">
          <span className="grid size-11 place-items-center rounded-full bg-accent text-white">
            <AudioWaveform className="size-5" aria-hidden />
          </span>
          <p className="mt-4 font-mono text-sm text-accent">01</p>
          <h3 className="font-display text-2xl font-medium">Is the voice authentic?</h3>
          <p className="mt-2 text-ink-2">
            A pretrained wav2vec2 classifier scores short windows of the audio and reports which label, real or fake, its model favors.
          </p>
        </article>
        <article className="border-line md:border-l md:pl-12">
          <span className="grid size-11 place-items-center rounded-full bg-ink text-amber-light">
            <Quote className="size-5" aria-hidden />
          </span>
          <p className="mt-4 font-mono text-sm text-amber">02</p>
          <h3 className="font-display text-2xl font-medium">Is the conversation a scam?</h3>
          <p className="mt-2 text-ink-2">
            Whisper transcribes the call, then a language model reads it sentence by sentence and quotes the passages that look like pressure, secrecy, or requests for money and codes.
          </p>
        </article>
      </div>
      <p className="mt-10 text-ink-3">The two results are never combined into one score.</p>
    </section>
  )
}
