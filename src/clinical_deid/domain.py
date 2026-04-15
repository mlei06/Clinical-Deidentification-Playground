from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class PHILabel(str, Enum):
    """Canonical PHI label space.

    All pipeline outputs are normalized to these labels before reaching
    redaction/surrogate logic.  Detectors may use any internal labels, but
    must declare a mapping to canonical labels via their config's
    ``label_mapping`` / ``remap`` fields.

    Based on HIPAA Safe Harbor's 18 identifiers plus practical clinical additions.
    """

    # HIPAA #1 — Names
    NAME = "NAME"
    PATIENT = "PATIENT"
    DOCTOR = "DOCTOR"
    STAFF = "STAFF"
    HCW = "HCW"

    # HIPAA #2 — Geographic data
    ADDRESS = "ADDRESS"
    LOCATION = "LOCATION"
    CITY = "CITY"
    STATE = "STATE"
    COUNTRY = "COUNTRY"
    ZIP_CODE = "ZIP_CODE"
    POSTAL_CODE = "POSTAL_CODE"

    # HIPAA #3 — Dates
    DATE = "DATE"
    DATE_TIME = "DATE_TIME"

    # HIPAA #4-5 — Phone / Fax
    PHONE = "PHONE"
    FAX = "FAX"

    # HIPAA #6 — Email
    EMAIL = "EMAIL"

    # HIPAA #7 — SSN
    SSN = "SSN"

    # HIPAA #8 — Medical record numbers
    MRN = "MRN"

    # HIPAA #9-11 — Beneficiary / Account / License
    ID = "ID"
    ACCOUNT = "ACCOUNT"
    LICENSE = "LICENSE"

    # HIPAA #12-13 — Vehicle / Device identifiers
    VEHICLE_ID = "VEHICLE_ID"
    DEVICE_ID = "DEVICE_ID"

    # HIPAA #14-15 — Web / IP
    URL = "URL"
    IP_ADDRESS = "IP_ADDRESS"

    # HIPAA #16 — Biometric
    BIOMETRIC = "BIOMETRIC"

    # HIPAA #17 — Photos (not detectable via text, but included for completeness)
    PHOTO = "PHOTO"

    # Clinical / practical additions
    AGE = "AGE"
    ORGANIZATION = "ORGANIZATION"
    HOSPITAL = "HOSPITAL"
    IDNUM = "IDNUM"
    OHIP = "OHIP"
    SIN = "SIN"
    PERSON = "PERSON"

    # Catch-all for labels that don't map to a specific type
    OTHER = "OTHER"

    @classmethod
    def normalize(cls, label: str) -> PHILabel:
        """Map a raw label string to a canonical PHILabel.

        Returns the matching enum member if it exists, otherwise ``OTHER``.
        """
        upper = label.upper().replace(" ", "_")
        # Direct match
        try:
            return cls(upper)
        except ValueError:
            pass
        # Common aliases
        aliases: dict[str, PHILabel] = {
            "PHONE_NUMBER": cls.PHONE,
            "EMAIL_ADDRESS": cls.EMAIL,
            "LOCATION_OTHER": cls.LOCATION,
            "POSTAL_CODE_CA": cls.POSTAL_CODE,
            "ZIP_CODE_US": cls.ZIP_CODE,
            "ZIP": cls.ZIP_CODE,
            "FIRSTNAME": cls.NAME,
            "FIRST_NAME": cls.NAME,
            "LASTNAME": cls.NAME,
            "LAST_NAME": cls.NAME,
            "FULLNAME": cls.NAME,
            "FULL_NAME": cls.NAME,
            "DATE_OF_BIRTH": cls.DATE,
            "DOB": cls.DATE,
            "STREET_ADDRESS": cls.ADDRESS,
            "MEDICAL_RECORD": cls.MRN,
            "SOCIAL_SECURITY": cls.SSN,
        }
        return aliases.get(upper, cls.OTHER)

    @classmethod
    def values(cls) -> list[str]:
        """Return all canonical label strings."""
        return [m.value for m in cls]


class Document(BaseModel):
    id: str
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class PHISpan(BaseModel):
    start: int
    end: int
    label: str
    confidence: float | None = None
    source: str | None = None

    @model_validator(mode="after")
    def span_order(self) -> PHISpan:
        if self.start < 0 or self.end < 0 or self.start >= self.end:
            raise ValueError(f"invalid span bounds: start={self.start}, end={self.end}")
        return self


class AnnotatedDocument(BaseModel):
    document: Document
    spans: list[PHISpan] = Field(default_factory=list)

    @model_validator(mode="after")
    def spans_match_text(self) -> AnnotatedDocument:
        n = len(self.document.text)
        for s in self.spans:
            if s.end > n:
                raise ValueError(
                    f"span [{s.start}:{s.end}) exceeds text length {n} for doc {self.document.id!r}"
                )
        return self

    def with_spans(self, spans: list[PHISpan]) -> AnnotatedDocument:
        return AnnotatedDocument(document=self.document, spans=spans)


def tag_replace(text: str, spans: list[PHISpan]) -> str:
    """Replace spans with ``[LABEL]`` tags, handling overlaps.

    When spans overlap, the longest span wins.  Ties are broken by earliest
    start, then alphabetical label.  Fully or partially covered spans are
    dropped so replacements never corrupt each other.
    """
    if not spans:
        return text

    # Dedupe and pick winners: longest span first, then earliest start
    sorted_spans = sorted(
        spans,
        key=lambda s: (-(s.end - s.start), s.start, s.label),
    )

    # Greedily select non-overlapping spans
    selected: list[PHISpan] = []
    for s in sorted_spans:
        if any(s.start < sel.end and s.end > sel.start for sel in selected):
            continue
        selected.append(s)

    # Replace right-to-left to preserve offsets
    selected.sort(key=lambda s: s.start, reverse=True)
    result = text
    for s in selected:
        result = result[: s.start] + f"[{s.label}]" + result[s.end :]
    return result
