"""Multilingual foundation: language selection, Whisper language codes, language metadata, and the guard that stops the
English-only scam detectors from running on other languages.

Everything here uses stand-ins for the models (a fake Whisper that records what it was asked, fake components in the
pipeline), so it tests the wiring and the decision logic. It says nothing about how well Hindi or Punjabi is transcribed
or translated. Scam detection through translation is covered here and in test_multilingual_intent.py. The opt-in
real-model tests at the end of test_real_models.py run the actual models on spoken Hindi."""

import tempfile
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.dependencies import get_pipeline
from app.main import app
from app.schemas_analysis import AnalysisReport, TranscriptResult, TranscriptSegment
from app.services.languages import (
    NAMES,
    SCAM_DETECTION_LANGUAGES,
    scam_detection_route,
    SELECTABLE,
    TRANSLATED_SCAM_LANGUAGES,
    UnsupportedLanguage,
    language_name,
    parse_requested_language,
    scam_detection_block,
    whisper_code,
)
from app.services.pipeline import AnalysisPipeline, language_info
from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from app.services.transcription import FasterWhisperTranscriber
from tests.helpers import FAIL, FakeTranscriber, FakeVoice, make_wav, transcript_of, translation_of, voice_result
from tests.test_scam_nli import analyzer as nli_analyzer

AUDIO = np.zeros(16000, dtype=np.float32)
HINDI = "मुझे अपना कोड बताइए।"  # "Please tell me your code." Used only as opaque text.
PUNJABI = "ਮੈਨੂੰ ਆਪਣਾ ਕੋਡ ਦੱਸੋ।"
client = TestClient(app)


# ---- the language list and the mapping to Whisper codes -------------------------------------------------------------


def test_the_selectable_languages_are_auto_english_and_hindi():
    assert [(o.code, o.name) for o in SELECTABLE] == [("auto", "Auto-detect"), ("en", "English"), ("hi", "Hindi")]


@pytest.mark.parametrize("sent, parsed", [(None, "auto"), ("", "auto"), ("   ", "auto"), ("auto", "auto"), ("AUTO", "auto"), ("en", "en"), ("hi", "hi"), (" HI ", "hi")])
def test_a_missing_or_valid_language_is_accepted_and_normalized(sent, parsed):
    assert parse_requested_language(sent) == parsed


@pytest.mark.parametrize("bad", ["pa", "Pa", "fr", "xx", "zh", "english", "hi-IN", "pa-Guru", "hi,pa", "../etc/passwd", "'; DROP TABLE x;--", "a" * 500, "\x00", "ਪੰਜਾਬੀ"])
def test_anything_else_is_rejected_safely(bad):
    with pytest.raises(UnsupportedLanguage) as error:
        parse_requested_language(bad)
    assert bad[:20] not in str(error.value) or len(bad) <= 2  # the message lists what is allowed; it does not echo the input
    assert str(error.value).endswith("Choose one of: auto, en, hi.")


def test_whisper_gets_the_right_code_or_none_for_auto():
    assert [whisper_code(c) for c in ("auto", "en", "hi")] == [None, "en", "hi"]


def test_language_names_cover_the_selectable_languages_and_fall_back_to_the_code():
    assert [language_name(c) for c in ("en", "hi", "pa", "ur")] == ["English", "Hindi", "Punjabi", "Urdu"]
    assert language_name("xx") == "xx" and language_name(None) is None
    assert {"en", "hi", "pa"} <= set(NAMES)  # Punjabi is no longer selectable, but detected Punjabi is still named


def test_only_english_is_read_directly_and_only_hindi_and_urdu_go_through_translation():
    assert SCAM_DETECTION_LANGUAGES == {"en"}
    assert TRANSLATED_SCAM_LANGUAGES == {"hi", "ur"}


# ---- transcription: what Whisper is asked, and what is claimed about the answer -----------------------------------------


def seg(text, start=0.0, end=2.0, logprob=-0.2):
    return SimpleNamespace(text=text, start=start, end=end, no_speech_prob=0.01, avg_logprob=logprob)


class RecordingWhisper:
    """Stands in for faster-whisper's model. Records every call so a test can see what was asked of it."""

    def __init__(self, segments, language="en", probability=0.97, guess=("en", 0.97), guess_error=None):
        self.segments, self.info = segments, SimpleNamespace(language=language, language_probability=probability)
        self.guess, self.guess_error = guess, guess_error
        self.transcribe_calls: list[dict] = []
        self.detect_calls = 0

    def transcribe(self, audio, **kwargs):
        self.transcribe_calls.append(kwargs)
        return iter(self.segments), self.info

    def detect_language(self, audio, **kwargs):
        self.detect_calls += 1
        if self.guess_error:
            raise self.guess_error
        return self.guess[0], self.guess[1], [self.guess]


def transcriber(model, **settings) -> FasterWhisperTranscriber:
    return FasterWhisperTranscriber(Settings(**settings), model_factory=lambda s: model)


def test_auto_mode_lets_whisper_detect_and_reports_its_detection_score():
    model = RecordingWhisper([seg("Hello there.")], language="en", probability=0.97)
    result = transcriber(model).transcribe(AUDIO)
    assert model.transcribe_calls[0]["language"] is None
    assert (result.language, result.language_source, result.language_probability) == ("en", "detected", 0.97)
    assert model.detect_calls == 0  # no second pass when Whisper already detects the language
    assert result.detected_language is None and result.language_mismatch is False


@pytest.mark.parametrize("code", ["en", "hi", "pa"])
def test_manual_mode_passes_the_chosen_whisper_code_and_invents_no_confidence(code):
    # Whisper reports probability 1.0 when it is told the language. That is not a measurement, so it must not be shown.
    model = RecordingWhisper([seg(HINDI)], language=code, probability=1.0, guess=(code, 0.99))
    result = transcriber(model).transcribe(AUDIO, language=code)
    assert model.transcribe_calls[0]["language"] == code
    assert (result.language, result.language_source) == (code, "selected")
    assert result.language_probability is None


def test_the_transcript_stays_in_the_spoken_language_and_is_never_translated():
    model = RecordingWhisper([seg(HINDI), seg(PUNJABI, 2, 4)], language="hi", probability=1.0, guess=("hi", 0.95))
    result = transcriber(model).transcribe(AUDIO, language="hi")
    assert result.text == f"{HINDI} {PUNJABI}"
    assert [s.text for s in result.segments] == [HINDI, PUNJABI]
    assert model.transcribe_calls[0].get("task", "transcribe") == "transcribe"  # never "translate"
    for s in result.segments:
        assert result.text[s.char_start : s.char_end] == s.text  # offsets still index the original-language text


def test_a_selection_that_disagrees_with_a_confident_language_guess_is_flagged_not_trusted():
    model = RecordingWhisper([seg("some text")], language="en", probability=1.0, guess=("hi", 0.93))
    result = transcriber(model).transcribe(AUDIO, language="en")
    assert (result.detected_language, result.detected_language_score, result.language_mismatch) == ("hi", 0.93, True)
    assert any("You selected English" in n and "sounded like Hindi" in n and "93%" in n for n in result.quality_notes)


def test_a_weak_disagreement_is_not_called_a_mismatch():
    model = RecordingWhisper([seg("some text")], language="en", probability=1.0, guess=("hi", 0.55))
    result = transcriber(model).transcribe(AUDIO, language="en")
    assert result.language_mismatch is False and result.detected_language == "hi"
    assert not any("sounded like" in n for n in result.quality_notes)


def test_a_failing_language_check_never_fails_the_transcription():
    model = RecordingWhisper([seg("Hello there.")], language="en", probability=1.0, guess_error=RuntimeError("/private/path"))
    result = transcriber(model).transcribe(AUDIO, language="en")
    assert result.status == "ok" and result.detected_language is None and result.language_mismatch is False


def test_a_model_without_the_language_check_still_works_in_manual_mode():
    model = SimpleNamespace(transcribe=lambda audio, **kw: (iter([seg("Hello")]), SimpleNamespace(language="en", language_probability=1.0)))
    assert transcriber(model).transcribe(AUDIO, language="en").status == "ok"


def test_a_language_pinned_in_the_server_settings_counts_as_selected():
    model = RecordingWhisper([seg("Hello")], language="en", probability=1.0, guess=("en", 0.9))
    result = transcriber(model, whisper_language="en").transcribe(AUDIO)
    assert model.transcribe_calls[0]["language"] == "en"
    assert (result.language_source, result.language_probability) == ("selected", None)


def test_no_speech_keeps_the_selected_language_but_invents_none_in_auto_mode():
    manual = transcriber(RecordingWhisper([])).transcribe(AUDIO, language="pa")
    assert (manual.status, manual.language, manual.language_source) == ("no_speech", "pa", "selected")
    auto = transcriber(RecordingWhisper([])).transcribe(AUDIO)
    assert (auto.status, auto.language, auto.language_source) == ("no_speech", None, None)


def test_low_confidence_language_detection_is_noted_only_when_the_language_was_detected():
    low = transcriber(RecordingWhisper([seg("mumble")], probability=0.4)).transcribe(AUDIO)
    assert any("language was detected with low confidence" in n for n in low.quality_notes)
    chosen = transcriber(RecordingWhisper([seg("mumble")], probability=1.0, guess=("en", 0.9))).transcribe(AUDIO, language="en")
    assert not any("low confidence" in n and "language" in n for n in chosen.quality_notes)


# ---- language metadata in the report ----------------------------------------------------------------------------------


def lang_transcript(text, code, source, probability=None, **extra) -> TranscriptResult:
    segment = TranscriptSegment(index=0, start_seconds=0, end_seconds=3, text=text, char_start=0, char_end=len(text))
    return TranscriptResult(status="ok", text=text, language=code, language_source=source, language_probability=probability, segments=[segment], **extra)


def test_detected_language_metadata_carries_the_detection_score():
    info = language_info("auto", lang_transcript("Hello there my friend.", "en", "detected", 0.97))
    assert (info.requested, info.code, info.name, info.source, info.detection_score) == ("auto", "en", "English", "detected", 0.97)
    assert info.scam_detection_supported is True and info.scam_detection_note is None and info.transcription_note is None


def test_selected_language_metadata_has_no_score_and_says_scam_detection_runs_through_a_translation():
    info = language_info("hi", lang_transcript(HINDI, "hi", "selected"))
    assert (info.requested, info.code, info.name, info.source) == ("hi", "hi", "Hindi", "selected")
    assert info.detection_score is None
    assert (info.scam_detection_supported, info.scam_detection_mode, info.scam_detection_note) == (True, "translated", None)
    assert "machine translation" in (info.translation_note or "") and "has not measured" in info.translation_note
    assert "has not measured its accuracy" in (info.transcription_note or "")


def test_english_is_read_directly_and_has_no_translation_note():
    info = language_info("en", lang_transcript("Hello there my friend.", "en", "selected"))
    assert (info.scam_detection_mode, info.translation_note) == ("direct", None)


def test_the_voice_model_is_never_described_as_validated_in_any_language():
    for transcript in (lang_transcript("Hello there my friend.", "en", "detected", 0.97), lang_transcript(HINDI, "hi", "selected")):
        note = language_info("auto", transcript).voice_note
        assert "not on real calls" in note and "weak evidence" in note
        assert not any(word in note.lower() for word in ("validated for", "works well", "accurate in"))


def test_a_language_the_scam_detectors_do_not_know_is_reported_by_name_not_hidden():
    info = language_info("auto", lang_transcript("texto", "es", "detected", 0.9))
    assert (info.code, info.name, info.scam_detection_supported, info.scam_detection_mode) == ("es", "Spanish", False, "not_run")
    assert "not validated for Spanish" in (info.scam_detection_note or "")


def test_missing_language_metadata_is_unknown_and_not_guessed():
    missing = language_info("auto", TranscriptResult(status="ok", text="Hello there my friend.", segments=[]))
    assert (missing.code, missing.name, missing.source, missing.detection_score) == (None, None, "unknown", None)
    assert missing.scam_detection_supported is None and missing.scam_detection_note is None


def test_a_failed_transcription_still_reports_what_was_asked_for_and_nothing_else():
    info = language_info("hi", TranscriptResult(status="unavailable", error="The audio could not be transcribed."))
    assert (info.requested, info.code, info.source, info.scam_detection_supported) == ("hi", None, "unknown", None)
    assert info.voice_note


def test_a_mismatch_is_carried_into_the_metadata_and_blocks_scam_detection():
    t = lang_transcript("some english looking text", "en", "selected", detected_language="hi", detected_language_score=0.94, language_mismatch=True)
    info = language_info("en", t)
    assert (info.mismatch, info.detected_code, info.detected_name, info.detected_score) == (True, "hi", "Hindi", 0.94)
    assert info.scam_detection_supported is False and "sounded like Hindi" in (info.scam_detection_note or "")


# ---- the scam-detection guard, shared by both detectors ------------------------------------------------------------------

BANK = "Please read me the one time password we just sent you, and do not tell anyone about this call."


@pytest.mark.parametrize("make", [lambda: RuleBasedScamIntentAnalyzer(), lambda: nli_analyzer({})[0]], ids=["rules", "nli"])
class TestBothDetectorsRefuseLanguagesTheyWereNotBuiltFor:
    def test_original_hindi_text_is_never_read_by_the_english_detectors(self, make):
        # English words with a Hindi label: the label decides, because the detectors only know English text. The
        # pipeline hands them an English translation of Hindi speech instead (see the API tests below).
        result = make().analyze(lang_transcript(BANK, "hi", "selected"))
        assert result.risk == "inconclusive" and result.indicators == []
        assert "cannot read Hindi text directly" in result.summary
        assert "elevated" not in result.risk and "none_detected" not in result.risk  # neither a warning nor a clearance

    def test_a_confidently_detected_punjabi_transcript_gets_no_scam_verdict(self, make):
        result = make().analyze(lang_transcript(BANK, "pa", "detected", 0.9))
        assert result.risk == "inconclusive" and result.indicators == []
        assert "not validated for Punjabi" in result.summary

    def test_a_language_with_no_translation_path_gets_no_scam_verdict(self, make):
        result = make().analyze(lang_transcript(BANK, "es", "detected", 0.9))
        assert result.risk == "inconclusive" and "not validated for Spanish" in result.summary

    def test_a_weak_unconfirmed_language_guess_does_not_block_english_wording(self, make):
        assert make().analyze(lang_transcript(BANK, "hi", "detected", 0.3)).risk != "unavailable"
        assert "not validated" not in make().analyze(lang_transcript(BANK, "hi", "detected", 0.3)).summary

    def test_english_still_runs(self, make):
        for transcript in (lang_transcript(BANK, "en", "selected"), lang_transcript(BANK, "en", "detected", 0.99), transcript_of(BANK)):
            assert "not validated" not in make().analyze(transcript).summary

    def test_a_mismatch_between_the_selection_and_the_audio_blocks_the_verdict(self, make):
        t = lang_transcript(BANK, "en", "selected", detected_language="hi", detected_language_score=0.95, language_mismatch=True)
        result = make().analyze(t)
        assert result.risk == "inconclusive" and result.indicators == []
        assert "You selected English" in result.summary and "sounded like Hindi" in result.summary


def test_the_guard_reasons_are_never_phrased_as_safe_or_as_a_scam():
    for t in (lang_transcript(BANK, "hi", "selected"), lang_transcript(BANK, "en", "selected", detected_language="pa", detected_language_score=0.9, language_mismatch=True)):
        text = scam_detection_block(t) or ""
        assert text and not any(w in text.lower() for w in ("safe", "scam call", "fraud", "legitimate"))


# ---- the API ---------------------------------------------------------------------------------------------------------


def use(transcriber_, voice=None):
    app.dependency_overrides[get_pipeline] = lambda: AnalysisPipeline(
        get_settings(), transcriber_, voice or FakeVoice(voice_result("model_favors_real")), RuleBasedScamIntentAnalyzer()
    )


@pytest.fixture(autouse=True)
def reset_overrides():
    yield
    app.dependency_overrides.clear()


def post(path="/api/v1/analysis", language="__omit__", data=None):
    form = {} if language == "__omit__" else {"language": language}
    return client.post(path, files={"file": ("call.wav", data if data is not None else make_wav(6, amplitude=0.2), "audio/wav")}, data=form)


def leftovers() -> set[str]:
    return {p.name for p in Path(tempfile.gettempdir()).glob("voxshield-*")}


def test_existing_clients_that_send_no_language_keep_working_exactly_as_before():
    fake = FakeTranscriber(transcript_of(BANK))
    use(fake)
    response = post()
    assert response.status_code == 200
    report = AnalysisReport.model_validate(response.json())
    assert fake.languages_requested == [None]  # auto-detect, the previous behavior
    assert report.language is not None and report.language.requested == "auto"
    assert report.intent.risk in {"elevated", "high"}  # English scam detection is untouched
    assert {"status", "audio", "transcript", "voice", "intent", "recommendations", "errors", "privacy", "timings_seconds", "notice"} <= set(response.json())


@pytest.mark.parametrize("sent, asked", [("auto", None), ("en", "en"), ("hi", "hi"), (" HI ", "hi"), ("", None)])
def test_the_requested_language_reaches_the_transcriber_as_a_whisper_code(sent, asked):
    fake = FakeTranscriber(lang_transcript(BANK, asked or "en", "selected" if asked else "detected", None if asked else 0.98))
    use(fake)
    assert post(language=sent).status_code == 200
    assert fake.languages_requested == [asked]


def test_the_streaming_endpoint_takes_the_same_option():
    import json

    fake = FakeTranscriber(lang_transcript(HINDI, "hi", "selected"))
    use(fake)
    response = post("/api/v1/analysis/stream", language="hi")
    assert response.status_code == 200 and fake.languages_requested == ["hi"]
    report = json.loads(response.text.splitlines()[-1])["report"]
    assert report["language"]["requested"] == "hi" and report["language"]["code"] == "hi"


@pytest.mark.parametrize("bad", ["pa", "fr", "klingon", "hi-IN", "a" * 300, "<script>alert(1)</script>"])
@pytest.mark.parametrize("path", ["/api/v1/analysis", "/api/v1/analysis/stream"])
def test_an_unsupported_language_is_rejected_before_any_work_is_done(path, bad):
    fake = FakeTranscriber(transcript_of(BANK))
    use(fake)
    before = leftovers()
    response = post(path, language=bad)
    assert response.status_code == 422
    body = response.json()["detail"]
    assert body["code"] == "unsupported_language" and body["message"].endswith("Choose one of: auto, en, hi.")
    assert len(bad) <= 2 or bad not in response.text  # the rejected value is not echoed back
    assert fake.languages_requested == []  # no transcription, no models touched
    assert leftovers() == before  # nothing was written
    assert response.headers["cache-control"] == "no-store"


def test_a_bad_language_does_not_use_up_an_analysis_slot():
    use(FakeTranscriber(transcript_of(BANK)))
    for _ in range(10):
        assert post(language="fr").status_code == 422
    assert post(language="en").status_code == 200  # still room: the rejected requests never took a slot


TRANSLATED_BANK = "Please tell me your one time password."


def test_selecting_hindi_checks_an_english_translation_and_keeps_the_hindi_transcript():
    fake = FakeTranscriber(lang_transcript(HINDI, "hi", "selected"), translation=translation_of(TRANSLATED_BANK, 0, 3))
    use(fake)
    report = AnalysisReport.model_validate(post(language="hi").json())
    assert fake.translations_requested == ["hi"]
    assert report.transcript.text == HINDI  # the original-language transcript is returned untouched
    assert report.translation is not None and report.translation.text == TRANSLATED_BANK
    lang = report.language
    assert (lang.requested, lang.code, lang.name, lang.source, lang.detection_score) == ("hi", "hi", "Hindi", "selected", None)
    assert (lang.scam_detection_supported, lang.scam_detection_mode) == (True, "translated")
    intent = report.intent
    assert intent.analyzed_text == "translation" and intent.risk in {"elevated", "high"}
    assert "machine translation of the Hindi speech" in intent.summary
    sources = {i.text_source for i in intent.indicators}
    assert sources == {"translation", "transcript"}  # the translated finding and the Hindi keyword rule both count
    translated = next(i for i in intent.indicators if i.text_source == "translation")
    assert translated.original_text == HINDI and translated.original_segment_index == 0 and translated.id.startswith("tr-")
    native = next(i for i in intent.indicators if i.text_source == "transcript")
    assert HINDI[native.char_start : native.char_end] == native.excerpt  # offsets point into the Hindi text
    assert report.voice.verdict == "model_favors_real"  # the voice assessment is separate and still runs
    assert "not on real calls" in lang.voice_note


def test_detected_punjabi_speech_is_transcribed_but_not_translated_or_given_a_scam_verdict():
    fake = FakeTranscriber(lang_transcript(PUNJABI, "pa", "detected", 0.95), translation=translation_of(TRANSLATED_BANK, 0, 3))
    use(fake)
    report = AnalysisReport.model_validate(post(language="auto").json())
    assert fake.translations_requested == [] and report.translation is None
    assert report.transcript.text == PUNJABI  # the transcript is still shown
    assert report.language.name == "Punjabi" and report.language.scam_detection_mode == "not_run"
    assert report.intent.risk == "inconclusive" and report.intent.indicators == []
    assert "not validated for Punjabi" in report.intent.summary
    assert report.voice.verdict != "unavailable"  # the voice check does not depend on the language


def test_english_is_never_translated():
    fake = FakeTranscriber(lang_transcript(BANK, "en", "selected"), translation=translation_of("unused"))
    use(fake)
    report = AnalysisReport.model_validate(post(language="en").json())
    assert fake.translations_requested == [] and report.translation is None
    assert report.intent.analyzed_text == "transcript" and "translation" not in report.timings_seconds


def test_a_failed_translation_is_reported_and_the_hindi_keyword_rules_still_run():
    fake = FakeTranscriber(lang_transcript(HINDI, "hi", "selected"), translate_error=FAIL)
    use(fake)
    report = AnalysisReport.model_validate(post(language="hi").json())
    assert report.translation is not None and report.translation.status == "unavailable"
    assert any(e.component == "transcription" for e in report.errors)
    assert [i.rule_id for i in report.intent.indicators] == ["indic_cred_request"]
    assert report.intent.method is not None and report.intent.method.name == "voxshield-indic-keyword-rules"


def test_with_no_translation_and_no_keyword_match_the_result_is_inconclusive_not_quiet():
    quiet = "नमस्ते, आज मौसम बहुत अच्छा है और मैं घर जा रहा हूँ।"
    use(FakeTranscriber(lang_transcript(quiet, "hi", "selected"), translate_error=FAIL))
    intent = AnalysisReport.model_validate(post(language="hi").json()).intent
    assert intent.risk == "inconclusive" and intent.indicators == []
    assert "too narrow" in intent.summary


def test_auto_detection_of_another_language_is_reported_with_its_detection_score():
    use(FakeTranscriber(lang_transcript(HINDI, "hi", "detected", 0.91), translation=translation_of(TRANSLATED_BANK)))
    lang = AnalysisReport.model_validate(post(language="auto").json()).language
    assert (lang.requested, lang.code, lang.source, lang.detection_score) == ("auto", "hi", "detected", 0.91)
    assert (lang.scam_detection_supported, lang.scam_detection_mode) == (True, "translated")


def test_a_detected_language_with_no_translation_path_gets_no_scam_verdict():
    fake = FakeTranscriber(lang_transcript("texto", "es", "detected", 0.95), translation=translation_of(TRANSLATED_BANK))
    use(fake)
    report = AnalysisReport.model_validate(post().json())
    assert fake.translations_requested == [] and report.intent.risk == "inconclusive"
    assert report.language.scam_detection_mode == "not_run"


def test_english_is_unchanged_and_supported():
    use(FakeTranscriber(lang_transcript(BANK, "en", "selected")))
    report = AnalysisReport.model_validate(post(language="en").json())
    assert report.language.scam_detection_supported is True and report.language.scam_detection_note is None
    assert report.intent.risk in {"elevated", "high"} and report.intent.indicators


def test_a_transcription_failure_still_returns_a_report_with_the_requested_language_and_no_guessed_one():
    use(FakeTranscriber(error=FAIL), FakeVoice(voice_result("model_favors_real")))
    report = AnalysisReport.model_validate(post(language="hi").json())
    assert report.status == "partial" and report.transcript.status == "unavailable"
    assert (report.language.requested, report.language.code, report.language.source) == ("hi", None, "unknown")
    assert report.language.scam_detection_supported is None
    assert report.intent.risk == "unavailable"


def test_a_transcript_with_no_language_metadata_is_reported_as_unknown():
    use(FakeTranscriber(transcript_of(BANK, language=None)))
    report = AnalysisReport.model_validate(post().json())
    assert (report.language.code, report.language.source, report.language.scam_detection_supported) == (None, "unknown", None)
    assert report.intent.risk in {"elevated", "high"}  # no language claim means no language block: behavior as before


def test_everything_failing_still_reports_the_requested_language():
    use(FakeTranscriber(error=FAIL), FakeVoice(error=FAIL))
    report = AnalysisReport.model_validate(post(language="hi").json())
    assert report.status == "failed" and report.language.requested == "hi"


def test_the_limits_endpoint_lists_the_languages_and_which_have_validated_scam_detection():
    languages = {l["code"]: l for l in client.get("/api/v1/limits").json()["languages"]}
    assert list(languages) == ["auto", "en", "hi"]
    assert [languages[c]["scam_detection_validated"] for c in ("auto", "en", "hi")] == [None, True, False]
    assert [languages[c]["scam_detection"] for c in ("auto", "en", "hi")] == [None, "direct", "translated"]


def test_nothing_about_the_language_is_stored():
    use(FakeTranscriber(lang_transcript(HINDI, "hi", "selected")))
    before = leftovers()
    report = post(language="hi").json()
    assert report["privacy"] == {"audio_stored": False, "transcript_stored": False}
    assert leftovers() == before


# ---- the next step must not imply a scam check that did not happen ------------------------------------------------------


def test_a_voice_only_next_step_for_an_unchecked_language_does_not_claim_the_conversation_was_checked():
    use(FakeTranscriber(lang_transcript("texto", "es", "detected", 0.95)), FakeVoice(voice_result("model_favors_fake")))
    report = AnalysisReport.model_validate(post().json())
    headline = report.recommendations.headline
    assert "no direct scam request was found" not in headline
    assert "Scam detection did not run for this recording" in headline and "nothing is known about what was said" in headline
    assert [i.basis for i in report.recommendations.items] == ["voice"]  # the voice item stays, labelled as voice-only advice


def test_a_hindi_finding_from_the_translation_drives_the_next_step():
    use(FakeTranscriber(lang_transcript(HINDI, "hi", "selected"), translation=translation_of(TRANSLATED_BANK)))
    plan = AnalysisReport.model_validate(post(language="hi").json()).recommendations
    assert plan.state == "actions" and plan.items[0].id == "credentials"


def test_the_english_voice_only_next_step_is_unchanged():
    benign = "Hi, your parcel will arrive on Tuesday afternoon between two and four, please be home to sign for it, thank you."
    use(FakeTranscriber(lang_transcript(benign, "en", "detected", 0.99)), FakeVoice(voice_result("model_favors_fake")))
    headline = AnalysisReport.model_validate(post().json()).recommendations.headline
    assert "no direct scam request was found in the conversation" in headline


def test_a_wrong_language_selection_also_does_not_claim_the_conversation_was_checked():
    t = lang_transcript("some english looking text here", "en", "selected", detected_language="hi", detected_language_score=0.9, language_mismatch=True)
    use(FakeTranscriber(t), FakeVoice(voice_result("model_favors_fake")))
    headline = AnalysisReport.model_validate(post(language="en").json()).recommendations.headline
    assert "no direct scam request was found" not in headline and "did not run" in headline


def test_weakly_detected_punjabi_written_in_another_script_is_never_read_as_english():
    # Real FLEURS Punjabi speech was detected as Punjabi at about 0.47-0.55 and transcribed in Devanagari.
    devanagari = "रोगी नजीर्या यहासी जित इबोला वाईरस्द कुज"
    route, note = scam_detection_route(lang_transcript(devanagari, "pa", "detected", 0.467))
    assert route == "not_run" and "not validated for Punjabi" in note


def test_a_weak_guess_on_latin_text_still_falls_back_to_the_english_detectors():
    assert scam_detection_route(lang_transcript("Please read me the code we sent you.", "pa", "detected", 0.3))[0] == "direct"
