from __future__ import annotations

from clinical_deid.domain import AnnotatedDocument, Document
from clinical_deid.pipes.pydeid_ner import PyDeidNerConfig, PyDeidNerPipe


def _make_doc(text: str, doc_id: str = "test") -> AnnotatedDocument:
    return AnnotatedDocument(document=Document(id=doc_id, text=text), spans=[])


def test_pydeid_detects_date() -> None:
    pipe = PyDeidNerPipe(PyDeidNerConfig(phi_types=["dates"]))
    doc = _make_doc("Patient was admitted on 01/15/2023 for surgery.")
    result = pipe.forward(doc)
    assert len(result.spans) >= 1
    date_spans = [s for s in result.spans if s.label == "DATE"]
    assert len(date_spans) >= 1
    assert result.spans[0].source == "pydeid"


def test_pydeid_detects_phone() -> None:
    pipe = PyDeidNerPipe(PyDeidNerConfig(phi_types=["contact"]))
    doc = _make_doc("Call Dr. Smith at 416-555-1234 for follow-up.")
    result = pipe.forward(doc)
    phone_spans = [s for s in result.spans if s.label == "PHONE"]
    assert len(phone_spans) >= 1


def test_pydeid_empty_text() -> None:
    pipe = PyDeidNerPipe(PyDeidNerConfig(phi_types=["dates"]))
    doc = _make_doc("")
    result = pipe.forward(doc)
    assert result.spans == []


def test_pydeid_custom_label_rules() -> None:
    config = PyDeidNerConfig(
        phi_types=["dates"],
        label_rules=[("day/year", "MY_DATE"), ("month/year", "MY_DATE")],
    )
    pipe = PyDeidNerPipe(config)
    doc = _make_doc("Visit scheduled for 03/20/2024.")
    result = pipe.forward(doc)
    date_spans = [s for s in result.spans if s.label == "MY_DATE"]
    assert len(date_spans) >= 1


def test_pydeid_registry_roundtrip() -> None:
    """Pipe can be loaded from JSON config via the registry."""
    from clinical_deid.pipes.registry import load_pipe

    spec = {
        "type": "pydeid_ner",
        "config": {"phi_types": ["dates", "contact"]},
    }
    pipe = load_pipe(spec)
    assert isinstance(pipe, PyDeidNerPipe)
    assert pipe._config.phi_types == ["dates", "contact"]


def test_pydeid_serialization_roundtrip() -> None:
    """Pipe can be serialized back to JSON via the registry."""
    from clinical_deid.pipes.registry import dump_pipe, load_pipe

    spec = {
        "type": "pydeid_ner",
        "config": {"phi_types": ["dates"]},
    }
    pipe = load_pipe(spec)
    dumped = dump_pipe(pipe)
    assert dumped["type"] == "pydeid_ner"
    assert dumped["config"]["phi_types"] == ["dates"]
