# Deploying VoxShield

VoxShield is two pieces: a **web app** (static files) and an **API** (Python, three AI models on CPU). The web app is
cheap and can live anywhere. The API is the part that needs a real machine.

> **Status.** Everything here was prepared and checked locally. The container images and the compose file have **not
> been built or run** (the machine used for development has no Docker), and nothing has been deployed. Follow
> [Verify a deployment](#verify-a-deployment) after your first deploy.

## What the API needs

| | Measured on the development machine (CPU only) |
| --- | --- |
| Memory | about **3.5 GB peak** with all three models loaded (2.7 GB with the rules-only detector). Plan for **4 GB** minimum, 5 GB to be comfortable. |
| Disk | models are about 2 GB; the image will be roughly 3 to 4 GB (not yet built, so this is an estimate). |
| CPU | any modern x86-64 or ARM64. An 11-second clip takes about 3 s when warm. A 10-minute recording takes roughly 4 to 5 minutes (almost all of it speech-to-text). Faster CPUs help directly; there is no GPU support configured. |
| Start-up | the models take a few seconds to load from local disk. `/api/v1/health` answers immediately; `/api/v1/ready` answers 200 once all three models are loaded. |
| Workers | **one**. Each extra worker loads its own copy of every model. Run more replicas if you need more throughput. |
| Network | none required at runtime once the models are in the image. |

Free hosting tiers (512 MB to 1 GB of RAM) cannot run it. Use a plan with at least 4 GB.

## Option A: web app on Vercel, API on a container host

Any host that runs a Docker image with 4 GB or more works (Render, Fly.io, Railway, a VM with Docker, and so on).

1. **Deploy the API.** Build `backend/Dockerfile` (the build downloads the three models, so it needs internet and takes a while).
   Give it 4 GB or more of memory, and set these environment variables:

   | Variable | Value |
   | --- | --- |
   | `VOXSHIELD_CORS_ORIGINS` | `["https://your-app.vercel.app"]` (a JSON list of your web app's addresses) |
   | `VOXSHIELD_CORS_ORIGIN_REGEX` | optional, for Vercel preview URLs, for example `https://voxshield-[a-z0-9-]+\.vercel\.app` |
   | `FORWARDED_ALLOW_IPS` | the address of your host's proxy/load balancer, so rate limiting sees real visitors (see below) |

   Serve it over **https**. The browser refuses to send audio from an https page to an http API, and the microphone only works on https.
   Point the host's health check at `/api/v1/health`.
2. **Deploy the web app.** In Vercel, import the repo with **root directory `frontend`** (`vercel.json` is already there).
   Add the build-time variable `VITE_API_BASE_URL=https://your-api.example.com/api/v1`, then deploy.
3. Put the web app's final address into the API's `VOXSHIELD_CORS_ORIGINS` and redeploy the API.
4. Run the [smoke test](#verify-a-deployment).

## Option B: everything on one machine with Docker Compose

```bash
docker compose up --build        # web app on http://localhost:8080
```

The web container serves the site and forwards `/api` to the API container, so the browser sees a single address (no CORS).
The API is not published to the host. To serve it on the internet, put a TLS-terminating reverse proxy (Caddy, Traefik,
nginx with certificates, or your cloud's load balancer) in front of port 8080. **Without https the microphone does not work**,
except on `localhost`.

## Configuration reference

Set as environment variables (prefix `VOXSHIELD_`). Defaults are in `backend/app/config.py` and `backend/.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CORS_ORIGINS` | localhost dev addresses | Web app origins allowed to call the API |
| `CORS_ORIGIN_REGEX` | none | Pattern for origins you cannot list |
| `DOCS_ENABLED` | `true` (Docker image: `false`) | Interactive API docs at `/docs` |
| `RATE_LIMIT_PER_MINUTE` | `20` | Upload and analysis requests per client address per minute; `0` disables |
| `MAX_CONCURRENT_ANALYSES` | `4` | Analyses in flight; extra requests get a clear 503 |
| `MAX_UPLOAD_MB` / `MAX_DURATION_SECONDS` | `25` / `600` | Upload limits |
| `SCAM_DETECTOR` | `nli` | `nli` (language model) or `rules`. Never combined. |
| `PRELOAD_MODELS` | `true` | Load models at start-up instead of on the first request |
| `WHISPER_MODEL_SIZE` | `small` | `base` is faster and less accurate |
| `FORWARDED_ALLOW_IPS` (no prefix) | `127.0.0.1` | Proxies whose `X-Forwarded-For` is trusted |
| `HF_HUB_OFFLINE` (no prefix) | `1` in the image | Never contact Hugging Face at runtime |

**Rate limiting and proxies.** The limit is per client address. Behind a proxy every visitor looks like the proxy unless
`FORWARDED_ALLOW_IPS` lists it, in which case the real address from `X-Forwarded-For` is used. Never set it to `*` on an
API that is reachable directly from the internet, because anyone could then forge the header and dodge the limit.
Compose sets `*` because the API is reachable only through the web container, **and** the bundled `nginx.conf` overwrites
`X-Forwarded-For` with the real client address instead of appending to what the client sent. (Until Stage 6 it appended,
and a client could pick its own address: 30 requests with forged headers all got through a limit of 20. A test now
guards the nginx setting.) If another proxy or load balancer sits in front of the web container, configure nginx's `realip`
module rather than trusting the header blindly. The limiter keeps its counts in memory, so it is per replica and resets on restart.

## Privacy and security notes

* **Audio and transcripts are not kept.** Uploads go to temporary files (the framework's own spool file for uploads over
  1 MB, plus a `voxshield-*` folder) and are deleted when the analysis ends, including on errors and when the client
  disconnects; folders left by a crash are removed at the next start-up. Deletion is not a secure erase. In Compose, `/tmp`
  is a memory-backed filesystem, which keeps audio off the container's filesystem; it cannot promise the host never swaps
  that memory to disk. Playback on the results page uses the copy already in the visitor's browser.
* **No cache.** Every API response carries `Cache-Control: no-store`, since a response can contain a transcript.
* **No third parties.** Fonts are bundled; the site makes no requests to other hosts. The API contacts no one at runtime
  once the models are baked into the image.
* **Logs.** Application logs contain only error class names (unexpected errors included), never audio, transcripts, or file names. The web server's
  access log records the visitor's IP address and the request path, so apply your host's log-retention policy.
* **No accounts, no authentication.** Anyone who can reach the API can submit audio. Rate limiting and the concurrency cap
  stop casual abuse, not a determined one. For anything beyond a demo, put the API behind your platform's access controls.
* **The container runs as a non-root user.**
* **Upload size is enforced as the body arrives.** The limit applies to the bytes actually received, so a chunked upload
  with no `Content-Length` is cut off at the limit instead of being spooled to disk first.

### Known gaps (not fixed, by design or for lack of a requirement)

* **No analysis time limit.** A maximum-length recording (10 minutes by default) costs about four minutes of CPU, and
  speech-to-text runs one request at a time. Four such uploads fill every slot, and others get `503 busy`. For a public
  demo, lower `VOXSHIELD_MAX_DURATION_SECONDS` (for example to 120) and keep the rate limit on.
* **Slow uploads** hold a connection and a spool file until the proxy gives up. The bundled nginx has a 60 s timeout
  between body reads (nginx's documented default, not tested here); a deployment without a proxy has no such limit.
* **Busy responses come late.** The `503 busy` answer is sent after the upload has been received, not before.
* **Abandoned analyses finish their current stage.** When a client disconnects, its temporary files are removed at once and
  the work stops after the stage in progress, but the concurrency slot is released immediately, so a few abandoned jobs can
  briefly run beyond the cap.
* **WAV files with streaming headers** (sizes of `0xFFFFFFFF`) are refused as "too long". Recordings made in the browser
  are not affected.
* `/docs` is on by default outside Docker, the `Server: uvicorn` header is sent, and there is no authentication.
* This is a review of one codebase by its authors with hand-run experiments and tests. It is not an independent
  penetration test.
* The models are pinned to exact revisions (`backend/app/config.py`), so a rebuild fetches the same weights.

## Verify a deployment

```bash
cd backend && pip install httpx
python scripts/smoke_test.py https://your-api.example.com --origin https://your-app.vercel.app --wait-ready 180
# add --audio some-call.wav to run a real analysis end to end
```

It checks liveness, readiness (all three models loaded), the uncacheable headers, upload validation, and that CORS allows
your web app and refuses other origins. Then open the web app, upload a recording, record one, and press play on the results.

## Known gaps

* Docker images and `docker-compose.yml` were written carefully but never built or run here.
* The CI workflow (`.github/workflows/ci.yml`) has not run.
* No GPU path. Throughput is bounded by CPU; long recordings are slow by design.
* Accuracy has only been measured on small synthetic datasets (`backend/evaluation/RESULTS.md`), not on real calls.
