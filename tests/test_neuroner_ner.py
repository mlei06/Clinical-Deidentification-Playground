"""Tests for the neuroner_ner detector pipe.

All tests use mocked subprocess communication — no Python 3.7 venv or
TensorFlow required.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from clinical_deid.domain import AnnotatedDocument, Document, PHISpan
from clinical_deid.pipes.neuroner_ner.pipe import (
    DEFAULT_ENTITY_MAP,
    NeuroNerConfig,
    NeuroNerPipe,
)


def _make_doc(text: str, doc_id: str = "test") -> AnnotatedDocument:
    return AnnotatedDocument(document=Document(id=doc_id, text=text), spans=[])


# ── Config tests ───────────────────────────────────────────────────────────


def test_config_defaults() -> None:
    cfg = NeuroNerConfig()
    assert cfg.model == "i2b2_2014_glove_spacy_bioes"
    assert cfg.source_name == "neuroner_ner"
    assert cfg.entity_map == DEFAULT_ENTITY_MAP


def test_config_custom_model() -> None:
    cfg = NeuroNerConfig(model="mimic_glove_spacy_bioes")
    assert cfg.model == "mimic_glove_spacy_bioes"


def test_registry_roundtrip() -> None:
    """Pipe can be loaded from JSON config via the registry."""
    from clinical_deid.pipes.registry import load_pipe

    spec = {
        "type": "neuroner_ner",
        "config": {"model": "i2b2_2014_glove_spacy_bioes"},
    }
    pipe = load_pipe(spec)
    assert isinstance(pipe, NeuroNerPipe)
    assert pipe._config.model == "i2b2_2014_glove_spacy_bioes"


def test_serialization_roundtrip() -> None:
    """Pipe can be serialized back to JSON via the registry."""
    from clinical_deid.pipes.registry import dump_pipe, load_pipe

    spec = {
        "type": "neuroner_ner",
        "config": {"model": "mimic_glove_spacy_bioes"},
    }
    pipe = load_pipe(spec)
    dumped = dump_pipe(pipe)
    assert dumped["type"] == "neuroner_ner"
    assert dumped["config"]["model"] == "mimic_glove_spacy_bioes"


# ── Entity map coverage ───────────────────────────────────────────────────


I2B2_LABELS = {
    "AGE", "BIOID", "CITY", "COUNTRY", "DATE", "DEVICE", "DOCTOR", "EMAIL",
    "FAX", "HEALTHPLAN", "HOSPITAL", "IDNUM", "LOCATION_OTHER",
    "MEDICALRECORD", "ORGANIZATION", "PATIENT", "PHONE", "PROFESSION",
    "STATE", "STREET", "URL", "USERNAME", "ZIP",
}


def test_default_entity_map_covers_i2b2_labels() -> None:
    """Every i2b2 2014 label has a mapping in DEFAULT_ENTITY_MAP."""
    assert I2B2_LABELS == set(DEFAULT_ENTITY_MAP.keys())


def test_default_entity_map_values_are_nonempty() -> None:
    for k, v in DEFAULT_ENTITY_MAP.items():
        assert isinstance(v, str) and len(v) > 0, f"Bad mapping for {k}: {v!r}"


# ── Forward with mocked subprocess ─────────────────────────────────────────


@pytest.fixture()
def pipe_with_mock():
    """Create a NeuroNerPipe with mocked subprocess methods."""
    pipe = NeuroNerPipe(NeuroNerConfig())
    pipe._model_labels = list(I2B2_LABELS)
    return pipe


def test_forward_maps_entities(pipe_with_mock: NeuroNerPipe) -> None:
    pipe = pipe_with_mock
    fake_response = {
        "entities": [
            {"id": "T1", "type": "DOCTOR", "start": 8, "end": 18, "text": "John Smith"},
            {"id": "T2", "type": "DATE", "start": 32, "end": 42, "text": "01/15/2023"},
        ]
    }
    with patch.object(pipe, "_ensure_subprocess", return_value=None), \
         patch.object(pipe, "_send_request", return_value=fake_response):
        doc = _make_doc("Patient John Smith admitted on 01/15/2023 for surgery.")
        result = pipe.forward(doc)

    assert len(result.spans) == 2
    labels = {s.label for s in result.spans}
    assert "NAME" in labels  # DOCTOR mapped to NAME
    assert "DATE" in labels
    assert all(s.source == "neuroner_ner" for s in result.spans)


def test_forward_empty_text(pipe_with_mock: NeuroNerPipe) -> None:
    pipe = pipe_with_mock
    doc = _make_doc("")
    result = pipe.forward(doc)
    assert result.spans == []


def test_forward_whitespace_only(pipe_with_mock: NeuroNerPipe) -> None:
    pipe = pipe_with_mock
    doc = _make_doc("   \n  ")
    result = pipe.forward(doc)
    assert result.spans == []


def test_forward_skips_invalid_offsets(pipe_with_mock: NeuroNerPipe) -> None:
    """Entities with out-of-range offsets are silently dropped."""
    pipe = pipe_with_mock
    fake_response = {
        "entities": [
            {"id": "T1", "type": "DOCTOR", "start": 0, "end": 5, "text": "Hello"},
            {"id": "T2", "type": "DATE", "start": 0, "end": 999, "text": "bad"},
        ]
    }
    with patch.object(pipe, "_ensure_subprocess", return_value=None), \
         patch.object(pipe, "_send_request", return_value=fake_response):
        doc = _make_doc("Hello world")
        result = pipe.forward(doc)

    assert len(result.spans) == 1
    assert result.spans[0].label == "NAME"


def test_forward_unmapped_label_passes_through(pipe_with_mock: NeuroNerPipe) -> None:
    """Entity labels not in entity_map pass through unchanged."""
    pipe = pipe_with_mock
    fake_response = {
        "entities": [
            {"id": "T1", "type": "UNKNOWN_LABEL", "start": 0, "end": 5, "text": "Hello"},
        ]
    }
    with patch.object(pipe, "_ensure_subprocess", return_value=None), \
         patch.object(pipe, "_send_request", return_value=fake_response):
        doc = _make_doc("Hello world")
        result = pipe.forward(doc)

    assert len(result.spans) == 1
    assert result.spans[0].label == "UNKNOWN_LABEL"


def test_forward_with_label_mapping() -> None:
    """label_mapping (post-entity_map) drops or remaps labels."""
    config = NeuroNerConfig(label_mapping={"NAME": None, "DATE": "TEMPORAL"})
    pipe = NeuroNerPipe(config)
    pipe._model_labels = list(I2B2_LABELS)

    fake_response = {
        "entities": [
            {"id": "T1", "type": "DOCTOR", "start": 8, "end": 18, "text": "John Smith"},
            {"id": "T2", "type": "DATE", "start": 32, "end": 42, "text": "01/15/2023"},
        ]
    }
    with patch.object(pipe, "_ensure_subprocess", return_value=None), \
         patch.object(pipe, "_send_request", return_value=fake_response):
        doc = _make_doc("Patient John Smith admitted on 01/15/2023 for surgery.")
        result = pipe.forward(doc)

    # NAME was dropped (mapped to None), DATE was remapped to TEMPORAL
    assert len(result.spans) == 1
    assert result.spans[0].label == "TEMPORAL"


def test_forward_accumulates_with_existing_spans() -> None:
    """New spans are accumulated with pre-existing document spans."""
    pipe = NeuroNerPipe(NeuroNerConfig())
    pipe._model_labels = list(I2B2_LABELS)

    existing = PHISpan(start=0, end=7, label="NAME", source="other_detector")
    doc = AnnotatedDocument(
        document=Document(id="test", text="Patient John Smith was seen on 01/15/2023."),
        spans=[existing],
    )
    fake_response = {
        "entities": [
            {"id": "T1", "type": "DATE", "start": 31, "end": 41, "text": "01/15/2023"},
        ]
    }
    with patch.object(pipe, "_ensure_subprocess", return_value=None), \
         patch.object(pipe, "_send_request", return_value=fake_response):
        result = pipe.forward(doc)

    assert len(result.spans) == 2
    sources = {s.source for s in result.spans}
    assert "other_detector" in sources
    assert "neuroner_ner" in sources


# ── Label introspection ────────────────────────────────────────────────────


def test_model_labels_returns_cached() -> None:
    pipe = NeuroNerPipe(NeuroNerConfig())
    pipe._model_labels = ["AGE", "DATE", "DOCTOR"]
    with patch.object(pipe, "_ensure_subprocess", return_value=None):
        labels = pipe.model_labels()
    assert labels == ["AGE", "DATE", "DOCTOR"]


def test_base_labels_from_entity_map() -> None:
    pipe = NeuroNerPipe(NeuroNerConfig())
    bl = pipe.base_labels
    # Should include both keys (raw labels) and values (mapped labels)
    assert "DOCTOR" in bl
    assert "NAME" in bl
    assert "DATE" in bl


def test_effective_labels_with_mapping() -> None:
    config = NeuroNerConfig(label_mapping={"NAME": "PERSON", "DATE": None})
    pipe = NeuroNerPipe(config)
    eff = pipe.labels
    assert "PERSON" in eff
    assert "DATE" not in eff  # dropped by label_mapping
