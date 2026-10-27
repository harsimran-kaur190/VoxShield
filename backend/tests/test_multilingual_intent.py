"""Scam-intent detection for Hindi: the native-language keyword rules, the translation pass, and how the two
are combined. Stand-in models only, and every sentence here was written by the developers, so this checks the logic and
says nothing about accuracy on real calls."""

from types import SimpleNamespace

import numpy as np
import pytest

from app.config import Settings
from app.schemas_analysis import IntentAssessment, IntentIndicator, TranscriptResult, TranscriptSegment
from app.services.interfaces import ComponentFailure
from app.services.multilingual_intent import combine, mark_translated
from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from app.services.scam_rules_indic import find_indicators
from app.services.transcription import FasterWhisperTranscriber
from tests.helpers import translation_of

AUDIO = np.zeros(16000, dtype=np.float32)


def native(text: str, code: str = "hi", segments: list[tuple[float, float, str]] | None = None) -> TranscriptResult:
    parts = segments or [(0, 5, text)]
    built, cursor = [], 0
    for index, (start, end, piece) in enumerate(parts):
        built.append(TranscriptSegment(index=index, start_seconds=start, end_seconds=end, text=piece, char_start=cursor, char_end=cursor + len(piece)))
        cursor += len(piece) + 1
    return TranscriptResult(status="ok", text=" ".join(p for _, _, p in parts), language=code, language_source="selected", segments=built)


def rules(text: str) -> list[tuple[str, str]]:
    found, _ = find_indicators(native(text))
    return [(i.rule_id, i.context) for i in found]


# ---- keyword rules on the original transcript ---------------------------------------------------------------------------


@pytest.mark.parametrize("text", [
    "कृपया अपना ओटीपी मुझे अभी बताइए।",       # Hindi: please tell me your OTP now
    "अपना पिन नंबर बता दीजिए।",               # Hindi: tell me your PIN
    "मुझे अपना पासवर्ड शेयर कीजिए।",           # Hindi: share your password with me
    "otp bata do jaldi",                       # romanized Hindi
])
def test_requests_for_codes_are_found_in_hindi_and_romanized_text(text):
    assert ("indic_cred_request", "direct") in rules(text)


@pytest.mark.parametrize("text", [
    "अपना ओटीपी कभी किसी को मत बताइए।",        # never tell anyone your OTP
    "बैंक कभी भी आपका पिन नहीं पूछता, इसलिए किसी को मत बताइए।",  # the bank never asks for your PIN, so tell no one
    "otp kabhi mat batao",
])
def test_protective_advice_is_set_aside_not_flagged(text):
    found, suppressed = find_indicators(native(text))
    assert found == [] and suppressed >= 1


def test_the_word_for_two_is_not_mistaken_for_give():
    assert rules("कोड दो मिनट में आ जाएगा।") == []  # "the code will arrive in two minutes"


def test_money_requests_secrecy_threats_and_bypass_are_found():
    found = dict(rules("मुझे तुरंत पचास हजार रुपये ट्रांसफर कर दो। आपका खाता बंद हो जाएगा। ब्रांच मत जाइए। किसी को मत बताना।"))
    assert {"indic_urgency", "indic_pay_request", "indic_threat_account", "indic_bypass_verify", "indic_secrecy"} <= set(found)


def test_common_spelling_variants_are_covered():
    assert ("indic_threat_account", "direct") in rules("आपका खाता बन्द होने वाला है।")  # बन्द, as Whisper wrote it
    assert ("indic_threat_account", "direct") in rules("आपका खाता बन्ध हो जाएगा।")
    assert ("indic_threat_account", "direct") in rules("आपके खाते को आज ब्लाक किया जाएगा।")


@pytest.mark.parametrize("heard", ["अव तीपी", "और तीपी", "ओ टी पी", "ओटीपी"])
def test_the_ways_whisper_writes_otp_all_count_as_a_code(heard):
    assert ("indic_cred_request", "direct") in rules(f"क्रिप्या अभी भेजा गया {heard} मुझे बताये।")


def test_punjabi_text_is_no_longer_matched_by_the_keyword_rules():
    # Punjabi is not supported: its speech is never routed here, and the rules carry no Gurmukhi patterns.
    for text in ("ਤੁਰੰਤ 5000 ਰੁਪਏ ਭੇਜੋ ਅਤੇ ਕਿਸੇ ਨੂੰ ਨਾ ਦੱਸਣਾ।", "ਮੈਨੂੰ ਆਪਣਾ ਕੋਡ ਦੱਸੋ।"):
        assert rules(text) == []


def test_a_request_and_a_secrecy_demand_in_one_sentence_both_count():
    found = dict(rules("कृपया अपना ओटीपी मुझे अभी बताइए, और किसी को मत बताना।"))
    assert found.get("indic_cred_request") == "direct" and found.get("indic_secrecy") == "direct"


def test_a_recounted_request_is_reported_speech():
    assert rules("उसने कहा कि OTP बताओ।") == [("indic_cred_request", "reported")]


def test_offsets_and_timestamps_point_into_the_original_text():
    t = native("", segments=[(0, 2, "नमस्ते जी।"), (2, 6, "अपना ओटीपी बताइए।")])
    found, _ = find_indicators(t)
    hit = next(i for i in found if i.rule_id == "indic_cred_request")
    assert t.text[hit.char_start : hit.char_end] == hit.excerpt and hit.segment_index == 1 and hit.start_seconds == 2


def test_an_ordinary_hindi_sentence_has_no_findings():
    assert rules("नमस्ते, आज मौसम बहुत अच्छा है और मैं घर जा रहा हूँ।") == []


# ---- combining the translated result with the keyword rules ------------------------------------------------------------

HINDI = native("", segments=[(0, 3, "नमस्ते, मैं आपके बंक सी बोल रहा हूं।"), (3, 8, "क्रिप्या अपना अव तीपी मुझे अभी बताये।")])  # real Whisper-style errors


def translated_result(text: str, start=3.0, end=8.0) -> IntentAssessment:
    return RuleBasedScamIntentAnalyzer().analyze(translation_of(text, start, end))


def test_a_finding_from_the_translation_carries_the_original_sentence_spoken_at_that_time():
    intent = combine(translated_result("Please tell me your one time password right now."), HINDI)
    finding = next(i for i in intent.indicators if i.category == "credential_request")
    assert finding.text_source == "translation" and finding.original_segment_index == 1
    assert finding.original_text == "क्रिप्या अपना अव तीपी मुझे अभी बताये।"
    assert intent.analyzed_text == "translation" and intent.risk in {"elevated", "high"}


def test_translation_catches_what_misspelled_hindi_keywords_miss():
    misspelled = native("क्रिप्या अपना ओठीपे मुझे अभी बताये।")  # a spelling no keyword rule knows
    assert find_indicators(misspelled)[0] == []
    assert any(i.category == "credential_request" for i in combine(translated_result("Tell me your OTP now.", 0, 5), misspelled).indicators)


def test_keyword_rules_catch_what_a_mistranslation_loses():
    clear = native("कृपया अपना ओटीपी मुझे अभी बताइए।")
    intent = combine(translated_result("Kritya, tell me about your food."), clear)  # a poor translation with no request
    assert intent.risk in {"elevated", "high"} and [i.text_source for i in intent.indicators] == ["transcript"]


def test_ids_stay_unique_when_both_sources_flag_the_same_moment():
    clear = native("कृपया अपना ओटीपी मुझे अभी बताइए।")
    intent = combine(translated_result("Please tell me your one time password.", 0, 5), clear)
    ids = [i.id for i in intent.indicators]
    assert len(ids) == len(set(ids)) and {i.text_source for i in intent.indicators} == {"translation", "transcript"}


def test_the_risk_never_drops_below_what_the_translated_text_alone_gave():
    translated = translated_result("Tell me your one time password immediately and do not tell anyone, your account will be blocked.")
    assert combine(translated, native("नमस्ते।")).risk == translated.risk


def test_quiet_on_both_sides_keeps_the_translated_verdict_and_says_how_it_was_checked():
    quiet = translated_result("Hello, the weather is very nice today and I am going home now, see you in the evening my friend.")
    intent = combine(quiet, native("नमस्ते, आज मौसम बहुत अच्छा है।"))
    assert intent.risk == "none_detected" and intent.summary.startswith("Checked through an English machine translation of the Hindi speech")
    assert any("machine translation" in note for note in intent.limitations)


def test_without_a_translation_and_with_nothing_found_the_result_is_inconclusive():
    intent = combine(None, native("नमस्ते।"), "The speech could not be translated to English.")
    assert intent.risk == "inconclusive" and "could not be translated" in intent.summary


def test_a_translated_finding_with_no_timestamp_has_no_original_text_rather_than_a_guess():
    item = IntentIndicator(rule_id="x", category="urgency", severity="low", segment_index=None, char_start=0, char_end=3, excerpt="now", explanation="", suggested_action="")
    marked = mark_translated(item, HINDI, "hi")
    assert (marked.original_text, marked.original_segment_index, marked.text_source) == (None, None, "translation")


# ---- the translation pass in the transcriber ----------------------------------------------------------------------------


class TranslatingWhisper:
    def __init__(self, segments, error=None):
        self.segments, self.error, self.calls = segments, error, []

    def transcribe(self, audio, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return iter(self.segments), SimpleNamespace(language="en", language_probability=1.0)


def seg(text, start=0.0, end=2.0, logprob=-0.2):
    return SimpleNamespace(text=text, start=start, end=end, no_speech_prob=0.01, avg_logprob=logprob)


def test_translate_asks_whisper_for_an_english_translation_from_the_spoken_language():
    model = TranslatingWhisper([seg(" Tell me your OTP."), seg(" Now.", 2, 3)])
    result = FasterWhisperTranscriber(Settings(), model_factory=lambda s: model).translate(AUDIO, "hi")
    assert model.calls[0]["task"] == "translate" and model.calls[0]["language"] == "hi"
    assert (result.status, result.language, result.language_source, result.text) == ("ok", "en", "translated", "Tell me your OTP. Now.")
    assert "from Hindi to English" in result.model.method
    assert any("Machine translation" in n for n in result.quality_notes)


def test_a_failed_translation_raises_a_safe_component_failure():
    model = TranslatingWhisper([], error=RuntimeError("/private/path/model.bin"))
    with pytest.raises(ComponentFailure) as failure:
        FasterWhisperTranscriber(Settings(), model_factory=lambda s: model).translate(AUDIO, "hi")
    assert failure.value.code == "translation_failed" and "/private" not in failure.value.message


def test_an_empty_translation_is_no_speech():
    result = FasterWhisperTranscriber(Settings(), model_factory=lambda s: TranslatingWhisper([])).translate(AUDIO, "hi")
    assert result.status == "no_speech" and result.text == ""
