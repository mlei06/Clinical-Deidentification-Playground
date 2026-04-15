"""Tests for custom_ner pipe (model loading from models/ directory)."""

from __future__ import annotations

import json

import pytest

from clinical_deid.domain import AnnotatedDocument, Document, PHISpan
from clinical_deid.pipes.custom_ner.pipe import CustomNerConfig, CustomNerPipe


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def model_dir(tmp_path, monkeypatch):
    """Create a fake spaCy model directory with manifest."""
    models_dir = tmp_path / "models"
    spacy_dir = models_dir / "spacy" / "test-model"
    spacy_dir.mkdir(parents=True)

    manifest = {
        "name": "test-model",
        "framework": "spacy",
        "labels": ["PERSON", "DATE", "LOCATION"],
        "description": "Test NER model",
        "device": "cpu",
    }
    (spacy_dir / "model_manifest.json").write_text(json.dumps(manifest))

    monkeypatch.setenv("CLINICAL_DEID_MODELS_DIR", str(models_dir))
    from clinical_deid.config import reset_settings
    reset_settings()

    return models_dir


@pytest.fixture
def hf_model_dir(tmp_path, monkeypatch):
    """Create a fake HuggingFace model directory with manifest."""
    models_dir = tmp_path / "models"
    hf_dir = models_dir / "huggingface" / "test-hf-model"
    hf_dir.mkdir(parents=True)

    manifest = {
        "name": "test-hf-model",
        "framework": "huggingface",
        "labels": ["PERSON", "DATE"],
        "description": "Test HF NER model",
        "device": "cpu",
    }
    (hf_dir / "model_manifest.json").write_text(json.dumps(manifest))

    monkeypatch.setenv("CLINICAL_DEID_MODELS_DIR", str(models_dir))
    from clinical_deid.config import reset_settings
    reset_settings()

    return models_dir


# ---------------------------------------------------------------------------
# Config tests
# ---------------------------------------------------------------------------


def test_config_defaults():
    cfg = CustomNerConfig(model_name="my-model")
    assert cfg.model_name == "my-model"
    assert cfg.framework is None
    assert cfg.confidence_threshold == 0.0
    assert cfg.device == "cpu"
    assert cfg.label_mapping == {}


def test_config_with_framework():
    cfg = CustomNerConfig(model_name="my-model", framework="spacy")
    assert cfg.framework == "spacy"


def test_config_with_threshold():
    cfg = CustomNerConfig(model_name="m", confidence_threshold=0.5)
    assert cfg.confidence_threshold == 0.5


# ---------------------------------------------------------------------------
# Label resolution
# ---------------------------------------------------------------------------


def test_base_labels_from_manifest(model_dir):
    pipe = CustomNerPipe(CustomNerConfig(model_name="test-model"))
    assert pipe.base_labels == {"PERSON", "DATE", "LOCATION"}


def test_labels_with_mapping(model_dir):
    pipe = CustomNerPipe(CustomNerConfig(
        model_name="test-model",
        label_mapping={"PERSON": "NAME", "LOCATION": None},
    ))
    assert "NAME" in pipe.labels
    assert "DATE" in pipe.labels
    assert "LOCATION" not in pipe.labels
    assert "PERSON" not in pipe.labels


def test_base_labels_missing_model():
    """base_labels returns empty set when model doesn't exist."""
    pipe = CustomNerPipe(CustomNerConfig(model_name="nonexistent"))
    assert pipe.base_labels == set()


# ---------------------------------------------------------------------------
# Framework mismatch
# ---------------------------------------------------------------------------


def test_framework_mismatch_raises(model_dir):
    pipe = CustomNerPipe(CustomNerConfig(
        model_name="test-model",
        framework="huggingface",
    ))
    doc = AnnotatedDocument(
        document=Document(id="t", text="Hello"),
        spans=[],
    )
    with pytest.raises(ValueError, match="framework='huggingface'"):
        pipe.forward(doc)


# ---------------------------------------------------------------------------
# Pipe catalog registration
# ---------------------------------------------------------------------------


def test_custom_ner_in_catalog():
    from clinical_deid.pipes.registry import pipe_catalog

    names = [e.name for e in pipe_catalog()]
    assert "custom_ner" in names


def test_custom_ner_registered():
    from clinical_deid.pipes.registry import registered_pipes

    assert "custom_ner" in registered_pipes()


# ---------------------------------------------------------------------------
# JSON round-trip
# ---------------------------------------------------------------------------


def test_load_pipe_custom_ner():
    """Verify custom_ner can be loaded from a JSON spec (will fail on forward without a real model)."""
    from clinical_deid.pipes.registry import load_pipe

    pipe = load_pipe({
        "type": "custom_ner",
        "config": {"model_name": "my-model"},
    })
    assert isinstance(pipe, CustomNerPipe)


def test_dump_pipe_custom_ner(model_dir):
    from clinical_deid.pipes.registry import dump_pipe

    pipe = CustomNerPipe(CustomNerConfig(model_name="test-model"))
    dumped = dump_pipe(pipe)
    assert dumped["type"] == "custom_ner"
    assert dumped["config"]["model_name"] == "test-model"
