"""Video-frames module: the image detector applied to frames spread across the video.

The same detector used for photos (UnivFD) scores about 16 whole frames. The module score is the median frame score,
so a few odd frames (motion blur, a scene cut) do not decide it."""

from dataclasses import dataclass, field

import numpy as np

from app.deeptruth.schemas import Evidence, MediaInfo, ModuleResult

FLAG_AT = 0.5  # the classifiers' own decision point

WEAKNESSES = [
    "Frame scores come from an image detector trained and checked on still images of fully generated content. It was "
    "not checked on video, and it is not built for face swaps, which keep the rest of each frame real; video "
    "compression also blurs the fine detail it relies on.",
]


@dataclass
class FrameReading:
    time: float
    on_face: bool  # False: no face, the whole frame was scored
    face_px: int | None
    probabilities: dict[str, float] = field(default_factory=dict)  # model name -> fake probability
    errors: dict[str, str] = field(default_factory=dict)

    @property
    def score(self) -> float | None:
        return float(np.mean(list(self.probabilities.values()))) if self.probabilities else None


def build_frames_module(readings: list[FrameReading], media: MediaInfo, spacing: float, frames_seen: int, frames_with_face: int) -> ModuleResult:
    scored = [r for r in readings if r.score is not None]
    if not scored:
        errors = sorted({e for r in readings for e in r.errors.values()}) or ["No frame could be scored."]
        return ModuleResult(
            modality="video_frames", score=0.5, reliability=0.0, status="unavailable", error="; ".join(errors),
            summary="No video frame could be scored.", limitations=[f"The frame classifier did not run: {'; '.join(errors)}"],
        )
    face_scores = [r.score for r in scored if r.on_face]
    use = [r.score for r in scored]
    score = float(np.median(use))
    reliability, reasons = _reliability(scored, frames_seen, frames_with_face, media)

    windows = [
        {"start_seconds": round(r.time, 2), "end_seconds": round(r.time + spacing, 2), "score": round(r.score, 3), "flagged": r.score >= FLAG_AT}
        for r in scored
    ]
    models = sorted({m for r in scored for m in r.probabilities})
    evidence = [
        Evidence(type="timeline", label="Frame classifier scores", data={"windows": windows, "cutoff": FLAG_AT, "duration_seconds": media.duration_seconds}),
        Evidence(type="metadata", label="Frame sampling", data={
            "frames_scored": len(scored),
            "frames_scored_on_a_face": len(face_scores),
            "frames_checked_for_faces": frames_seen,
            "frames_with_a_face": frames_with_face,
            "score_spread_iqr": round(float(np.subtract(*np.percentile(use, [75, 25]))), 3),
            "per_frame": [{"t": round(r.time, 2), "face_px": r.face_px, **{m.split("/")[-1]: round(p, 3) for m, p in r.probabilities.items()}} for r in scored],
        }),
    ]
    flagged = sum(w["flagged"] for w in windows)
    lean = "leans manipulated" if score >= 0.6 else "leans authentic" if score <= 0.4 else "is undecided"
    summary = f"{flagged} of {len(scored)} sampled frames scored at or above {FLAG_AT}; the median frame score is {score:.2f} and {lean}."
    return ModuleResult(
        modality="video_frames", score=round(score, 3), reliability=round(reliability, 2), evidence=evidence,
        limitations=[*reasons, *WEAKNESSES], summary=summary, models=models,
    )


def _reliability(scored: list[FrameReading], frames_seen: int, frames_with_face: int, media: MediaInfo) -> tuple[float, list[str]]:
    """Heuristic weight with reasons. 0.65 at best: the classifiers were never tested by this project on video."""
    reliability, reasons = 0.65, []
    coverage = frames_with_face / frames_seen if frames_seen else 0.0
    if coverage == 0:
        reasons.append("No face was found in any sampled frame; the frame scores still apply, but the sync and consistency checks have nothing to track.")
    if media.width and media.height and min(media.width, media.height) < 360:
        reliability -= 0.1
    disagree = [r for r in scored if len(r.probabilities) >= 2 and (max(r.probabilities.values()) >= 0.5) != (min(r.probabilities.values()) >= 0.5)]
    if len(disagree) > len(scored) / 2:
        reliability -= 0.15
        reasons.append(f"The two classifiers disagree on {len(disagree)} of {len(scored)} frames.")
    spread = np.subtract(*np.percentile([r.score for r in scored], [75, 25]))
    if spread > 0.3:
        reliability -= 0.1
        reasons.append(f"Frame scores vary widely (interquartile range {spread:.2f}), so the median is unstable.")
    if len(scored) < 5:
        reliability -= 0.1
        reasons.append(f"Only {len(scored)} frames could be scored.")
    return min(max(reliability, 0.05), 0.65), reasons
