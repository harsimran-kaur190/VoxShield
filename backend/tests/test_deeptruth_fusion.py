"""Phase 3: fusion rules and the limitations generator, on hand-built module results."""

from app.deeptruth.fusion import limitations
from app.deeptruth.fusion.fuse import find_disagreement, fuse, verdict_for
from app.deeptruth.schemas import MediaInfo, ModuleResult


def module(modality, score, reliability, status="ok", lims=()):
    return ModuleResult(modality=modality, score=score, reliability=reliability, status=status, limitations=list(lims), error="down" if status != "ok" else None)


def media(**kw) -> MediaInfo:
    base = dict(filename="f", kind="audio", format="wav", size_bytes=1000)
    base.update(kw)
    return MediaInfo(**base)


def test_one_strong_signal_decides_even_when_another_module_sees_nothing():
    """A real face with a cloned voice is a fake video: the strong voice reading decides, the conflict is still shown."""
    face_real, voice_fake = module("video_frames", 0.15, 0.6), module("audio", 0.9, 0.7)
    report = fuse([face_real, voice_fake], media(kind="video", format="mp4"))
    assert report.verdict == "Likely manipulated" and report.decided_by == "audio"
    assert report.disagreement == ["video-frame", "voice"]
    assert report.manipulation_likelihood == 0.9  # the deciding module's score is the headline...
    assert 0.5 < report.weighted_average < 0.6  # ...and the average is still reported next to it
    assert "strong signs of manipulation (0.90, reliability 70%)" in report.verdict_reason
    assert "Other modules saw nothing (video-frame 0.15)" in report.verdict_reason


def test_mixed_signals_when_modules_conflict_but_none_is_strong():
    face_real, voice_leaning_fake = module("image", 0.15, 0.6), module("audio", 0.72, 0.7)
    report = fuse([face_real, voice_leaning_fake], media(kind="video", format="mp4"))
    assert report.verdict == "Mixed signals" and report.decided_by is None
    assert "opposite directions" in report.verdict_reason
    assert report.manipulation_likelihood == report.weighted_average


def test_a_strong_score_needs_enough_reliability_and_a_measured_detector():
    phone_voice = module("audio", 0.95, 0.5)  # phone-quality audio drops voice reliability to 0.5
    assert fuse([phone_voice, module("image", 0.2, 0.6)], media()).verdict == "Mixed signals"
    out_of_sync = module("lipsync", 0.95, 0.9)  # heuristics never decide alone, whatever their score
    assert fuse([out_of_sync, module("video_frames", 0.2, 0.6)], media(kind="video", format="mp4")).decided_by is None


def test_every_module_gets_a_plain_language_description():
    report = fuse([module("audio", 0.9, 0.7), module("lipsync", 0.3, 0.5)], media())
    audio, lipsync = report.modules
    assert audio.basis == "measured" and "synthetic" in audio.checks and "VOICE_RESULTS" in audio.basis_note
    assert lipsync.basis == "heuristic" and "never" in lipsync.basis_note


def test_no_mixed_signals_when_the_dissenter_is_unreliable_or_close():
    assert find_disagreement([module("image", 0.15, 0.2), module("audio", 0.9, 0.7)]) is None  # too unreliable
    assert find_disagreement([module("image", 0.45, 0.7), module("audio", 0.7, 0.7)]) is None  # not far enough apart
    assert find_disagreement([module("image", 0.9, 0.7), module("audio", 0.8, 0.7)]) is None  # same side
    assert find_disagreement([module("image", 0.1, 0.7), module("audio", 0.9, 0.0, status="unavailable")]) is None


def test_verdict_bands_and_reasons():
    assert verdict_for(0.8, 0.7) == "Likely manipulated"
    assert verdict_for(0.2, 0.7) == "No manipulation detected"
    assert verdict_for(0.5, 0.7) == "Inconclusive"
    assert verdict_for(0.9, 0.1) == "Inconclusive"
    assert verdict_for(0.9, 0.7, ["image", "voice"]) == "Mixed signals"
    report = fuse([module("audio", 0.8, 0.7)], media())
    assert report.verdict_reason == "Reliability-weighted score 0.80 from 1 module, above 0.6."
    assert fuse([module("audio", 0.8, 0.1)], media()).verdict_reason.startswith("The modules that ran rated")


def test_file_limitations_are_specific_to_the_file():
    short_lossy = limitations.file_limitations(media(format="mp3", duration_seconds=2.5, sample_rate_hz=8000, channels=2))
    assert any("2.5 s" in s for s in short_lossy)
    assert any("8000 Hz" in s for s in short_lossy)
    assert any("Lossy MP3" in s for s in short_lossy)
    assert any("mixed down" in s for s in short_lossy)
    thin = limitations.file_limitations(media(kind="image", format="jpeg", width=4000, height=3000, size_bytes=400_000))
    assert any("Very large image" in s for s in thin) and any("Strongly compressed JPEG" in s for s in thin)
    assert limitations.file_limitations(media(kind="image", format="png", width=800, height=600, size_bytes=900_000)) == []
    silent = limitations.file_limitations(media(kind="video", format="mp4", width=320, height=240, has_audio=False, duration_seconds=10))
    assert any("no audio track" in s for s in silent) and any("Low video resolution" in s for s in silent)


def test_module_reliability_notes_and_dedupe():
    mods = [module("image", 0.5, 0.3, lims=["a", "b"]), module("audio", 0.5, 0.0, status="unavailable", lims=["b"])]
    items = limitations.generate(media(kind="video", format="mp4", width=1280, height=720, has_audio=True), mods)
    assert items[0].startswith("The image module rated its own reliability at 30%")
    assert items[1].startswith("The voice module did not run (down)")
    assert items[2:] == ["a", "b"]


def test_fuse_status_and_confidence():
    ok, down = module("audio", 0.9, 0.8, lims=["a"]), module("image", 0.5, 0.0, status="unavailable")
    report = fuse([ok, down], media())
    assert report.status == "partial" and report.confidence == 0.8 and report.verdict == "Likely manipulated"
    failed = fuse([down], media())
    assert failed.status == "failed" and failed.verdict == "Inconclusive"
    assert failed.limitations[0].startswith("No detection module produced a result")


def test_a_clean_consistency_check_is_not_a_vote_for_authentic():
    """A synthetic voice dubbed onto a mouth can be perfectly in sync, so 'in sync' must not create Mixed signals."""
    in_sync, steady, voice_fake = module("lipsync", 0.25, 0.5), module("video_temporal", 0.25, 0.3), module("audio", 0.95, 0.8)
    assert find_disagreement([in_sync, steady, voice_fake]) is None
    # An anomaly from a consistency check does count on the manipulated side.
    face_real, out_of_sync = module("video_frames", 0.2, 0.6), module("lipsync", 0.7, 0.5)
    assert find_disagreement([face_real, out_of_sync]) == ["video-frame", "audio-visual sync"]
