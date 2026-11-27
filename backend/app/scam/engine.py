"""Deterministic risk scoring, independent of speech recognition and transport."""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal, Mapping

from pydantic import BaseModel, Field

from .normalization import normalize
from .signals import Cue, Signal, extract_cues

Language = Literal["auto", "te", "hi", "en", "te-IN", "hi-IN", "en-IN"]
Level = Literal["low", "suspicious", "high_caution", "critical"]
Action = Literal["CONTINUE_LISTENING", "SHOW_CAUTION", "SPOKEN_WARNING", "FAMILY_RESCUE"]


@dataclass(frozen=True)
class Combination:
    categories: frozenset[str]
    points: int
    explanation: str


@dataclass(frozen=True)
class ScoringPolicy:
    weights: Mapping[str, int] = field(default_factory=lambda: {
        "authority_impersonation": 16, "legal_threat": 26, "secrecy_isolation": 18,
        "financial_manipulation": 24, "credential_theft": 22, "urgency": 12,
        "parcel_scam": 18, "coercion": 21,
    })
    combinations: tuple[Combination, ...] = (
        Combination(frozenset({"authority_impersonation", "legal_threat", "financial_manipulation"}),
                    20, "An authority claim reinforces a legal threat and payment demand"),
        Combination(frozenset({"credential_theft", "financial_manipulation"}),
                    12, "A credential request accompanies financial pressure"),
        Combination(frozenset({"authority_impersonation", "secrecy_isolation"}),
                    10, "An authority claim accompanies an instruction to keep the call secret"),
    )
    suspicious_at: int = 30
    high_at: int = 50
    critical_at: int = 70


DEFAULT_POLICY = ScoringPolicy()
SPEAKER_BREAK = re.compile(r"(?im)^\s*(?:[a-z]|caller|speaker\s+\d+|elder|guardian|recipient)\s*:")


class TranscriptQuality(BaseModel):
    status: Literal["empty", "limited", "usable"]
    token_count: int
    duplicates_removed: int


class AnalysisResult(BaseModel):
    risk_score: int = Field(ge=0, le=100)
    risk_level: Level
    detected_signals: list[Signal]
    evidence: list[str]
    explanation: str
    recommended_action: Action
    transcript_quality: TranscriptQuality
    normalized_transcript: str
    evidence_fragment_ids: list[int] = Field(default_factory=list)


class TranscriptFragment(BaseModel):
    id: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=1600)
    finalized_at_ms: int = Field(ge=0)


def linked_groups(cues: list[Cue], can_join: Callable[[int, int, int], bool]) -> list[list[Cue]]:
    groups: list[list[Cue]] = []
    last: Cue | None = None
    for cue in sorted(cues, key=lambda item: (item.clause, item.signal.start, -item.last_clause)):
        if (last is None or cue.clause > last.last_clause + 1
                or not can_join(last.signal.end, cue.signal.start, 12_000)
                or not can_join(groups[-1][0].signal.start, cue.signal.start, 25_000)):
            groups.append([])
            last = None
        groups[-1].append(cue)
        if last is None or (cue.last_clause, cue.signal.end) >= (last.last_clause, last.signal.end):
            last = cue
    return groups


def score_group(group: list[Cue], policy: ScoringPolicy) -> tuple[int, list[Signal], list[str], list[Cue]]:
    consequential = any(cue.signal.category in {"legal_threat", "credential_theft"}
                        or cue.kind in {"safe_account", "payment_demand"} for cue in group)
    transfer_context = consequential or any(
        cue.kind == "authority_origin" or cue.signal.category in {"coercion", "parcel_scam"} for cue in group
    )
    authority_context = any(cue.signal.category in {"legal_threat", "credential_theft"}
                            or cue.kind == "safe_account" for cue in group)
    selected: dict[str, Cue] = {}
    for cue in group:
        if ((cue.kind == "authority_identity" and not authority_context)
                or (cue.kind == "generic_deadline" and not consequential)
                or (cue.kind == "urgent_transfer" and not transfer_context)):
            continue
        previous = selected.get(cue.signal.category)
        if previous is None or cue.kind in {"disconnect_threat", "direct_arrest", "payment_threat"}:
            selected[cue.signal.category] = cue
    categories = selected.keys()
    signals = sorted((cue.signal for cue in selected.values()), key=lambda signal: signal.start)
    weights = {category: policy.weights.get(category, DEFAULT_POLICY.weights[category]) for category in categories}
    points = sum(weights.values())
    explanations = [f"{signal.category.replace('_', ' ')} (+{weights[signal.category]})" for signal in signals]
    for combination in policy.combinations:
        if combination.categories <= categories:
            points += combination.points
            explanations.append(f"{combination.explanation} (+{combination.points})")

    kinds = {cue.kind for cue in selected.values()}
    if {"authority_impersonation", "legal_threat"} <= categories and (
        "financial_manipulation" not in categories and
        kinds & {"direct_arrest", "digital_arrest"}
    ):
        points += 12
        explanations.append("The authority claim accompanies an arrest threat (+12)")
    if {"financial_manipulation", "secrecy_isolation", "coercion"} <= categories and "safe_account" in kinds:
        points += 12
        explanations.append("The safe-account demand is reinforced by isolation and call control (+12)")
    floor = 0
    if kinds & {"credential_request", "safe_account", "account_pressure"}:
        floor = policy.suspicious_at
    if kinds & {"direct_arrest", "disconnect_threat", "payment_threat"}:
        floor = policy.high_at
    if floor > points:
        explanations.append(f"Direct recipient pressure sets a minimum of {floor} for this pattern")
        points = floor
    score = max(0, min(100, points))
    if len(categories) < 2:
        score = min(score, policy.critical_at - 1)
    if score != points:
        explanations.append(f"Score capped at {score}")
    return score, signals, explanations, list(selected.values())


def analyze(transcript: str, policy: ScoringPolicy = DEFAULT_POLICY, *,
            fragments: tuple[TranscriptFragment, ...] = ()) -> AnalysisResult:
    ranges: list[tuple[int, int, TranscriptFragment]] = []
    if fragments:
        transcript = "\n".join(fragment.text for fragment in fragments)
        cursor = 0
        for fragment in fragments:
            ranges.append((cursor, cursor + len(fragment.text), fragment))
            cursor += len(fragment.text) + 1

    def origin(offset: int) -> TranscriptFragment | None:
        return next((fragment for start, end, fragment in ranges if start <= offset <= end), None)

    def can_join(left: int, right: int, max_gap: int = 12_000) -> bool:
        if SPEAKER_BREAK.search(transcript[min(left, right):max(left, right)]):
            return False
        first, second = origin(left), origin(right)
        return first is None or second is None or abs(second.finalized_at_ms - first.finalized_at_ms) <= max_gap

    normalized = normalize(transcript)
    token_count = sum(len(clause) for clause in normalized.clauses)
    quality = TranscriptQuality(
        status="empty" if token_count == 0 else "limited" if token_count < 5 else "usable",
        token_count=token_count, duplicates_removed=normalized.duplicates_removed,
    )
    groups = linked_groups(extract_cues(normalized, can_join), can_join)
    score, signals, explanations, episode = max(
        (score_group(group, policy) for group in groups),
        key=lambda item: (item[0], max((cue.signal.end for cue in item[3]), default=0)),
        default=(0, [], [], []),
    )

    level: Level
    action: Action
    if score >= policy.critical_at:
        level, action = "critical", "FAMILY_RESCUE"
    elif score >= policy.high_at:
        level, action = "high_caution", "SPOKEN_WARNING"
    elif score >= policy.suspicious_at:
        level, action = "suspicious", "SHOW_CAUTION"
    else:
        level, action = "low", "CONTINUE_LISTENING"

    if explanations:
        explanation = "Score contributions include " + ", ".join(explanations) + "."
    elif quality.status != "usable":
        explanation = "There is too little transcript text to make a useful assessment."
    else:
        explanation = "No supported suspicious pattern was detected in this transcript."

    return AnalysisResult(
        risk_score=score, risk_level=level, detected_signals=signals,
        evidence=list(dict.fromkeys(signal.evidence for signal in signals)),
        explanation=explanation, recommended_action=action,
        transcript_quality=quality, normalized_transcript=normalized.text,
        evidence_fragment_ids=[
            fragment.id for start, end, fragment in ranges
            if any(cue.signal.start < end and cue.signal.end > start for cue in episode)
        ],
    )
