"""Regex-only PHI detection (pyDeid-derived patterns per label)."""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, model_validator

from clinical_deid.domain import AnnotatedDocument, PHISpan
from clinical_deid.pipes.base import ConfigurablePipe
from clinical_deid.pipes.detector_label_mapping import (
    accumulate_spans,
    apply_detector_label_mapping,
    detector_label_mapping_field,
    effective_detector_labels,
)
from clinical_deid.pipes.ui_schema import field_ui

_EMAIL = r"\b([\w\.]+\w ?@ ?\w+[\.\w+]((\.\w+)?){,3}\.\w{2,3})\b"

_PHONE = (
    r"\(?(\d{3})\s*[\)\.\/\-\, ]*\s*\d\s*\d\s*\d\s*[ \-\.\/]*\s*\d\s*\d\s*\d\s*\d"
    r"|\(?(\d{3})\s*[\)\.\/\-\=\, ]*\s*\d{3}\s*[ \-\.\/\=]*\s*\d{3}\b"
    r"|\(?(\d{3})\s*[\)\.\/\-\=\, ]*\s*\d{3}\s*[ \-\.\/\=]*\s*\d{5}\b"
    r"|\(?\d{3}?\s?[\)\.\/\-\=\, ]*\s?\d{4}\s?[ \-\.\/\=]*\s?\d{3}\b"
    r"|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b"
)

_DATE = (
    r"\b(\d\d?)[\-\/\.](\d\d?)[\-\/\.](\d\d|\d{4})\b"
    r"|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b"
)

_MRN = (
    r"((mrn|medical record|hospital number)( *)(number|num|no|#)?( *)"
    r"[\)\#\:\-\=\s\.]?( *)(\t*)( *)[a-zA-Z]*?((\d+)[\/\-\:]?(\d+)?))[a-zA-Z]*?"
)

_ID = r"\b(?:MRN|ID)[\s:#]*\d+\b|\b\d{6,10}\b"

_POSTAL_CA = r"\b([a-zA-Z]\d[a-zA-Z][ \-]?\d[a-zA-Z]\d)\b"

_OHIP = r"\b\d{4}[- \/]?\d{3}[- \/]?\d{3}[- \/]?([a-zA-Z]?[a-zA-Z]?)\b"

_SIN = r"\b(\d{3}([- \/]?)\d{3}\2\d{3})\b"

_SSN = r"\b\d\d\d([- /]?)\d\d\1\d\d\d\d\b"

BUILTIN_REGEX_PATTERNS: dict[str, str] = {
    "DATE": _DATE,
    "PHONE": _PHONE,
    "EMAIL": _EMAIL,
    "ID": _ID,
    "MRN": _MRN,
    "POSTAL_CODE_CA": _POSTAL_CA,
    "OHIP": _OHIP,
    "SIN": _SIN,
    "SSN": _SSN,
}


class RegexNerLabelConfig(BaseModel):
    """Per-label regex settings."""

    regex_enabled: bool = Field(
        default=True,
        json_schema_extra=field_ui(ui_group="Patterns", ui_order=1, ui_widget="switch"),
    )
    pattern: str | None = Field(
        default=None,
        json_schema_extra=field_ui(
            ui_group="Patterns",
            ui_order=2,
            ui_widget="regex",
            ui_placeholder="(?i)...",
        ),
    )


class RegexNerConfig(BaseModel):
    """Configuration for :class:`RegexNerPipe`."""

    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Per-label pyDeid-style regex patterns. "
                "Chain with ``whitelist`` for dictionary phrase matching."
            )
        }
    )

    source_name: str = Field(
        default="regex_ner",
        json_schema_extra=field_ui(
            ui_group="General",
            ui_order=1,
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    per_label: dict[str, RegexNerLabelConfig] = Field(
        default_factory=dict,
        json_schema_extra=field_ui(
            ui_group="Patterns",
            ui_order=2,
            ui_widget="nested_dict",
            ui_help="Per-label enable flags and custom patterns.",
        ),
    )
    patterns: dict[str, str] = Field(
        default_factory=dict,
        description="Legacy: map label → regex string; folded into ``per_label``.",
        json_schema_extra=field_ui(
            ui_group="Legacy",
            ui_order=3,
            ui_widget="key_value",
            ui_advanced=True,
            ui_help="Prefer per_label for new configs.",
        ),
    )
    include_builtin_regex: bool = Field(
        default=True,
        json_schema_extra=field_ui(
            ui_group="Patterns",
            ui_order=4,
            ui_widget="switch",
            ui_help="Include packaged pyDeid-style built-in patterns (DATE, PHONE, …).",
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

    @model_validator(mode="after")
    def _fold_top_level_patterns(self) -> RegexNerConfig:
        if not self.patterns:
            return self
        pl = dict(self.per_label)
        for label, pat in self.patterns.items():
            prev = pl.get(label, RegexNerLabelConfig())
            pl[label] = RegexNerLabelConfig(
                regex_enabled=prev.regex_enabled,
                pattern=pat,
            )
        object.__setattr__(self, "per_label", pl)
        return self


def builtin_regex_label_names() -> list[str]:
    return sorted(BUILTIN_REGEX_PATTERNS.keys())


class _ResolvedRegex:
    __slots__ = ("label", "compiled")

    def __init__(self, label: str, compiled: re.Pattern[str]) -> None:
        self.label = label
        self.compiled = compiled


def _resolve_regex(config: RegexNerConfig) -> list[_ResolvedRegex]:
    label_keys: set[str] = set()
    if config.include_builtin_regex:
        label_keys |= set(BUILTIN_REGEX_PATTERNS.keys())
    label_keys |= set(config.per_label.keys())
    label_keys |= set(config.patterns.keys())

    out: list[_ResolvedRegex] = []
    for label in sorted(label_keys):
        sub = config.per_label.get(label, RegexNerLabelConfig())
        if not sub.regex_enabled:
            continue
        pat: str | None = None
        if sub.pattern is not None:
            pat = sub.pattern
        elif label in config.patterns:
            pat = config.patterns[label]
        elif config.include_builtin_regex and label in BUILTIN_REGEX_PATTERNS:
            pat = BUILTIN_REGEX_PATTERNS[label]
        if not pat:
            continue
        out.append(_ResolvedRegex(label, re.compile(pat, re.IGNORECASE)))
    return out


class RegexNerPipe(ConfigurablePipe):
    """Detector: regex patterns only."""

    def __init__(self, config: RegexNerConfig | None = None) -> None:
        self._config = config or RegexNerConfig()
        self._resolved = _resolve_regex(self._config)

    @property
    def base_labels(self) -> set[str]:
        return {r.label for r in self._resolved}

    @property
    def label_mapping(self) -> dict[str, str | None]:
        return dict(self._config.label_mapping)

    @property
    def labels(self) -> set[str]:
        return effective_detector_labels(self.base_labels, self._config.label_mapping)

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        text = doc.document.text
        found: list[PHISpan] = []
        seen: set[tuple[int, int, str]] = set()
        for r in self._resolved:
            for m in r.compiled.finditer(text):
                key = (m.start(), m.end(), r.label)
                if key not in seen:
                    seen.add(key)
                    found.append(
                        PHISpan(
                            start=m.start(),
                            end=m.end(),
                            label=r.label,
                            confidence=None,
                            source=self._config.source_name,
                        )
                    )
        found.sort(key=lambda s: (s.start, s.end, s.label))
        found = apply_detector_label_mapping(found, self._config.label_mapping)
        return accumulate_spans(doc, found, skip_overlapping=self._config.skip_overlapping)
