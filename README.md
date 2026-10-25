# VoxShield

**Beyond the Voice. Into the Truth.**
AI-powered voice fraud detection and protection.

VoxShield judges two separate questions about a call recording:

1. **Voice authenticity**: does the audio show signs of synthetic or manipulated speech?
2. **Scam intent**: does the transcribed conversation contain pressure, secrecy, or requests for money or codes?

A genuine voice does not make a call safe, and a synthetic voice does not prove fraud.

## Deploying

See [`DEPLOYMENT.md`](DEPLOYMENT.md): Docker images for the API (models baked in, runs offline, non-root) and the web app, a Vercel config, a Docker Compose file for one-machine hosting, a smoke test for a running server, and the resource requirements (the API needs about 4 GB of RAM). Nothing has been deployed yet.

## Status: Phase 3 (reliability, explainability, performance)

Phase 3 added per-stage timings, parallel model preload, bounded concurrent analyses, indicator timestamps with a "why it triggered" trace, reported-speech handling in the scam rules (now `voxshield-scam-rules` 1.1), a single shared "Understanding these results" section, and more tests.

Upload a call recording and VoxShield runs two independent assessments. Nothing is mocked: if a model cannot run, that result is shown as **unavailable** instead of a guess.

| Assessment | Method | Model |
| --- | --- | --- |
| Transcript | Speech-to-text with voice-activity filtering | `Systran/faster-whisper-small` (Whisper, MIT) |
| Voice authenticity | Windowed wav2vec2 audio classifier; reports the model's raw "fake" score | `Gustking/wav2vec2-large-xlsr-deepfake-audio-classification` (Apache-2.0), pinned to a fixed revision |
| Scam intent | Zero-shot language model applied sentence by sentence (default), or transparent English rules (`VOXSHIELD_SCAM_DETECTOR=rules`). Every finding quotes the exact transcript sentence | `MoritzLaurer/deberta-v3-base-zeroshot-v2.0` (MIT), pinned to a fixed revision; or `voxshield-scam-rules` v1.1 (no ML model) |

The two results are never merged into one score. Outcomes can be *inconclusive* or *unavailable*.

### Why not `koyelog/deepfake-voice-detector-sota`?

It was inspected and rejected. Its card describes a wav2vec2 encoder, but the checkpoint holds a ResNet-style CNN, BiGRU, and attention network. Its config lists mel-spectrogram settings that the card never mentions, no architecture or preprocessing code is published, and the weights are a raw pickle file. Exact preprocessing could only be guessed, so results would not be trustworthy or reproducible.

### Scam-intent detector

The default detector is a natural-language-inference model: each sentence is tested against plain statements about the
speaker ("The speaker is asking the listener to ..."). A finding quotes the real sentence with its transcript
timestamp and a model score. The score is an *entailment score*, not a calibrated probability of fraud. The old rules
remain available and are never mixed with the model. On 168 synthetic, developer-written transcripts the model reached
F1 0.815 versus 0.525 for the rules on the 93 held-out examples (95% interval of the difference +0.12 to +0.47), with
the rules better on benign negated and legitimate-urgent cases. That says nothing about real calls. Method, error
analysis, and every caveat are in [`backend/evaluation/RESULTS.md`](backend/evaluation/RESULTS.md).
The model adds a 369 MB download, about 0.7 GB of memory, and about 0.6 s per short request.

## Requirements

- Node.js 20+ and npm
- Python 3.11+ (developed on 3.14, macOS Apple Silicon, 16 GB RAM)
- About 2.5 GB of free disk for model downloads (once) and an internet connection on first run

No ffmpeg, GPU, or API keys are needed. Audio decoding uses PyAV, which bundles its own codecs.

## Setup

```bash
# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt     # exact versions used in development: requirements.lock.txt

# Frontend (new terminal)
cd frontend
npm install
```

The first analysis downloads the models from Hugging Face (about 2.1 GB) and can take several minutes. To download ahead of time, set `VOXSHIELD_PRELOAD_MODELS=true` and start the backend.

## Run

Terminal 1, backend (http://127.0.0.1:8000):

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Terminal 2, frontend (http://localhost:5173):

```bash
cd frontend
npm run dev
```

Open http://localhost:5173 and check that the pill says **Server online**. API docs: http://127.0.0.1:8000/docs

## Try it with a recording

In the browser, choose **Upload audio** or **Record audio**. Recording uses your microphone, so it captures sound the device can hear (for example a call on speakerphone). It cannot record a phone call's audio directly. The browser asks for microphone access only when you press Start, the recording stays in browser memory, and nothing is sent until you press Analyze. The recording is converted in the browser to a 16 kHz mono WAV (browsers record WebM, MP4, or Ogg, and the backend does not accept WebM) and submitted to the same endpoint as an uploaded file. Recording needs `https` or `localhost`, and is limited to the backend duration limit (10 minutes by default).

To upload instead, drop a WAV, MP3, M4A, FLAC, or OGG file (1 second to 10 minutes, up to 25 MB) onto the dashboard.

From the terminal:

```bash
curl -F "file=@backend/tests/fixtures/jfk.flac" localhost:8000/api/v1/analysis
```

To make a test recording on a Mac, use text-to-speech (this is *synthetic* speech, so it should lean synthetic):

```bash
say -v Samantha -o /tmp/test.aiff "This is your bank. Please read me the one time code we just sent you."
afconvert -f WAVE -d LEI16 /tmp/test.aiff /tmp/test.wav
```

For a human voice, record yourself with the Voice Memos app and export it as M4A.

## Test

```bash
cd backend && source .venv/bin/activate
pytest                                                          # unit tests and rule regression cases, stubbed models, no downloads
VOXSHIELD_RUN_REAL_MODELS=1 pytest tests/test_real_models.py    # real models: human clip, plus a macOS text-to-speech scam script
python scripts/profile_pipeline.py tests/fixtures/jfk.flac       # cold vs warm latency and peak memory
python scripts/profile_scam_model.py                             # scam-intent model load time, memory, scoring time
python -m evaluation.run_eval --split dev --tune                 # compare rules and model on the dev set (downloads nothing new)
python -m evaluation.run_eval --split test --threshold 0.92      # held-out set; see evaluation/RESULTS.md before re-running
cd ../frontend && npm test && npm run lint && npm run build
```

Stubbed model tests check wiring and decision logic only. `tests/data/intent_cases.json` holds developer-written rule regression cases, not real-call data. Neither says anything about accuracy. No labeled evaluation set exists yet; `scripts/spot_check.py` prints counts for folders you label yourself and computes no accuracy.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/health` | Liveness and version |
| GET | `/api/v1/ready` | 200 once every model is loaded, otherwise 503 |
| GET | `/api/v1/limits` | Upload limits and allowed extensions |
| GET | `/api/v1/models` | Model IDs, revisions, licenses, and whether each is loaded |
| POST | `/api/v1/uploads/validate` | Validate a file and return metadata only |
| POST | `/api/v1/analysis` | Full analysis, one JSON report |
| POST | `/api/v1/analysis/stream` | Same analysis as newline-delimited JSON: stage events, then the report |

Upload errors return `{"detail": {"code": "...", "message": "..."}}` with status 413, 415, 422, 429 (rate limited, with `Retry-After`), or 503 (busy). Component failures do not fail the request. They appear in the report as `status: "partial"` with an `errors` list.

## Configuration

See `backend/.env.example`. Common settings: `VOXSHIELD_WHISPER_MODEL_SIZE` (`base` is faster, `small` is more accurate), `VOXSHIELD_VOICE_MODEL_ID`, `VOXSHIELD_PRELOAD_MODELS` (now on by default, loads both models in parallel at startup), `VOXSHIELD_MAX_CONCURRENT_ANALYSES` (default 4; extra requests get a 503 `busy`). If you change the voice model ID, the pinned revision is ignored unless you also set `VOXSHIELD_VOICE_MODEL_REVISION`. Labels are mapped by name from the model config, and the model must expose exactly one real and one fake label.

## Privacy

Recordings are held in browser memory until you press Analyze and are never written to browser storage. Uploads are streamed into a temporary directory, analyzed in memory, and deleted when the analysis ends, including on errors. The results page plays the analyzed recording from the copy already in your browser (the file you chose or the recording you made); it is not uploaded again, not saved, and its object URL is revoked when you leave the results. Audio and transcripts are never stored or logged (logs contain only exception class names). Upload folders left by a crashed process are swept at startup. There is no history. Only model files are downloaded, from Hugging Face.

## Limitations

- The voice model was fine-tuned on ASVspoof 2019. Newer voice-cloning methods, phone compression, and noise can cause missed detections or false alarms. Its published metrics are the authors' claims; VoxShield has not evaluated it on its own data.
- Voice scores are uncalibrated raw outputs. The lean thresholds are fixed heuristics, documented in each result.
- Scam detection is English-only, finds indicators rather than intent, and depends on transcription accuracy. The language model flags whole sentences, still mistakes negated advice and quoted scams for requests, and returns *inconclusive* on roughly one held-out example in five. It was evaluated only on synthetic text.
- A genuine voice does not make a call safe, and a synthetic voice does not prove fraud.
- Analysis runs on CPU (M-series Mac, 10 cores, 16 GB). Measured on an 11.0 s clip: about 2.5 s warm (about 2.0 s of it Whisper), 2.6 s on the first request after preload, 4.9 s on a cold first request with no preload (2.3 s of it model loading). A first cold run earlier measured 8.9 s, so cold numbers vary with the OS file cache. A 9.9-minute recording took about 237 to 245 s, almost all in Whisper. A first run that downloads models adds download time.
- In-browser recording is not implemented yet.

## Project layout

```
backend/app/
  main.py, config.py, dependencies.py      App wiring and settings
  schemas.py, schemas_analysis.py          API models, including the report
  api/                                     health, uploads, analysis, models routes
  services/
    upload_handling.py, audio_validation.py   Streaming upload and file checks
    audio_io.py                               Decode to 16 kHz mono (PyAV)
    transcription.py                          faster-whisper
    voice_authenticity.py                     wav2vec2 classifier, windowing, decision rule
    scam_rules.py, scam_intent.py             Rules and risk summary
    pipeline.py, report.py                    Orchestration, partial failures, next steps
    interfaces.py                             Component contracts
backend/tests/                              Unit, API, and opt-in real-model tests
frontend/src/
  pages/                                    Analysis workspace, Evaluation & limits
  components/                               Upload stage, analysis view, results/ (timeline, voice, evidence, transcript)
  hooks/                                    Backend status, streamed analysis state
  lib/                                      API client, types, transcript highlighting
```
