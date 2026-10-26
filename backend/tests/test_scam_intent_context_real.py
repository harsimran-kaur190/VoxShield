"""The regression cases run through the REAL zero-shot NLI classifier (no stub).

Opt-in because it loads the model (about 0.7 GB, needs the weights cached locally):
    VOXSHIELD_RUN_REAL_MODELS=1 pytest tests/test_scam_intent_context_real.py

These check the specific situations from the Stage 2 false-positive report. They are a handful of hand-written
sentences, not an accuracy measure; see evaluation/RESULTS.md for the evaluation and its caveats. The deterministic
logic tests, with a stubbed model, are in test_scam_intent_context.py.
"""

import os

import pytest

from app.config import Settings
from app.services.scam_nli import NliModel, NliScamIntentAnalyzer
from tests.helpers import transcript_of
from tests.test_scam_intent_context import BANK_NOTICE

pytestmark = pytest.mark.skipif(os.environ.get("VOXSHIELD_RUN_REAL_MODELS") != "1", reason="set VOXSHIELD_RUN_REAL_MODELS=1 to run the real classifier")


@pytest.fixture(scope="module")
def detector():
    settings = Settings()
    return NliScamIntentAnalyzer(settings, NliModel(settings))


def check(detector, text):
    result = detector.analyze(transcript_of(text))
    return result, {i.category for i in result.indicators if i.context == "direct"}


def test_the_reported_bank_awareness_notice_has_no_findings(detector):
    result, direct = check(detector, BANK_NOTICE)
    assert result.indicators == [] and result.risk == "none_detected"
    assert result.suppressed_mentions >= 1


def test_each_protective_sentence_in_the_notice_has_no_strong_finding(detector):
    for sentence in BANK_NOTICE.split(". "):
        _, direct = check(detector, sentence if sentence.endswith(".") else sentence + ".")
        assert not direct, sentence


def test_2_an_urgent_otp_request_is_flagged(detector):
    result, direct = check(detector, "Tell me your OTP immediately so I can stop your account from being blocked.")
    assert "credential_request" in direct and result.risk in {"elevated", "high"}


def test_3_never_share_your_otp_is_not_a_request_for_a_secret(detector):
    _, direct = check(detector, "Never share your OTP with anyone who calls you.")
    assert direct == set()


def test_4_contacting_your_bank_on_the_card_number_does_not_discourage_checking(detector):
    _, direct = check(detector, "Contact your bank using the number printed on your card.")
    assert "verification_bypass" not in direct


def test_5_a_reported_request_differs_from_a_direct_request(detector):
    reported, direct = check(detector, "The caller asked me to reveal my password.")
    assert "credential_request" not in direct and reported.risk != "high"
    direct_request, direct = check(detector, "Please reveal your password so I can fix your account.")
    assert "credential_request" in direct and direct_request.risk in {"elevated", "high"}


def test_6_unusual_activity_alone_is_not_a_confirmed_scam(detector):
    result, direct = check(detector, "Your bank account has unusual activity.")
    assert direct == set() and result.risk not in {"elevated", "high"}


def test_7_a_warning_and_a_genuine_request_in_the_same_message_expose_the_request(detector):
    for text in (
        "Never share your code with strangers, but I need you to read me the code that just arrived.",
        "Please remember that scammers exist. Now, tell me your online banking password to confirm your identity.",
        "Never share your OTP with anyone except me, so read me the OTP now.",
    ):
        result, direct = check(detector, text)
        assert "credential_request" in direct and result.risk in {"elevated", "high"}, text


# ---- who is sending the money (Stage 7) -------------------------------------------------------------------------


def payment_findings(result):
    return [i for i in result.indicators if i.category == "payment_pressure" and i.context == "direct"]


def test_offering_or_asking_permission_to_send_money_is_not_a_payment_request(detector):
    for text in (
        "Can I send you some money for now?",
        "Can I send you some money?",
        "Would it help if I sent you some money?",
        "Do you want me to transfer the money?",
        "Should I send it to your account?",
        "Would you like me to send the payment today?",
    ):
        result, _ = check(detector, text)
        assert payment_findings(result) == [], text


def test_asking_the_listener_to_send_money_is_still_a_payment_request(detector):
    for text in (
        "Could you send me some money for now?",
        "Can you transfer money to my account?",
        "Please pay this invoice immediately.",
        "I need you to wire two thousand dollars today.",
    ):
        result, _ = check(detector, text)
        assert payment_findings(result), text


def test_a_reported_request_or_a_warning_about_requests_is_not_a_direct_request(detector):
    for text in ("She asked me to send her some money.", "Be careful if someone asks you to transfer money."):
        result, _ = check(detector, text)
        assert payment_findings(result) == [], text


def test_an_offer_next_to_real_evidence_still_exposes_that_evidence(detector):
    result, direct = check(detector, "Can I send you some money? I just need your bank password to do it.")
    assert payment_findings(result) == [] and "credential_request" in direct
    result, _ = check(detector, "I can send you money, but first you must pay a processing fee of two hundred dollars.")
    assert payment_findings(result)
    result, _ = check(detector, "Can I send you some money right now? It has to happen immediately.")
    assert payment_findings(result) == []


def test_a_shared_subject_asserts_no_direction(detector):
    result, _ = check(detector, "Could we send some money for now?")
    assert payment_findings(result) == [] and result.risk not in {"elevated", "high"}


# ---- the eight payment intents with the real classifier (hardening pass) ----------------------------------------


def test_the_eight_payment_intents_with_the_real_classifier(detector):
    offer, request, reported, need, mixed = (
        ["Can I send you some money?", "Would you like me to transfer some money?"],
        ["Could you send me some money?", "Can you transfer money to my account?"],
        ["She asked me to send her money.", "He offered to send me money."],
        "I need money; can you help?",
        "I can send you money, but first give me your OTP.",
    )
    for text in offer:  # an offer or permission question is not a request for money
        assert payment_findings(check(detector, text)[0]) == [], text
    for text in request:  # a request to the listener is still found
        assert payment_findings(check(detector, text)[0]), text
    for text in reported:  # reported requests and reported offers are not direct requests to the listener
        assert payment_findings(check(detector, text)[0]) == [], text
    result, _ = check(detector, need)  # a request for money, but a request alone is a low signal, not an alarm
    assert [(i.category, i.severity) for i in result.indicators if i.context == "direct"] == [("payment_pressure", "low")]
    assert result.risk == "weak_signals"
    result, direct = check(detector, mixed)  # an offer next to a separate credential request
    assert direct == {"credential_request"} and payment_findings(result) == [] and result.risk in {"elevated", "high"}
