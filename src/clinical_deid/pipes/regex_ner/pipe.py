"""Regex-only PHI detection with built-in clinical patterns per label."""

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

# ---------------------------------------------------------------------------
# US state names (for zip-code context matching)
# ---------------------------------------------------------------------------

_US_STATES = (
    "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|"
    "Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|"
    "Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|"
    "Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|"
    "New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|"
    "Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|"
    "Virginia|Washington|West Virginia|Wisconsin|Wyoming|"
    "District of Columbia|Puerto Rico"
)

# ---------------------------------------------------------------------------
# Month / season helpers
# ---------------------------------------------------------------------------

_MONTH = (
    "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    "Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?"
)

_SEASON = r"winter|spring|summer|autumn|fall"

_ORDINAL = r"(?:st|nd|rd|th)"

# ---------------------------------------------------------------------------
# Street-address suffix list
# ---------------------------------------------------------------------------

_STREET_SUFFIX = (
    "Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|"
    "Lane|Ln|Court|Ct|Place|Pl|Circle|Cir|Way|"
    "Highway|Hwy|Parkway|Pkwy|Terrace|Ter|Trail|Trl"
)

# ---------------------------------------------------------------------------
# Clinical measurement disqualifiers — terms that when adjacent to a
# numeric pattern indicate vitals/labs, not dates or phone numbers.
# ---------------------------------------------------------------------------

_CLINICAL_DISQUALIFIERS = (
    r"(?:HR|Heart Rate|BP|SBP|DBP|SVR|ICP|CVP|RR|"
    r"PEEP|CPAP|PSV|FiO2|SpO2|SaO2|PaO2|PaCO2|"
    r"TV|Tidal Volume|VT|CKS|INR|BNP|WBC|RBC|Hgb|Hct|"
    r"cc|mg|mL|mcg|mmHg|cmH2O|L\/min|bpm|"
    r"dose|doses|drop|drops|units|tabs|capsules|"
    r"scale|range|grade|stage|level|score|ratio|index)"
)

# Negative lookbehind: skip matches preceded by clinical term + space
_NOT_AFTER_CLINICAL = rf"(?<!\b{_CLINICAL_DISQUALIFIERS}\s)"

# ---------------------------------------------------------------------------
# Built-in patterns
# ---------------------------------------------------------------------------

_EMAIL = r"\b[\w\.]+\w ?@ ?\w+[\.\w+](?:(?:\.\w+)?){,3}\.\w{2,3}\b"

# Phone: 10-digit variants + 9-digit + 11-digit + extension
_PHONE = (
    # (XXX) XXX-XXXX flexible
    r"\(?(\d{3})\s*[\)\.\/\-\, ]*\s*\d\s*\d\s*\d\s*[ \-\.\/]*\s*\d\s*\d\s*\d\s*\d"
    # XXX-XXX-XXXX strict
    r"|\(?(\d{3})\s*[\)\.\/\-\, ]*\s*\d{3}\s*[ \-\.\/]*\s*\d{4}"
    # XXX-XXX-XXX (9 digit)
    r"|\(?(\d{3})\s*[\)\.\/\-\=\, ]*\s*\d{3}\s*[ \-\.\/\=]*\s*\d{3}\b"
    # XXX-XXX-XXXXX (11 digit)
    r"|\(?(\d{3})\s*[\)\.\/\-\=\, ]*\s*\d{3}\s*[ \-\.\/\=]*\s*\d{5}\b"
    # XXX-XXXX-XXX
    r"|\(?\d{3}?\s?[\)\.\/\-\=\, ]*\s?\d{4}\s?[ \-\.\/\=]*\s?\d{3}\b"
    # simple XXX-XXX-XXXX
    r"|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b"
    # extension after phone number
    r"(?:\s*(?:x|ex|ext|extension)\.?\s*\(?\d+\)?)?"
)

# Date: comprehensive patterns covering clinical note date formats
_DATE = (
    # --- Numeric formats ---
    # MM/DD/YYYY or DD/MM/YYYY or MM-DD-YY
    r"\b\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{2,4}\b"
    # YYYY/MM/DD or YYYY-MM-DD
    r"|\b\d{4}[\-\/\.]\d{1,2}[\-\/\.]\d{1,2}\b"
    # MM/YYYY or YYYY/MM
    r"|\b\d{1,2}[\-\/]\d{4}\b"
    r"|\b\d{4}[\-\/]\d{1,2}\b"

    # --- Numeric date ranges ---
    # MM/DD-MM/DD/YYYY
    r"|\b\d{1,2}\/\d{1,2}\-\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b"
    # MM/DD/YY-MM/DD/YY
    r"|\b\d{1,2}\/\d{1,2}\/\d{2,4}\-\d{1,2}\/\d{1,2}\/\d{2,4}\b"

    # --- Named month: Month DD, YYYY ---
    r"|\b(?:" + _MONTH + r")\.?\s+\d{1,2}(?:" + _ORDINAL + r")?\s*[\,\s]+\d{2,4}\b"
    # --- Named month: DD Month YYYY ---
    r"|\b\d{1,2}(?:" + _ORDINAL + r")?\s+(?:of\s+)?(?:" + _MONTH + r")\.?\s*[\,\s]+\d{2,4}\b"
    # --- Named month: Month DD (no year) ---
    r"|\b(?:" + _MONTH + r")\.?\s+\d{1,2}(?:" + _ORDINAL + r")?\b"
    # --- Named month: DD Month (no year) ---
    r"|\b\d{1,2}(?:" + _ORDINAL + r")?\s+(?:of\s+)?(?:" + _MONTH + r")\b"
    # --- Named month: Month YYYY ---
    r"|\b(?:" + _MONTH + r")\.?\s*(?:of\s+)?\d{4}\b"
    # --- Named month: Month 'YY ---
    r"|\b(?:" + _MONTH + r")\.?\s*\'\d{2}\b"

    # --- Named month ranges: Month DD-DD, YYYY ---
    r"|\b(?:" + _MONTH + r")\.?\s+\d{1,2}\s*(?:\-|to|through)\s*\d{1,2}\s*[\,\s]+\d{2,4}\b"
    # --- DD-DD Month YYYY ---
    r"|\b\d{1,2}\s*(?:\-|to|through)\s*\d{1,2}\s+(?:" + _MONTH + r")\.?\s*[\,\s]+\d{2,4}\b"

    # --- Season + year ---
    r"|\b(?:" + _SEASON + r")\s*(?:of\s+)?\d{2,4}\b"

    # --- Holidays ---
    r"|\b(?:Christmas|Thanksgiving|Easter|Hanukkah|Rosh Hashanah|Ramadan|"
    r"New Year(?:'s)?(?:\s+Day)?|Independence Day|"
    r"Victoria Day|Canada Day|Labour Day|Labor Day)\b"

    # --- Year with medical-event context ---
    r"|\b(?:since|from|in|year)\s+\d{4}\b"
)

_MRN = (
    r"(?:mrn|medical record|hospital number)\s*"
    r"(?:number|num|no|#)?\s*"
    r"[\)\#\:\-\=\s\.]*\s*"
    r"[a-zA-Z]*?\d+[\/\-\:]?\d*"
)

_ID = r"\b(?:MRN|ID)[\s:#]*\d+\b|\b\d{6,10}\b"

_POSTAL_CA = r"\b[a-zA-Z]\d[a-zA-Z][ \-]?\d[a-zA-Z]\d\b"

_OHIP = r"\b\d{4}[- \/]?\d{3}[- \/]?\d{3}[- \/]?[a-zA-Z]{0,2}\b"

_SIN = r"\b\d{3}([- \/]?)\d{3}\1\d{3}\b"

_SSN = r"\b\d{3}([- /]?)\d{2}\1\d{4}\b"

# US zip code: state name followed by 5(+4) digit zip
_ZIP_CODE_US = (
    r"\b(?:" + _US_STATES + r")\s*[,.]?\s*(\d{5}(?:-\d{4})?)\b"
)

# Street addresses with common suffixes + optional apartment/suite
_ADDRESS = (
    r"\b\d+\s+(?:[A-Za-z\.\']+\s+)?(?:[A-Za-z\.\']+\s+)?"
    r"(?:" + _STREET_SUFFIX + r")\.?"
    r"(?:\s*[,.]?\s*(?:apt|suite|ste|unit|bldg|building|fl|floor)\.?\s*#?\s*[\w]+)?\b"
)


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
    "ZIP_CODE_US": _ZIP_CODE_US,
    "ADDRESS": _ADDRESS,
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
                "Per-label regex patterns for rule-based PHI detection. "
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
        description="Legacy: map label -> regex string; folded into ``per_label``.",
        json_schema_extra=field_ui(
            ui_group="Legacy",
            ui_order=3,
            ui_widget="key_value",
            ui_advanced=True,
            ui_help="Prefer per_label for new configs.",
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
    label_keys: set[str] = set(BUILTIN_REGEX_PATTERNS.keys())
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
        elif label in BUILTIN_REGEX_PATTERNS:
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
