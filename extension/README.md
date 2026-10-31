# VoxShield Check (browser extension)

Check suspicious media where you find it, before you act on it. Get a verdict, the evidence behind it, and what the result cannot tell you.

Right-click an image, an audio player or a video on any page and choose **Check with VoxShield** (or **Check linked
file with VoxShield** on a link that points straight at a media file). The file is sent to your VoxShield backend
(`POST /api/v1/deeptruth/analyze`), the verdict appears in a card on the page, and the result is saved to the website's
History page with source "extension". Only scores, reasons and evidence are kept; the file is deleted by the server
when the analysis ends and is never stored by the extension.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3: permissions, the service worker, the site bridge. |
| `background.js` | Service worker: context menu, downloads the media, calls the backend, stores the result. |
| `content.js` | The result card, rendered in a Shadow DOM on the page. Injected only when you use the menu. |
| `bridge.js` | Runs only on the VoxShield site and hands stored results to the page's History. |
| `options.html`, `options.js` | Settings page: backend URL, website URL, "Test backend". Right-click the extension icon → Options. |
| `settings.js` | Defaults (`http://localhost:8000`, `http://localhost:5173`) and the first-use consent flag, in `chrome.storage.sync`. |

## Load it (Chrome or Edge)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `extension/` folder.
4. Start the backend (`uvicorn app.main:app --reload --port 8000`) and the site (`npm run dev`).

No build step and no dependencies.

## Errors the card explains

| Card title | When |
| --- | --- |
| VoxShield backend is offline | The backend URL did not answer. |
| The site blocked the download | The page's server refused the request (hotlinking rules, login), or the media is a `blob:`/`data:` URL. |
| File too large | The backend's upload limit (100 MB for DeepTruth) was exceeded. |
| Unsupported media type | The content type is not an image, audio or video the backend accepts, or the bytes were not recognised. |
| Streamed media | A `blob:`/`data:` source or a streaming site (YouTube, Instagram, X, TikTok, Facebook, Vimeo, Twitch…): there is no file to download, and the card says so. |

## Limits

- Only media with a real file behind it can be checked. Streamed video is detected and refused honestly, never guessed at.
- The upload limit comes from the backend (`GET /api/v1/deeptruth/limits`, 100 MB by default) and is checked before the download finishes.
- Accuracy is the backend's: the image detector is 77% accurate on 180 held-out images (eval/results/summary.json), the voice detector is weakest on heavily compressed (phone or Opus) audio, and no module detects face swaps. Every card shows the limitations the backend reports.
- The site bridge (`bridge.js`) only runs on `localhost:5173` / `127.0.0.1:5173`. If the website URL is changed in options, results still show in the card and link to the site, but `manifest.json` must list the new origin for History to receive them.
