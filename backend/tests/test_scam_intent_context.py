"""Context handling in the NLI scam-intent detector: protective advice, reported speech, mixed messages.

STUBBED MODEL. A fake NLI model returns the scores written in each table, so these tests check the decision logic
(protective gating, clause splitting, reported-speech handling) deterministically. The scores are rounded from what the
real model returned during development, but nothing here says how the real model behaves; that is
tests/test_scam_intent_context_real.py, which runs the real classifier and is opt-in.
"""

from app.schemas_analysis import IntentAssessment
from app.services.scam_nli import (
    ANAPHORIC_OBJECT,
    HYPOTHESES,
    NARRATION,
    PROTECTIVE_TEXTS,
    Thresholds,
    _narrates,
    build_windows,
    split_clauses,
)
from tests.helpers import transcript_of
from tests.test_scam_nli import analyzer

STATEMENT = {h.key: h.texts[0] for h in HYPOTHESES}
CRED, SECRECY, BYPASS = STATEMENT["credential_request"], STATEMENT["secrecy"], STATEMENT["verification_bypass"]
PROTECT_SHARE, PROTECT_VERIFY, PROTECT_SUSPECT = PROTECTIVE_TEXTS


def run(text: str, table: dict) -> IntentAssessment:
    return analyzer(table)[0].analyze(transcript_of(text))


def direct(result: IntentAssessment) -> set[str]:
    return {i.category for i in result.indicators if i.context == "direct"}


# ---- 1. the reported false positive -------------------------------------------------------------------------------


BANK_NOTICE = (
    "Hello, this is a security notification regarding your bank account. "
    "For your safety, please review your recent banking activity and contact your bank through its official website if you notice anything suspicious. "
    "Never share your password, PIN, or one-time verification code with callers claiming to represent your bank. "
    "Always verify a caller's identity independently before taking action. "
    "Scammers may use convincing voices and urgent language to gain your trust."
)


def test_the_bank_awareness_notice_gets_no_findings_and_says_what_was_held_back():
    table = {
        # the greeting only mentions an account: the reworded credential statement does not fire (the old one scored 0.99)
        ("security notification", CRED): 0.02,
        ("Never share your password", SECRECY): 0.95,
        ("Never share your password", BYPASS): 0.98,
        ("Never share your password", PROTECT_SHARE): 0.999,
    }
    result = run(BANK_NOTICE, table)
    assert result.indicators == []
    assert result.risk == "none_detected"
    assert result.suppressed_mentions == 2  # visible, not silent
    assert "protective advice" in result.summary


def test_protective_wording_does_not_make_the_result_a_clearance():
    result = run(BANK_NOTICE, {("Never share", SECRECY): 0.95, ("Never share", PROTECT_SHARE): 0.999})
    assert result.score_note and "not a calibrated probability" in result.score_note
    assert any("does not rule out a scam" in item or "Finding nothing" in item for item in result.limitations)


# ---- 2-7. the regression cases ------------------------------------------------------------------------------------


def test_2_a_direct_request_for_an_otp_is_flagged():
    result = run("Tell me your OTP immediately so I can stop your account from being blocked.", {("Tell me your OTP", CRED): 0.989})
    (item,) = [i for i in result.indicators if i.category == "credential_request"]
    assert (item.context, item.severity) == ("direct", "high")
    assert result.risk in {"elevated", "high"}


def test_3_never_share_your_otp_is_not_a_request_for_a_secret_or_secrecy():
    table = {("Never share your OTP", SECRECY): 0.985, ("Never share your OTP", BYPASS): 0.984, ("Never share your OTP", PROTECT_SHARE): 0.982}
    result = run("Never share your OTP with anyone who calls you, please.", table)
    assert direct(result) == set() and result.suppressed_mentions == 2


def test_3b_even_a_high_credential_score_on_a_clearly_protective_sentence_is_held_back():
    """Real model: 'never reuse your password' scored 0.92 on the credential statement and 0.99 as protective."""
    result = run("To protect your account, enable two-factor authentication and never reuse your password on other sites.", {("never reuse", CRED): 0.92, ("never reuse", PROTECT_SHARE): 0.99})
    assert direct(result) == set()


def test_credential_requests_need_stronger_protective_evidence_than_the_other_categories_to_be_held_back():
    text = "Never share your OTP with anyone except me, please."
    below_strict = {("Never share", CRED): 0.97, ("Never share", PROTECT_SHARE): 0.93}  # above 0.90, below 0.95
    assert "credential_request" in direct(run(text, below_strict))
    assert direct(run(text, {("Never share", SECRECY): 0.97, ("Never share", PROTECT_SHARE): 0.93})) == set()


def test_4_contacting_your_bank_on_the_number_on_your_card_is_not_discouraging_verification():
    table = {("number printed on your card", BYPASS): 0.95, ("number printed on your card", PROTECT_VERIFY): 0.96}
    result = run("Contact your bank using the number printed on your card if you are unsure.", table)
    assert "verification_bypass" not in direct(result)


def test_5_a_reported_password_request_is_distinguished_from_a_direct_one():
    reported = run("The caller asked me to reveal my password.", {("asked me to reveal", CRED): 0.87})
    (item,) = reported.indicators
    assert (item.context, item.severity) == ("reported", "low")
    assert reported.risk == "weak_signals" and direct(reported) == set()

    asked_now = run("Please reveal your password so I can fix your account.", {("reveal your password", CRED): 0.991})
    (item,) = asked_now.indicators
    assert (item.context, item.severity) == ("direct", "high")


def test_5b_the_lower_bar_for_narrated_sentences_never_applies_to_unnarrated_ones():
    """0.87 is below the 0.92 finding threshold: without a narration cue it is only an uncertain passage."""
    result = run("Please reveal your password so I can fix your account.", {("reveal your password", CRED): 0.87})
    assert result.indicators == [] and result.risk == "inconclusive"


def test_6_unusual_account_activity_alone_is_not_treated_as_a_confirmed_scam():
    result = run("Your bank account has unusual activity on it, and we noticed it today.", {("unusual activity", CRED): 0.07})
    assert result.risk == "none_detected" and result.indicators == []


def test_7a_a_warning_clause_followed_by_a_request_clause_still_exposes_the_request():
    text = "Never share your code with strangers, but I need you to read me the code that just arrived."
    table = {
        ("Never share your code", PROTECT_SHARE): 0.98,
        ("Never share your code", SECRECY): 0.96,        # would look like secrecy if judged on its own
        ("I need you to read me", CRED): 0.97,
    }
    result = run(text, table)
    assert direct(result) == {"credential_request"}
    (item,) = result.indicators
    assert item.excerpt.startswith("I need you to read me")  # the request, not the warning, is quoted
    assert result.suppressed_mentions == 1


def test_7b_a_warning_sentence_followed_by_a_request_sentence_still_exposes_the_request():
    text = "Your bank advises never to disclose your OTP. However, for this verification I need you to tell me your OTP."
    table = {("never to disclose", PROTECT_SHARE): 0.98, ("never to disclose", SECRECY): 0.9, ("I need you to tell me", CRED): 0.97}
    assert direct(run(text, table)) == {"credential_request"}


def test_7c_a_request_after_a_comma_so_is_split_from_the_warning_before_it():
    text = "Never share your OTP with anyone except me, so read me the OTP now."
    table = {("Never share your OTP", PROTECT_SHARE): 0.97, ("read me the OTP", CRED): 0.99}
    assert direct(run(text, table)) == {"credential_request"}


def test_7d_a_real_secrecy_request_is_not_hidden_by_protective_advice_later_in_the_same_sentence():
    text = "Keep this call secret from your family, and also never share your code with your bank."
    table = {
        ("Keep this call secret", SECRECY): 0.995,
        ("never share your code", PROTECT_SHARE): 0.98,
        ("never share your code", SECRECY): 0.96,         # the protective clause alone looks like secrecy; it is held back
    }
    result = run(text, table)
    assert [i.excerpt for i in result.indicators if i.category == "secrecy_isolation"] == ["Keep this call secret from your family"]


def test_a_request_is_not_hidden_because_the_clause_before_it_was_protective():
    """The window joining a protective clause and a request must not inherit the clause's protectiveness."""
    text = "Never give your code to strangers, so please give your code to me and I will confirm it is safe."
    table = {
        ("Never give your code to strangers", PROTECT_SHARE): 0.98,
        ("Never give your code to strangers please give", CRED): 0.988,  # the joined window (clause texts, connector removed)
        ("please give your code to me", CRED): 0.91,                      # alone it is just under the 0.92 finding threshold
    }
    assert "credential_request" in direct(run(text, table))


def test_a_context_finding_that_comes_only_from_a_protective_neighbour_is_held_back():
    """Real model: 'If you receive such a call, hang up...' scored 0.92 on secrecy only when joined to 'We will never ask for your PIN.'"""
    first, second = "We will never call you to ask for your PIN.", "If you receive such a call, hang up and dial the number on your card."
    table = {(first, PROTECT_SHARE): 0.97, (f"{first} {second}", SECRECY): 0.92}
    result = run(f"{first} {second}", table)
    assert direct(result) == set() and result.suppressed_mentions == 1


def test_protective_advice_never_lowers_the_risk_of_a_separate_genuine_sentence():
    text = "Never share your code with anyone. Do not tell your family about this call or your bank."
    table = {("Never share", PROTECT_SHARE): 0.99, ("Never share", SECRECY): 0.95, ("Do not tell your family", SECRECY): 0.99}
    result = run(text, table)
    assert "secrecy_isolation" in direct(result)
    assert all(not i.excerpt.startswith("Never share") for i in result.indicators)


# ---- pieces --------------------------------------------------------------------------------------------------------


def test_clauses_are_split_only_when_both_sides_can_be_scored():
    text = "Never share your code with strangers, but I need you to read me the code."
    assert [text[a:b] for a, b in split_clauses(text, 0, len(text))] == ["Never share your code with strangers", "I need you to read me the code."]
    short = "I agree, but no."
    assert split_clauses(short, 0, len(short)) == [(0, len(short))]
    assert len(build_windows("Never share your code, but I need your code now. Thanks for listening to this message today.")) == 3


def test_narration_cues_are_structural_not_scam_vocabulary():
    for sentence in ("The caller asked me to reveal my password.", "In this scam, the caller pretends to be your bank.", 'He said "read me the code" and I refused.', "Scammers often say read me the code."):
        assert _narrates(sentence), sentence
    for sentence in ("Please reveal your password so I can fix your account.", "Tell me your OTP immediately.", "Read me the six digit code you just received."):
        assert not _narrates(sentence), sentence
    assert NARRATION.search("A typical scam begins with a call.") is None  # needs a cue such as 'in a typical scam'


def test_anaphoric_it_is_recognised_only_as_the_object_of_a_disclosure_verb():
    assert ANAPHORIC_OBJECT.search("Please do not give it to anyone.") and ANAPHORIC_OBJECT.search("Don't share it with anyone")
    assert not ANAPHORIC_OBJECT.search("Do not tell your family about this call.")


def test_thresholds_keep_the_old_three_argument_form_and_expose_the_new_ones():
    t = Thresholds(0.92, 0.30, 0.50)
    assert (t.protective, t.protective_strict, t.reported_finding) == (0.90, 0.95, 0.80)
