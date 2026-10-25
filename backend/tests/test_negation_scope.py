"""A negation only affects the clause it appears in. Quoted or recounted speech still never makes a direct finding."""

import pytest

from app.schemas_analysis import VoiceAssessment
from app.services.recommendations import build_recommendations
from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from app.services.scam_rules import current_clause, is_negated
from tests.helpers import transcript_of

analyzer = RuleBasedScamIntentAnalyzer()
VOICE = VoiceAssessment(verdict="model_favors_real", summary="stub")


def run(text: str):
    return analyzer.analyze(transcript_of(text))


def rules(result) -> set[str]:
    return {i.rule_id for i in result.indicators}


# ---- the reported bug: secrecy plus urgency ---------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "Do not tell anyone, and do it right now, because the account is closing today at noon.",
        "Please read me the one time password, do not tell anyone, and do it right now.",
        "Please do not tell anyone about this call, it is urgent and you must act now.",
        "Do not tell your family about this, but you have to act right away or it will be too late.",
    ],
)
def test_secrecy_does_not_suppress_the_urgency_that_follows_it(text):
    result = run(text)
    assert "secrecy_tell" in rules(result) and "urgency" in rules(result)
    assert result.suppressed_mentions == 0
    assert {"secrecy_isolation", "urgency"} <= set(result.categories)


def test_recommendations_use_the_corrected_findings_and_cite_the_urgency_evidence():
    plan = build_recommendations(VOICE, run("Do not tell anyone, and do it right now, because the account is closing today at noon."))
    by_id = {item.id: item for item in plan.items}
    assert {"secrecy", "pressure"} <= set(by_id)
    assert [e.label for e in by_id["pressure"].evidence] == ["right now"]
    assert by_id["pressure"].evidence[0].id and by_id["pressure"].evidence[0].start_seconds is not None


# ---- genuinely negated urgency stays set aside ------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "You do not need to decide right now, take your time and call us back whenever you are ready.",
        "There is no need to act immediately, so please take your time with this one today.",
        "There is no rush at all, nothing has to happen immediately, so check with your bank first and call back later.",
    ],
)
def test_negated_urgency_is_set_aside_and_counted(text):
    result = run(text)
    assert "urgency" not in rules(result) and result.suppressed_mentions >= 1
    assert result.risk in {"none_detected", "inconclusive"}


# ---- a negation that belongs to a different clause is not applied -----------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "Do not worry, this is urgent and you must act right now to keep the account open today.",
        "We do not have much time, so you must transfer the money right now to the account I give you.",
        "I am not going to repeat this; you need to act immediately before the line closes for the day.",
    ],
)
def test_unrelated_negation_nearby_does_not_hide_an_urgency_phrase(text):
    result = run(text)
    assert "urgency" in rules(result), [(i.rule_id, i.excerpt) for i in result.indicators]


def test_negation_still_reaches_across_an_introductory_comma_in_the_same_clause():
    result = run("Never, under any circumstances, share your one time password with anyone who phones you.")
    assert not [i for i in result.indicators if i.category == "credential_request"] and result.suppressed_mentions >= 1


def test_negation_still_covers_a_compound_predicate_without_a_clause_break():
    result = run("The bank will never call you and ask for your one time password under any circumstances.")
    assert not result.indicators and result.suppressed_mentions >= 1


@pytest.mark.parametrize(
    "prefix, expected",
    [
        ("do not tell anyone, and do it", False),
        ("do not tell anyone about it, it is", False),
        ("we do not have time, so you must act", False),
        ("do not act", True),
        ("there is no need to act", True),
        ("never, under any circumstances, share", True),
        ("do not act; you must act", False),
    ],
)
def test_clause_scope_of_negation(prefix, expected):
    assert is_negated(prefix) is expected


def test_current_clause_returns_only_the_text_after_the_last_break():
    assert current_clause("do not tell anyone, and do it").strip() == "and do it"
    assert current_clause("no breaks here") == "no breaks here"


# ---- quoted or recounted speech still never makes a direct finding ----------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "He said, do not tell anyone, and do it right now, and I hung up on him straight away.",
        'The message literally says "read me your one time password, and do it right now" and I deleted it.',
        "Scammers often say do not tell anyone, and do it right now, so it helps to know how to spot those calls.",
    ],
)
def test_quoted_or_recounted_instructions_stay_reported_and_never_drive_recommendations(text):
    result = run(text)
    assert result.indicators and all(i.context == "reported" for i in result.indicators)
    assert result.categories == [] and result.risk == "weak_signals"
    plan = build_recommendations(VOICE, result)
    assert plan.state == "reported_only" and plan.items == []


def test_the_same_words_said_directly_do_drive_recommendations():
    plan = build_recommendations(VOICE, run("Do not tell anyone, and do it right now, because the account is closing today."))
    assert plan.state == "actions" and {"secrecy", "pressure"} <= {i.id for i in plan.items}


# ---- ordinary speech ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "I do not know what time the parcel arrives, but it should be there by the afternoon, so please be home to sign.",
        "I never share my password with anyone, and the bank sent me a new card this week, which arrived on Tuesday.",
        "We did not manage to finish the report today, but I will send it over first thing tomorrow morning, thanks.",
        "My daughter does not like broccoli, so we are having pasta tonight, and then we are watching a film together.",
    ],
)
def test_ordinary_speech_with_negations_has_no_findings(text):
    result = run(text)
    assert result.risk == "none_detected" and result.indicators == []


# ---- a known limitation, recorded so a future change is noticed ---------------------------------------------


@pytest.mark.xfail(strict=True, reason="Without any punctuation or conjunction cue the negation window still reaches the next phrase.")
def test_run_on_speech_with_no_punctuation_still_loses_the_urgency():
    assert "urgency" in rules(run("Do not tell anyone about this call do it right now because it is closing."))
