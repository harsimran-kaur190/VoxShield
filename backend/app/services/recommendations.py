"""Evidence-linked safety recommendations.

Pure and deterministic: the plan is derived only from the structured voice and scam-intent results, never from free
text. Each action is a declarative entry in ACTIONS, so adding or changing advice does not touch the engine.
"""

from collections.abc import Callable
from dataclasses import dataclass

from app.schemas_analysis import (
    EvidenceRef,
    IntentAssessment,
    IntentIndicator,
    Priority,
    Recommendation,
    RecommendationPlan,
    TranscriptResult,
    VoiceAssessment,
)

PRIORITY_RANK: dict[str, int] = {"high": 2, "medium": 1, "low": 0}
LOWER: dict[str, Priority] = {"high": "medium", "medium": "low", "low": "low"}
MEDIUM_OR_HIGHER = {"medium", "high"}
MAX_PRIMARY = 3

FAMILY_RULES = {"imp_relative", "imp_emergency", "nli_family_emergency"}
NOT_GUARANTEE = "This is not a guarantee of safety. If something still feels wrong, verify the caller through a trusted channel."


@dataclass(frozen=True)
class Action:
    id: str
    title: str
    detail: str
    priority: Priority
    phrase: str  # how the trigger reads inside the headline
    matches: Callable[[IntentIndicator], bool]
    why: str = ""


ACTIONS: tuple[Action, ...] = (
    Action(
        "credentials",
        "Don't share codes, PINs or passwords",
        "Never read these out to a caller. If you have already shared any, contact the bank or service through its official channel right away.",
        "high",
        "a request for a code, PIN or password",
        lambda i: i.category == "credential_request",
        why='Organizations do not ask callers to read out codes or passwords, and anyone holding one can take over an account.',
    ),
    Action(
        "payment",
        "Pause any payment",
        "Don't send money, gift cards or crypto during this call. Verify the request with the person or organization through a trusted contact method.",
        "high",
        "a payment request",
        lambda i: i.category == "payment_pressure",
        why='Money sent on request is hard to recover, and a payment request is the moment to confirm who is really asking.',
    ),
    Action(
        "family",
        "Call your family member directly",
        "Reach them on a number you already have, or another trusted channel, before doing anything the caller asks.",
        "high",
        "a caller claiming to be a relative or in an emergency",
        lambda i: i.rule_id in FAMILY_RULES,
        why='Voice cloning can imitate a relative, so the voice alone cannot confirm who is calling.',
    ),
    Action(
        "remote_access",
        "Don't install remote-access software",
        "If you already did, disconnect the device from the internet and contact your bank through its official channel.",
        "high",
        "a request for remote access to your device",
        lambda i: i.category == "remote_access",
        why='Remote access lets someone see and control the device, including banking apps and passwords.',
    ),
    Action(
        "organization",
        "Verify the organization independently",
        "Use official published contact details, not a number the caller gave you. Ending the call is fine.",
        "medium",
        "a claimed bank, agency, or official role",
        lambda i: i.category == "impersonation" and i.rule_id not in FAMILY_RULES,
        why="A caller's claim to be from a bank or agency cannot be confirmed from audio, and real organizations also call customers.",
    ),
    Action(
        "pressure",
        "Don't let pressure set the pace",
        "Urgency and threats are used to stop people from checking. Pause, and verify the situation independently before deciding.",
        "medium",
        "pressure or threats",
        lambda i: i.category in {"coercion_threat", "urgency"},
        why='Urgency and threats leave less time to check, whether or not the request is genuine.',
    ),
    Action(
        "verify",
        "Check through a channel you already trust",
        "Contact the organization or person using a number or app you already had, such as the one on your card or statement. Do not use a number, link or app the caller supplied.",
        "high",
        "being discouraged from checking",
        lambda i: i.category == "verification_bypass",
        why="Being told not to check is the opposite of what a genuine request needs; a real one can wait while you confirm it.",
    ),
    Action(
        "secrecy",
        "Treat secrecy as a reason to pause",
        "Being asked to hide something is a reason to get independent confirmation, ideally from someone you trust.",
        "medium",
        "a request for secrecy",
        lambda i: i.category == "secrecy_isolation",
        why="Keeping others out of the loop removes the chance for someone to spot a problem.",
    ),
)


def _label(indicator: IntentIndicator) -> str:
    excerpt = (indicator.excerpt or "").strip()
    return excerpt or indicator.category.replace("_", " ") or "Finding"


def _evidence(indicator: IntentIndicator) -> EvidenceRef:
    return EvidenceRef(source="intent", id=indicator.id or None, label=_label(indicator), start_seconds=indicator.start_seconds)


def _priority(base: Priority, evidence: list[IntentIndicator]) -> Priority:
    """Weak-only evidence lowers the priority one step: the same advice, a lighter tone."""
    return base if any(i.severity in MEDIUM_OR_HIGHER for i in evidence) else LOWER[base]


def _voice_recommendation(voice: VoiceAssessment) -> tuple[Recommendation, str] | None:
    if voice.verdict != "model_favors_fake":
        return None
    total = voice.windows_analyzed or len(voice.windows)
    counted = (
        f"{voice.windows_favoring_fake} of {total} analyzed window{'s' if total != 1 else ''}" if total else "the analyzed audio"
    )
    label = f"Model favored “fake” in {counted}"
    return (
        Recommendation(
            id="voice",
            title="Don't rely on the voice to confirm who it is",
            detail=f"The voice model leaned “fake” in {counted}. That is a model assessment, not proof. Verify the speaker through a separate trusted channel.",
            priority="medium",
            evidence=[EvidenceRef(source="voice", label=label)],
            why="Voice models can be wrong, for example on phone-quality or noisy audio, and can flag harmless synthetic voices such as text-to-speech or assistants.",
            basis="voice",
        ),
        "a voice the model flagged as possibly synthetic",
    )


def _join(phrases: list[str]) -> str:
    if len(phrases) <= 1:
        return "".join(phrases)
    return ", ".join(phrases[:-1]) + f" and {phrases[-1]}"


GENERAL_VERIFY = Recommendation(
    id="general_verify",
    title="If a message about your account worries you, check it yourself",
    detail="Open your bank's app or call the number on your card or statement. Avoid links or phone numbers that arrived in the message or call.",
    priority="low",
    why="This is an ordinary precaution that applies to any account message. It is not a result of this analysis.",
    basis="general",
)
VOICE_ONLY_HEADLINE = (
    "The voice model leaned “fake”, but no direct scam request was found in the conversation. "
    "Treat that as a reason to confirm who is speaking, not as a sign of a scam."
)


VOICE_ONLY_NO_SCAM_CHECK_HEADLINE = (
    "The voice model leaned “fake”. Scam detection did not run for this recording, so nothing is known about what was said. "
    "Treat the voice result as a reason to confirm who is speaking, not as a sign of a scam."
)


def _general(transcript: TranscriptResult | None, intent: IntentAssessment) -> list[Recommendation]:
    """Ordinary precautions for a quiet or ambiguous result. Only when there was a transcript to look at."""
    if transcript is None or transcript.status != "ok" or intent.error:
        return []
    if intent.risk in {"none_detected", "inconclusive", "weak_signals"}:
        return [GENERAL_VERIFY]
    return []


def build_recommendations(
    voice: VoiceAssessment, intent: IntentAssessment, transcript: TranscriptResult | None = None, scam_check_ran: bool = True
) -> RecommendationPlan:
    """`scam_check_ran` is False when scam detection was withheld (for example, for a language it was not built for), so a
    voice-only plan must not say that nothing suspicious was found in the conversation."""
    direct = [i for i in intent.indicators if i.context == "direct"]
    ranked: list[tuple[Recommendation, str]] = []
    for action in ACTIONS:
        matched = [i for i in direct if action.matches(i)]
        if matched:
            ranked.append(
                (
                    Recommendation(
                        id=action.id,
                        title=action.title,
                        detail=action.detail,
                        priority=_priority(action.priority, matched),
                        evidence=[_evidence(i) for i in matched],
                        why=action.why or None,
                    ),
                    action.phrase,
                )
            )
    voice_item = _voice_recommendation(voice)
    if voice_item:
        ranked.append(voice_item)

    if ranked:
        # What comes first: advice that follows from a scam finding always precedes the voice item, which says nothing
        # about scams. Then higher priority, then more supporting findings, then the order ACTIONS is declared in
        # (a stable sort), which puts codes ahead of payments ahead of the rest.
        ranked.sort(key=lambda pair: (pair[0].basis == "voice", -PRIORITY_RANK[pair[0].priority], -len(pair[0].evidence)))
        items = [rec.model_copy(update={"secondary": index >= MAX_PRIMARY}) for index, (rec, _) in enumerate(ranked)]
        count = sum(len(rec.evidence) for rec in items)
        if all(rec.basis == "voice" for rec in items):
            headline = VOICE_ONLY_HEADLINE if scam_check_ran else VOICE_ONLY_NO_SCAM_CHECK_HEADLINE
            return RecommendationPlan(state="actions", headline=headline, items=items, general=_general(transcript, intent))
        headline = f"Based on {count} finding{'s' if count != 1 else ''}: {_join([phrase for _, phrase in ranked])}."
        return RecommendationPlan(state="actions", headline=headline, items=items)

    if intent.indicators:  # only quoted or recounted speech
        return RecommendationPlan(
            state="reported_only",
            headline="The transcript quotes or recounts scam-like phrases, but no direct request was detected.",
            detail=NOT_GUARANTEE,
            general=_general(transcript, intent),
        )
    if intent.risk == "none_detected":
        return RecommendationPlan(
            state="none_detected",
            headline="No suspicious indicators were detected in the analyzed transcript.",
            detail=NOT_GUARANTEE,
            general=_general(transcript, intent),
        )
    reason = intent.error or intent.summary or voice.error
    return RecommendationPlan(
        state="insufficient",
        headline="There isn't enough reliable evidence to recommend a result-specific action.",
        detail=reason or None,
        general=_general(transcript, intent),
    )
