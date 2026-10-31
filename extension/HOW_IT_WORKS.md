# VoxShield Check: how it works and how to test it

**Use case.** Check suspicious media where you find it, before you act on it. Get a verdict, the evidence behind it, and what the result cannot tell you.

## The 30-second demo

1. On any web page, right-click a photo, an audio player or a video and choose **Check with VoxShield**.
2. A card appears on the page: "Analysing…", then the verdict (for example *Likely manipulated · High risk*), the manipulation likelihood and confidence, a heatmap (images) or the per-module findings (audio, video), and a **Limitations** line.
3. **View full report** opens the VoxShield website with the complete evidence dashboard. The result is also on the **History** page under the *Browser extension* filter.

## How it works

```
  web page                 extension                      VoxShield backend (FastAPI)
  ────────                 ─────────                      ───────────────────────────
  right-click media  ──►  background.js (service worker)
                           1. first use: consent card
                           2. downloads the media        ──►  POST /api/v1/deeptruth/analyze
                              (checks size vs /limits)         sniffs the real type, runs the modules,
                           3. result JSON                 ◄──  fuses them, deletes the file
                           4. stores score/evidence
                              in chrome.storage
  result card        ◄──  content.js (Shadow DOM)
  (website tab)      ◄──  bridge.js hands stored results to the site's History
```

- **No AI runs in the browser.** The extension is about 400 lines of plain JavaScript: a context menu, a fetch, a POST, and a card. All detection is the same backend the website uses.
- **The server stores nothing.** The upload lives in a temp folder for the length of the analysis and is deleted. The extension keeps only the report JSON (scores, reasons, evidence), never the media.
- **One endpoint for everything.** The backend reads the file's bytes to decide image, audio or video, so a mislabeled file is routed correctly.

## What the backend checks

| Media | Modules | Model (free, local) | Known accuracy |
| --- | --- | --- | --- |
| Image | Two learned classifiers averaged, ELA heatmap, noise heatmap, EXIF, face geometry | UnivFD (CLIP ViT-L/14 + linear head, Ojha et al. 2023, MIT) + Swin-V2 AI-image classifier (haywoodsloan/ai-image-detector-deploy, Apache-2.0); MediaPipe Face Landmarker | Held-out 180 images: accuracy 0.77, AUC 0.88, 63% of fakes caught, 9% of real photos wrongly flagged (was 0.63 / 0.69 with UnivFD alone) |
| Audio | Voice authenticity over 12 s windows, spectrogram with flagged segments | NII mms-300m-anti-deepfake (non-commercial licence) | 0 of 119 real voices scored ≥ 0.8; 92 of 145 fakes did. Weak on phone/Opus-compressed audio |
| Video | Frame classifier (16 frames), temporal consistency, audio track, audio-visual sync | Same two models + OpenCV frame sampling | Frame and audio modules as above; temporal and sync checks are heuristic and not yet measured |

**Fusion.** Each module returns a score (0–1) and a reliability (0–1). One strong, measured signal (score ≥ 0.8, reliability ≥ 0.6) decides. Otherwise a reliability-weighted average applies: ≥ 0.6 *Likely manipulated*, ≤ 0.4 *No manipulation detected*, between them *Inconclusive*; trusted modules on opposite sides give *Mixed signals*.

## Honesty rules built in

- No score is ever invented. If a module cannot run, it is reported as unavailable and carries no weight.
- *Inconclusive* is shown when reliability is low, and the limitations line is always shown.
- Streamed video (YouTube, Instagram, X…) is refused with a plain message, never guessed at.
- Every error names its cause: backend offline, site blocked the download, file too large, unsupported type.
- The likelihood is a normalised model score, not a calibrated probability. A high score is a reason to verify through another channel, not proof.

## Test script

Before you start: backend running (`uvicorn app.main:app --reload --port 8000`), website running (`npm run dev`), extension loaded unpacked from `extension/` at `chrome://extensions` with Developer mode on.

| # | Do this | Expect |
| --- | --- | --- |
| 1 | Right-click any Wikipedia photo → Check with VoxShield | First time only: the consent note. Continue → card with verdict, ELA heatmap, limitations |
| 2 | Click **View full report** | The website opens the full dashboard for that result; `/history` lists it under *Browser extension* |
| 3 | Right-click an AI-generated image (a Midjourney or GPT-image picture, or a StyleGAN face on thispersondoesnotexist.com) | *Likely manipulated · High risk* on most 2025-generator images; StyleGAN faces are caught about half the time. A miss is a real result, not a bug |
| 4 | Open `http://localhost:5173/lab/harmless.flac`, right-click the player | Audio verdict with the number of flagged segments |
| 5 | Open a short direct MP4 (under 100 MB), right-click the video | Four modules listed: video frames, video temporal, audio, lipsync. Slower than an image |
| 6 | Open a large direct MP4 (over 100 MB) | *File too large: this file is N MB; the backend accepts up to 100.0 MB* |
| 7 | Right-click a playing YouTube video | *This video is streamed and can't be downloaded by the extension. Try an image or a direct media file.* |
| 8 | Right-click an SVG logo | *Unsupported media type · image/svg+xml* |
| 9 | Stop the backend, check any image | *VoxShield backend is offline* with the start hint |
| 10 | Extension icon → Options → Test backend | *Backend is up (VoxShield 0.3.0)*; a wrong URL gives a clear error |

## Limits to state up front

- The results are only as good as the detectors: 77% on held-out images (see the Evaluation page for the breakdown), weak on compressed phone-quality voice, and **no face-swap detector** yet.
- "No manipulation detected" is not "real": every detector misses fakes, so the card always says so.
- Only media with a real file behind it can be checked; streamed players cannot.
- History is kept in the website tab's memory. The extension refills it from `chrome.storage` whenever the site opens.
- The voice model's licence is non-commercial, so this is a research and demo build.
- CPU only, one worker: the first check after a restart can take a minute while models load.
