from app.schemas_analysis import IntentAssessment, IntentIndicator, ModelInfo, TranscriptResult
from app.services.languages import scam_detection_block
from app.services.scam_rules import RULES, is_negated, is_reported, split_sentences

METHOD = ModelInfo(
    name="voxshield-scam-rules",
    revision="1.1",
    method="Transparent English regular-expression rules over the transcript, with negation handling. No machine-learning model.",
)
LIMITATIONS = [
    "The rules only understand English and only see what the transcription captured.",
    "Rules find indicators, not intent. Honest callers can use the same words, and scammers can avoid them.",
    "Finding no indicator does not rule out a scam.",
]
SENSITIVE_CATEGORIES = {"credential_request", "payment_pressure", "remote_access"}
MIN_WORDS_FOR_NEGATIVE = 12
SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2}


def segment_at(transcript: TranscriptResult, position: int):
    for segment in transcript.segments:
        if segment.char_start <= position <= segment.char_end:
            return segment
    return None


def _trigger(rule, category_label: str, reported: bool) -> str:
    checked = (
        "It sits inside quoted or recounted speech, so it is shown but does not raise the risk level."
        if reported
        else "No negation (for example 'never share') or recounting cue ('he said') came before it in the same sentence."
    )
    return f"Rule '{rule.rule_id}' ({category_label}) matched this wording. {checked}"


def _overlaps(a: IntentIndicator, b: IntentIndicator) -> bool:
    return a.category == b.category and a.context == b.context and a.char_start < b.char_end and b.char_start < a.char_end


def summarize_direct(direct: list[IntentIndicator]) -> tuple[str, str, list[str]]:
    """Risk level from direct findings only. Shared by both detectors so the level always means the same thing."""
    categories = sorted({i.category for i in direct})
    strong_sensitive = any(i.category in SENSITIVE_CATEGORIES and i.severity != "low" for i in direct)
    pressure = {c for c in categories if c not in SENSITIVE_CATEGORIES}
    strongest = max(SEVERITY_RANK[i.severity] for i in direct)
    if (strong_sensitive and pressure) or len(categories) >= 3:
        return "high", "Several indicators appear together, such as a request for a secret or payment combined with pressure.", categories
    if strongest >= 1:
        return "elevated", "At least one notable indicator was found in the conversation.", categories
    return "weak_signals", "Only weak signals were found. They also appear in ordinary calls.", categories


class RuleBasedScamIntentAnalyzer:
    detector_name = "rules"

    def analyze(self, transcript: TranscriptResult) -> IntentAssessment:
        if transcript.status != "ok" or not transcript.text.strip():
            return self._inconclusive("There was no usable transcript, so scam intent could not be assessed.")
        blocked = scam_detection_block(transcript)
        if blocked:
            return self._inconclusive(blocked)

        text = transcript.text
        found: list[IntentIndicator] = []
        suppressed = 0
        for start, end in split_sentences(text):
            sentence = text[start:end]
            for rule in RULES:
                for match in rule.pattern.finditer(sentence):
                    if not rule.negation_is_signal and is_negated(sentence[: match.start()]):
                        suppressed += 1
                        continue
                    abs_start, abs_end = start + match.start(), start + match.end()
                    reported = is_reported(sentence[: match.start()])
                    segment = segment_at(transcript, abs_start)
                    candidate = IntentIndicator(
                        id=f"{rule.rule_id}-{abs_start}",
                        rule_id=rule.rule_id,
                        category=rule.category,
                        severity="low" if reported else rule.severity,
                        segment_index=segment.index if segment else None,
                        char_start=abs_start,
                        char_end=abs_end,
                        start_seconds=segment.start_seconds if segment else None,
                        end_seconds=segment.end_seconds if segment else None,
                        excerpt=text[abs_start:abs_end],
                        sentence=sentence,
                        context="reported" if reported else "direct",
                        trigger=_trigger(rule, rule.category.replace("_", " "), reported),
                        explanation=rule.explanation,
                        suggested_action=rule.action,
                    )
                    existing = next((i for i in found if _overlaps(i, candidate)), None)
                    if existing is None:
                        found.append(candidate)
                    elif SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[existing.severity]:
                        found[found.index(existing)] = candidate
        found.sort(key=lambda i: i.char_start)

        limitations = list(LIMITATIONS)
        limitations += transcript.quality_notes
        if suppressed:
            limitations.append(
                f"{suppressed} mention(s) were set aside because they appeared in a negated or advisory sentence "
                "(for example, 'never share your OTP')."
            )

        direct = [i for i in found if i.context == "direct"]
        reported = len(found) - len(direct)
        if reported:
            limitations.append(
                f"{reported} phrase(s) were shown as reported speech because someone seemed to be quoting or recounting a "
                "request. If the speaker is relaying that request to you directly, treat it as a direct one."
            )

        if not found:
            word_count = len(text.split())
            if word_count < MIN_WORDS_FOR_NEGATIVE:
                return self._inconclusive(
                    f"The transcript is only {word_count} words long, which is too short to judge.", suppressed
                )
            return IntentAssessment(
                risk="none_detected",
                summary="No scam indicators were found in the transcript.",
                suppressed_mentions=suppressed,
                limitations=limitations,
                method=METHOD,
            )

        if not direct:
            return IntentAssessment(
                risk="weak_signals",
                summary="The transcript describes scam-like requests, but they appear to be quoted or recounted rather than made to you.",
                indicators=found,
                suppressed_mentions=suppressed,
                reported_mentions=reported,
                limitations=limitations,
                method=METHOD,
            )

        risk, summary, categories = summarize_direct(direct)
        return IntentAssessment(
            risk=risk,
            summary=summary,
            indicators=found,
            categories=categories,
            suppressed_mentions=suppressed,
            reported_mentions=reported,
            limitations=limitations,
            method=METHOD,
        )

    def _inconclusive(self, reason: str, suppressed: int = 0) -> IntentAssessment:
        return IntentAssessment(
            risk="inconclusive",
            summary=reason,
            suppressed_mentions=suppressed,
            limitations=LIMITATIONS,
            method=METHOD,
        )
