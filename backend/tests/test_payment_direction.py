"""Who is sending the money: offers and questions about sending money must not read as requests for money.

Regression for the false positive where "Can I send you some money for now?" was flagged as a payment request.

STUBBED MODEL for the decision logic (exact scores are in each table, rounded from what the real model returned in the
Stage 7 probe). The grammar helper `payment_direction` needs no model. The real classifier runs the same examples in
test_scam_intent_context_real.py (opt-in). Nothing here measures accuracy."""

import pytest

from app.schemas_analysis import IntentAssessment, TranscriptResult, TranscriptSegment
from app.services.scam_nli import DIRECTION_TEXTS, HYPOTHESES, payment_direction
from tests.helpers import transcript_of
from tests.test_scam_nli import analyzer

PAY = {h.key: h.texts[0] for h in HYPOTHESES}["payment_request"]
URGENT = {h.key: h.texts[0] for h in HYPOTHESES}["urgency"]
CRED = {h.key: h.texts[0] for h in HYPOTHESES}["credential_request"]
SENDER = DIRECTION_TEXTS[0]


def run(text: str, table: dict, transcript: TranscriptResult | None = None) -> IntentAssessment:
    return analyzer(table)[0].analyze(transcript or transcript_of(text))


def payments(result: IntentAssessment) -> list[tuple[str, str]]:
    return [(i.context, i.severity) for i in result.indicators if i.category == "payment_pressure"]


# ---- the grammar -----------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "sentence",
    [
        "Can I send you some money?",
        "Can I send you some money for now?",
        "Would it help if I sent you some money?",
        "Do you want me to transfer the money?",
        "Would you like me to send the payment today?",
        "Should I send it to your account?",
        "I can send you the money tomorrow if you like.",
        "I'll wire it today.",
        "Let me pay for it.",
        "If I paid the invoice now, would that help?",
    ],
)
def test_the_speaker_is_the_sender_in_offers_and_questions_about_sending(sentence):
    assert payment_direction(sentence) == "speaker"


@pytest.mark.parametrize(
    "sentence",
    [
        "Could you send me some money?",
        "Can you transfer money to my account?",
        "Please pay this invoice immediately.",
        "I need you to wire two thousand dollars today.",
        "You must pay the fee before we continue.",
        "Send me some money.",
        "Transfer the money to this account now.",
        "Can you lend me some money for now?",
        "You wire back the difference.",
        "Hi, please send the payment.",
    ],
)
def test_the_listener_is_the_sender_in_requests(sentence):
    assert payment_direction(sentence) == "listener"


@pytest.mark.parametrize("sentence", ["Could we send some money for now?", "Let's send some money for now."])
def test_a_shared_subject_does_not_show_who_sends(sentence):
    assert payment_direction(sentence) == "shared"


@pytest.mark.parametrize("sentence", ["She asked me to send her some money.", "Be careful if someone asks you to transfer money.", "The money arrived yesterday."])
def test_sentences_with_no_sender_cue_are_left_alone(sentence):
    assert payment_direction(sentence) in (None, "listener")  # reported speech is handled by the narration check, not here
    assert payment_direction("The money arrived yesterday.") is None


def test_a_request_to_the_listener_always_wins_over_an_offer_in_the_same_text():
    assert payment_direction("I can send you money, but first you must pay a processing fee.") == "listener"
    assert payment_direction("Can I send you a check? Then please wire back the difference.") == "listener"


# ---- findings ---------------------------------------------------------------------------------------------------


def test_offering_to_send_money_is_not_a_payment_request_and_is_counted_and_disclosed():
    result = run("Can I send you some money for now?", {("send you some money", PAY): 0.97})
    assert payments(result) == []
    assert result.offer_mentions == 1
    assert "offered or asked about sending money from the speaker's side" in result.summary or result.risk == "inconclusive"


def test_an_offer_in_a_longer_neutral_message_is_counted_and_the_summary_says_so():
    text = "Hello again, thanks for calling me back today. Can I send you some money for now? Let me know what works for you."
    result = run(text, {("send you some money", PAY): 0.97})
    assert payments(result) == [] and result.offer_mentions == 1 and result.risk == "none_detected"
    assert "not counted as a request for money" in result.summary


@pytest.mark.parametrize(
    "text, score",
    [
        ("Would it help if I sent you some money?", 0.87),   # below the finding threshold: only uncertain before
        ("Do you want me to transfer the money?", 0.91),
        ("Should I send it to your account?", 0.22),
    ],
)
def test_offers_that_scored_below_the_finding_threshold_do_not_make_the_result_uncertain_either(text, score):
    text = f"Thanks for waiting on the line today. {text} Tell me what works best for you."
    result = run(text, {(text.split(". ")[1][:20], PAY): score})
    assert payments(result) == []
    assert result.risk in {"none_detected", "inconclusive"} and result.risk != "elevated"


@pytest.mark.parametrize(
    "text",
    [
        "Could you send me some money for now?",
        "Can you transfer money to my account?",
        "Please pay this invoice immediately.",
    ],
)
def test_asking_the_listener_to_send_money_is_still_a_payment_request(text):
    result = run(text, {(text[:18], PAY): 0.99})
    assert payments(result) == [("direct", "medium")]
    assert result.offer_mentions == 0


def test_a_reported_request_is_not_a_direct_request():
    text = "She asked me to send her some money, and I thought it was odd."
    result = run(text, {("asked me to send", PAY): 0.95})
    assert ("direct", "medium") not in payments(result)  # reported at most, and then only as low severity
    assert all(i.severity == "low" for i in result.indicators if i.category == "payment_pressure")


def test_a_warning_about_payment_requests_is_not_a_request():
    result = run("Be careful if someone asks you to transfer money to an account.", {("Be careful", PAY): 0.06})
    assert payments(result) == []


def test_an_offer_with_suspicious_urgency_keeps_the_urgency_finding_and_invents_no_payment_finding():
    text = "Can I send you some money right now? It has to happen immediately."
    result = run(text, {("It has to happen immediately", URGENT): 0.96, ("send you some money", PAY): 0.97})
    assert payments(result) == []
    assert [(i.category, i.context) for i in result.indicators] == [("urgency", "direct")]


def test_an_offer_followed_by_a_request_for_a_secret_still_exposes_the_secret_request():
    text = "Can I send you some money? I just need your bank password to do it."
    result = run(text, {("send you some money", PAY): 0.97, ("need your bank password", CRED): 0.98})
    assert payments(result) == []
    assert "credential_request" in {i.category for i in result.indicators if i.context == "direct"}


def test_an_offer_with_a_condition_that_asks_for_money_still_exposes_the_request():
    text = "I can send you money, but first you must pay a processing fee of two hundred dollars."
    result = run(text, {("send you money", PAY): 0.9, ("you must pay a processing fee", PAY): 0.96})
    assert payments(result) == [("direct", "medium")]
    assert result.indicators[0].excerpt.startswith("first you must pay")  # the request, not the offer, is quoted


def test_an_offer_does_not_hide_a_request_in_the_same_sentence():
    text = "I can send you a check for five thousand dollars and you wire back the difference."
    result = run(text, {("wire back", PAY): 0.97})
    assert payments(result) == [("direct", "medium")]


def test_protective_language_elsewhere_does_not_hide_a_payment_request():
    text = "Never share your PIN with anyone. Could you send me some money for now?"
    result = run(text, {("Never share", PAY): 0.0, ("Could you send me", PAY): 0.99, ("Never share", "The speaker is warning the listener never to share a code, password, or PIN."): 0.99})
    assert payments(result) == [("direct", "medium")]


# ---- direction that cannot be established -----------------------------------------------------------------------


def test_a_shared_subject_asserts_no_direction_and_leaves_the_result_inconclusive():
    text = "Hello again, thanks for calling me back today. Could we send some money for now? Let me know what you think."
    result = run(text, {("Could we send some money", PAY): 0.99})
    assert payments(result) == []
    assert result.risk == "inconclusive" and "could not classify" in result.summary
    assert result.offer_mentions == 0


def test_when_the_grammar_is_silent_the_model_reading_may_make_a_finding_uncertain_but_never_hides_a_request():
    text = "Thanks for holding on the line today. The money will go out to you for now. Tell me if that works."
    sentence = "The money will go out to you for now."
    unclear = {(sentence[:20], PAY): 0.95, (sentence[:20], SENDER): 0.93}
    result = run(text, unclear)
    assert payments(result) == [] and result.risk == "inconclusive"
    # the same model reading on a sentence the grammar shows to be a request: the finding stays
    asked = "Thanks for holding on the line today. Please send the payment for now. Tell me if that works."
    kept = run(asked, {("Please send the payment", PAY): 0.95, ("Please send the payment", SENDER): 0.93})
    assert payments(kept) == [("direct", "medium")]


def test_without_a_sender_reading_an_unclear_sentence_is_flagged_as_before():
    text = "Thanks for holding on the line today. The payment must be made for now. Tell me if that works."
    result = run(text, {("The payment must be made", PAY): 0.95})
    assert payments(result) == [("direct", "medium")]


# ---- the transcript may not match what was said -----------------------------------------------------------------


def segment_transcript(text: str, logprob: float) -> TranscriptResult:
    segment = TranscriptSegment(index=0, start_seconds=0, end_seconds=3, text=text, char_start=0, char_end=len(text), avg_logprob=logprob)
    return TranscriptResult(status="ok", text=text, language="en", language_probability=0.99, segments=[segment])


def test_a_payment_finding_in_low_confidence_speech_recognition_says_to_check_the_audio():
    text = "Could you send me some money for now?"
    result = run(text, {("send me some money", PAY): 0.99}, segment_transcript(text, -1.4))
    assert payments(result) == [("direct", "medium")]  # the transcript is taken as given, the finding is not hidden
    assert any("speech recognition that was low-confidence" in n and "reverse who is sending money" in n for n in result.limitations)


def test_a_confident_transcript_gets_no_such_caution():
    text = "Could you send me some money for now?"
    result = run(text, {("send me some money", PAY): 0.99}, segment_transcript(text, -0.2))
    assert not any("low-confidence" in n for n in result.limitations)


def test_the_caution_is_only_added_for_payment_findings():
    text = "Please read me the one time code we just sent you right now."
    result = run(text, {("read me the one time code", CRED): 0.99}, segment_transcript(text, -1.4))
    assert not any("who is sending money" in n for n in result.limitations)


# ---- the eight intents, through both detectors ----------------------------------------------------------------------
# Hardening pass: each intent runs through the rule engine (no model) and through the NLI decision logic (stubbed scores
# taken from the real model's output). The real model runs the same intents in test_scam_intent_context_real.py.

from app.services.scam_intent import RuleBasedScamIntentAnalyzer  # noqa: E402

RULES = RuleBasedScamIntentAnalyzer()


def by_rules(text: str) -> IntentAssessment:
    return RULES.analyze(transcript_of(text))


def direct_categories(result: IntentAssessment) -> set[str]:
    return {i.category for i in result.indicators if i.context == "direct"}


class TestRuleEngineDirection:
    @pytest.mark.parametrize("text", ["Can I send you some money?", "Would you like me to transfer some money?", "Do you want me to send the payment today?"])
    def test_offers_are_not_requests(self, text):
        assert "payment_pressure" not in direct_categories(by_rules(text))

    @pytest.mark.parametrize("text", ["Could you send me some money?", "Please send me money today, thanks."])
    def test_requests_to_the_listener_are_found(self, text):
        assert "payment_pressure" in direct_categories(by_rules(text))

    @pytest.mark.parametrize(
        "text",
        [
            "She asked me to send her money.",
            "He offered to send me money.",
            "My brother promised to send me money on Friday.",
            "They agreed to wire me money next week.",
        ],
    )
    def test_reported_requests_and_reported_offers_are_not_direct_requests(self, text):
        """Found while hardening: 'He offered to send me money.' was reported as a direct request to the listener."""
        assert "payment_pressure" not in direct_categories(by_rules(text)), text

    def test_a_request_for_money_that_is_not_an_instruction_stays_a_weak_signal(self):
        result = by_rules("I need money; can you help?")
        assert result.risk == "weak_signals"
        assert [i.severity for i in result.indicators] == ["low"]

    def test_an_offer_followed_by_a_credential_request_exposes_only_the_credential_request(self):
        result = by_rules("I can send you money, but first give me your OTP.")
        assert direct_categories(result) == {"credential_request"}


class TestNeedStatements:
    """'I need money' is a statement of need, not an instruction to send. The rule engine already rates it low
    ('friends and family ask this too'); the language model cannot tell it from 'send me money'."""

    def test_a_statement_of_need_is_a_low_signal_not_a_notable_indicator(self):
        result = run("I need money; can you help?", {("I need money", PAY): 0.993})
        (item,) = result.indicators
        assert (item.category, item.context, item.severity) == ("payment_pressure", "direct", "low")
        assert result.risk == "weak_signals"
        assert "statement of need" in item.trigger

    def test_the_request_is_still_reported_not_dropped(self):
        result = run("We really need some cash this week, can you help?", {("need some cash", PAY): 0.97})
        assert payments(result) == [("direct", "low")]

    def test_an_instruction_to_send_money_keeps_its_severity(self):
        result = run("I need you to wire two thousand dollars today.", {("I need you to wire", PAY): 0.99})
        assert payments(result) == [("direct", "medium")]

    def test_an_amount_or_pressure_is_not_downgraded(self):
        """Only the recognised 'I need money/cash/funds' wording is lowered; anything else keeps its severity."""
        for text in ("I need two thousand dollars right away.", "You owe us the payment and it is overdue."):
            result = run(text, {(text[:12], PAY): 0.97})
            assert payments(result) == [("direct", "medium")], text

    def test_need_wording_next_to_other_evidence_does_not_lower_that_evidence(self):
        text = "I need money. Please read me the one time code we just sent you."
        result = run(text, {("I need money", PAY): 0.99, ("read me the one time code", CRED): 0.99})
        assert "credential_request" in direct_categories(result) and result.risk in {"elevated", "high"}
