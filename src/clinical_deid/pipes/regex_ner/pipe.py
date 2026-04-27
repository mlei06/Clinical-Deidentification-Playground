"""Regex-only PHI detection with built-in clinical patterns per label."""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field

from clinical_deid.domain import AnnotatedDocument, EntitySpan
from clinical_deid.pipes.base import ConfigurablePipe
from clinical_deid.pipes.detector_label_mapping import (
    accumulate_spans,
    apply_detector_label_mapping,
    effective_detector_labels,
)
from clinical_deid.pipes.span_merge import merge_longest_non_overlapping
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
    "Highway|Hwy|Parkway|Pkwy|Terrace|Ter|Trail|Trl|"
    "Square|Sq|Plaza|Plz|Crescent|Cres|Alley|Aly|Loop|Row"
)

# ---------------------------------------------------------------------------
# Hospital / organization trailing keywords
# ---------------------------------------------------------------------------

_HOSPITAL_KEYWORD = (
    r"Hospitals?|Medical\s+Center|Medical\s+Centre|Medical\s+Group|"
    r"Health\s+System|Health\s+Center|Health\s+Centre|"
    r"Healthcare|Health\s+Care|Cancer\s+Center|Cancer\s+Centre|"
    r"Children's\s+Hospital|Memorial\s+Hospital|"
    r"Clinic|Polyclinic|Infirmary|Sanitarium|Sanatorium|"
    r"Urgent\s+Care|Surgery\s+Center"
)

_ORG_KEYWORD = (
    r"Inc\.?|LLC|L\.L\.C\.|Corp\.?|Corporation|Co\.|Company|"
    r"Foundation|Ltd\.?|Limited|Group|Associates|Partners|"
    r"Pharmaceuticals?|Pharma|Laboratories|Labs?\.?|Industries|"
    r"Holdings|Enterprises|Solutions|Systems|Technologies|"
    r"University|College|Institute|Academy|Society|Association"
)

# ---------------------------------------------------------------------------
# Built-in patterns
# ---------------------------------------------------------------------------

# EMAIL: standard mailbox, plus obfuscated [at]/(at) and [dot]/(dot) forms.
_EMAIL = (
    r"\b[A-Za-z0-9._%+\-]+\s?@\s?[A-Za-z0-9][A-Za-z0-9\-\.]*\.[A-Za-z]{2,24}\b"
    r"|\b[A-Za-z0-9._%+\-]+\s*(?:\[at\]|\(at\))\s*"
    r"[A-Za-z0-9][A-Za-z0-9\-\.]*\s*(?:\[dot\]|\(dot\)|\.)\s*[A-Za-z]{2,24}\b"
)

# Phone: international, NANP, separator-required local, and keyword-anchored.
_PHONE = (
    # International with + prefix: +1 555 123 4567, +44 20 7946 0958
    r"\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}"
    # (XXX) XXX-XXXX with parentheses
    r"|\(\d{3}\)\s*\d{3}[-.\s]?\d{4}"
    # XXX-XXX-XXXX or XXX.XXX.XXXX or XXX XXX XXXX (separator required)
    r"|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b"
    # 9-digit / 11-digit local variants kept for OCR'd notes
    r"|\(?(\d{3})\s*[\)\.\/\-\=\, ]*\s*\d{3}\s*[ \-\.\/\=]*\s*\d{3}\b"
    r"|\(?(\d{3})\s*[\)\.\/\-\=\, ]*\s*\d{3}\s*[ \-\.\/\=]*\s*\d{5}\b"
    # Keyword + digits: phone: 5551234567, mobile #555-1234, pager 1234
    r"|(?:phone|tel|telephone|mobile|cell|cellular|pager|beeper|"
    r"home\s+phone|work\s+phone|office\s+phone)\s*"
    r"(?:number|num|no|#)?\s*[:#\-]?\s*\(?\+?\d[\d\s\-\.\(\)]{6,20}\d"
    # Optional extension trailer
    r"(?:\s*(?:x|ex|ext|extension)\.?\s*\(?\d+\)?)?"
)

# FAX: phone-like number with required fax-keyword context.
_FAX = (
    r"(?:fax|facsimile)\s*(?:number|num|no|#)?\s*"
    r"[:#\-]?\s*\(?\+?\d[\d\s\-\.\(\)]{6,20}\d"
)

# Date: comprehensive patterns covering clinical note date formats.
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
    r"|\b\d{1,2}\/\d{1,2}\-\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b"
    r"|\b\d{1,2}\/\d{1,2}\/\d{2,4}\-\d{1,2}\/\d{1,2}\/\d{2,4}\b"

    # --- Named month forms ---
    r"|\b(?:" + _MONTH + r")\.?\s+\d{1,2}(?:" + _ORDINAL + r")?\s*[\,\s]+\d{2,4}\b"
    r"|\b\d{1,2}(?:" + _ORDINAL + r")?\s+(?:of\s+)?(?:" + _MONTH + r")\.?\s*[\,\s]+\d{2,4}\b"
    r"|\b(?:" + _MONTH + r")\.?\s+\d{1,2}(?:" + _ORDINAL + r")?\b"
    r"|\b\d{1,2}(?:" + _ORDINAL + r")?\s+(?:of\s+)?(?:" + _MONTH + r")\b"
    r"|\b(?:" + _MONTH + r")\.?\s*(?:of\s+)?\d{4}\b"
    r"|\b(?:" + _MONTH + r")\.?\s*\'\d{2}\b"

    # --- Named month ranges ---
    r"|\b(?:" + _MONTH + r")\.?\s+\d{1,2}\s*(?:\-|to|through)\s*\d{1,2}\s*[\,\s]+\d{2,4}\b"
    r"|\b\d{1,2}\s*(?:\-|to|through)\s*\d{1,2}\s+(?:" + _MONTH + r")\.?\s*[\,\s]+\d{2,4}\b"

    # --- Season + year ---
    r"|\b(?:" + _SEASON + r")\s*(?:of\s+)?\d{2,4}\b"

    # --- Decades: 1990s, the 90s, '90s ---
    r"|\b(?:19|20)\d0s\b"
    r"|\bthe\s+\d0s\b"
    r"|\'\d{2}s\b"

    # --- Year ranges: 1990-2024, 1990 to 2024 ---
    r"|\b(?:19|20)\d{2}\s*(?:\-|to|through|until)\s*(?:19|20)\d{2}\b"

    # --- Holidays ---
    r"|\b(?:Christmas|Thanksgiving|Easter|Hanukkah|Rosh Hashanah|Ramadan|"
    r"New Year(?:'s)?(?:\s+Day)?|Independence Day|Memorial Day|"
    r"Victoria Day|Canada Day|Labour Day|Labor Day|Veterans Day|"
    r"Mother's Day|Father's Day|Valentine's Day)\b"

    # --- Year with medical-event context ---
    r"|\b(?:since|from|in|year|during|until|before|after|by|circa)\s+\d{4}\b"
)

# DATE_TIME: ISO 8601 timestamps and bare time-of-day expressions.
_DATE_TIME = (
    # ISO 8601: 2024-01-15T14:30:00Z, 2024-01-15 14:30:00+05:30
    r"\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?"
    r"(?:\s*Z|\s*[+-]\d{2}:?\d{2})?\b"
    # 24-hour or 12-hour time: 14:30, 2:30 pm, 02:30 a.m.
    r"|\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s*[ap]\.?\s*m\.?)?\b"
    # 10am, 10 p.m.
    r"|\b\d{1,2}\s*[ap]\.?\s*m\.?\b"
)

# AGE: explicit age phrases (HIPAA Safe Harbor: ages > 89 must be aggregated).
_AGE = (
    # age 55, age: 55, aged 55, age is 55
    r"\b(?:age[ds]?|aged)\s*(?:is|of|=|:)?\s*\d{1,3}\b"
    # 55-year-old, 55 year old
    r"|\b\d{1,3}\s*[\-]?\s*year[\s\-]*old\b"
    # 55 years old, 55 yrs old, 55 yo
    r"|\b\d{1,3}\s*(?:years?|yrs?)[\s\.\-]*old\b"
    # 55 y/o, 55 y.o.
    r"|\b\d{1,3}\s*y[\s\.\/]\s*o\.?\b"
    # 55M, 55F shorthand for "55-year-old male/female"
    r"|\b\d{1,3}\s*[\-]?\s*[ymf]o?\b"
)

# MRN: medical record number with explicit context terms.
_MRN = (
    r"(?:mrn|medical\s+record(?:\s*(?:number|num|no|#))?|"
    r"hospital\s+(?:number|#|num)|chart\s*(?:number|#|num|no)?|"
    r"patient\s+(?:id|identifier|number|#)|case\s*(?:number|#|num|no)|"
    r"empi)\s*"
    r"(?:number|num|no|#)?\s*"
    r"[\)\#\:\-\=\s\.]*\s*"
    r"[a-zA-Z]*?\d+[\/\-\:]?\d*"
)

# ID: explicit ID prefix or patient/subject/study identifier.
_ID = (
    r"\b(?:MRN|ID|EMPI|HCN|HRN|UPI)[\s:#]*\d+\b"
    r"|\b(?:patient|subject|study|enrollment)\s+(?:id|identifier|number|#)"
    r"\s*[:#]?\s*[A-Z0-9][A-Z0-9\-]{2,}\b"
    r"|\b\d{6,10}\b"
)

# ACCOUNT: account number with required keyword context.
_ACCOUNT = (
    r"\b(?:account|acct|acc)\s*(?:number|num|no|#)?\s*"
    r"[:#\-]?\s*\d[\dA-Z\-]{3,}\b"
)

# LICENSE: license/certificate number, plus DEA and NPI registries.
_LICENSE = (
    r"\b(?:licen[cs]e|lic\.?|certificate|cert\.?)\s*"
    r"(?:number|num|no|#)?[\s:#\-]*[A-Z0-9][\dA-Z\-]{3,}\b"
    r"|\bDEA\s*(?:number|num|no|#)?[\s:#\-]*[A-Z]{2}\d{7}\b"
    r"|\bNPI\s*(?:number|num|no|#)?[\s:#\-]*\d{10}\b"
)

# VEHICLE_ID: VIN (17 chars, no I/O/Q) or license plate with context.
_VEHICLE_ID = (
    r"\b(?:VIN|vehicle\s+identification\s+number)\s*"
    r"(?:number|num|no|#)?[\s:#\-]*[A-HJ-NPR-Z0-9]{17}\b"
    r"|\b(?:license\s+plate|plate\s+number|plate\s+#|tag\s+number)"
    r"\s*[:#\-]?\s*[A-Z0-9][A-Z0-9\s\-]{2,8}\b"
)

# DEVICE_ID: device or serial number with required keyword context.
_DEVICE_ID = (
    r"\b(?:device\s+(?:id|number|serial|#)|serial\s*(?:number|#|num|no)|"
    r"s\/n|s\.n\.|model\s+(?:number|#|num|no))\s*"
    r"[:#\-]?\s*[A-Z0-9][A-Z0-9\-]{3,}\b"
    r"|\bUDI[\s:#\-]+[\dA-Z\(\)\+\-]{8,}\b"
)

# URL: http/https/ftp/file plus bare www. domains.
_URL = (
    r"\bhttps?:\/\/[^\s<>\"\)\]]+"
    r"|\b(?:ftp|ftps|file):\/\/[^\s<>\"\)\]]+"
    r"|\bwww\.[a-zA-Z0-9][a-zA-Z0-9\-]*(?:\.[a-zA-Z0-9\-]+)+(?:\/[^\s<>\"\)\]]*)?"
)

# IP_ADDRESS: IPv4 (octet-validated) and uncompressed IPv6.
_IP_ADDRESS = (
    r"\b(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)"
    r"(?:\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}\b"
    r"|\b(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}\b"
)

# HOSPITAL: capitalized words ending in a hospital/clinic keyword.
# Both prefix and keyword require uppercase first letter (via (?-i:...)) so
# stop-word phrases like "the hospital" don't trigger under re.IGNORECASE.
_HOSPITAL = (
    r"\b(?:(?-i:[A-Z])[A-Za-z'\.\-]+\s+){1,4}"
    r"(?-i:" + _HOSPITAL_KEYWORD + r")\b"
)

# ORGANIZATION: capitalized words ending in a corporate/academic suffix.
_ORGANIZATION = (
    r"\b(?:(?-i:[A-Z])[A-Za-z'\.\-]+\s+){1,4}"
    r"(?-i:" + _ORG_KEYWORD + r")\b"
)

_POSTAL_CA = r"\b[a-zA-Z]\d[a-zA-Z][ \-]?\d[a-zA-Z]\d\b"

_OHIP = r"\b\d{4}[- \/]?\d{3}[- \/]?\d{3}[- \/]?[a-zA-Z]{0,2}\b"

_SIN = r"\b\d{3}([- \/]?)\d{3}\1\d{3}\b"

_SSN = r"\b\d{3}([- /]?)\d{2}\1\d{4}\b"

# US zip code: state name followed by 5(+4) digit zip
_ZIP_CODE_US = (
    r"\b(?:" + _US_STATES + r")\s*[,.]?\s*(\d{5}(?:-\d{4})?)\b"
)

# Street addresses with common suffixes + optional apt/suite, plus PO Box.
_ADDRESS = (
    r"\b\d+\s+(?:[A-Za-z\.\']+\s+)?(?:[A-Za-z\.\']+\s+)?"
    r"(?:" + _STREET_SUFFIX + r")\.?"
    r"(?:\s*[,.]?\s*(?:apt|suite|ste|unit|bldg|building|fl|floor|rm|room)\.?\s*#?\s*[\w]+)?\b"
    r"|\bP\.?\s*O\.?\s*Box\s+\d+\b"
)


_CLINICAL_PHI_PATTERNS: dict[str, str] = {
    "DATE": _DATE,
    "DATE_TIME": _DATE_TIME,
    "AGE": _AGE,
    "PHONE": _PHONE,
    "FAX": _FAX,
    "EMAIL": _EMAIL,
    "ID": _ID,
    "MRN": _MRN,
    "ACCOUNT": _ACCOUNT,
    "LICENSE": _LICENSE,
    "VEHICLE_ID": _VEHICLE_ID,
    "DEVICE_ID": _DEVICE_ID,
    "URL": _URL,
    "IP_ADDRESS": _IP_ADDRESS,
    "HOSPITAL": _HOSPITAL,
    "ORGANIZATION": _ORGANIZATION,
    "POSTAL_CODE_CA": _POSTAL_CA,
    "OHIP": _OHIP,
    "SIN": _SIN,
    "SSN": _SSN,
    "ZIP_CODE_US": _ZIP_CODE_US,
    "ADDRESS": _ADDRESS,
}

# Register the built-in packs now that the pattern dict is defined. This is a
# one-shot side-effect import; ``packs._register_builtin_packs()`` reads
# ``_CLINICAL_PHI_PATTERNS`` above.
from clinical_deid.pipes.regex_ner.packs import (  # noqa: E402
    _register_builtin_packs,
    get_pattern_pack,
)

_register_builtin_packs()

# Backward-compat alias: legacy callers import ``BUILTIN_REGEX_PATTERNS`` from
# this module (and via ``clinical_deid.pipes.regex_ner``). Always points at the
# default (``clinical_phi``) pack's patterns.
BUILTIN_REGEX_PATTERNS: dict[str, str] = dict(_CLINICAL_PHI_PATTERNS)


class RegexLabelSettings(BaseModel):
    """Per-label settings for the regex NER detector."""

    enabled: bool = True
    remap: str | None = None
    custom_pattern: str | None = None


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

    pattern_pack: str = Field(
        default="clinical_phi",
        description=(
            "Name of the registered regex pattern pack to use. "
            "Built-ins: 'clinical_phi' (default), 'generic_pii'."
        ),
        json_schema_extra=field_ui(
            ui_group="General",
            ui_order=2,
            ui_widget="text",
            ui_advanced=True,
        ),
    )

    labels: dict[str, RegexLabelSettings] = Field(
        default_factory=dict,
        title="Labels",
        description=(
            "Configure each detection label: toggle on/off, "
            "view or override regex patterns, and remap output labels."
        ),
        json_schema_extra=field_ui(
            ui_group="Labels",
            ui_order=2,
            ui_widget="unified_label",
            ui_allow_custom_labels=True,
        ),
    )

    skip_overlapping: bool = Field(
        default=False,
        description="Drop new spans that overlap any existing span in the document.",
        json_schema_extra=field_ui(
            ui_group="General",
            ui_order=99,
            ui_widget="switch",
        ),
    )

    dedupe_internal_overlaps: bool = Field(
        default=True,
        description=(
            "Reconcile this pipe's own matches before they are added to the "
            "document so it never emits duplicate or overlapping spans with "
            "itself. Runs after label remap using a longest-match-wins greedy "
            "merge — within a single rule-based pipe a longer match is by "
            "construction the more specific one (e.g. ``Fax: 555-987-6543`` "
            "beats the embedded phone digits). Cross-pipe label conflicts are "
            "still settled by ``resolve_spans`` downstream. Disable only if "
            "you need the raw, unfiltered match set."
        ),
        json_schema_extra=field_ui(
            ui_group="General",
            ui_order=100,
            ui_widget="switch",
            ui_advanced=True,
        ),
    )

    @property
    def label_mapping(self) -> dict[str, str | None]:
        """Derived label mapping for the DetectorWithLabelMapping protocol."""
        mapping: dict[str, str | None] = {}
        for label, s in self.labels.items():
            if not s.enabled:
                mapping[label] = None
            elif s.remap:
                mapping[label] = s.remap
        return mapping


def builtin_regex_label_names(pack_name: str = "clinical_phi") -> list[str]:
    """Return the labels contributed by *pack_name* (default: clinical_phi)."""
    return get_pattern_pack(pack_name).labels()


def default_base_labels() -> list[str]:
    """Default label space for the regex_ner detector (clinical_phi pack)."""
    return get_pattern_pack("clinical_phi").labels()


class _ResolvedRegex:
    __slots__ = ("label", "compiled")

    def __init__(self, label: str, compiled: re.Pattern[str]) -> None:
        self.label = label
        self.compiled = compiled


def _resolve_regex(config: RegexNerConfig) -> list[_ResolvedRegex]:
    pack = get_pattern_pack(config.pattern_pack)
    label_keys = set(pack.patterns) | set(config.labels)

    out: list[_ResolvedRegex] = []
    for label in sorted(label_keys):
        settings = config.labels.get(label, RegexLabelSettings())
        if not settings.enabled:
            continue
        pat = settings.custom_pattern or pack.patterns.get(label)
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
        found: list[EntitySpan] = []
        for r in self._resolved:
            for m in r.compiled.finditer(text):
                found.append(
                    EntitySpan(
                        start=m.start(),
                        end=m.end(),
                        label=r.label,
                        confidence=1.0,
                        source=self._config.source_name,
                    )
                )
        found = apply_detector_label_mapping(found, self._config.label_mapping)

        # Reconcile *after* remap. Two distinct base labels can collapse to the
        # same output label (e.g. ``MRN`` → ``ID`` colliding with native ``ID``)
        # at the same range, and patterns under different labels routinely match
        # nested or overlapping ranges (e.g. ``MRN: 12345`` and bare ``12345``).
        # Longest-first wins: within one rule-based pipe a longer match is by
        # construction more specific (the FAX pattern matched its keyword *and*
        # the digits; the PHONE pattern only matched the digits — FAX wins).
        if self._config.dedupe_internal_overlaps and found:
            found = merge_longest_non_overlapping([found])
        else:
            found.sort(key=lambda s: (s.start, s.end, s.label))

        return accumulate_spans(doc, found, skip_overlapping=self._config.skip_overlapping)
