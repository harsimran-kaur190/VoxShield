"""Audio-visual sync consistency: does the mouth open when the audio gets loud?

Mouth openness per frame (inner-lip gap over face height, from MediaPipe landmarks) is compared with the audio's
loudness at the same instants (RMS energy over a 100 ms window, the same quantity as librosa.feature.rms). Both series
are standardised and correlated at time shifts of up to half a second. A real speaker on camera usually gives a clear
positive correlation near zero shift; a dubbed or lip-synced fake often gives a weak correlation or a shifted peak.

This is NOT phoneme-level analysis: it only checks that mouth movement and loudness rise and fall together.

HEURISTIC: the correlation cut-offs were set by reasoning. TODO(phase 5): check them on the evaluation set."""

import numpy as np

from app.deeptruth.modules.face_analysis import Face
from app.deeptruth.schemas import Evidence, ModuleResult
from app.services.audio_io import TARGET_SAMPLE_RATE

RMS_WINDOW_SECONDS = 0.1
MAX_LAG_SECONDS = 0.5
GOOD_CORRELATION = 0.35  # at or above: score 0.25
POOR_CORRELATION = 0.05  # at or below: score 0.7
SUSPICIOUS_LAG_SECONDS = 0.3
MIN_POINTS = 30  # 3 s at 10 frames per second
MAX_RELIABILITY = 0.5

LIMITATIONS = [
    "Audio-visual sync compares mouth opening with loudness only, not with the sounds being made. A real video can "
    "score poorly when the speaker is off camera, a voice-over or music is playing, several people talk, or the "
    "speaker mumbles; a good lip-sync deepfake can score well.",
]


def rms_at(audio: np.ndarray, times: np.ndarray, window: float = RMS_WINDOW_SECONDS, rate: int = TARGET_SAMPLE_RATE) -> np.ndarray:
    """Root-mean-square energy of the audio in a window centred on each time."""
    half = int(window * rate / 2)
    out = np.zeros(len(times), dtype=np.float32)
    for i, t in enumerate(times):
        centre = int(t * rate)
        chunk = audio[max(centre - half, 0): centre + half]
        out[i] = float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2))) if len(chunk) else 0.0
    return out


def lagged_correlation(mouth: np.ndarray, energy: np.ndarray, max_lag: int) -> list[tuple[int, float, int]]:
    """Pearson correlation of mouth[t] with energy[t + lag] for each lag, over points where the mouth is known (not NaN).
    A positive lag means the audio comes after the mouth movement. Returns (lag, r, points used)."""
    results = []
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            m, e = mouth[: len(mouth) - lag], energy[lag:]
        else:
            m, e = mouth[-lag:], energy[: len(energy) + lag]
        keep = ~np.isnan(m)
        m, e = m[keep], e[keep]
        if len(m) < 3 or m.std() < 1e-9 or e.std() < 1e-9:
            results.append((lag, 0.0, int(len(m))))
            continue
        results.append((lag, float(np.corrcoef(m, e)[0, 1]), int(len(m))))
    return results


def sync_score(correlation: float, lag_seconds: float) -> float:
    """Map the best correlation (and its shift) to 0-1, where higher means less consistent with real speech on camera."""
    if correlation >= GOOD_CORRELATION:
        score = 0.25
    elif correlation <= POOR_CORRELATION:
        score = 0.7
    else:
        score = 0.7 - (correlation - POOR_CORRELATION) / (GOOD_CORRELATION - POOR_CORRELATION) * 0.45
    if abs(lag_seconds) >= SUSPICIOUS_LAG_SECONDS and correlation > 0.15:
        score = max(score, 0.6)  # mouth and sound do move together, but out of step
    return score


def build_lipsync_module(track: list[tuple[float, Face | None]], audio: np.ndarray, spacing: float) -> ModuleResult:
    times = np.array([t for t, _ in track], dtype=np.float64)
    mouth = np.array([f.mouth_openness() if f is not None else np.nan for _, f in track], dtype=np.float64)
    energy = rms_at(audio, times).astype(np.float64)
    known = int((~np.isnan(mouth)).sum())
    if known < MIN_POINTS:
        return ModuleResult(
            modality="lipsync", score=0.5, reliability=0.0, status="unavailable",
            error=f"A face was visible in only {known} sampled frames; at least {MIN_POINTS} are needed.",
            summary="Audio-visual sync consistency could not be measured.",
            limitations=["Too few frames with a visible face to compare mouth movement with the audio."],
        )

    max_lag = int(round(MAX_LAG_SECONDS / spacing))
    results = lagged_correlation(mouth, energy, max_lag)
    best_lag, best_r, _ = max(results, key=lambda x: x[1])
    zero_r = next(r for lag, r, _ in results if lag == 0)
    lag_seconds = best_lag * spacing
    score = sync_score(best_r, lag_seconds)

    # Reliability: how much speech and how much face there was to compare.
    loud = energy > max(0.01, 0.1 * float(np.percentile(energy, 95)))
    speech_fraction = float(loud.mean())
    coverage = known / len(track)
    reliability, reasons = MAX_RELIABILITY, []
    if coverage < 0.8:
        reliability -= 0.2
        reasons.append(f"A face was visible in {coverage:.0%} of frames, so mouth movement is missing for part of the clip.")
    if speech_fraction < 0.3:
        reliability -= 0.2
        reasons.append(f"Only {speech_fraction:.0%} of the analysed time has clear sound, too little to compare with mouth movement.")
    if len(track) * spacing < 6:
        reliability -= 0.1
        reasons.append("Less than 6 s of video was available for the sync check.")
    mouth_range = float(np.nanpercentile(mouth, 95) - np.nanpercentile(mouth, 5))
    if mouth_range < 0.02:
        reliability -= 0.2
        reasons.append("The mouth barely moves in the analysed frames, so there is little to correlate.")

    span = max(float(np.nanmax(mouth)), 1e-6)
    top = max(float(energy.max()), 1e-6)
    series = {
        "times": [round(float(t), 2) for t in times],
        "mouth": [None if np.isnan(v) else round(float(v / span), 3) for v in mouth],
        "audio": [round(float(v / top), 3) for v in energy],
    }
    evidence = [
        Evidence(type="timeline", label="Mouth openness vs audio energy", data={"series": series, "duration_seconds": round(float(times[-1]), 2) if len(times) else None}),
        Evidence(type="metadata", label="Sync measurements", data={
            "best_correlation": round(best_r, 3),
            "best_lag_seconds": round(lag_seconds, 2),
            "correlation_at_zero_lag": round(zero_r, 3),
            "lag_meaning": "positive = the sound comes after the mouth moves",
            "frames_with_mouth": known,
            "speech_fraction": round(speech_fraction, 2),
            "correlation_by_lag": {f"{lag * spacing:+.1f}s": round(r, 3) for lag, r, _ in results},
        }),
    ]
    if abs(lag_seconds) < SUSPICIOUS_LAG_SECONDS:
        in_step = "in step"
    else:
        order = "after" if lag_seconds > 0 else "before"
        in_step = f"about {abs(lag_seconds):.1f} s out of step (the sound comes {order} the mouth moves)"
    summary = f"Mouth openness and audio loudness correlate at r = {best_r:.2f}, {in_step}."
    return ModuleResult(
        modality="lipsync", score=round(score, 3), reliability=round(max(reliability, 0.05), 2), evidence=evidence,
        limitations=[*reasons, *LIMITATIONS], summary=summary, models=["MediaPipe Face Landmarker + RMS energy correlation"],
    )
