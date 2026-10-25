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


ACTIONS: tuple[Action, ...] = (
    Action(
        "credentials",
        "Don't share codes, PINs or passwords",
        "Never read these out to a caller. If you have already shared any, contact the bank or service through its official channel right away.",
        "high",
        "a request for a code, PIN or password",
        lambda i: i.category == "credential_request",
    ),
    Action(
        "payment",
        "Pause any payment",
        "Don't send money, gift cards or crypto during this call. Verify the request with the person or organization through a trusted contact method.",
        "high",
        "a payment request",
        lambda i: i.category == "payment_pressure",
    ),
    Action(
        "family",
        "Call your family member directly",
        "Reach them on a number you already have, or another trusted channel, before doing anything the caller asks.",
        "high",
        "a caller claiming to be a relative or in an emergency",
        lambda i: i.rule_id in FAMILY_RULES,
    ),
    Action(
        "remote_access",
        "Don't install remote-access software",
        "If you already did, disconnect the device from the internet and contact your bank through its official channel.",
        "high",
        "a request for remote access to your device",
        lambda i: i.category == "remote_access",
    ),
    Action(
        "organization",
        "Verify the organization independently",
        "Use official published contact details, not a number the caller gave you. Ending the call is fine.",
        "medium",
        "a claimed bank, agency, or official role",
        lambda i: i.category == "impersonation" and i.rule_id not in FAMILY_RULES,
    ),
    Action(
        "pressure",
        "Don't let pressure set the pace",
        "Urgency and threats are used to stop people from checking. Pause, and verify the situation independently before deciding.",
        "medium",
        "pressure or threats",
        lambda i: i.category in {"coercion_threat", "urgency"},
    ),
    Action(
        "secrecy",
        "Treat secrecy as a reason to pause",
        "Being asked to hide something, or to skip the usual checks, is a reason to get independent confirmation, ideally from someone you trust.",
        "medium",
        "a request for secrecy or to skip verification",
        lambda i: i.category in {"secrecy_isolation", "verification_bypass"},
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
        ),
        "a voice the model flagged as possibly synthetic",
    )


def _join(phrases: list[str]) -> str:
    if len(phrases) <= 1:
        return "".join(phrases)
    return ", ".join(phrases[:-1]) + f" and {phrases[-1]}"


def build_recommendations(voice: VoiceAssessment, intent: IntentAssessment) -> RecommendationPlan:
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
                    ),
                    action.phrase,
                )
            )
    voice_item = _voice_recommendation(voice)
    if voice_item:
        ranked.append(voice_item)

    if ranked:
        # Stable sort: higher priority first, then more evidence, then the order the actions are declared in.
        ranked.sort(key=lambda pair: (-PRIORITY_RANK[pair[0].priority], -len(pair[0].evidence)))
        items = [rec.model_copy(update={"secondary": index >= MAX_PRIMARY}) for index, (rec, _) in enumerate(ranked)]
        count = sum(len(rec.evidence) for rec in items)
        headline = f"Based on {count} finding{'s' if count != 1 else ''}: {_join([phrase for _, phrase in ranked])}."
        return RecommendationPlan(state="actions", headline=headline, items=items)

    if intent.indicators:  # only quoted or recounted speech
        return RecommendationPlan(
            state="reported_only",
            headline="The transcript quotes or recounts scam-like phrases, but no direct request was detected.",
            detail=NOT_GUARANTEE,
        )
    if intent.risk == "none_detected":
        return RecommendationPlan(
            state="none_detected",
            headline="No suspicious indicators were detected in the analyzed transcript.",
            detail=NOT_GUARANTEE,
        )
    reason = intent.error or intent.summary or voice.error
    return RecommendationPlan(
        state="insufficient",
        headline="There isn't enough reliable evidence to recommend a result-specific action.",
        detail=reason or None,
    )
