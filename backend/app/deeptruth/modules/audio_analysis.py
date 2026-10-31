"""Audio module: wraps VoxShield's existing voice-authenticity detector in DeepTruth's common format.

Nothing about the detector changes. This module only translates its result (a VoiceAssessment with per-window 'fake'
scores) into a score, a reliability and evidence the dashboard can draw: the windows as a timeline and a spectrogram."""

import logging

import numpy as np

from app.deeptruth.modules.spectrogram import spectrogram
from app.deeptruth.schemas import Evidence, MediaInfo, ModuleResult
from app.schemas_analysis import VoiceAssessment
from app.services.interfaces import Audio16k, ComponentFailure, VoiceAuthenticityClassifier
from app.services.voice_authenticity import LIMITATIONS as VOICE_LIMITATIONS

logger = logging.getLogger("deeptruth.audio")

SHORT_CLIP_SECONDS = 4.0
DEFAULT_CUTOFF = 0.5


def analyze_audio(audio: Audio16k, voice: VoiceAuthenticityClassifier, media: MediaInfo) -> ModuleResult:
    """Run the voice detector and express the outcome as a ModuleResult. Never raises: a failure becomes an
    'unavailable' module with reliability 0, so it cannot move the final verdict."""
    try:
        assessment = voice.classify(audio)
    except ComponentFailure as failure:
        return _unavailable(failure.message, audio, media)
    except Exception as error:  # a crash inside the model must not take the whole report down
        logger.error("voice detector failed unexpectedly: %s", type(error).__name__)
        return _unavailable("The voice detector failed unexpectedly.", audio, media)
    if assessment.verdict == "unavailable":
        return _unavailable(assessment.error or "The voice detector could not run.", audio, media)

    cutoff = assessment.fake_cutoff or DEFAULT_CUTOFF
    score = rescale(assessment.fake_score_median, cutoff) if assessment.fake_score_median is not None else 0.5
    reliability, reasons = estimate_reliability(assessment, media)
    limitations = [*reasons, *VOICE_LIMITATIONS]

    windows = [
        {"start_seconds": w.start_seconds, "end_seconds": w.end_seconds, "score": round(w.fake_score, 3), "flagged": w.fake_score >= cutoff}
        for w in assessment.windows
    ]
    evidence = [
        Evidence(type="timeline", label="Voice detector windows", data={"windows": windows, "cutoff": cutoff, "duration_seconds": media.duration_seconds}),
        Evidence(type="spectrogram", label="Spectrogram with flagged windows", data={**spectrogram(audio), "flagged": [w for w in windows if w["flagged"]]}),
        Evidence(
            type="metadata",
            label="Detector reading",
            data={
                "verdict": assessment.verdict,
                "summary": assessment.summary,
                "raw_median_fake_score": assessment.fake_score_median,
                "raw_max_fake_score": assessment.fake_score_max,
                "fake_cutoff": cutoff,
                "windows_analyzed": assessment.windows_analyzed,
                "windows_favoring_fake": assessment.windows_favoring_fake,
                "audio_band": assessment.audio_band,
                "decision_rule": assessment.decision_rule,
                "detectors": [{"model": d.model.name, "verdict": d.verdict, "median": d.fake_score_median} for d in assessment.detectors],
            },
        ),
    ]
    models = [d.model.name for d in assessment.detectors] or ([assessment.model.name] if assessment.model else [])
    return ModuleResult(
        modality="audio", score=round(score, 3), reliability=round(reliability, 2), evidence=evidence,
        limitations=limitations, summary=assessment.summary, models=models,
    )


def rescale(median: float, cutoff: float) -> float:
    """Map the detector's raw median to a 0-1 score where the detector's own decision cut-off sits at 0.5.

    VoxShield leans 'fake' from 0.2 on full-band audio, so a raw 0.2 would look like 'probably real' on a shared 0-1
    axis. Two straight-line pieces keep the ordering and put the cut-off where every other module puts its midpoint."""
    median = min(max(median, 0.0), 1.0)
    if median < cutoff:
        return 0.5 * median / cutoff
    return 0.5 + 0.5 * (median - cutoff) / (1.0 - cutoff)


def estimate_reliability(assessment: VoiceAssessment, media: MediaInfo) -> tuple[float, list[str]]:
    """A heuristic 0-1 weight for fusion, with the plain-language reason for each deduction.

    Starts at 0.8 (the detector was never evaluated on real calls, so it never reaches 1) and drops for conditions
    VoxShield's own benchmark showed to hurt it: phone-quality audio, very short clips, few windows, an inconclusive
    median, and two detectors that disagree."""
    reliability, reasons = 0.8, []
    duration = media.duration_seconds or 0.0
    if assessment.audio_band == "narrowband":
        reliability -= 0.3
        reasons.append("Phone or VoIP quality audio: the detector called up to 3 in 10 real voices 'fake' on such audio in VoxShield's benchmark.")
    if duration and duration < SHORT_CLIP_SECONDS:
        reliability -= 0.2
        reasons.append(f"Clip is only {duration:g} s long; the detector needs several seconds of speech for a stable reading.")
    if assessment.windows_analyzed < 2:
        reliability -= 0.15
        reasons.append("Fewer than two analysis windows: a single window's score is easily swayed by one noise or music burst.")
    if assessment.verdict == "inconclusive":
        reliability -= 0.2
        reasons.append("The detector's median score sits in its inconclusive band.")
    verdicts = {d.verdict for d in assessment.detectors if d.verdict != "unavailable"}
    if len(verdicts) > 1:
        reliability -= 0.1
        reasons.append("The two voice detectors disagree with each other.")
    if assessment.reliability_caution:
        reasons.append(assessment.reliability_caution.strip())
    return min(max(reliability, 0.05), 0.95), reasons


def _unavailable(message: str, audio: np.ndarray, media: MediaInfo) -> ModuleResult:
    """No score is guessed: 0.5 with reliability 0 contributes nothing to the fusion. The spectrogram is still shown."""
    return ModuleResult(
        modality="audio", score=0.5, reliability=0.0, status="unavailable", error=message,
        summary="Voice authenticity could not be assessed.",
        evidence=[Evidence(type="spectrogram", label="Spectrogram", data={**spectrogram(audio), "flagged": []})],
        limitations=[f"The voice detector did not run: {message}"],
    )
