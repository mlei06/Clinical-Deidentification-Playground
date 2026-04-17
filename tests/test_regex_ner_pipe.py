"""Tests for regex_ner + whitelist and list upload API."""

from __future__ import annotations

import io

from clinical_deid.domain import AnnotatedDocument, Document
from clinical_deid.pipes.combinators import Pipeline
from clinical_deid.pipes.regex_ner import (
    BUILTIN_REGEX_PATTERNS,
    RegexLabelSettings,
    RegexNerConfig,
    RegexNerPipe,
)
from clinical_deid.pipes.whitelist import WhitelistConfig, WhitelistPipe, WhitelistLabelConfig


def _no_builtin_regex_config() -> RegexNerConfig:
    """Return a config with all built-in regex labels disabled."""
    return RegexNerConfig(
        labels={label: RegexLabelSettings(enabled=False) for label in BUILTIN_REGEX_PATTERNS},
    )


def _doc(text: str) -> AnnotatedDocument:
    return AnnotatedDocument(document=Document(id="test-doc", text=text), spans=[])


def _chained_detectors(config_r: RegexNerConfig | None, config_w: WhitelistConfig | None):
    return Pipeline(pipes=[
        RegexNerPipe(config_r),
        WhitelistPipe(config_w),
    ])


def test_builtin_patterns_match_phone_and_date() -> None:
    pipe = _chained_detectors(RegexNerConfig(), WhitelistConfig())
    out = pipe.forward(_doc("Call 555-123-4567 on 12/25/2024."))
    labels = {s.label for s in out.spans}
    assert "PHONE" in labels
    assert "DATE" in labels


def test_label_disabled_via_settings() -> None:
    cfg = RegexNerConfig(
        labels={"PHONE": RegexLabelSettings(enabled=False)}
    )
    pipe = _chained_detectors(cfg, WhitelistConfig())
    out = pipe.forward(_doc("Call 555-123-4567."))
    assert not any(s.label == "PHONE" for s in out.spans)


def test_list_terms_hospital() -> None:
    pipe = _chained_detectors(
        _no_builtin_regex_config(),
        WhitelistConfig(
            per_label={
                "HOSPITAL": WhitelistLabelConfig(
                    terms=["Toronto General Hospital"],
                                    ),
            }
        ),
    )
    out = pipe.forward(_doc("Admitted to Toronto General Hospital today."))
    assert any(s.label == "HOSPITAL" for s in out.spans)


def test_ner_builtins_endpoint(client) -> None:
    r = client.get("/pipelines/ner/builtins")
    assert r.status_code == 200
    body = r.json()
    assert "DATE" in body["regex_labels"]
    assert isinstance(body["whitelist_labels"], list)


def test_whitelist_parse_lists_endpoint(client) -> None:
    csv_body = "term\nAlpha Clinic\nBeta Clinic\n"
    files = [
        ("files", ("sites.csv", io.BytesIO(csv_body.encode("utf-8")), "text/csv")),
    ]
    r = client.post("/pipelines/whitelist/parse-lists", files=files, data={"labels": "HOSPITAL"})
    assert r.status_code == 200, r.text
    res = r.json()["results"][0]
    assert res["label"] == "HOSPITAL"
    assert res["count"] == 2
    assert "Alpha Clinic" in res["terms"]


def test_builtin_regex_disabled_lists_only_labels() -> None:
    pipe = _chained_detectors(
        _no_builtin_regex_config(),
        WhitelistConfig(
            load_all_dictionaries=False,
            per_label={
                "HOSPITAL": WhitelistLabelConfig(
                    terms=["Toronto General Hospital"],
                ),
            },
        ),
    )
    out = pipe.forward(_doc("Patient at Toronto General Hospital."))
    assert any(s.label == "HOSPITAL" for s in out.spans)


def _labels_for(text: str, label: str) -> list[str]:
    """Return the matched substrings for a single label in ``text``."""
    pipe = RegexNerPipe(RegexNerConfig())
    out = pipe.forward(_doc(text))
    return [text[s.start : s.end] for s in out.spans if s.label == label]


# ---------------------------------------------------------------------------
# New label patterns
# ---------------------------------------------------------------------------


def test_age_patterns() -> None:
    cases = [
        "Patient is age 67.",
        "Aged 88 at admission.",
        "Presents as a 55-year-old female.",
        "55 years old male.",
        "65 y/o with chest pain.",
        "Age: 90.",
    ]
    for text in cases:
        assert _labels_for(text, "AGE"), f"AGE missed in: {text!r}"


def test_hospital_patterns() -> None:
    cases = [
        "Admitted to Toronto General Hospital today.",
        "Transferred to Mount Sinai Medical Center.",
        "Seen at Mayo Clinic last week.",
        "Visit at Memorial Sloan Kettering Cancer Center.",
        "Referred to St. Jude Children's Hospital.",
    ]
    for text in cases:
        assert _labels_for(text, "HOSPITAL"), f"HOSPITAL missed in: {text!r}"


def test_organization_patterns() -> None:
    cases = [
        "Drug supplied by Pfizer Inc.",
        "Medication from Johnson & Johnson Pharmaceuticals.",
        "Studied at Harvard University.",
        "Works at Acme Health Solutions.",
    ]
    for text in cases:
        assert _labels_for(text, "ORGANIZATION"), f"ORGANIZATION missed in: {text!r}"


def test_url_patterns() -> None:
    text = "See https://example.com/foo and www.clinic.org/page for details."
    matches = _labels_for(text, "URL")
    assert any("https://example.com/foo" in m for m in matches)
    assert any("www.clinic.org/page" in m for m in matches)


def test_ip_address_patterns() -> None:
    text = "Server at 192.168.1.42 and gateway 10.0.0.1."
    matches = _labels_for(text, "IP_ADDRESS")
    assert "192.168.1.42" in matches
    assert "10.0.0.1" in matches


def test_fax_patterns() -> None:
    cases = [
        "Fax: 555-987-6543",
        "facsimile #555.123.4567",
        "fax number (212) 555-0100",
    ]
    for text in cases:
        assert _labels_for(text, "FAX"), f"FAX missed in: {text!r}"


def test_license_patterns() -> None:
    assert _labels_for("Issued License #ABC12345 last year.", "LICENSE")
    assert _labels_for("DEA AB1234567 on file.", "LICENSE")
    assert _labels_for("NPI 1234567890 verified.", "LICENSE")


def test_vehicle_id_patterns() -> None:
    assert _labels_for("VIN 1HGCM82633A123456 issued.", "VEHICLE_ID")
    assert _labels_for("License plate ABC-123 cited.", "VEHICLE_ID")


def test_device_id_patterns() -> None:
    assert _labels_for("Pacemaker serial number SN-9981A.", "DEVICE_ID")
    assert _labels_for("UDI: 0123456789ABC.", "DEVICE_ID")


def test_account_patterns() -> None:
    assert _labels_for("Account #555000123 was billed.", "ACCOUNT")
    assert _labels_for("acct: 9988-7766", "ACCOUNT")


def test_date_time_patterns() -> None:
    assert _labels_for("Admitted 2024-01-15T14:30:00Z.", "DATE_TIME")
    assert _labels_for("Arrived at 14:30.", "DATE_TIME")
    assert _labels_for("Procedure started at 2:30 pm.", "DATE_TIME")


# ---------------------------------------------------------------------------
# Improved existing patterns
# ---------------------------------------------------------------------------


def test_email_obfuscated_forms() -> None:
    matches = _labels_for("Contact john [at] example [dot] com today.", "EMAIL")
    assert matches, "obfuscated [at]/[dot] EMAIL not detected"


def test_phone_international_prefix() -> None:
    assert _labels_for("Call +1 555 123 4567 anytime.", "PHONE")
    assert _labels_for("Call +44 20 7946 0958 from London.", "PHONE")


def test_date_iso_year_range_and_decade() -> None:
    assert _labels_for("Treated 2010-2024 in clinic.", "DATE")
    assert _labels_for("Symptoms began in the 1990s.", "DATE")


def test_address_po_box() -> None:
    assert _labels_for("Mail to P.O. Box 1234 in town.", "ADDRESS")


def test_hospital_avoids_bare_word() -> None:
    """The hospital-keyword alone shouldn't match without a preceding name."""
    pipe = RegexNerPipe(RegexNerConfig())
    out = pipe.forward(_doc("Discharged from the hospital today."))
    hospital_spans = [s for s in out.spans if s.label == "HOSPITAL"]
    # Bare 'the hospital' shouldn't trigger HOSPITAL — needs a proper-noun prefix.
    assert all(text not in {"hospital", "the hospital"} for text in
               [out.document.text[s.start:s.end].lower() for s in hospital_spans])
