# Voice-authenticity benchmark: English, Hindi, Punjabi

Reproduce with `python -m evaluation.voice_benchmark build DATA_DIR`, then
`python -m evaluation.voice_benchmark score DATA_DIR [--model ID] [--condition phone]`. Raw per-clip scores are in
`results/voice/`.

## Data (272 clips)

| | English | Hindi | Punjabi |
| --- | --- | --- | --- |
| Real: FLEURS dev, read speech by real people, one clip per sentence | 40 | 40 | 40 |
| Synthetic: MMS-TTS (VITS neural voice) reading the same sentences | 40 | 40 | 40 |
| Synthetic: macOS `say` (Samantha, Daniel, Karen, Moira, Rishi, Tara, Aman, Fred / Lekha) | 16 | 16 | none (no Punjabi voice) |

Real and synthetic clips say the same sentences, so content cannot give the answer away. "Phone" re-scores every clip
after a 300–3400 Hz band-pass, 8-bit mu-law, and noise at 20 dB SNR, roughly what a call sounds like by the time a
speakerphone recording reaches VoxShield.

**What this cannot show:** real phone calls, real microphones and rooms, or modern commercial voice cloning (ElevenLabs
and similar). Only two synthetic systems are included. FLEURS is in the NII model's training data, so its real-voice
results are optimistic.

## Results with the app's decision rule

Rates are of the app's verdict ("favors fake" / "favors real"; the rest were inconclusive).

| Model | Condition | Real voice called fake | macOS voice caught | Neural voice caught (en / hi / pa) |
| --- | --- | --- | --- | --- |
| Gustking wav2vec2-XLSR (ASVspoof 2019), previous default | clean | 0% | 100% | 24% / 3% / 3% |
| | phone | 0% | 71% en, 33% hi | 0% / 0% / 0% |
| **NII MMS-300M AntiDeepfake, new default** | clean | 0% (1 of 40 Punjabi inconclusive) | 100% | **92% / 62% / 8%** |
| | phone | 5% en, 3% hi, 8% pa | 100% | 8% / 49% / 3% |
| MelodyMachine Deepfake-audio-detection-V2 | clean | 41% en, 5% hi, 50% pa | 7% | 5% / 0% / 0% (worse than chance) |

Ranking quality (AUC of the median window score, clean): Gustking 0.96 / 1.00 / 1.00 on neural voices and NII
1.00 / 1.00 / 0.95. The Gustking model *ranks* neural voices above real ones, but scores them around 0.3, below its 0.5
cut-off. Lowering that cut-off to 0.17 (chosen on half the sentences, tested on the other half) caught 79% / 74% / 100%
of clean neural voices with up to 5% of real voices flagged, but still about 0–11% over phone audio, and the cut-off was
tuned on studio-quality read speech.

## Bug found

Before this benchmark, 28 of 40 English real clips got **no voice result**: FLEURS English is recorded quietly (peak
about 0.01), and windows below a fixed RMS of 0.003 were skipped as silence. The feature extractor normalizes every
window, so recording level never mattered to the model. The silence check is now relative to the recording's own peak.

## Decision

The default is now `nii-yamagishilab/mms-300m-anti-deepfake` at a pinned revision: the best result in every language on
clean audio, and the only one that still catches Hindi neural speech over phone-quality audio. Its weights are
**CC BY-NC-SA 4.0 (non-commercial)**. The fairseq checkpoint is mapped onto the Transformers `Wav2Vec2Model` by name
(`app/services/voice_nii.py`); every encoder weight is used and none is missing. Same size as the old model
(1.27 GB) and the same speed (about 0.5 s for 11 s of audio on an M-series CPU).

**Still weak:** Punjabi neural voices (8% caught), and neural voices over phone audio in English and Punjabi. A
"favors real" result is not evidence that a voice is human. Next steps: real Hindi and Punjabi recordings (with
consent) through real phones, clones from current commercial systems, and fine-tuning with phone-channel augmentation.

## Update: call codecs, band-matched cut-off and a second detector

Reproduce with `python -m evaluation.voice_channels score DATA_DIR --save evaluation/results/voice/channels_nii.json`
(and `--model Gustking/wav2vec2-large-xlsr-deepfake-audio-classification --save .../channels_gustking.json`), then
`python -m evaluation.voice_channels analyze ...`. Same 272 clips, now scored four ways: clean, the simulated phone
channel above, and two real narrowband call codecs (iLBC and Opus at 12 kbit/s, encoded at 8 kHz with macOS
`afconvert`). Rules were chosen on even-numbered sentences and are reported on odd-numbered ones (20 real and about
20 synthetic clips per language and condition, so one clip is 5%).

**Audio band.** A recording counts as phone or VoIP quality when the band above 4 kHz barely rises with the speech
(< 6 dB) or is nearly empty (< -60 dB relative to the telephone band). This marked 100% of simulated-phone clips,
93-96% of codec clips, and 15% of clean clips (those simply keep the stricter rule).

**What changed** (reporting half, real voices called fake / neural voices caught, before → after):

| | English | Hindi | Punjabi |
| --- | --- | --- | --- |
| Clean | 0% → 0% / 89% → 89% | 0% → 0% / 63% → 74% | 0% → 0% / 5% → 25% |
| Phone, iLBC, Opus | unchanged | unchanged | unchanged |

- Full-band audio uses a cut-off of 0.2 instead of 0.5 for the default model (0.05 and 0.1 caught more but leave less
  margin, given that FLEURS is in this model's training data). Phone and VoIP audio keep 0.5: no cut-off there improved
  both error types.
- A second detector (Gustking, Apache-2.0) runs on every recording and counts on full-band audio only. There it never
  called a real voice fake, and it caught a TTSMaker voice the default model scored 0.0008. Over Opus it called 4 of 119
  real English voices fake and caught nothing extra, so on phone or VoIP audio it is shown but does not decide.

**Found, not fixed:** over iLBC the default model calls real voices fake often (15% English, 30% Punjabi across all
clips), with or without these changes. Results on such audio now carry an explicit caution. One TTSMaker file is an
anecdote, not a measurement: more clips from current commercial systems are the most useful next addition.
