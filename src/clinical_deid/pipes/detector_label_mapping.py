"""Shared label mapping and span accumulation for detector pipes."""

from __future__ import annotations

from typing import Any

from pydantic import Field

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.pipes.ui_schema import field_ui

DETECTOR_LABEL_MAPPING_DESCRIPTION = (
    "Map each base detector label to a new label, or null to drop all spans with that base label. "
    "Labels not listed are left unchanged."
)


def detector_label_mapping_field(**ui: Any) -> Any:
    """Reusable ``label_mapping`` field with optional extra ``ui_*`` overrides."""
    return Field(
        default_factory=dict,
        description=DETECTOR_LABEL_MAPPING_DESCRIPTION,
        json_schema_extra=field_ui(
            ui_group="Output labels",
            ui_widget="label_space",
            ui_allow_custom_labels=False,
            **ui,
        ),
    )


DETECTOR_LABEL_MAPPING = detector_label_mapping_field()


def apply_detector_label_mapping(
    spans: list[PHISpan],
    mapping: dict[str, str | None],
) -> list[PHISpan]:
    """Apply *mapping* to span labels; null values remove the span."""
    if not mapping:
        return spans
    out: list[PHISpan] = []
    for s in spans:
        if s.label in mapping:
            new_label = mapping[s.label]
            if new_label is None:
                continue
            out.append(s.model_copy(update={"label": new_label}))
        else:
            out.append(s)
    return out


def accumulate_spans(
    doc: AnnotatedDocument,
    new_spans: list[PHISpan],
    skip_overlapping: bool = False,
) -> AnnotatedDocument:
    """Return *doc* with existing spans plus *new_spans* accumulated.

    If *skip_overlapping* is True, new spans that overlap any existing
    span in ``doc.spans`` are silently dropped.
    """
    existing = list(doc.spans)
    if skip_overlapping and existing:
        from clinical_deid.pipes.span_merge import has_overlap_with_kept

        sorted_existing = sorted(existing, key=lambda s: s.start)
        kept_new = [
            s for s in new_spans if not has_overlap_with_kept(s, sorted_existing)
        ]
    else:
        kept_new = new_spans
    combined = existing + kept_new
    combined.sort(key=lambda s: (s.start, s.end, s.label))
    return doc.with_spans(combined)


def effective_detector_labels(
    base_labels: set[str],
    mapping: dict[str, str | None],
) -> set[str]:
    """Labels that can appear after applying *mapping* to spans whose base labels are in *base_labels*."""
    if not mapping:
        return set(base_labels)
    out: set[str] = set()
    for lab in base_labels:
        if lab in mapping:
            v = mapping[lab]
            if v is not None:
                out.add(v)
        else:
            out.add(lab)
    return out
