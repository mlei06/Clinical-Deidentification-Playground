"""SpanResolver — overlap and conflict resolution pipe.

Resolves overlapping, nested, and boundary-disagreement spans using configurable
strategies: longest span wins, highest confidence wins, or label-priority ordering.
Optionally merges adjacent same-label spans.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.pipes.base import ConfigurablePipe


class SpanResolverConfig(BaseModel):
    """Configuration for :class:`SpanResolverPipe`."""

    strategy: Literal["longest", "highest_confidence", "priority"] = Field(
        default="longest",
        description="How to pick a winner when spans overlap.",
    )
    label_priority: list[str] = Field(
        default_factory=list,
        description="For 'priority' strategy: ordered list of labels, first wins.",
    )
    merge_adjacent: bool = Field(
        default=True,
        description="Merge touching same-label spans into one.",
    )
    boundary_slack: int = Field(
        default=0,
        ge=0,
        description="Characters of tolerance for grouping overlapping spans.",
    )


def _overlaps(a: PHISpan, b: PHISpan, slack: int = 0) -> bool:
    return a.start < (b.end + slack) and b.start < (a.end + slack)


def _cluster_overlapping(spans: list[PHISpan], slack: int) -> list[list[PHISpan]]:
    """Group spans into clusters where members overlap (with slack tolerance)."""
    if not spans:
        return []
    sorted_spans = sorted(spans, key=lambda s: (s.start, -s.end))
    clusters: list[list[PHISpan]] = [[sorted_spans[0]]]
    cluster_end = sorted_spans[0].end

    for s in sorted_spans[1:]:
        if s.start < (cluster_end + slack):
            clusters[-1].append(s)
            cluster_end = max(cluster_end, s.end)
        else:
            clusters.append([s])
            cluster_end = s.end

    return clusters


def _pick_winner(
    cluster: list[PHISpan],
    strategy: str,
    label_priority: list[str],
) -> PHISpan:
    """Pick the winning span from an overlapping cluster."""
    if strategy == "longest":
        return max(cluster, key=lambda s: (s.end - s.start, -(s.start)))
    elif strategy == "highest_confidence":
        return max(
            cluster,
            key=lambda s: (s.confidence if s.confidence is not None else 0.0, s.end - s.start),
        )
    elif strategy == "priority":
        priority_map = {label: i for i, label in enumerate(label_priority)}
        default_priority = len(label_priority)
        return min(
            cluster,
            key=lambda s: (priority_map.get(s.label, default_priority), -(s.end - s.start)),
        )
    else:
        return cluster[0]


def _merge_adjacent_spans(spans: list[PHISpan]) -> list[PHISpan]:
    """Merge touching same-label spans into one."""
    if not spans:
        return []
    sorted_spans = sorted(spans, key=lambda s: (s.start, s.end))
    merged: list[PHISpan] = [sorted_spans[0]]

    for s in sorted_spans[1:]:
        prev = merged[-1]
        if s.label == prev.label and s.start <= prev.end:
            # Merge: extend the previous span
            prev_conf = prev.confidence if prev.confidence is not None else 0.0
            s_conf = s.confidence if s.confidence is not None else 0.0
            best_conf: float | None = max(prev_conf, s_conf)
            if prev.confidence is None and s.confidence is None:
                best_conf = None
            merged[-1] = PHISpan(
                start=prev.start,
                end=max(prev.end, s.end),
                label=prev.label,
                confidence=best_conf,
                source=prev.source,
            )
        else:
            merged.append(s)

    return merged


class SpanResolverPipe(ConfigurablePipe):
    """SpanTransformer that resolves overlapping spans into non-overlapping output."""

    def __init__(self, config: SpanResolverConfig | None = None) -> None:
        self._config = config or SpanResolverConfig()

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        if not doc.spans:
            return doc

        clusters = _cluster_overlapping(list(doc.spans), self._config.boundary_slack)
        resolved: list[PHISpan] = []
        for cluster in clusters:
            if len(cluster) == 1:
                resolved.append(cluster[0])
            else:
                winner = _pick_winner(
                    cluster,
                    self._config.strategy,
                    self._config.label_priority,
                )
                resolved.append(winner)

        if self._config.merge_adjacent:
            resolved = _merge_adjacent_spans(resolved)

        return doc.with_spans(sorted(resolved, key=lambda s: (s.start, s.end)))
