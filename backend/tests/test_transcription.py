from types import SimpleNamespace

import numpy as np
import pytest

from app.config import Settings
from app.services.interfaces import ComponentFailure
from app.services.transcription import FasterWhisperTranscriber

AUDIO = np.zeros(16000, dtype=np.float32)


def seg(text, start=0.0, end=1.0, no_speech=0.01, logprob=-0.2):
    return SimpleNamespace(text=text, start=start, end=end, no_speech_prob=no_speech, avg_logprob=logprob)


class FakeWhisper:
    def __init__(self, segments, language="en", probability=0.98, error=None):
        self.segments, self.info, self.error = segments, SimpleNamespace(language=language, language_probability=probability), error

    def transcribe(self, audio, **kwargs):
        if self.error:
            raise self.error
        return iter(self.segments), self.info


def transcriber(model) -> FasterWhisperTranscriber:
    return FasterWhisperTranscriber(Settings(), model_factory=lambda s: model)


def test_segments_get_timestamps_and_offsets_that_match_the_text():
    result = transcriber(FakeWhisper([seg(" Hello there.", 0, 1.5), seg(" Send me the code.", 1.5, 3.2)])).transcribe(AUDIO)
    assert result.status == "ok" and result.language == "en"
    assert result.text == "Hello there. Send me the code."
    for s in result.segments:
        assert result.text[s.char_start : s.char_end] == s.text
    assert result.segments[1].start_seconds == 1.5


def test_no_segments_means_no_speech_and_no_invented_text():
    result = transcriber(FakeWhisper([])).transcribe(AUDIO)
    assert result.status == "no_speech" and result.text == "" and result.segments == []


def test_likely_hallucination_on_silence_is_dropped():
    result = transcriber(FakeWhisper([seg("Thank you.", no_speech=0.9, logprob=-1.5)])).transcribe(AUDIO)
    assert result.status == "no_speech"


def test_low_confidence_adds_a_quality_note():
    result = transcriber(FakeWhisper([seg("mumble", logprob=-1.4)], probability=0.4)).transcribe(AUDIO)
    assert len(result.quality_notes) == 2


def test_model_load_failure_is_reported_without_internal_details():
    def factory(_):
        raise RuntimeError("/private/path/leak")

    with pytest.raises(ComponentFailure) as info:
        FasterWhisperTranscriber(Settings(), model_factory=factory).transcribe(AUDIO)
    assert info.value.code == "model_load_failed" and "leak" not in info.value.message


def test_transcription_error_does_not_invent_a_transcript():
    with pytest.raises(ComponentFailure) as info:
        transcriber(FakeWhisper([], error=RuntimeError("decode"))).transcribe(AUDIO)
    assert info.value.code == "transcription_failed"


def test_hallucinated_scripts_marks_and_repeats_are_dropped():
    from app.services.transcription import _drop_hallucinations

    kept = [seg("Hello there, how are you"), seg("谢谢观看"), seg("..."), seg("ok"), seg("ok"), seg("ok")]
    assert [s.text for s in _drop_hallucinations(kept, "en")] == ["Hello there, how are you"]
    hindi = [seg("नमस्ते आप कैसे हैं"), seg("thanks for watching")]
    assert len(_drop_hallucinations(hindi, "hi")) == 2  # Latin is allowed in a Hindi call
