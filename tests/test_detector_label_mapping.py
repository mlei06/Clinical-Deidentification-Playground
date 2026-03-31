"""Detector label_mapping (rename, drop via null) and LabelMapper null."""

from __future__ import annotations

from clinical_deid.domain import AnnotatedDocument, Document, PHISpan
from clinical_deid.pipes.combinators import LabelMapper, LabelMapperConfig
from clinical_deid.pipes.detector_label_mapping import (
    apply_detector_label_mapping,
    effective_detector_labels,
)
from clinical_deid.pipes.regex_ner import RegexNerConfig, RegexNerPipe
from clinical_deid.pipes.whitelist import WhitelistConfig, WhitelistLabelConfig, WhitelistPipe


def _doc(text: str) -> AnnotatedDocument:
    return AnnotatedDocument(document=Document(id="d", text=text), spans=[])


def test_effective_detector_labels_rename() -> None:
    assert effective_detector_labels({"A", "B"}, {"A": "X"}) == {"X", "B"}


def test_effective_detector_labels_drop() -> None:
    assert effective_detector_labels({"A", "B"}, {"A": None}) == {"B"}


def test_apply_detector_label_mapping_drop() -> None:
    spans = [
        PHISpan(start=0, end=1, label="X", source="t"),
        PHISpan(start=2, end=3, label="Y", source="t"),
    ]
    out = apply_detector_label_mapping(spans, {"X": None})
    assert len(out) == 1 and out[0].label == "Y"


def test_regex_ner_label_mapping_rename() -> None:
    pipe = RegexNerPipe(
        RegexNerConfig(
            label_mapping={"PHONE": "TELEPHONE"},
        )
    )
    assert "PHONE" in pipe.base_labels
    assert "PHONE" not in pipe.labels
    assert "TELEPHONE" in pipe.labels
    out = pipe.forward(_doc("Call 555-123-4567."))
    assert any(s.label == "TELEPHONE" for s in out.spans)
    assert not any(s.label == "PHONE" for s in out.spans)


def test_regex_ner_label_mapping_null_drops() -> None:
    pipe = RegexNerPipe(RegexNerConfig(label_mapping={"PHONE": None}))
    out = pipe.forward(_doc("Call 555-123-4567."))
    assert len(out.spans) == 0


def test_whitelist_label_mapping() -> None:
    pipe = WhitelistPipe(
        WhitelistConfig(
            per_label={
                "HOSPITAL": WhitelistLabelConfig(
                    terms=["Memorial Hospital"],
                    include_builtin_terms=False,
                ),
            },
            label_mapping={"HOSPITAL": "SITE"},
        )
    )
    assert "HOSPITAL" in pipe.base_labels
    assert "SITE" in pipe.labels and "HOSPITAL" not in pipe.labels
    out = pipe.forward(_doc("At Memorial Hospital."))
    assert [s.label for s in out.spans] == ["SITE"]


def test_label_mapper_null_drops() -> None:
    doc = AnnotatedDocument(
        document=Document(id="1", text="ab"),
        spans=[
            PHISpan(start=0, end=1, label="A", source="s"),
            PHISpan(start=1, end=2, label="B", source="s"),
        ],
    )
    pipe = LabelMapper(LabelMapperConfig(mapping={"A": None}))
    out = pipe.forward(doc)
    assert len(out.spans) == 1 and out.spans[0].label == "B"


def test_pipeline_json_roundtrip_label_mapping() -> None:
    from clinical_deid.pipes.registry import dump_pipe, load_pipe

    p1 = RegexNerPipe(RegexNerConfig(label_mapping={"DATE": None, "PHONE": "TEL"}))
    spec = dump_pipe(p1)
    p2 = load_pipe(spec)
    assert isinstance(p2, RegexNerPipe)
    assert p2.label_mapping == {"DATE": None, "PHONE": "TEL"}
