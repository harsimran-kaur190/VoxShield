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

## Follow-up: protective advice, quotes, and mixed messages (false-positive fix)

Testing the Stage 2 results page found that a bank-security *awareness* message was flagged: the opening sentence as
"Asks for a code or secret" (model score 0.99) and "Never share your password, PIN, or one-time code with callers..." as
"Secrecy" (0.95) and "Discourages checking" (0.98).

### Root cause (measured with the real model, not guessed)

1. **A topic-level statement.** The credential statement was "The text asks the listener to share a verification code,
   password, or bank details." The NLI model treats that as entailed by any sentence about a bank account: 0.99 on "this
   is a security notification regarding your bank account" and 0.97 on "Your bank account has unusual activity". The
   thresholds were not the problem; the statement was.
2. **A prohibition read as an instruction.** "Never share X" scored 0.98 on "discourages the listener from checking" and
   0.95 on "keep this call secret". The model keys on "do not / never" plus a disclosure verb, not on what is forbidden.
3. **No protective-advice signal.** The only down-weighting was a "talking about scams in general" statement, which
   scored 0.02 on the warning. The zero-shot model cannot separate quoted or reported requests from direct ones either:
   "describing a request someone else made" scored 0.985 on the direct "Tell me your OTP", so it was not usable.

Not the cause: sentence-level splitting alone (context windows made one case worse, below) and category aggregation. The
rules never overrode the model (they are a separate detector and are never mixed in).

### What changed (same model, same architecture)

* The credential statement now describes *asking the listener to give* a secret (0.015 on the greeting, 0.07 on
  "unusual activity", still 0.99 on "Tell me your OTP").
* Two protective-advice statements plus one phrased as suspicion are scored for every sentence. A sentence that scores at
  least **0.90** as protective holds back *secrecy*, *verification bypass* and *impersonation* findings; *credential*
  requests need **0.95**. Held-back findings are counted in `suppressed_mentions` and named in the summary, never dropped
  silently. Payment, threat, urgency, family-emergency and remote-access findings are never held back.
* Sentences are split into clauses at "but", "however", "although", a semicolon, and ", so/and (also) <instruction>", so
  protective advice in one clause cannot hide a request in the next. A finding that exists only in the window joined to a
  protective neighbour is held back only if the current clause gives no support of its own.
* Narration cues (reusing the rule engine's reported-speech patterns, plus "in this scam", "scammers often...", and quote
  marks) mark a sentence as reported. For those, the finding bar is **0.80** instead of 0.92, and the result is always
  low severity, "reported", and cannot raise the risk. This is a structural cue, not scam vocabulary.
* A protective sentence is no longer counted as "uncertain", so it does not turn a clean message into "inconclusive".

Thresholds that changed or were added: protective 0.90 (new), protective for credential 0.95 (new), reported-finding
bar 0.80 (new). The finding (0.92), uncertain (0.30) and reported (0.50) thresholds are unchanged.

### Results (all with the real model unless stated)

| Set | n | Before | After |
| --- | --- | --- | --- |
| The reported transcript | 1 | 3 findings, risk "high" | 0 findings, "none_detected", 2 matches held back and disclosed |
| Awareness set, development (`awareness_cases.py`) | 17 non-suspicious, 10 suspicious | 8 false positives, 0 false negatives | 0 false positives, 0 false negatives |
| Awareness set, second (`awareness_holdout.py`) | 11 non-suspicious, 9 suspicious | not run before the fix | 0 false positives, 0 false negatives (see note) |
| Existing dev set (n = 75) | 33 scam | TP 30 FP 7 FN 3, F1 0.857 | TP 30 FP 3 FN 3, F1 0.909 |
| Existing held-out set (n = 93) | 42 scam | TP 33 FP 6 FN 9, F1 0.815 | TP 34 FP 4 FN 8, F1 0.850 |

The rules detector on the second awareness set: 2 false positives, 4 false negatives, for comparison.

**How much to trust these numbers.** They are small, synthetic, and written by the same author who made the fix.
The first awareness set was iterated on until it was clean, so 0/0 on it is *expected* and is not evidence. The second
set was written after that tuning and run once; its first run had 1 false positive and 2 false negatives (protective
wording that hid a real request in the same clause, and a protective sentence just under the credential bar). The fix
for those was then made and the set re-run, so it is also no longer unseen. One of the added protective statements was
motivated by one of its cases. The existing held-out set had already been inspected in earlier runs and was re-run once
here only to check for regressions. None of this measures real-call accuracy.

### Known failure modes

* **Protective wording used to disguise a request** inside one clause with no "but / so / and also" join, for example
  "Never share your OTP with anyone except me." (a tail "except me" is only a few words), can be held back.
* **Anaphora across sentences.** "Please do not give it to anyone" is recognised as protective only through the narrow
  "<verb> it" rule. Other pronoun references are not resolved.
* **Narration cues are surface patterns.** A scammer who says "He told me to call you, now read me your code" in one
  clause would be marked reported (low severity); it is still shown, never hidden.
* **Protective advice about money** ("never send money to strangers") has no protective statement, so payment findings
  are not held back, which errs toward showing a finding.
* **Ambiguity stays ambiguous.** "Your account has unusual activity" with no request is reported as none/inconclusive,
  not as a scam; a real scam opening that contains no request is therefore not flagged by this detector.
* **Cost.** Three more statements per sentence (about 19 pairs per sentence instead of 16): about 20% more scoring time,
  and the default pair budget now covers about 142 sentences instead of 168.

## Follow-up: who is sending the money (payment direction)

A test recording in which the speaker asks whether *she* can send money was reported as a suspicious payment request.

### Root cause

The payment statement, "The speaker is asking the listener to send money.", says nothing about direction. With accurate
transcripts, the real model scored it **0.969** on "Can I send you some money for now?" (0.87 to 0.98 on other offers:
"Would you like me to send the payment today?" 0.98, "Do you want me to transfer the money?" 0.91), so offers were flagged
as direct payment requests. The rule engine was not involved (it needs "send **me**"). Speech recognition was not the
cause for any of the clean synthetic recordings tried: Whisper kept the direction in all of them, and under added noise it
garbled words but never turned "I send you" into "you send me". The submitted audio could not be inspected, so a
transcript that reversed the direction in that recording is not ruled out.

An NLI statement cannot be trusted to separate the two: "The speaker is offering to send money" scored 0.89 on the real
request "Can you transfer money to my account?". A statement about the sender ("the speaker is the one who would send the
money") separated better (offers 0.66 to 0.94, requests at most 0.28) but missed "Should I send it to your account?".

### What changed

* The grammar is read for who the sender is. "Can/should/could I ...", "do you want me to ...", "let me ...", "I can/will ...",
  "if I sent ..." make the **speaker** the sender (an offer or a question about sending). "Can you ...", "please ...",
  "I need you to ...", "you must ...", an imperative, and "you wire back ..." make the **listener** the sender (a request).
  If a text has both, the request wins, so an offer in the same clause never hides it. "We" and "let's" show no direction.
* Only the grammar can suppress a payment finding. An offer is dropped from the findings, counted in the new
  `offer_mentions` field, and disclosed in the summary. A shared subject, or a sentence whose grammar is silent but which the
  model reads as the speaker sending (statement above, 0.85), is treated as *uncertain*, which yields `inconclusive`
  instead of a confident direction. The model reading can make a sentence uncertain; it can never hide a request.
* A sentence that follows an offer and scores high on payment only because of it is no longer counted as uncertain.
* A payment finding that rests on low-confidence speech recognition (segment log-probability below -1) now carries a
  limitation: a misheard word can reverse who is sending money, so check the audio.

New heuristic: the sender-reading bar 0.85 (`VOXSHIELD_SCAM_NLI_SENDER_THRESHOLD`). No existing threshold changed.

### Results (real model)

Of 28 sentences (offers, requests, reported speech and warnings, "we", and mixed cases), **8 results changed, all from a
wrong direct payment finding to none**: six offers or questions about sending (including one preceded by "I can't hear
you") and the two "we" sentences. Offers combined with other evidence kept that evidence: an offer plus "I just need your
bank password" still reports the credential request; an offer plus "it has to happen immediately" still reports the
urgency; "I can send you money, but first you must pay a processing fee" still reports the fee as a payment request.
All eight requests that were flagged before are still flagged. Two requests were *not* flagged before or after
("Can you lend me some money?" and "You must pay the fee before we continue.", which score just under the 0.92 finding
threshold): this change neither caused nor fixes them. Awareness sets (27 and 20 cases): still 0 false positives and
0 false negatives. Development split (75): false positives 3 to 2, false negatives 3 to 3. The held-out split was not
re-run.

### Known failure modes

* Grammar cues cover common English phrasings. Unusual wording ("Want me to wire it over?" is covered; "I'm good for it, just
  say the word" is not) can still be misread in either direction. An unrecognised offer is flagged as before; an
  unrecognised request is flagged as before. Only recognised offers are dropped.
* A speaker who offers money as the first step of a scam is not flagged *for the offer*. The scam shows up in what else is
  said (a fee, a code, a password, urgency), not in the offer itself.
* "I will send you a check and you wire back the difference" is reported as a low-severity reported finding by the existing
  story-or-example check, not as a direct request. This predates the change.
* Direction is read from the words. If speech recognition mishears who is the sender, the finding follows the transcript;
  only a low-confidence segment triggers the caution above.

### Hardening pass on payment direction

Eight intents were run through both detectors and, as speech, through the whole pipeline (every transcript matched the spoken
words). Two further problems were found and fixed:

* **Rule engine: reported offers.** "He offered to send me money." was reported as a direct request to the listener, because
  the rule for "send me money" had no way to see that someone else was the sender. "offered / promised / agreed /
  volunteered to ..." is now treated as reported speech, the same mechanism as "said / asked / told". Rule results on all 168
  labelled examples are identical with and without the change (no example changed).
* **Language model: statements of need.** "I need money; can you help?" was a medium finding and reported as "elevated",
  because the payment statement cannot tell "I need money" from "send me money". The rule engine already rates this wording
  low ("friends and family ask this too"). The exact wording "I/we need|require|are short of|could use (some|more) money|cash|funds"
  (not "I need you to ...", not an amount) now gives a low-severity finding, still reported, never dropped. Anything else keeps
  its severity, so "I need two thousand dollars right away" is unchanged. This is a narrow, recognised-wording rule, not a
  threshold change.

Real-model results, one sentence each (NLI default | rules detector):

| Intent | Sentence | NLI | Rules |
| --- | --- | --- | --- |
| offer / permission | Can I send you some money? | no finding | no finding |
| offer | Would you like me to transfer some money? | no finding | no finding |
| request | Could you send me some money? | payment, direct, medium | payment, direct, medium |
| request | Can you transfer money to my account? | payment, direct, medium | **no finding (recall gap)** |
| reported request | She asked me to send her money. | no finding | no finding |
| reported offer | He offered to send me money. | no finding | payment, reported, low |
| need + help | I need money; can you help? | payment, direct, **low** | payment, direct, low |
| offer + OTP | I can send you money, but first give me your OTP. | credential, direct, high | credential, direct, high |

One-sentence clips are `inconclusive` when nothing is found, because a transcript under twelve words is too short to judge.
After this pass: development split FP 2 / FN 3 (unchanged), awareness sets 0 and 0 (unchanged).

Still open: the rule engine misses "Can you transfer money to my account?" and similar requests that name a destination
instead of "me"; widening it was left out of this pass. The NLI detector misses two phrasings that sit just under the 0.92 bar
("Can you lend me some money?", "You must pay the fee before we continue.").

## Limitations

* Synthetic, author-written data with a single annotator; the same author wrote the rules, which may bias the
  comparison in either direction.
* n = 93 held-out examples; several scenarios have 5 to 8 examples, so per-scenario counts are anecdotes.
* The held-out set was inspected after run 1, so run 2 is not independent. The first run is the clean number.
* Transcripts are clean text. The pipeline's real input is Whisper output from audio, whose errors are only sampled
  here by a few hand-made examples.
* English only. No evaluation on real calls, phone-quality audio, accents, or other languages.
* Thresholds come from 75 examples; the model was not fine-tuned.
