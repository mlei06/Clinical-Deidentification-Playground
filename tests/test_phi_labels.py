"""Tests for the canonical PHILabel enum."""

from __future__ import annotations

from clinical_deid.domain import PHILabel


def test_direct_match() -> None:
    assert PHILabel.normalize("PHONE") == PHILabel.PHONE
    assert PHILabel.normalize("DATE") == PHILabel.DATE
    assert PHILabel.normalize("SSN") == PHILabel.SSN


def test_case_insensitive() -> None:
    assert PHILabel.normalize("phone") == PHILabel.PHONE
    assert PHILabel.normalize("Date") == PHILabel.DATE


def test_alias_mapping() -> None:
    assert PHILabel.normalize("PHONE_NUMBER") == PHILabel.PHONE
    assert PHILabel.normalize("EMAIL_ADDRESS") == PHILabel.EMAIL
    assert PHILabel.normalize("POSTAL_CODE_CA") == PHILabel.POSTAL_CODE
    assert PHILabel.normalize("ZIP_CODE_US") == PHILabel.ZIP_CODE
    assert PHILabel.normalize("LOCATION_OTHER") == PHILabel.LOCATION
    assert PHILabel.normalize("FIRST_NAME") == PHILabel.NAME
    assert PHILabel.normalize("LAST_NAME") == PHILabel.NAME
    assert PHILabel.normalize("DOB") == PHILabel.DATE


def test_unknown_maps_to_other() -> None:
    assert PHILabel.normalize("COMPLETELY_UNKNOWN_LABEL") == PHILabel.OTHER


def test_values_returns_all_strings() -> None:
    vals = PHILabel.values()
    assert isinstance(vals, list)
    assert "NAME" in vals
    assert "PHONE" in vals
    assert "OTHER" in vals


def test_str_enum_serialization() -> None:
    assert str(PHILabel.NAME) == "PHILabel.NAME"
    assert PHILabel.NAME.value == "NAME"
    assert PHILabel.NAME == "NAME"
