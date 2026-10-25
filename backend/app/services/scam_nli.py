"""Scam-intent detection with a zero-shot natural-language-inference (NLI) model.

How it works, and what it does not claim:
  * The transcript is split into sentences. Each sentence, with the sentence before it as context, is the NLI
    *premise*. A fixed set of plain-language *hypotheses* ("The speaker is asking the listener to ...") is tested
    against every premise. The model's output is the probability its NLI head assigns to "entailment".
  * That number is an entailment score for one sentence and one hypothesis. It is not a calibrated probability
    that anyone is a scammer, and the thresholds below are heuristics tuned on a small development set.
  * Evidence is the real sentence (exact text and offsets from the transcript) with the timestamp of the transcript
    segment it starts in. The model cannot point at a phrase inside a sentence, so no phrase is invented.
  * One extra hypothesis detects "the speaker is recounting or warning about this". Such findings are kept but
    marked as reported speech and do not raise the risk level, mirroring the rule engine.
"""

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.config import Settings
from app.schemas_analysis import IntentAssessment, IntentIndicator, ModelInfo, TranscriptResult
from app.services.interfaces import ComponentFailure
from app.services.scam_intent import summarize_direct, segment_at
from app.services.scam_rules import split_sentences

logger = logging.getLogger("voxshield.scam_nli")

MIN_WORDS_PER_SENTENCE = 3
MIN_WORDS_FOR_NEGATIVE = 12
MAX_CONTEXT_WORDS = 80


@dataclass(frozen=True)
class Hypothesis:
    key: str
    category: str
    severity: str
    texts: tuple[str, ...]  # alternative statements of the same behavior; the highest score counts
    explanation: str
    action: str


HYPOTHESES: tuple[Hypothesis, ...] = (
    Hypothesis(
        "credential_request", "credential_request", "high",
        (
            "The text asks the listener to share a verification code, password, or bank details.",
            "The speaker asks the listener to read out a code that was sent to them.",
        ),
        "The model judged that this sentence asks for a code, PIN, password, or card detail. Legitimate organizations do not ask you to read these out.",
        "Do not share it. Hang up and contact the organization using a number you find yourself.",
    ),
    Hypothesis(
        "payment_request", "payment_pressure", "medium",
        (
            "The speaker is asking the listener to send money.",
            "The speaker demands a payment from the listener.",
        ),
        "The model judged that this sentence asks you to send or transfer money.",
        "Do not send money. Verify the request with the person or organization through an independent contact.",
    ),
    Hypothesis(
        "org_claim", "impersonation", "low",
        (
            "The speaker pretends to be an authority or an official.",
        ),
        "The model judged that the speaker claims to represent an organization. VoxShield cannot verify this from audio, and real organizations also call customers.",
        "Do not rely on the caller's claim. Contact the organization using an official number you find yourself.",
    ),
    Hypothesis(
        "family_emergency", "impersonation", "medium",
        (
            "The speaker says they are the listener's child, grandchild, nephew, or niece and are in trouble.",
        ),
        "The model judged that the speaker claims to be a relative in an emergency, a pattern used in voice-cloning scams.",
        "Hang up and call the relative on the number you already have, or ask a question only they could answer.",
    ),
    Hypothesis(
        "threat", "coercion_threat", "medium",
        (
            "The speaker says the listener will be arrested, sued, or lose an account or service unless they comply.",
            "The speaker threatens the listener.",
        ),
        "The model judged that this sentence threatens arrest, legal trouble, or loss of an account. Real agencies do not demand payment or secrets this way.",
        "Do not act under pressure. Hang up and contact the agency through its official website or number.",
    ),
    Hypothesis(
        "urgency", "urgency", "low",
        (
            "The speaker is telling the listener to do something immediately.",
            "The speaker is pressuring the listener to act right now.",
        ),
        "The model judged that this sentence pressures you to act right away. Time pressure is used to stop people from thinking or checking.",
        "Slow down. Legitimate requests can wait while you verify them.",
    ),
    Hypothesis(
        "secrecy", "secrecy_isolation", "medium",
        (
            "The speaker is telling the listener to hide this conversation from family, friends, or other people.",
            "The speaker asks the listener to keep this call a secret.",
        ),
        "The model judged that the speaker asks you to keep this secret. Isolation is a hallmark of scams.",
        "Talk to someone you trust before doing anything. Genuine requests survive a second opinion.",
    ),
    Hypothesis(
        "verification_bypass", "verification_bypass", "high",
        (
            "The speaker discourages the listener from checking with anyone else.",
            "The speaker is telling the listener not to verify the request or not to contact their bank or the authorities.",
        ),
        "The model judged that the speaker discourages the normal checks that would expose a scam.",
        "Do the opposite: hang up and verify through an independently obtained official number.",
    ),
    Hypothesis(
        "remote_access", "remote_access", "high",
        (
            "The speaker asks the listener to give them remote access to a device.",
            "The speaker wants the listener to install an app or let the speaker control or see their computer or phone.",
        ),
        "The model judged that this sentence asks for remote control of your device, which can expose bank accounts and passwords.",
        "Do not install anything. End the call and run a security check if you already did.",
    ),
)
# Findings are marked as reported speech when the sentence looks like a story, an example, or advice.
REPORTED_TEXTS = (
    "The speaker is talking about scams in general.",
    "The speaker is giving an example or a hypothetical scenario.",
)
SCORE_NOTE = (
    "Each score is the probability an NLI model assigns to 'entailment' for one sentence and one statement about the "
    "speaker. It measures how well the sentence supports that statement. It is not a calibrated probability, and not "
    "a probability that the caller is a scammer."
)
LIMITATIONS = [
    "The model compares each sentence with fixed statements, so it flags whole sentences (or two, when one refers to the other) and cannot point at an exact phrase.",
    "It was trained for general zero-shot classification, not on scam calls, and thresholds were set on a small development set.",
    "It only sees what the transcription captured, and it works best on English.",
    "Finding nothing does not rule out a scam.",
]
NLI_METHOD = (
    "Zero-shot natural-language inference: each sentence (with the previous sentence as context) is tested against "
    "statements about what the speaker is doing. Scores are NLI entailment probabilities, not calibrated scam probabilities."
)


# ---- the model ---------------------------------------------------------------------------------------------------


@dataclass
class LoadedNli:
    tokenizer: Any
    model: Any
    entailment_index: int


def _default_loader(settings: Settings) -> LoadedNli:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    revision = settings.effective_scam_revision
    tokenizer = AutoTokenizer.from_pretrained(settings.scam_model_id, revision=revision)
    model = AutoModelForSequenceClassification.from_pretrained(
        settings.scam_model_id, revision=revision, use_safetensors=True, trust_remote_code=False, dtype=torch.float32
    )
    model.to(settings.scam_model_device).eval()
    labels = {int(i): str(name).lower() for i, name in model.config.id2label.items()}
    matches = [i for i, name in labels.items() if name == "entailment"]
    if len(matches) != 1:
        raise ValueError("Could not find the entailment label")
    return LoadedNli(tokenizer, model, matches[0])


class NliModel:
    """Loads once, serializes inference, and scores (premise, hypothesis) pairs."""

    def __init__(self, settings: Settings, loader: Callable[[Settings], LoadedNli] = _default_loader):
        self._settings = settings
        self._loader = loader
        self._loaded: LoadedNli | None = None
        self.load_seconds: float | None = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._loaded is not None

    def ensure_loaded(self) -> LoadedNli:
        with self._lock:
            if self._loaded is None:
                started = time.perf_counter()
                try:
                    self._loaded = self._loader(self._settings)
                    self.load_seconds = round(time.perf_counter() - started, 2)
                except Exception as error:
                    logger.error("Scam-intent model failed to load: %s", type(error).__name__)
                    raise ComponentFailure("model_load_failed", "The scam-intent model could not be loaded.") from error
            return self._loaded

    def entailment(self, pairs: list[tuple[str, str]]) -> list[float]:
        if not pairs:
            return []
        loaded = self.ensure_loaded()
        s = self._settings
        try:
            import torch

            order = sorted(range(len(pairs)), key=lambda i: len(pairs[i][0]))  # similar lengths batch together
            scores = [0.0] * len(pairs)
            with self._lock, torch.inference_mode():
                for start in range(0, len(order), s.scam_batch_size):
                    batch = order[start : start + s.scam_batch_size]
                    encoded = loaded.tokenizer(
                        [pairs[i][0] for i in batch],
                        [pairs[i][1] for i in batch],
                        return_tensors="pt",
                        padding=True,
                        truncation="only_first",  # never cut the hypothesis
                        max_length=s.scam_max_pair_tokens,
                    )
                    encoded = {k: v.to(s.scam_model_device) for k, v in encoded.items()}
                    probs = torch.softmax(loaded.model(**encoded).logits, dim=-1)[:, loaded.entailment_index]
                    for i, value in zip(batch, probs.tolist(), strict=True):
                        scores[i] = round(float(value), 4)
            return scores
        except Exception as error:
            logger.error("Scam-intent inference failed: %s", type(error).__name__)
            raise ComponentFailure("inference_failed", "The scam-intent model failed while analyzing.") from error


# ---- scoring, then deciding --------------------------------------------------------------------------------------


@dataclass
class SentenceScores:
    start: int
    end: int
    text: str
    alone: dict[str, float]  # "hypothesis key:statement number" -> entailment score for this sentence by itself
    reported_alone: float  # highest of the recounting/example statements for this sentence by itself
    context_start: int | None = None  # start of the previous sentence when a with-context premise was scored
    with_context: dict[str, float] | None = None  # the same scores for "previous sentence + this sentence"
    reported_context: float | None = None


@dataclass
class ScoredTranscript:
    sentences: list[SentenceScores]
    skipped_sentences: int = 0  # sentences not analyzed because of the pair budget


@dataclass(frozen=True)
class Thresholds:
    finding: float
    uncertain: float
    reported: float

    @classmethod
    def from_settings(cls, s: Settings) -> "Thresholds":
        return cls(s.scam_nli_threshold, s.scam_nli_uncertain_threshold, s.scam_nli_reported_threshold)


def build_windows(text: str) -> list[tuple[int, int, int | None, str | None]]:
    """(start, end, context_start, context_premise) per sentence long enough to score.

    The context premise is the previous sentence plus this one. It is only used to resolve references such as "it"
    or "that code"; a finding is attributed to the sentence itself whenever the sentence supports it alone.
    """
    spans = split_sentences(text)
    windows: list[tuple[int, int, int | None, str | None]] = []
    for index, (start, end) in enumerate(spans):
        sentence = text[start:end]
        if len(sentence.split()) < MIN_WORDS_PER_SENTENCE:
            continue
        context_start, premise = None, None
        if index > 0:
            prev_start, prev_end = spans[index - 1]
            previous = text[prev_start:prev_end]
            if len(previous.split()) + len(sentence.split()) <= MAX_CONTEXT_WORDS:
                context_start, premise = prev_start, f"{previous} {sentence}"
        windows.append((start, end, context_start, premise))
    return windows


class NliScamIntentAnalyzer:
    detector_name = "nli"

    def __init__(self, settings: Settings, model: NliModel, thresholds: Thresholds | None = None):
        self._settings = settings
        self._model = model
        self.thresholds = thresholds or Thresholds.from_settings(settings)

    @property
    def loaded(self) -> bool:
        return self._model.loaded

    @property
    def load_seconds(self) -> float | None:
        return self._model.load_seconds

    def ensure_loaded(self) -> Any:
        return self._model.ensure_loaded()

    def method(self) -> ModelInfo:
        s = self._settings
        return ModelInfo(name=s.scam_model_id, revision=s.effective_scam_revision, method=NLI_METHOD)

    # step 1: the only expensive step
    def score(self, text: str) -> ScoredTranscript:
        windows = build_windows(text)
        statements = [(h.key, i, t) for h in HYPOTHESES for i, t in enumerate(h.texts)]
        texts = [t for _, _, t in statements] + list(REPORTED_TEXTS)
        per_premise = len(texts)
        budget = max(1, self._settings.scam_max_pairs // (2 * per_premise))
        skipped = max(0, len(windows) - budget)
        windows = windows[:budget]

        premises: list[str] = []  # every premise to score, in a fixed order
        for start, end, _, context_premise in windows:
            premises.append(text[start:end])
            if context_premise is not None:
                premises.append(context_premise)
        scores = self._model.entailment([(premise, statement) for premise in premises for statement in texts])

        def row(index: int) -> tuple[dict[str, float], float]:
            values = scores[index * per_premise : (index + 1) * per_premise]
            by_statement = {f"{key}:{i}": values[k] for k, (key, i, _) in enumerate(statements)}
            return by_statement, max(values[len(statements) :])

        sentences, cursor = [], 0
        for start, end, context_start, context_premise in windows:
            alone, reported_alone = row(cursor)
            cursor += 1
            with_context = reported_context = None
            if context_premise is not None:
                with_context, reported_context = row(cursor)
                cursor += 1
            sentences.append(SentenceScores(start, end, text[start:end], alone, reported_alone, context_start, with_context, reported_context))
        return ScoredTranscript(sentences, skipped)

    # step 2: cheap, deterministic, and re-runnable with other thresholds
    def decide(self, transcript: TranscriptResult, scored: ScoredTranscript, thresholds: Thresholds | None = None) -> IntentAssessment:
        t = thresholds or self.thresholds
        found: list[IntentIndicator] = []
        uncertain = 0
        previous: SentenceScores | None = None
        for sentence in scored.sentences:
            unsure = False
            for h in HYPOTHESES:
                alone_best = max(range(len(h.texts)), key=lambda i: sentence.alone[f"{h.key}:{i}"])
                alone = sentence.alone[f"{h.key}:{alone_best}"]
                span = None  # (start, end, score, statement index, reported score)
                if alone >= t.finding:
                    span = (sentence.start, sentence.end, alone, alone_best, sentence.reported_alone)
                elif sentence.with_context is not None and sentence.context_start is not None:
                    ctx_best = max(range(len(h.texts)), key=lambda i: sentence.with_context[f"{h.key}:{i}"])
                    ctx = sentence.with_context[f"{h.key}:{ctx_best}"]
                    prev_alone = max(previous.alone[f"{h.key}:{i}"] for i in range(len(h.texts))) if previous else 0.0
                    # Only the two sentences together support it, and the previous one does not already carry it.
                    if ctx >= t.finding and prev_alone < t.finding:
                        span = (sentence.context_start, sentence.end, ctx, ctx_best, sentence.reported_context or 0.0)
                if span is None:
                    top = max(alone, max((sentence.with_context or {}).get(f"{h.key}:{i}", 0.0) for i in range(len(h.texts))))
                    unsure = unsure or top >= t.uncertain
                    continue
                start, end, value, best, reported_score = span
                reported = reported_score >= t.reported
                excerpt = transcript.text[start:end]
                segment = segment_at(transcript, start)
                found.append(
                    IntentIndicator(
                        id=f"nli_{h.key}-{start}",
                        rule_id=f"nli_{h.key}",
                        category=h.category,
                        severity="low" if reported else h.severity,  # type: ignore[arg-type]
                        segment_index=segment.index if segment else None,
                        char_start=start,
                        char_end=end,
                        start_seconds=segment.start_seconds if segment else None,
                        end_seconds=segment.end_seconds if segment else None,
                        excerpt=excerpt,
                        sentence=excerpt,
                        context="reported" if reported else "direct",
                        detector="nli",
                        score=round(value, 3),
                        trigger=(
                            f"Model score {value:.2f} for “{h.texts[best]}”"
                            + (" on this sentence and the one before it." if start != sentence.start else " on this sentence.")
                            + (" The model also judged it to be a story, example, or advice, so it does not raise the risk level." if reported else "")
                        ),
                        explanation=h.explanation,
                        suggested_action=h.action,
                    )
                )
            uncertain += unsure
            previous = sentence
        found.sort(key=lambda i: (i.char_start, i.rule_id))
        return self._assessment(transcript, found, uncertain, scored.skipped_sentences)

    def _assessment(self, transcript: TranscriptResult, found: list[IntentIndicator], uncertain: int, skipped: int) -> IntentAssessment:
        limitations = list(LIMITATIONS) + list(transcript.quality_notes)
        if skipped:
            limitations.append(f"The transcript is long, so only the first part was analyzed; {skipped} later sentence(s) were not.")
        direct = [i for i in found if i.context == "direct"]
        reported = len(found) - len(direct)
        common = dict(
            indicators=found,
            reported_mentions=reported,
            uncertain_mentions=uncertain,
            detector="nli",
            score_note=SCORE_NOTE,
            limitations=limitations,
            method=self.method(),
        )
        if direct:
            risk, summary, categories = summarize_direct(direct)
            return IntentAssessment(risk=risk, summary=summary, categories=categories, **common)  # type: ignore[arg-type]
        if found:
            return IntentAssessment(
                risk="weak_signals",
                summary="The transcript describes scam-like requests, but they appear to be quoted or recounted rather than made to you.",
                **common,  # type: ignore[arg-type]
            )
        if uncertain:
            return IntentAssessment(
                risk="inconclusive",
                summary="The model found passages it could not classify with enough confidence, so no result is reported.",
                **common,  # type: ignore[arg-type]
            )
        words = len(transcript.text.split())
        if words < MIN_WORDS_FOR_NEGATIVE:
            return IntentAssessment(risk="inconclusive", summary=f"The transcript is only {words} words long, which is too short to judge.", **common)  # type: ignore[arg-type]
        return IntentAssessment(risk="none_detected", summary="No scam indicators were found in the transcript.", **common)  # type: ignore[arg-type]

    def analyze(self, transcript: TranscriptResult) -> IntentAssessment:
        method = self.method()
        if transcript.status != "ok" or not transcript.text.strip():
            return self._inconclusive("There was no usable transcript, so scam intent could not be assessed.", method)
        if transcript.language and transcript.language != "en" and (transcript.language_probability or 0) >= 0.5:
            return self._inconclusive(f"The speech was detected as '{transcript.language}'. The scam-intent model only supports English.", method)
        return self.decide(transcript, self.score(transcript.text))

    @staticmethod
    def _inconclusive(reason: str, method: ModelInfo) -> IntentAssessment:
        return IntentAssessment(risk="inconclusive", summary=reason, detector="nli", score_note=SCORE_NOTE, limitations=LIMITATIONS, method=method)
