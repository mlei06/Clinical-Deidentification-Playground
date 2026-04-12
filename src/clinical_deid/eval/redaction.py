"""Redaction quality evaluation — measures whether PHI was successfully removed from output text.

Complements span-based detection metrics by answering:
"Does any gold-standard PHI still appear verbatim in the redacted output?"
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class LeakedSpan:
    """A gold PHI string that still appears in the redacted text."""

    label: str
    original_text: str
    found_at: list[int]  # character offsets where it was found in redacted text


@dataclass(frozen=True)
class LabelLeakage:
    """Per-label leakage summary."""

    label: str
    gold_count: int
    leaked_count: int
    leakage_rate: float  # leaked_count / gold_count


@dataclass
class RedactionMetrics:
    """Aggregate redaction quality metrics for a document or corpus."""

    gold_phi_count: int
    leaked_phi_count: int
    leakage_rate: float  # leaked / gold (0.0 = perfect, 1.0 = nothing redacted)
    redaction_recall: float  # 1 - leakage_rate
    per_label: list[LabelLeakage] = field(default_factory=list)
    leaked_spans: list[LeakedSpan] = field(default_factory=list)
    over_redaction_chars: int = 0  # chars changed that were NOT PHI
    original_length: int = 0
    redacted_length: int = 0


def _find_all(haystack: str, needle: str) -> list[int]:
    """Find all occurrences of needle in haystack (case-sensitive)."""
    positions: list[int] = []
    start = 0
    while True:
        idx = haystack.find(needle, start)
        if idx == -1:
            break
        positions.append(idx)
        start = idx + 1
    return positions


def compute_redaction_metrics(
    original_text: str,
    redacted_text: str,
    gold_spans: list[dict],
) -> RedactionMetrics:
    """Evaluate redaction quality by checking if gold PHI strings leak into the redacted text.

    Parameters
    ----------
    original_text
        The original document text before any redaction.
    redacted_text
        The pipeline output text (after redaction/surrogate replacement).
    gold_spans
        Gold-standard PHI spans as dicts with ``start``, ``end``, ``label`` keys.
        These reference positions in *original_text*.
    """
    if not gold_spans:
        return RedactionMetrics(
            gold_phi_count=0,
            leaked_phi_count=0,
            leakage_rate=0.0,
            redaction_recall=1.0,
            original_length=len(original_text),
            redacted_length=len(redacted_text),
        )

    # Extract the actual PHI text strings from the original
    # Deduplicate by (text, label) since the same string may appear multiple times
    phi_entries: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for span in gold_spans:
        start, end, label = span["start"], span["end"], span["label"]
        phi_text = original_text[start:end]
        if not phi_text.strip():
            continue
        key = (phi_text, label)
        if key not in seen:
            seen.add(key)
            phi_entries.append(key)

    total_gold = len(phi_entries)
    leaked: list[LeakedSpan] = []

    # Check each unique PHI string against the redacted text
    redacted_lower = redacted_text.lower()
    for phi_text, label in phi_entries:
        # Case-insensitive search — even partial case preservation is a leak
        positions = _find_all(redacted_lower, phi_text.lower())
        if positions:
            leaked.append(LeakedSpan(
                label=label,
                original_text=phi_text,
                found_at=positions,
            ))

    leaked_count = len(leaked)
    leakage_rate = leaked_count / total_gold if total_gold > 0 else 0.0

    # Per-label breakdown
    from collections import Counter

    gold_by_label: Counter[str] = Counter()
    leaked_by_label: Counter[str] = Counter()
    for phi_text, label in phi_entries:
        gold_by_label[label] += 1
    for ls in leaked:
        leaked_by_label[ls.label] += 1

    per_label = []
    for label in sorted(gold_by_label):
        gc = gold_by_label[label]
        lc = leaked_by_label.get(label, 0)
        per_label.append(LabelLeakage(
            label=label,
            gold_count=gc,
            leaked_count=lc,
            leakage_rate=lc / gc if gc > 0 else 0.0,
        ))

    # Over-redaction estimate: characters in original that are NOT PHI but were changed.
    # Build a mask of PHI character positions in the original.
    phi_chars = set()
    for span in gold_spans:
        for i in range(span["start"], min(span["end"], len(original_text))):
            phi_chars.add(i)

    # Count non-PHI characters in original text
    non_phi_char_count = len(original_text) - len(phi_chars)

    # A rough over-redaction metric: if redacted text is shorter than
    # (original - phi_chars), extra chars were removed beyond PHI.
    # If it's longer (surrogates can be longer), we look at non-PHI preservation.
    # Simple heuristic: count how many non-PHI chars from original appear in redacted text
    # by checking character-level alignment. For a proper measure we'd need diff,
    # but a useful proxy is: len(redacted) vs expected length after PHI removal.
    expected_non_phi_length = non_phi_char_count
    # For tag replacement: each span becomes [LABEL], for surrogate: variable length
    # We can't perfectly compute over-redaction without alignment, so we report the raw numbers.
    over_redaction = max(0, expected_non_phi_length - len(redacted_text))

    return RedactionMetrics(
        gold_phi_count=total_gold,
        leaked_phi_count=leaked_count,
        leakage_rate=round(leakage_rate, 6),
        redaction_recall=round(1.0 - leakage_rate, 6),
        per_label=per_label,
        leaked_spans=leaked,
        over_redaction_chars=over_redaction,
        original_length=len(original_text),
        redacted_length=len(redacted_text),
    )
