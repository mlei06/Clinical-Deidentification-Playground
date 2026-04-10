"""Detector pipe that wraps the pyDeid library for clinical PHI detection.

Uses pyDeid's find→prune pipeline (names, dates, SIN, OHIP, MRN, locations,
hospitals, contact) and converts results into :class:`PHISpan` objects that
integrate with the rest of the clinical-deid pipe system.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.pipes.base import ConfigurablePipe
from clinical_deid.pipes.detector_label_mapping import (
    accumulate_spans,
    apply_detector_label_mapping,
    detector_label_mapping_field,
    effective_detector_labels,
)
from clinical_deid.pipes.ui_schema import field_ui

# Default PHI types that pyDeid supports
_DEFAULT_PHI_TYPES: list[str] = [
    "names",
    "dates",
    "sin",
    "ohip",
    "mrn",
    "locations",
    "hospitals",
    "contact",
]

# Keyword → normalised label.  pyDeid type strings are verbose and varied
# (e.g. "Female First Name (ambig)", "Month/Day/Year [mm/dd/yy(yy)]",
# "Telephone/Fax", "Street Address", "Postalcode", "Email Address").
# We match by checking whether any keyword appears *in* the lowered type
# string.  Order matters — first match wins.
_DEFAULT_KEYWORD_RULES: list[tuple[str, str]] = [
    ("first name", "NAME"),
    ("last name", "NAME"),
    ("name", "NAME"),
    ("day/year", "DATE"),
    ("month/year", "DATE"),
    ("year/month", "DATE"),
    ("day/month", "DATE"),
    ("date", "DATE"),
    ("ohip", "OHIP"),
    ("sin", "SIN"),
    ("mrn", "MRN"),
    ("hospital", "HOSPITAL"),
    ("email", "EMAIL"),
    ("telephone", "PHONE"),
    ("fax", "PHONE"),
    ("phone", "PHONE"),
    ("street address", "ADDRESS"),
    ("address", "ADDRESS"),
    ("postalcode", "ADDRESS"),
    ("postal code", "ADDRESS"),
    ("zipcode", "ADDRESS"),
    ("location", "LOCATION"),
    ("ssn", "SSN"),
]


def default_base_labels() -> list[str]:
    """Default label space for the pydeid_ner detector."""
    return sorted({label for _, label in _DEFAULT_KEYWORD_RULES})


class PyDeidNerConfig(BaseModel):
    """Configuration for the pyDeid detector pipe."""

    phi_types: list[str] = Field(
        default_factory=lambda: list(_DEFAULT_PHI_TYPES),
        description="Which PHI categories pyDeid should look for.",
        json_schema_extra=field_ui(
            ui_group="Detection",
            ui_order=1,
            ui_widget="multiselect",
        ),
    )
    named_entity_recognition: bool = Field(
        default=False,
        description="Use spaCy NER for improved name detection.",
        json_schema_extra=field_ui(
            ui_group="Detection",
            ui_order=2,
            ui_widget="switch",
        ),
    )
    label_rules: list[tuple[str, str]] = Field(
        default_factory=lambda: list(_DEFAULT_KEYWORD_RULES),
        description=(
            "Ordered list of (keyword, label) pairs.  A pyDeid type string "
            "is mapped to the label of the first keyword found in it (case-insensitive). "
            "Unmapped types become their uppercase original."
        ),
        json_schema_extra=field_ui(
            ui_group="Mapping",
            ui_order=1,
            ui_widget="json",
            ui_advanced=True,
            ui_help="Advanced: list of [keyword, label] pairs; JSON editor recommended.",
        ),
    )
    two_digit_threshold: int = Field(
        default=30,
        json_schema_extra=field_ui(
            ui_group="Date validation",
            ui_order=1,
            ui_widget="number",
            ui_advanced=True,
        ),
    )
    valid_year_low: int = Field(
        default=1900,
        json_schema_extra=field_ui(
            ui_group="Date validation",
            ui_order=2,
            ui_widget="number",
            ui_advanced=True,
        ),
    )
    valid_year_high: int = Field(
        default=2050,
        json_schema_extra=field_ui(
            ui_group="Date validation",
            ui_order=3,
            ui_widget="number",
            ui_advanced=True,
        ),
    )
    source_name: str = Field(
        default="pydeid",
        json_schema_extra=field_ui(
            ui_group="General",
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    label_mapping: dict[str, str | None] = detector_label_mapping_field()

    skip_overlapping: bool = Field(
        default=False,
        description="Drop new spans that overlap any existing span in the document.",
        json_schema_extra=field_ui(
            ui_group="General",
            ui_order=99,
            ui_widget="switch",
            ui_advanced=True,
        ),
    )


class PyDeidNerPipe(ConfigurablePipe):
    """Detector that delegates PHI finding to the pyDeid library.

    On first ``forward`` call the pyDeid builder constructs the internal
    finder/pruner pipeline.  Subsequent calls reuse the same handler so
    startup cost is paid only once.
    """

    def __init__(self, config: PyDeidNerConfig | None = None) -> None:
        self._config = config or PyDeidNerConfig()
        self._handler: Any | None = None

    # -- lazy init ----------------------------------------------------------

    def _ensure_handler(self) -> Any:
        if self._handler is not None:
            return self._handler

        try:
            from pyDeid.pyDeidBuilder import pyDeidBuilder
        except ImportError as exc:
            raise ImportError(
                "pyDeid is required for PyDeidNerPipe. "
                "Install with:  pip install '.[pydeid]'"
            ) from exc

        builder = (
            pyDeidBuilder()
            .replace_phi(enable_replace=False, return_surrogates=False)
            .set_phi_types(self._config.phi_types)
            .set_valid_years(
                self._config.two_digit_threshold,
                self._config.valid_year_low,
                self._config.valid_year_high,
            )
        )

        if self._config.named_entity_recognition:
            from spacy import load as spacy_load

            nlp = spacy_load("en_core_web_sm")
            builder.set_ner_pipeline(nlp)

        deid = builder.build()
        self._handler = deid.handler
        return self._handler

    # -- Detector protocol --------------------------------------------------

    @property
    def base_labels(self) -> set[str]:
        return {label for _, label in self._config.label_rules}

    @property
    def label_mapping(self) -> dict[str, str | None]:
        return dict(self._config.label_mapping)

    @property
    def labels(self) -> set[str]:
        return effective_detector_labels(self.base_labels, self._config.label_mapping)

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        handler = self._ensure_handler()
        text = doc.document.text
        if not text:
            return doc

        # Run find → prune (no replacement)
        handler.handle_string(text)
        raw_phis: dict[Any, list[str]] = handler.phis  # Dict[PHI, List[str]]

        label_rules = self._config.label_rules
        source = self._config.source_name
        spans: list[PHISpan] = []

        for phi_key, type_list in raw_phis.items():
            start: int = phi_key.start
            end: int = phi_key.end
            if start >= end or start < 0 or end > len(text):
                continue

            # Pick the best normalised label from the type list
            label = _resolve_label(type_list, label_rules)
            spans.append(
                PHISpan(
                    start=start,
                    end=end,
                    label=label,
                    confidence=None,
                    source=source,
                )
            )

        spans.sort(key=lambda s: (s.start, s.end, s.label))
        spans = apply_detector_label_mapping(spans, self._config.label_mapping)
        return accumulate_spans(doc, spans, skip_overlapping=self._config.skip_overlapping)


def _resolve_label(type_list: list[str], rules: list[tuple[str, str]]) -> str:
    """Pick the best normalised label via keyword matching against pyDeid types."""
    for t in type_list:
        lowered = t.lower()
        for keyword, label in rules:
            if keyword in lowered:
                return label
    # Fallback: uppercase the first type
    return type_list[0].upper() if type_list else "PHI"
