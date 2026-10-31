"""Frame-to-frame consistency: does the face behave like one solid face over time?

Two simple measurements on the face track (10 frames per second):
  1. Shape glitches. Take rigid points (nose, forehead, temples, cheekbones; not eyes or mouth, which move on their
     own). Align each frame's points to the previous frame's with a similarity transform, which removes head motion and
     zoom. What is left over is shape change. A real face changes smoothly; face-swap blending often makes the rigid
     parts wobble for a frame or two. Frames whose residual is far above the video's own typical level are flagged.
  2. Track breaks. The face vanishing for one frame between two frames where it is found, or the face box jumping.

HEURISTIC: the thresholds below were set by reasoning, not fitted to data. The reliability is capped low so this check
can colour, not decide, the verdict. TODO(phase 5): check the thresholds on the evaluation set."""

import numpy as np

from app.deeptruth.modules.face_analysis import Face
from app.deeptruth.schemas import Evidence, ModuleResult

# MediaPipe face-mesh indices on parts of the face that do not move by themselves.
RIGID_POINTS = [1, 4, 5, 6, 9, 10, 151, 168, 195, 197, 234, 454, 54, 284, 21, 251, 127, 356]
OUTLIER_MAD = 5.0  # a pair is a glitch when its residual exceeds median + 5 x MAD of this video...
MIN_GLITCH = 0.02  # ...and is at least 2% of the face width (so a perfectly steady video does not flag noise)
JUMP_FRACTION = 0.35  # a face box moving more than 35% of its width between two samples counts as a jump
MAX_RELIABILITY = 0.3
MIN_PAIRS = 10

LIMITATIONS = [
    "The frame-consistency check uses thresholds chosen by reasoning, not fitted on data; fast head turns, cuts and "
    "heavy motion blur can trigger it, and a careful deepfake with stable blending will pass it.",
]


def procrustes_residual(a: np.ndarray, b: np.ndarray) -> float:
    """Mean distance between point sets after the best similarity alignment of b onto a, divided by a's spread."""
    a0, b0 = a - a.mean(axis=0), b - b.mean(axis=0)
    na, nb = np.linalg.norm(a0), np.linalg.norm(b0)
    if na < 1e-9 or nb < 1e-9:
        return 0.0
    a0, b0 = a0 / na, b0 / nb
    u, _, vt = np.linalg.svd(b0.T @ a0)
    rotation = u @ vt
    scale = float(np.trace((b0 @ rotation).T @ a0))
    aligned = scale * (b0 @ rotation)
    # Back to units of face size: the normalised sets have unit norm over all points.
    return float(np.linalg.norm(aligned - a0, axis=1).mean() * np.sqrt(len(a)))


def build_temporal_module(track: list[tuple[float, Face | None]], spacing: float, image_width: int, image_height: int) -> ModuleResult:
    pairs = []  # (t0, t1, residual)
    jumps, dropouts = [], []
    for i in range(1, len(track)):
        (t0, f0), (t1, f1) = track[i - 1], track[i]
        if f0 is not None and f1 is not None and t1 - t0 <= 1.6 * spacing:
            # Landmarks are normalised 0-1 per axis; scale to pixels so non-square frames are not distorted.
            p0 = f0.landmarks[RIGID_POINTS] * (image_width, image_height)
            p1 = f1.landmarks[RIGID_POINTS] * (image_width, image_height)
            pairs.append((t0, t1, procrustes_residual(p0, p1)))
            move = np.hypot(f1.box[0] - f0.box[0], f1.box[1] - f0.box[1]) / max(f0.box[2], 1e-6)
            if move > JUMP_FRACTION:
                jumps.append(t1)
        if 0 < i < len(track) - 1 and f1 is None and f0 is not None and track[i + 1][1] is not None:
            dropouts.append(t1)

    if len(pairs) < MIN_PAIRS:
        return ModuleResult(
            modality="video_temporal", score=0.5, reliability=0.0, status="unavailable",
            error=f"Only {len(pairs)} consecutive frame pairs with a face; at least {MIN_PAIRS} are needed.",
            summary="Frame-to-frame consistency could not be measured.",
            limitations=["Too few consecutive frames with a visible face to check frame-to-frame consistency."],
        )

    residuals = np.array([r for _, _, r in pairs])
    median = float(np.median(residuals))
    mad = float(np.median(np.abs(residuals - median))) or 1e-6
    threshold = max(median + OUTLIER_MAD * mad, MIN_GLITCH)
    glitches = residuals > threshold
    events = int(glitches.sum()) + len(jumps) + len(dropouts)
    rate = events / len(pairs)
    # 0 events -> 0.25 (no sign of trouble, but this check cannot vouch for a video); 10%+ of pairs -> 0.8.
    score = 0.25 + min(rate / 0.10, 1.0) * 0.55

    reliability, reasons = MAX_RELIABILITY, []
    if len(pairs) < 30:
        reliability -= 0.1
        reasons.append(f"Only {len(pairs)} frame pairs with a face were available for the consistency check.")

    top = max(float(residuals.max()), threshold) * 1.25
    windows = [
        {"start_seconds": round(t0, 2), "end_seconds": round(t1, 2), "score": round(min(r / top, 1.0), 3), "flagged": bool(g)}
        for (t0, t1, r), g in zip(pairs, glitches)
    ]
    evidence = [
        Evidence(type="timeline", label="Face shape change between frames", data={"windows": windows, "cutoff": round(threshold / top, 3), "duration_seconds": None}),
        Evidence(type="metadata", label="Consistency measurements", data={
            "frame_pairs": len(pairs),
            "median_residual": round(median, 4),
            "glitch_threshold": round(threshold, 4),
            "shape_glitches": int(glitches.sum()),
            "face_box_jumps": [round(t, 2) for t in jumps],
            "one_frame_dropouts": [round(t, 2) for t in dropouts],
            "note": "Residual = how much the nose, forehead, temples and cheekbones changed shape between two frames after head motion and zoom were removed, as a fraction of face size.",
        }),
    ]
    summary = f"{events} inconsistency events in {len(pairs)} frame pairs ({int(glitches.sum())} shape glitches, {len(jumps)} box jumps, {len(dropouts)} one-frame dropouts)."
    return ModuleResult(
        modality="video_temporal", score=round(score, 3), reliability=round(max(reliability, 0.05), 2), evidence=evidence,
        limitations=[*reasons, *LIMITATIONS], summary=summary, models=["MediaPipe Face Landmarker + Procrustes alignment (heuristic)"],
    )
