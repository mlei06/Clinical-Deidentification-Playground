"""Shared span merge / resolution for :class:`ParallelDetectors` and :class:`ResolveSpans`.

``ParallelDetectors`` passes one span list per detector.  :class:`ResolveSpans` passes
``[doc.spans]`` — a single group — so the same strategies apply to overlaps from one detector
or many.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from clinical_deid.domain import PHISpan

# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


def overlaps(a: PHISpan, b: PHISpan) -> bool:
    return a.start < b.end and b.start < a.end


def _has_overlap_with_kept(span: PHISpan, kept: list[PHISpan]) -> bool:
    """Check if *span* overlaps any span in *kept* (sorted by start).

    Uses the sorted order of *kept* to skip spans that end before ``span.start``
    and stop early once spans start at or after ``span.end``.  This brings amortised
    cost from O(n) per call to O(k) where k is the number of overlapping neighbours.
    """
    for k in kept:
        if k.end <= span.start:
            continue
        if k.start >= span.end:
            break
        return True
    return False


# ---------------------------------------------------------------------------
# Strategies (multi-group)
# ---------------------------------------------------------------------------


def merge_union(span_groups: list[list[PHISpan]]) -> list[PHISpan]:
    """Concatenate all spans from every group and sort."""
    out: list[PHISpan] = []
    for group in span_groups:
        out.extend(group)
    out.sort(key=lambda s: (s.start, s.end, s.label))
    return out


def merge_exact_dedupe(span_groups: list[list[PHISpan]]) -> list[PHISpan]:
    """Drop exact duplicate (start, end, label) spans."""
    seen: set[tuple[int, int, str]] = set()
    out: list[PHISpan] = []
    for group in span_groups:
        for s in group:
            key = (s.start, s.end, s.label)
            if key not in seen:
                seen.add(key)
                out.append(s)
    out.sort(key=lambda s: (s.start, s.end, s.label))
    return out


def merge_consensus(span_groups: list[list[PHISpan]], threshold: int) -> list[PHISpan]:
    """Keep spans where >= *threshold* groups have an overlapping same-label span."""
    tagged: list[tuple[PHISpan, int]] = []
    for gidx, group in enumerate(span_groups):
        for span in group:
            tagged.append((span, gidx))

    kept: list[PHISpan] = []
    for span, gidx in tagged:
        votes = 0
        for other_idx, other_group in enumerate(span_groups):
            if other_idx == gidx:
                votes += 1
                continue
            for other in other_group:
                if other.label == span.label and overlaps(span, other):
                    votes += 1
                    break
        if votes >= threshold:
            kept.append(span)

    kept.sort(key=lambda s: (s.start, -(s.end - s.start)))
    deduped: list[PHISpan] = []
    for span in kept:
        if not any(overlaps(span, d) and span.label == d.label for d in deduped):
            deduped.append(span)
    deduped.sort(key=lambda s: (s.start, s.end, s.label))
    return deduped


def merge_max_confidence(span_groups: list[list[PHISpan]]) -> list[PHISpan]:
    """Greedily keep highest-confidence spans; skip any overlap with an already kept span."""
    all_spans = [s for group in span_groups for s in group]
    all_spans.sort(key=lambda s: (s.confidence or 0.0), reverse=True)

    kept: list[PHISpan] = []
    for span in all_spans:
        if not _has_overlap_with_kept(span, kept):
            # Insert into sorted position (by start) to maintain order for sweep.
            _insort_by_start(kept, span)

    kept.sort(key=lambda s: (s.start, s.end, s.label))
    return kept


def merge_longest_non_overlapping(span_groups: list[list[PHISpan]]) -> list[PHISpan]:
    """Greedily keep longest spans first; skip any overlap with an already kept span (any label)."""
    all_spans = [s for group in span_groups for s in group]
    all_spans.sort(key=lambda s: (s.end - s.start), reverse=True)

    kept: list[PHISpan] = []
    for span in all_spans:
        if not _has_overlap_with_kept(span, kept):
            _insort_by_start(kept, span)

    kept.sort(key=lambda s: (s.start, s.end, s.label))
    return kept


def _insort_by_start(lst: list[PHISpan], span: PHISpan) -> None:
    """Insert *span* into *lst* keeping it sorted by ``start``."""
    lo, hi = 0, len(lst)
    while lo < hi:
        mid = (lo + hi) // 2
        if lst[mid].start < span.start:
            lo = mid + 1
        else:
            hi = mid
    lst.insert(lo, span)


MergeFunc = Callable[[list[list[PHISpan]]], list[PHISpan]]
MergeStrategy = (
    Literal[
        "union",
        "exact_dedupe",
        "consensus",
        "max_confidence",
        "longest_non_overlapping",
    ]
    | MergeFunc
)


def resolve_merge_strategy(
    strategy: MergeStrategy,
    consensus_threshold: int,
) -> MergeFunc:
    if callable(strategy) and not isinstance(strategy, str):
        return strategy
    if strategy == "union":
        return merge_union
    if strategy == "exact_dedupe":
        return merge_exact_dedupe
    if strategy == "consensus":
        return lambda groups: merge_consensus(groups, consensus_threshold)
    if strategy == "max_confidence":
        return merge_max_confidence
    if strategy == "longest_non_overlapping":
        return merge_longest_non_overlapping
    raise ValueError(f"Unknown span resolve strategy: {strategy!r}")


def apply_resolve_spans(
    span_groups: list[list[PHISpan]],
    strategy: MergeStrategy = "union",
    consensus_threshold: int = 2,
) -> list[PHISpan]:
    """Run the chosen merge over one or more span lists."""
    merge = resolve_merge_strategy(strategy, consensus_threshold)
    return merge(span_groups)
