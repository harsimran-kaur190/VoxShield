import pytest

from app.schemas_analysis import TranscriptResult
from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from tests.helpers import transcript_of

analyzer = RuleBasedScamIntentAnalyzer()


def categories(text: str) -> set[str]:
    return set(analyzer.analyze(transcript_of(text)).categories)


def test_scam_conversation_returns_excerpts_that_exist_in_the_transcript():
    text = (
        "Hello, this is Officer James from the police department. Your account has been compromised and you will "
        "be arrested today. Do not tell anyone about this call. Please read me the one time password we just sent "
        "you, right now."
    )
    result = analyzer.analyze(transcript_of(text))
    assert result.risk == "high"
    assert {"credential_request", "coercion_threat", "secrecy_isolation", "impersonation", "urgency"} <= set(result.categories)
    for indicator in result.indicators:
        assert text[indicator.char_start : indicator.char_end] == indicator.excerpt
        assert indicator.explanation and indicator.suggested_action
    assert any(i.excerpt.lower() == "read me the one time password" for i in result.indicators)


@pytest.mark.parametrize(
    "text, category",
    [
        ("Please tell me the OTP that you just received on your phone.", "credential_request"),
        ("What is your card PIN number so I can confirm it.", "credential_request"),
        ("You need to buy gift cards and read me the numbers.", "payment_pressure"),
        ("Grandma it's me, your grandson. I'm in jail and I need money.", "impersonation"),
        ("Don't tell your wife or the bank about this.", "secrecy_isolation"),
        ("There is no need to verify anything, just trust me.", "verification_bypass"),
        ("Please install AnyDesk so I can fix your computer.", "remote_access"),
        ("There is an arrest warrant issued in your name.", "coercion_threat"),
    ],
)
def test_each_category_is_detected(text, category):
    assert category in categories(text)


@pytest.mark.parametrize(
    "text",
    [
        "We will never ask you to share your OTP or PIN. Please do not share your password with anyone.",
        "The bank will never ask you for your card number over the phone.",
        "I received an OTP from my bank and entered it on the website to log in.",
        "Hi, this is a reminder from your bank that your appointment is tomorrow at ten in the morning, see you then.",
        "Can you confirm the meeting with the bank manager on Thursday? I will send the invoice by email afterwards.",
    ],
)
def test_benign_mentions_of_banks_and_otps_do_not_raise_risk(text):
    result = analyzer.analyze(transcript_of(text))
    assert result.risk in {"none_detected", "weak_signals", "inconclusive"}
    assert "credential_request" not in result.categories


def test_negated_advice_is_counted_as_suppressed_not_flagged():
    result = analyzer.analyze(transcript_of("Never share your OTP with anyone, not even someone from the bank today."))
    assert "credential_request" not in result.categories
    assert result.suppressed_mentions >= 1


def test_single_weak_signal_does_not_become_high():
    result = analyzer.analyze(transcript_of("Please send the payment by Friday, and call me right away if there is a problem."))
    assert result.risk in {"weak_signals", "none_detected"}


def test_short_transcript_with_no_indicators_is_inconclusive():
    assert analyzer.analyze(transcript_of("Hello? Can you hear me?")).risk == "inconclusive"


def test_empty_or_missing_transcript_is_inconclusive_not_manufactured():
    for status in ("no_speech", "unavailable"):
        result = analyzer.analyze(TranscriptResult(status=status))
        assert result.risk == "inconclusive" and not result.indicators


def test_non_english_transcript_is_inconclusive():
    result = analyzer.analyze(transcript_of("Bonjour, donnez-moi votre code s'il vous plaît.", language="fr"))
    assert result.risk == "inconclusive"
    assert "English" in result.summary


def test_none_detected_keeps_the_uncertainty_in_the_limitations_not_the_summary():
    text = "I am calling to let you know that the delivery of your parcel will arrive on Tuesday afternoon between two and four."
    result = analyzer.analyze(transcript_of(text))
    assert result.risk == "none_detected"
    assert any("does not rule out a scam" in text for text in result.limitations)


@pytest.mark.parametrize(
    "text, category",
    [
        ("You must wire five thousand dollars to this account.", "payment_pressure"),
        ("You must wire $5,000 right now.", "payment_pressure"),
        ("You must tell me the one time password.", "credential_request"),
        ("I am asking you for your OTP to finish the process.", "credential_request"),
    ],
)
def test_directives_without_the_word_to_are_detected(text, category):
    assert category in categories(text)


def test_will_never_ask_for_otp_is_set_aside_as_advice():
    result = analyzer.analyze(transcript_of("Remember that we will never ask you for your OTP or your PIN over the phone."))
    assert "credential_request" not in result.categories
    assert result.suppressed_mentions >= 1


def test_third_person_report_of_an_otp_request_is_not_flagged():
    result = analyzer.analyze(transcript_of("A caller asked for my OTP yesterday but I hung up and told my bank about it."))
    assert "credential_request" not in result.categories
