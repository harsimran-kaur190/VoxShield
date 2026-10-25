"""Tests for the NLI scam-intent detector. A fake model stands in for the weights, so these check the logic that
turns scores into findings and evidence. They say nothing about how accurate the real model is; see evaluation/."""

import threading
import time

import pytest

from app.config import Settings
from app.schemas_analysis import IntentAssessment, TranscriptResult, TranscriptSegment, VoiceAssessment
from app.services.interfaces import ComponentFailure
from app.services.recommendations import build_recommendations
from app.services.scam_nli import HYPOTHESES, LoadedNli, NliModel, NliScamIntentAnalyzer, REPORTED_TEXTS, Thresholds, build_windows
from tests.helpers import transcript_of

STATEMENT = {key: h.texts[0] for h in HYPOTHESES for key in [h.key]}
CRED, URGENT, SECRECY, FAMILY = STATEMENT["credential_request"], STATEMENT["urgency"], STATEMENT["secrecy"], STATEMENT["family_emergency"]


class FakeNli:
    """Scores a (premise, statement) pair from a table of (premise substring, statement) -> score."""

    def __init__(self, table: dict[tuple[str, str], float] | None = None, error: Exception | None = None):
        self.table, self.error, self.calls, self.pairs_seen = table or {}, error, 0, 0

    loaded = True
    load_seconds = 0.0

    def ensure_loaded(self):
        return None

    def entailment(self, pairs):
        self.calls += 1
        self.pairs_seen += len(pairs)
        if self.error:
            raise self.error
        return [max([v for (p, s), v in self.table.items() if p in premise and s == statement] or [0.0]) for premise, statement in pairs]


def analyzer(table=None, **kwargs) -> tuple[NliScamIntentAnalyzer, FakeNli]:
    fake = FakeNli(table, kwargs.pop("error", None))
    return NliScamIntentAnalyzer(Settings(**kwargs), fake), fake  # type: ignore[arg-type]


def two_segments(first: str, second: str) -> TranscriptResult:
    text = f"{first} {second}"
    return TranscriptResult(
        status="ok", text=text, language="en", language_probability=0.99,
        segments=[
            TranscriptSegment(index=0, start_seconds=0.0, end_seconds=2.0, text=first, char_start=0, char_end=len(first)),
            TranscriptSegment(index=1, start_seconds=2.5, end_seconds=6.0, text=second, char_start=len(first) + 1, char_end=len(text)),
        ],
    )


# ---- evidence ------------------------------------------------------------------------------------------------


def test_a_finding_quotes_the_exact_sentence_with_real_offsets_and_the_segment_timestamp():
    first, second = "Hello, thanks for picking up the phone today.", "Please tell me the code that was just sent to you now."
    transcript = two_segments(first, second)
    a, _ = analyzer({(second, CRED): 0.97})
    result = a.analyze(transcript)
    (item,) = result.indicators
    assert transcript.text[item.char_start : item.char_end] == item.excerpt == second
    assert (item.start_seconds, item.end_seconds, item.segment_index) == (2.5, 6.0, 1)
    assert item.id == f"nli_credential_request-{item.char_start}" and item.rule_id == "nli_credential_request"
    assert (item.detector, item.score, item.context) == ("nli", 0.97, "direct")
    assert result.detector == "nli" and "not a calibrated probability" in (result.score_note or "")


def test_the_trigger_text_names_the_statement_and_the_score_and_never_calls_it_a_probability_of_fraud():
    a, _ = analyzer({("tell me the code", CRED): 0.95})
    (item,) = a.analyze(transcript_of("Please tell me the code that was just sent to you now, thanks.")).indicators
    assert "0.95" in item.trigger and CRED in item.trigger and "probability" not in item.trigger.lower()


def test_a_sentence_is_not_blamed_for_what_only_the_previous_sentence_says():
    """Regression: 'Do it right now.' was reported as a credential request because its premise included the sentence before."""
    first, second = "Please read me the one time password we just sent you.", "Do it right now."
    transcript = two_segments(first, second)
    both = f"{first} {second}"
    table = {
        (first, CRED): 0.99,  # the first sentence really asks for the code
        (both, CRED): 0.99,   # ...so the combined premise also scores high
        (second, URGENT): 0.98,
    }
    result = analyzer(table)[0].analyze(transcript)
    by_rule = {(i.rule_id, i.excerpt) for i in result.indicators}
    assert ("nli_credential_request", first) in by_rule
    assert ("nli_urgency", second) in by_rule
    assert ("nli_credential_request", second) not in by_rule and ("nli_credential_request", both) not in by_rule


def test_a_reference_that_needs_the_previous_sentence_gets_a_two_sentence_span_and_says_so():
    first, second = "We just sent a six digit code to your phone.", "Can you read it back to me so I can cancel it?"
    transcript = two_segments(first, second)
    a, _ = analyzer({(f"{first} {second}", CRED): 0.96})  # only the pair supports it
    (item,) = a.analyze(transcript).indicators
    assert item.excerpt == f"{first} {second}" and item.char_start == 0
    assert "the one before it" in item.trigger
    assert item.start_seconds == 0.0  # the segment where the span starts


# ---- risk, uncertainty, reported speech --------------------------------------------------------------------------


def test_findings_roll_up_to_the_same_risk_levels_as_the_rule_engine():
    text = "Please read me the one time password now. Do not tell anyone about this call at all."
    result = analyzer({("read me", CRED): 0.99, ("Do not tell anyone", SECRECY): 0.99, ("read me", URGENT): 0.95})[0].analyze(transcript_of(text))
    assert result.risk == "high" and {"credential_request", "secrecy_isolation", "urgency"} <= set(result.categories)


def test_recounted_or_example_findings_are_kept_but_never_raise_the_risk():
    text = "My uncle got a call where the man said read me your one time password and he refused."
    result = analyzer({("read me", CRED): 0.97, ("read me", REPORTED_TEXTS[0]): 0.9})[0].analyze(transcript_of(text))
    (item,) = result.indicators
    assert item.context == "reported" and item.severity == "low" and "story, example, or advice" in item.trigger
    assert result.risk == "weak_signals" and result.categories == [] and result.reported_mentions == 1


def test_scores_between_the_two_thresholds_give_an_uncertain_result_not_a_clean_one():
    result = analyzer({("tell me the code", CRED): 0.6})[0].analyze(transcript_of("Please tell me the code that was just sent to you now, thanks."))
    assert result.risk == "inconclusive" and result.uncertain_mentions == 1 and result.indicators == []


def test_no_signal_in_a_long_enough_transcript_is_none_detected_and_a_short_one_is_inconclusive():
    quiet = analyzer()[0]
    assert quiet.analyze(transcript_of("The parcel will arrive on Tuesday afternoon between two and four so please be home.")).risk == "none_detected"
    assert quiet.analyze(transcript_of("Okay see you then.")).risk == "inconclusive"


def test_unusable_and_non_english_transcripts_are_inconclusive_without_loading_the_model():
    a, fake = analyzer()
    assert a.analyze(TranscriptResult(status="no_speech")).risk == "inconclusive"
    assert a.analyze(transcript_of("Bonjour, je voudrais parler de votre compte bancaire s'il vous plait.", language="fr")).risk == "inconclusive"
    assert fake.calls == 0


def test_thresholds_can_be_changed_without_scoring_again():
    a, fake = analyzer({("tell me the code", CRED): 0.8})
    transcript = transcript_of("Please tell me the code that was just sent to you now, thanks.")
    scored = a.score(transcript.text)
    calls = fake.calls
    assert a.decide(transcript, scored, Thresholds(0.9, 0.3, 0.5)).indicators == []
    assert len(a.decide(transcript, scored, Thresholds(0.7, 0.3, 0.5)).indicators) == 1
    assert fake.calls == calls


# ---- long transcripts ----------------------------------------------------------------------------------------------


def test_long_transcripts_stay_within_the_pair_budget_and_say_what_was_skipped():
    text = " ".join(f"This is ordinary sentence number {i} about the weather today." for i in range(100))
    a, fake = analyzer(scam_max_pairs=360)
    result = a.analyze(transcript_of(text))
    assert fake.pairs_seen <= 360
    assert any("only the first part was analyzed" in line for line in result.limitations)


def test_fragments_are_never_scored_alone_but_can_serve_as_context_for_the_next_sentence():
    text = "Hello there. This sentence is long enough to score. Another long enough sentence follows it."
    windows = build_windows(text)
    assert [text[start:end] for start, end, _, _ in windows] == ["This sentence is long enough to score.", "Another long enough sentence follows it."]
    assert windows[0][2] == 0 and windows[0][3] == "Hello there. This sentence is long enough to score."
    assert build_windows("Okay. Yes. Right.") == []


# ---- the model: loading and failure --------------------------------------------------------------------------------


def test_the_model_loads_once_even_when_many_requests_arrive_together():
    calls = []

    def slow_loader(settings):
        calls.append(1)
        time.sleep(0.15)
        return LoadedNli(tokenizer=None, model=None, entailment_index=0)

    model = NliModel(Settings(), loader=slow_loader)
    threads = [threading.Thread(target=model.ensure_loaded) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(calls) == 1 and model.loaded and model.load_seconds >= 0.15


def test_a_failed_load_is_a_safe_component_failure_that_can_be_retried():
    attempts = []

    def flaky(settings):
        attempts.append(1)
        if len(attempts) == 1:
            raise OSError("offline: secret path /x/y")
        return LoadedNli(None, None, 0)

    model = NliModel(Settings(), loader=flaky)
    with pytest.raises(ComponentFailure) as caught:
        model.ensure_loaded()
    assert caught.value.code == "model_load_failed" and "secret" not in caught.value.message and not model.loaded
    model.ensure_loaded()
    assert model.loaded


def test_an_inference_failure_is_a_safe_component_failure():
    class Boom:
        def __call__(self, **kwargs):
            raise RuntimeError("tensor secret")

    class Tok:
        def __call__(self, *args, **kwargs):
            raise RuntimeError("tokenizer secret")

    model = NliModel(Settings(), loader=lambda s: LoadedNli(Tok(), Boom(), 0))
    with pytest.raises(ComponentFailure) as caught:
        model.entailment([("a b c", "d e f")])
    assert caught.value.code == "inference_failed" and "secret" not in caught.value.message


def test_the_real_label_order_is_read_by_name():
    from types import SimpleNamespace

    from app.services import scam_nli

    class Model:
        config = SimpleNamespace(id2label={0: "not_entailment", 1: "entailment"})

        def to(self, device):
            return self

        def eval(self):
            return self

    import transformers

    original = (transformers.AutoTokenizer.from_pretrained, transformers.AutoModelForSequenceClassification.from_pretrained)
    transformers.AutoTokenizer.from_pretrained = lambda *a, **k: object()
    transformers.AutoModelForSequenceClassification.from_pretrained = lambda *a, **k: Model()
    try:
        assert scam_nli._default_loader(Settings()).entailment_index == 1
    finally:
        transformers.AutoTokenizer.from_pretrained, transformers.AutoModelForSequenceClassification.from_pretrained = original


# ---- recommendations and the API contract ---------------------------------------------------------------------------


def test_recommendations_use_the_model_findings_and_their_evidence():
    text = "Grandma it's me, your grandson. I need you to wire me money right now, please."
    table = {("grandson", FAMILY): 0.98, ("wire me money", STATEMENT["payment_request"]): 0.97, ("right now", URGENT): 0.96}
    result = analyzer(table)[0].analyze(transcript_of(text))
    plan = build_recommendations(VoiceAssessment(verdict="model_favors_real", summary="x"), result)
    ids = [item.id for item in plan.items]
    assert "family" in ids and "organization" not in ids and "payment" in ids and "pressure" in ids
    family = next(i for i in plan.items if i.id == "family")
    assert family.evidence[0].id == next(i.id for i in result.indicators if i.rule_id == "nli_family_emergency")


def test_the_response_schema_is_backward_compatible_with_the_rule_engine():
    rules = IntentAssessment(risk="none_detected", summary="x")
    assert rules.detector == "rules" and rules.uncertain_mentions == 0 and rules.score_note is None
    nli = analyzer({("tell me the code", CRED): 0.97})[0].analyze(transcript_of("Please tell me the code that was just sent to you now, thanks."))
    dumped = nli.model_dump()
    assert set(rules.model_dump()) <= set(dumped)
    assert set(dumped["indicators"][0]) >= {"id", "rule_id", "category", "severity", "char_start", "char_end", "start_seconds", "excerpt", "explanation", "suggested_action", "context"}
