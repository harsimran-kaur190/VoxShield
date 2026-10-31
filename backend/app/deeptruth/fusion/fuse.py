"""Combine module results into one verdict.

Each module gives a score (0 authentic .. 1 manipulated) and a reliability (0 ignore .. 1 trust). Rules, in order:
  1. too little total reliability -> "Inconclusive" (no module could really see the file);
  2. ONE STRONG SIGNAL DECIDES: a measured detector scoring >= 0.8 with reliability >= 0.6 -> "Likely manipulated".
     A video is fake if any one part of it is (a cloned voice over real footage, a swapped face over a real voice), and
     every detector here misses many fakes, so a "looks real" reading from another module does not cancel it. The bar
     was set on DeepTruth's own checks: a calibrated image score >= 0.8 occurred on 4% of real images (30% of fakes),
     and a voice score >= 0.8 on 0 of 119 real voices on clean audio (92 of 145 fakes);
  3. trusted modules on opposite sides, none strong -> "Mixed signals" instead of an average that would hide the conflict;
  4. otherwise the reliability-weighted mean, with an "Inconclusive" band from 0.4 to 0.6.
Nothing here invents a score: with no usable module the verdict is Inconclusive and the limitations say why."""

from app.deeptruth.fusion.limitations import MODULE_NAMES, generate
from app.deeptruth.modules.about import describe
from app.deeptruth.schemas import DeepTruthReport, MediaInfo, ModuleResult, Verdict

INCONCLUSIVE_LOW = 0.4
INCONCLUSIVE_HIGH = 0.6
# Below this total weight the modules carry too little information to call the file either way.
MIN_TOTAL_RELIABILITY = 0.2
# Rule 2. Only modules whose accuracy was measured can decide alone; the heuristic checks never reach this reliability.
STRONG_SCORE = 0.8
STRONG_RELIABILITY = 0.6
# Consistency checks can only find anomalies. "No anomaly found" (a low score) is not evidence that the media is real:
# a synthetic voice dubbed onto a real mouth is perfectly in sync. So these never count on the "authentic" side of a
# disagreement, but a high score from them (an anomaly) does count on the "manipulated" side.
ANOMALY_ONLY = {"lipsync", "video_temporal"}
# A module takes part in the disagreement check only if it is at least this reliable...
DISAGREE_MIN_RELIABILITY = 0.3
# ...and two modules disagree when one is at or below LOW and the other at or above HIGH.
DISAGREE_LOW, DISAGREE_HIGH = 0.35, 0.65


def weighted_score(modules: list[ModuleResult]) -> tuple[float, float]:
    """(reliability-weighted mean score, total reliability). Unavailable modules have reliability 0 and drop out."""
    total = sum(m.reliability for m in modules)
    if total == 0:
        return 0.5, 0.0
    return sum(m.score * m.reliability for m in modules) / total, total


def find_disagreement(modules: list[ModuleResult]) -> list[str] | None:
    """Names of modules that point firmly in opposite directions, or None."""
    trusted = [m for m in modules if m.status == "ok" and m.reliability >= DISAGREE_MIN_RELIABILITY]
    low = [m for m in trusted if m.score <= DISAGREE_LOW and m.modality not in ANOMALY_ONLY]
    high = [m for m in trusted if m.score >= DISAGREE_HIGH]
    if low and high:
        return [MODULE_NAMES.get(m.modality, m.modality) for m in [*low, *high]]
    return None


def strongest_signal(modules: list[ModuleResult]) -> ModuleResult | None:
    """The highest-scoring module that is reliable and strong enough to decide alone, or None."""
    strong = [m for m in modules if m.status == "ok" and m.score >= STRONG_SCORE and m.reliability >= STRONG_RELIABILITY and m.modality not in ANOMALY_ONLY]
    return max(strong, key=lambda m: (m.score, m.reliability)) if strong else None


def verdict_for(score: float, total_reliability: float, disagreement: list[str] | None = None, strong: ModuleResult | None = None) -> Verdict:
    if total_reliability < MIN_TOTAL_RELIABILITY:
        return "Inconclusive"
    if strong is not None:
        return "Likely manipulated"
    if disagreement:
        return "Mixed signals"
    if score >= INCONCLUSIVE_HIGH:
        return "Likely manipulated"
    if score <= INCONCLUSIVE_LOW:
        return "No manipulation detected"
    return "Inconclusive"


def explain(verdict: Verdict, score: float, total: float, modules: list[ModuleResult], disagreement: list[str] | None, strong: ModuleResult | None = None) -> str:
    ran = [m for m in modules if m.status == "ok"]
    if not ran:
        return "No module produced a result."
    if total < MIN_TOTAL_RELIABILITY:
        return "The modules that ran rated their own reliability too low to support a verdict."
    if strong is not None:
        name = MODULE_NAMES.get(strong.modality, strong.modality)
        others = [f"{MODULE_NAMES.get(m.modality, m.modality)} {m.score:.2f}" for m in ran if m is not strong and m.score <= DISAGREE_LOW and m.modality not in ANOMALY_ONLY]
        text = f"The {name} module found strong signs of manipulation ({strong.score:.2f}, reliability {strong.reliability:.0%}). One manipulated part is enough to make the file manipulated, so this decides the verdict."
        if others:
            text += f" Other modules saw nothing ({', '.join(others)}), which is common: each detector misses many fakes."
        return text
    if verdict == "Mixed signals":
        parts = [f"{name} {m.score:.2f}" for m in ran if (name := MODULE_NAMES.get(m.modality, m.modality)) in disagreement]
        return f"Trusted modules point in opposite directions ({', '.join(parts)}), so no average is given: check each module's evidence."
    plural = "module" if len(ran) == 1 else "modules"
    band = "above 0.6" if verdict == "Likely manipulated" else "below 0.4" if verdict == "No manipulation detected" else "in the 0.4 to 0.6 band"
    return f"Reliability-weighted score {score:.2f} from {len(ran)} {plural}, {band}."


def fuse(modules: list[ModuleResult], media: MediaInfo, timings: dict[str, float] | None = None) -> DeepTruthReport:
    modules = [describe(m) for m in modules]
    score, total = weighted_score(modules)
    ran = [m for m in modules if m.status == "ok"]
    confidence = sum(m.reliability for m in ran) / len(ran) if ran else 0.0
    disagreement = find_disagreement(modules)
    # The strong-signal rule settles conflicts between modules; with a single module the bands already say the same.
    strong = strongest_signal(modules) if total >= MIN_TOTAL_RELIABILITY and len(ran) > 1 else None
    verdict = verdict_for(score, total, disagreement, strong)
    limitations = generate(media, modules)
    if verdict == "No manipulation detected":
        # A low score means the detectors found nothing, not that the file is genuine: every detector misses many fakes.
        limitations.insert(0, "\"No manipulation detected\" does not prove the media is real: it means these detectors found nothing, and each of them misses many fakes, especially from newer generators.")
    if not ran:
        limitations.insert(0, "No detection module produced a result, so no verdict can be given.")
    status = "complete" if len(ran) == len(modules) else ("partial" if ran else "failed")
    return DeepTruthReport(
        verdict=verdict,
        verdict_reason=explain(verdict, score, total, modules, disagreement, strong),
        disagreement=disagreement,
        decided_by=strong.modality if strong else None,
        manipulation_likelihood=round(strong.score if strong else score, 3),
        weighted_average=round(score, 3),
        confidence=round(confidence, 2),
        modules=modules,
        limitations=limitations,
        media=media,
        status=status,
        timings_seconds=timings or {},
    )
