# Scam-intent detector comparison

Rules (`voxshield-scam-rules` v1.1, regular expressions with negation and quoted-speech handling) versus a zero-shot
language model (`MoritzLaurer/deberta-v3-base-zeroshot-v2.0`, revision `8e7e5af5983a0ddb1a5b45a38b129ab69e2258e8`,
MIT license, no fine-tuning). Every number below was produced by the scripts in this folder and is stored in
`results/*.json`.

## What this is, and is not

* **Dataset:** 168 transcripts **written by hand by the AI assistant that built VoxShield** (the same author as the
  rule engine) in the style of Whisper output. **They are synthetic. They are not recordings or transcripts of real
  calls**, and they are not a sample of any real population. Results measure agreement with the labels below, not
  real-world accuracy.
* **Splits:** 75 development examples (33 scam, 42 not) used to choose the model's statements and thresholds, and 93
  held-out examples (42 scam, 51 not) used only to report. Each of the 14 scenarios appears in both, written with
  different wording. `dataset.check_split_overlap()` found no exact duplicates and no dev/test pair sharing 40% or more
  of its word trigrams; there are no duplicates inside either split.
* **Label:** *scam* means the speaker directly attempts a scam (asks for a secret code or credentials, pressures a
  payment, demands remote access, discourages verification). Legitimate urgent calls, benign money talk, warnings,
  hypotheticals, and recounted scams are *not scam*. A second label lists the behaviors the speaker directly performs
  (used for the category-level numbers). Labels are the author's judgment; no second annotator.
* **Prediction:** a call counts as "scam" when the detector's risk level is *notable* (`elevated`) or *strong*
  (`high`). Weak signals, no findings, and inconclusive all count as "not scam"; inconclusive results are also counted
  separately.
* **The scores are not probabilities.** The model's number is the probability its NLI head assigns to *entailment* for
  one sentence and one statement about the speaker. Thresholds are heuristics tuned on 75 examples.

## Protocol, and what was changed along the way

1. Nine behaviors, each phrased as a plain statement about the speaker ("The speaker is asking the listener to ..."),
   plus a statement that detects recounted or example speech. Each sentence (with the previous sentence as context) is
   the premise; a sentence is a finding when its entailment score reaches the threshold.
2. **Development-only tuning, three rounds** (the held-out set was not opened):

   | Round | Change | Dev F1 | Dev TP / FP / FN |
   | --- | --- | --- | --- |
   | 1 | First wording, one long statement per behavior | 0.733 (threshold 0.56) | 22 / 5 / 11 |
   | 2 | Alternative wording, two statements per behavior | 0.678 (threshold 0.50) | 20 / 6 / 13 |
   | 3 | Statements chosen by per-behavior ROC AUC on dev (0.90 to 0.99 for most behaviors; the weakest, "works for a bank", was dropped) | **0.857 (threshold 0.92)** | 30 / 7 / 3 |

   The F1 curve is flat (about 0.82 to 0.86) for every threshold from 0.3 to 0.98, so the choice of 0.92 is not a
   fragile peak. The reported-speech threshold (0.5) was also chosen on dev.
3. **Configuration frozen**, then the held-out set was run **once** ("run 1", the only clean held-out result).
4. A real end-to-end test afterwards showed a flaw that metrics could not: a sentence such as "Do it right now."
   inherited the credential and secrecy findings of the sentence before it, because that sentence was part of its
   premise. The fix attributes a finding to a sentence only when that sentence supports it alone, and otherwise to a
   two-sentence span, and only when the previous sentence does not already carry it. Dev decision metrics did not
   change, so the frozen thresholds stayed. The held-out set was re-run ("run 2"). **Run 2 is not a clean held-out
   measurement**, because the test set had already been seen; it is shown only to confirm nothing collapsed.

## Results

### Held-out set (n = 93: 42 scam, 51 not scam), call level

| Detector | TP | FP | FN | TN | Precision | Recall | F1 | Accuracy | Inconclusive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Rules v1.1 | 16 | 3 | 26 | 48 | 0.842 | 0.381 | 0.525 | 0.688 | 6 |
| NLI model, run 1 (clean) | 33 | 6 | 9 | 45 | 0.846 | 0.786 | 0.815 | 0.839 | 18 |
| NLI model, run 2 (after the evidence fix) | 33 | 6 | 9 | 45 | 0.846 | 0.786 | 0.815 | 0.839 | 18 |

Paired bootstrap, 5000 resamples of the 93 examples, 95% intervals (run 2; `python -m evaluation.uncertainty ...`):

| | Rules | NLI |
| --- | --- | --- |
| Precision | 0.842 [0.667, 1.000] | 0.846 [0.722, 0.951] |
| Recall | 0.381 [0.238, 0.529] | 0.786 [0.659, 0.905] |
| F1 | 0.525 [0.360, 0.667] | 0.815 [0.712, 0.897] |
| F1 difference (NLI minus rules) | | **+0.290 [+0.122, +0.465]** |

The advantage comes from recall. Precision is the same within noise. The interval covers sampling noise on these
particular examples only; it says nothing about how far synthetic examples are from real calls.

### Development set (n = 75: 33 scam, 42 not scam)

| Detector | TP | FP | FN | TN | Precision | Recall | F1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Rules v1.1 | 16 | 3 | 17 | 39 | 0.842 | 0.485 | 0.615 |
| NLI model | 30 | 7 | 3 | 35 | 0.811 | 0.909 | 0.857 |

The NLI development numbers are optimistic because the statements and thresholds were chosen on this set.

### Behavior-level (micro-averaged over the 8 categories), held-out

| Detector | Precision | Recall | F1 | TP / FP / FN |
| --- | --- | --- | --- | --- |
| Rules v1.1 | 0.805 | 0.317 | 0.455 | 33 / 8 / 71 |
| NLI, run 1 (clean) | 0.770 | 0.548 | 0.640 | 57 / 17 / 47 |
| NLI, run 2 (after the evidence fix) | 0.769 | 0.577 | 0.659 | 60 / 18 / 44 |

Category labels are noisier than call labels (a sentence can contain several behaviors), so treat these as a rough guide.

### By scenario, held-out (calls classified correctly)

| Scenario | n | Rules | NLI |
| --- | --- | --- | --- |
| Urgent payment (scam) | 7 | 2 | 5 |
| OTP / credential request (scam) | 7 | 2 | 6 |
| Verification bypass (scam) | 6 | 2 | 4 |
| Secrecy + impersonation (scam) | 6 | 3 | 6 |
| Remote access (scam) | 5 | 2 | 4 |
| Family emergency (scam) | 5 | 3 | 4 |
| Transcription errors (3 scam, 4 not) | 7 | 5 | 7 |
| Incomplete speech (3 scam, 4 not) | 7 | 5 | 5 |
| Benign financial | 8 | 8 | 7 |
| Legitimate urgent | 7 | 7 | 6 |
| Negated advice | 7 | 6 | 5 |
| Hypothetical | 6 | 6 | 6 |
| Quoted or recounted scam | 8 | 6 | 6 |
| Everyday conversation | 7 | 7 | 7 |

**The rules are better or equal on every benign scenario** (benign financial, legitimate urgent, negated advice). The
model's gain is on actual scam attempts, including garbled transcripts, where regular expressions miss misspellings.

### Where the model is wrong (held-out run 1)

* **False positives (6):** an invoice reminder, a genuine bank security alert, two negated-advice sentences ("Under no
  circumstances will our representatives ask for your PIN, so never read it out"; "Please don't download anything a
  stranger sends you"), and two quoted scams (a friend's account of a threatening call; a forwarded phishing email).
  Zero-shot NLI reads a sentence that *mentions* a request as if it *made* one. The reported-speech statement catches
  some but not all.
* **False negatives (9):** short or indirect requests ("Give me your pin number."; "Install this and let me in."), a
  subscription scam, a "skip the usual verification step" bypass, and a family emergency phrased in the first person.
* **Abstentions:** 18 of 93 held-out calls (19%) were inconclusive (the model scored a passage between 0.3 and 0.92).
  The rules abstained on 6.

## Runtime, measured on this machine

Apple silicon laptop, 10 cores, 16 GB RAM, CPU only, Python 3.14.0, PyTorch 2.14.1, Transformers 5.20.2 (unchanged by
this work).

* **Weights:** `model.safetensors`, 369 MB on disk (fp16), 184 M parameters, loaded as float32. Not gated, MIT license.
  The first download plus load took about 100 s here; later loads from the local cache take 2.3 s.
* **Memory:** the model process measured about 1.6 GB peak RSS (including the PyTorch and Transformers imports). The
  whole backend with all three models loaded peaked at 3.47 GB versus 2.73 GB with the rules, an increase of about 0.74 GB.
* **Scoring time** (`scripts/profile_scam_model.py`; 18 statements per premise, two premises per sentence):

  | Transcript | Time |
  | --- | --- |
  | Short, 15 to 35 words (n = 150 evaluation texts) | 0.25 s median |
  | About 11 s of speech (56 words) | 1.2 s |
  | About 1 minute (167 words) | 4.0 s |
  | About 3 minutes (474 words) | 12.3 s |
  | About 10 minutes (1,502 words, 80 sentences), all analyzed | 36.5 s |

* **Whole request**, 11 s recording, warm: 2.5 s with the rules, 3.15 s with the model (+0.6 s). Cold first request
  with preload off adds the 2.3 s load.
* Long transcripts are bounded by `VOXSHIELD_SCAM_MAX_PAIRS` (default 5,400 pairs, about 150 sentences). Anything
  beyond is not analyzed and the result says so.

## Limitations

* Synthetic, author-written data with a single annotator; the same author wrote the rules, which may bias the
  comparison in either direction.
* n = 93 held-out examples; several scenarios have 5 to 8 examples, so per-scenario counts are anecdotes.
* The held-out set was inspected after run 1, so run 2 is not independent. The first run is the clean number.
* Transcripts are clean text. The pipeline's real input is Whisper output from audio, whose errors are only sampled
  here by a few hand-made examples.
* English only. No evaluation on real calls, phone-quality audio, accents, or other languages.
* Thresholds come from 75 examples; the model was not fine-tuned.
