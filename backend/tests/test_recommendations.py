"""The recommendation engine is deterministic and works only from structured findings."""

import pytest

from app.schemas_analysis import IntentAssessment, IntentIndicator, TranscriptResult, VoiceAssessment
from app.services.recommendations import MAX_PRIMARY, build_recommendations
from app.services.scam_intent import RuleBasedScamIntentAnalyzer
from tests.helpers import transcript_of

analyzer = RuleBasedScamIntentAnalyzer()


def voice(verdict: str = "model_favors_real", favoring: int = 0, windows: int = 3) -> VoiceAssessment:
    return VoiceAssessment(
        verdict=verdict, summary="stub", windows_analyzed=windows, windows_favoring_fake=favoring, fake_score_median=0.5
    )


def intent_from(text: str) -> IntentAssessment:
    return analyzer.analyze(transcript_of(text))


def plan(text: str, verdict: str = "model_favors_real"):
    return build_recommendations(voice(verdict, favoring=3 if verdict == "model_favors_fake" else 0), intent_from(text))


def ids(result) -> list[str]:
    return [item.id for item in result.items]


def indicator(**overrides) -> IntentIndicator:
    base = dict(
        id="x-0", rule_id="x", category="urgency", severity="medium", segment_index=0, char_start=0, char_end=3,
        excerpt="abc", explanation="e", suggested_action="a",
    )
    return IntentIndicator(**{**base, **overrides})


def intent_with(*indicators: IntentIndicator, risk: str = "elevated") -> IntentAssessment:
    return IntentAssessment(risk=risk, summary="stub", indicators=list(indicators))


# ---- each supported category -----------------------------------------------------------------


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Please read me the one time password we just sent you to your phone, it is needed for the account today.", "credentials"),
        ("You must transfer two thousand dollars to the account I will give you, and you have to buy gift cards today.", "payment"),
        ("Grandma it's me, your grandson. I'm in jail and I need you to help me get out of here as soon as you can.", "family"),
        ("To fix the problem you should install AnyDesk now and give me remote access to your computer so I can look.", "remote_access"),
        ("This is the fraud department of your bank calling about some activity on the card ending in four four two one.", "organization"),
        ("A warrant has been issued and you will be arrested if you do not call this number back immediately, ma'am.", "pressure"),
        ("Please do not tell anyone about this call, and keep this between us until everything has been fully resolved.", "secrecy"),
        ("No need to call your bank, we are handling everything for you here, so just stay with me on this call now.", "secrecy"),
    ],
)
def test_each_category_produces_its_action_with_evidence_from_the_transcript(text, expected):
    result = plan(text)
    assert result.state == "actions" and expected in ids(result)
    item = next(i for i in result.items if i.id == expected)
    assert item.evidence and all(e.source == "intent" and e.id and e.label in text for e in item.evidence)


def test_family_impersonation_is_not_mistaken_for_organization_impersonation():
    result = plan("Grandma it's me, your grandson. I'm in jail and I need you to help me get out of here as soon as you can.")
    assert "family" in ids(result) and "organization" not in ids(result)


# ---- multiple indicators, dedupe, priority ----------------------------------------------------


SCAM = "This is the fraud department. Your account has been compromised, please read me the one time password, do not tell anyone, and do it right now."


def test_many_indicators_give_one_deduplicated_recommendation_per_action_and_highest_priority_first():
    result = plan(SCAM)
    assert len(ids(result)) == len(set(ids(result)))
    assert result.items[0].id == "credentials" and result.items[0].priority == "high"
    ranks = {"high": 2, "medium": 1, "low": 0}
    priorities = [ranks[i.priority] for i in result.items]
    assert priorities == sorted(priorities, reverse=True)
    assert {"pressure", "secrecy", "organization"} <= set(ids(result))


def test_one_recommendation_can_cite_several_findings():
    result = plan("A warrant has been issued and you will be arrested, so you must act right now and call this number back.")
    pressure = next(i for i in result.items if i.id == "pressure")
    assert len(pressure.evidence) >= 2 and len({e.id for e in pressure.evidence}) == len(pressure.evidence)


def test_only_the_top_actions_are_primary_and_the_rest_are_secondary():
    result = plan(SCAM)
    assert len(result.items) > MAX_PRIMARY
    assert [i.secondary for i in result.items] == [False] * MAX_PRIMARY + [True] * (len(result.items) - MAX_PRIMARY)


def test_headline_explains_which_findings_triggered_the_plan():
    headline = plan(SCAM).headline
    assert headline.startswith("Based on ") and "code, PIN or password" in headline and "secrecy" in headline


def test_weak_only_evidence_lowers_priority():
    result = plan("I need money for rent this month, can you lend me some, I will pay you back on Friday when I get paid, thanks.")
    payment = next(i for i in result.items if i.id == "payment")
    assert payment.priority == "medium"  # high action, but only a low-severity finding


# ---- the two assessments are independent --------------------------------------------------------


def test_voice_concern_without_scam_indicators_recommends_only_voice_verification():
    benign = "Hi, your parcel will arrive on Tuesday afternoon between two and four, please be home to sign for it, thank you."
    result = plan(benign, verdict="model_favors_fake")
    assert ids(result) == ["voice"] and result.state == "actions"
    item = result.items[0]
    assert item.evidence[0].source == "voice" and "3 of 3" in item.detail
    assert "proof" in item.detail


def test_scam_indicators_without_a_voice_concern_do_not_mention_the_voice():
    result = plan(SCAM, verdict="model_favors_real")
    assert "voice" not in ids(result)


def test_a_real_leaning_voice_never_produces_a_reassurance_or_an_action():
    result = plan(SCAM, verdict="model_favors_real")
    assert not any("voice" in i.title.lower() for i in result.items)


def test_voice_and_scam_findings_combine_in_one_plan():
    result = plan(SCAM, verdict="model_favors_fake")
    assert "voice" in ids(result) and "credentials" in ids(result)


# ---- empty and inconclusive states ---------------------------------------------------------------


def test_no_indicators_gives_a_calm_message_and_no_action_cards():
    result = plan("Hi, your parcel will arrive on Tuesday afternoon between two and four, please be home to sign for it, thank you.")
    assert result.state == "none_detected" and result.items == []
    assert result.headline == "No suspicious indicators were detected in the analyzed transcript."
    assert "not a guarantee" in (result.detail or "")


def test_only_quoted_scam_phrases_are_not_treated_as_a_direct_request():
    quoted = "My grandmother got a call where the man said, read me your one time password, and she hung up on him luckily."
    result = plan(quoted)
    assert result.state == "reported_only" and result.items == []


@pytest.mark.parametrize(
    "assessment",
    [
        analyzer.analyze(TranscriptResult(status="no_speech")),
        analyzer.analyze(transcript_of("Hello? Hello.")),
        IntentAssessment(risk="unavailable", summary="Scam intent could not be assessed.", error="Transcription was unavailable."),
    ],
)
def test_insufficient_speech_or_failed_analysis_says_so_instead_of_inventing_advice(assessment):
    result = build_recommendations(voice("inconclusive"), assessment)
    assert result.state == "insufficient" and result.items == []
    assert "enough reliable evidence" in result.headline and result.detail


def test_everything_failed_is_still_a_valid_insufficient_plan():
    failed_voice = VoiceAssessment(verdict="unavailable", summary="x", error="model failed")
    result = build_recommendations(failed_voice, IntentAssessment(risk="unavailable", summary="x"))
    assert result.state == "insufficient"


def test_a_voice_concern_survives_when_the_transcript_is_unusable():
    result = build_recommendations(voice("model_favors_fake", 2, 2), analyzer.analyze(TranscriptResult(status="no_speech")))
    assert result.state == "actions" and ids(result) == ["voice"]


# ---- missing or malformed evidence ---------------------------------------------------------------


def test_unknown_category_is_ignored_rather_than_guessed():
    result = build_recommendations(voice(), intent_with(indicator(category="something_new", rule_id="new_rule")))
    assert result.state == "insufficient" or result.items == []
    assert "something_new" not in result.headline


def test_blank_excerpt_and_missing_id_and_timestamp_fall_back_safely():
    result = build_recommendations(voice(), intent_with(indicator(category="credential_request", excerpt="  ", id="")))
    ref = result.items[0].evidence[0]
    assert ref.label == "credential request" and ref.id is None and ref.start_seconds is None


def test_voice_concern_with_missing_window_counts_still_renders():
    bare = VoiceAssessment(verdict="model_favors_fake", summary="x")
    result = build_recommendations(bare, IntentAssessment(risk="none_detected", summary="x"))
    assert ids(result) == ["voice"] and "analyzed audio" in result.items[0].detail


def test_indicator_ids_match_the_frontend_key_scheme():
    for item in intent_from(SCAM).indicators:
        assert item.id == f"{item.rule_id}-{item.char_start}"


def test_the_plan_is_deterministic():
    assert plan(SCAM).model_dump() == plan(SCAM).model_dump()
