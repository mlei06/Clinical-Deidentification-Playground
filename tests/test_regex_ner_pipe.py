"""Tests for regex_ner + whitelist and list upload API."""

from __future__ import annotations

import io

from clinical_deid.domain import AnnotatedDocument, Document
from clinical_deid.pipes.combinators import Pipeline
from clinical_deid.pipes.regex_ner import RegexNerConfig, RegexNerPipe, RegexNerLabelConfig
from clinical_deid.pipes.whitelist import WhitelistConfig, WhitelistPipe, WhitelistLabelConfig


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


def test_per_label_regex_disabled() -> None:
    cfg = RegexNerConfig(
        per_label={
            "PHONE": RegexNerLabelConfig(regex_enabled=False),
        }
    )
    pipe = _chained_detectors(cfg, WhitelistConfig())
    out = pipe.forward(_doc("Call 555-123-4567."))
    assert not any(s.label == "PHONE" for s in out.spans)


def test_list_terms_hospital() -> None:
    pipe = _chained_detectors(
        RegexNerConfig(include_builtin_regex=False),
        WhitelistConfig(
            per_label={
                "HOSPITAL": WhitelistLabelConfig(
                    terms=["Toronto General Hospital"],
                    include_builtin_terms=False,
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
    assert "HOSPITAL" in body["whitelist_labels"]


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


def test_include_builtin_regex_off_lists_only_labels() -> None:
    pipe = _chained_detectors(
        RegexNerConfig(include_builtin_regex=False),
        WhitelistConfig(include_builtin_term_files=True),
    )
    out = pipe.forward(_doc("Patient at Toronto General Hospital."))
    assert any(s.label == "HOSPITAL" for s in out.spans)
