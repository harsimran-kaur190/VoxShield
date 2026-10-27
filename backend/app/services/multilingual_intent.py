"""Scam-intent detection for Hindi and Urdu speech.

Two sources, kept apart in the report so each finding says where it came from:
  * the configured English detector (language model or rules) reads Whisper's English translation of the audio. Its
    findings point into the translation, and each carries the original-language text spoken at the same time;
  * Hindi keyword rules (scam_rules_indic.py) read the original transcript, as a backstop for requests the
    translation loses.
The risk level is computed from both with the same rule the English detectors use (summarize_direct), so a level means
the same thing in every language. None of this has been validated on real calls, and the assessment says so.
"""

from app.schemas_analysis import IntentAssessment, IntentIndicator, TranscriptResult
from app.services.languages import TRANSLATION_NOTE, language_name
from app.services.scam_intent import summarize_direct
from app.services.scam_rules_indic import find_indicators

RISK_RANK = {"unavailable": -2, "inconclusive": -1, "none_detected": 0, "weak_signals": 1, "elevated": 2, "high": 3}


def _original_for(indicator: IntentIndicator, transcript: TranscriptResult) -> tuple[str | None, int | None]:
    """The original-language segments spoken while the translated sentence was, matched by time."""
    if indicator.start_seconds is None or indicator.end_seconds is None:
        return None, None
    overlapping = [
        seg for seg in transcript.segments
        if seg.start_seconds < indicator.end_seconds and indicator.start_seconds < seg.end_seconds
    ]
    if not overlapping:
        return None, None
    return " ".join(seg.text for seg in overlapping), overlapping[0].index


def mark_translated(indicator: IntentIndicator, transcript: TranscriptResult, language: str) -> IntentIndicator:
    original, index = _original_for(indicator, transcript)
    return indicator.model_copy(update={
        "id": f"tr-{indicator.id or indicator.rule_id + '-' + str(indicator.char_start)}",
        "text_source": "translation",
        "original_text": original,
        "original_segment_index": index,
        "trigger": f"{indicator.trigger} Found in the English machine translation of the {language_name(language)} speech."
        if indicator.trigger else f"Found in the English machine translation of the {language_name(language)} speech.",
    })


def combine(
    translated: IntentAssessment | None,
    transcript: TranscriptResult,
    translation_problem: str | None = None,
) -> IntentAssessment:
    """One assessment from the translated-text result (None when no translation could be made) and the keyword rules.

    A finding from either source counts. When neither finds anything, the translated result decides (none_detected or
    inconclusive), and with no translation at all the result is inconclusive: keyword rules alone are too narrow to
    call a recording quiet."""
    language = transcript.language or ""
    name = language_name(language) or "this language"
    native, native_suppressed = find_indicators(transcript)
    from_translation = [mark_translated(i, transcript, language) for i in (translated.indicators if translated else [])]
    indicators = sorted(from_translation + native, key=lambda i: (i.start_seconds is None, i.start_seconds or 0, i.char_start))

    limitations = [TRANSLATION_NOTE]
    if translation_problem:
        limitations.append(translation_problem)
    if native:
        limitations.append(
            f"{len(native)} finding(s) came from Hindi keyword rules on the original transcript. These rules were "
            "written by the developers and checked only on small synthetic examples."
        )
    if native_suppressed:
        limitations.append(
            f"{native_suppressed} keyword match(es) in the original transcript were set aside as advice (for example, "
            "'अपना OTP किसी को मत बताइए', never tell anyone your OTP)."
        )
    if translated:
        limitations += [note for note in translated.limitations if note not in limitations]

    base = translated or IntentAssessment(risk="inconclusive", summary="")
    lead = f"Checked through an English machine translation of the {name} speech, which VoxShield has not validated."
    direct = [i for i in indicators if i.context == "direct"]
    if direct:
        risk, summary, categories = summarize_direct(direct)
        if translated and RISK_RANK[translated.risk] > RISK_RANK[risk]:
            risk, summary = translated.risk, translated.summary
        summary = f"{lead} {summary}"
    elif indicators:
        risk, categories = "weak_signals", []
        summary = f"{lead} The scam-like requests found appear to be quoted or recounted rather than made to you."
    elif translated and translated.risk in ("none_detected", "inconclusive"):
        risk, categories = translated.risk, []
        summary = f"{lead} {translated.summary.replace('in the transcript', 'in the translation')}"
    else:
        risk, categories = "inconclusive", []
        reason = translation_problem or "No English translation could be made"
        summary = (
            f"{reason.rstrip('.')}, and the Hindi keyword rules found nothing. Keyword rules alone are too narrow "
            "to call this recording quiet, so no result is given."
        )

    return base.model_copy(update={
        "risk": risk,
        "summary": summary,
        "indicators": indicators,
        "categories": categories,
        "suppressed_mentions": base.suppressed_mentions + native_suppressed,
        "reported_mentions": sum(1 for i in indicators if i.context == "reported"),
        "analyzed_text": "translation",
        "limitations": limitations,
        "error": None,
    })
