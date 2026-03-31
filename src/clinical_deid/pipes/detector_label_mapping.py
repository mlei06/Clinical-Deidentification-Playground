"""Shared label mapping for detector pipes."""

from __future__ import annotations

from typing import Any

from pydantic import Field

from clinical_deid.domain import PHISpan
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
            ui_widget="label_mapping",
            ui_advanced=True,
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
