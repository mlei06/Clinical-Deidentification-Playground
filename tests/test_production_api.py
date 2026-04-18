"""Tests for the production API surface."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def prod_client(tmp_path, monkeypatch):
    """Test client wired to the production app with isolated filesystem."""
    db_file = tmp_path / "test.sqlite"
    pipelines_dir = tmp_path / "pipelines"
    dictionaries_dir = tmp_path / "dictionaries"
    pipelines_dir.mkdir()
    dictionaries_dir.mkdir()

    monkeypatch.setenv("CLINICAL_DEID_DATABASE_URL", f"sqlite:///{db_file.as_posix()}")
    monkeypatch.setenv("CLINICAL_DEID_PIPELINES_DIR", str(pipelines_dir))
    monkeypatch.setenv("CLINICAL_DEID_DICTIONARIES_DIR", str(dictionaries_dir))

    from clinical_deid.config import reset_settings
    from clinical_deid.db import init_db, reset_engine

    reset_settings()
    reset_engine()
    init_db()

    # Write a test pipeline
    pipeline_config = {
        "pipes": [
            {"type": "regex_ner"},
            {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}},
        ]
    }
    (pipelines_dir / "test-regex.json").write_text(json.dumps(pipeline_config))

    # Write a modes config
    modes = {
        "modes": {
            "fast": {"pipeline": "test-regex", "description": "Test fast mode"},
            "accurate": {"pipeline": "test-regex", "description": "Test accurate mode"},
        },
        "default_mode": "fast",
    }
    modes_path = tmp_path / "modes.json"
    modes_path.write_text(json.dumps(modes))

    from clinical_deid.api.production import create_production_app

    app = create_production_app(modes_path=str(modes_path))

    with TestClient(app) as tc:
        yield tc


# -- Health -----------------------------------------------------------------


def test_health(prod_client):
    resp = prod_client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# -- Modes ------------------------------------------------------------------


def test_list_modes(prod_client):
    resp = prod_client.get("/modes")
    assert resp.status_code == 200
    data = resp.json()
    assert data["default_mode"] == "fast"
    names = [m["name"] for m in data["modes"]]
    assert "fast" in names
    assert "accurate" in names
    # Every mode ships availability info so the UI can gray out broken ones.
    for m in data["modes"]:
        assert "available" in m
        assert "missing" in m
    # Both modes back onto test-regex (regex_ner + resolve_spans) which is
    # always installed, so they should both report available.
    by_name = {m["name"]: m for m in data["modes"]}
    assert by_name["fast"]["available"] is True
    assert by_name["fast"]["missing"] == []


def test_list_modes_marks_broken_mode_unavailable(prod_client, tmp_path):
    """A mode whose pipeline file is missing reports ``available=False``."""
    # The fixture already created a pipelines/ dir. Point a new modes.json at
    # a non-existent pipeline and reload.
    import json

    modes = {
        "modes": {
            "fast": {"pipeline": "test-regex", "description": "ok"},
            "ghost": {"pipeline": "nope", "description": "missing pipeline"},
        },
        "default_mode": "fast",
    }
    modes_path = tmp_path / "modes_broken.json"
    modes_path.write_text(json.dumps(modes))

    from clinical_deid.api.production import create_production_app

    app = create_production_app(modes_path=str(modes_path))
    from fastapi.testclient import TestClient

    with TestClient(app) as tc:
        resp = tc.get("/modes")
        assert resp.status_code == 200
        by_name = {m["name"]: m for m in resp.json()["modes"]}
        assert by_name["ghost"]["available"] is False
        assert any(tag.startswith("pipeline:") for tag in by_name["ghost"]["missing"])


# -- Pipelines (read-only) -------------------------------------------------


def test_list_pipelines(prod_client):
    resp = prod_client.get("/pipelines")
    assert resp.status_code == 200
    pipelines = resp.json()
    assert len(pipelines) == 1
    assert pipelines[0]["name"] == "test-regex"
    assert pipelines[0]["pipe_count"] == 2


def test_get_pipeline(prod_client):
    resp = prod_client.get("/pipelines/test-regex")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "test-regex"
    assert "pipes" in data["config"]


def test_get_pipeline_not_found(prod_client):
    resp = prod_client.get("/pipelines/nonexistent")
    assert resp.status_code == 404


# -- No CRUD endpoints exposed ---------------------------------------------


def test_no_create_pipeline(prod_client):
    resp = prod_client.post("/pipelines", json={"name": "x", "config": {"pipes": []}})
    # Should be 405 (method not allowed) since POST is not mounted on /pipelines
    assert resp.status_code == 405


def test_no_delete_pipeline(prod_client):
    resp = prod_client.delete("/pipelines/test-regex")
    assert resp.status_code == 405


# -- Inference by mode ------------------------------------------------------


def test_infer_by_mode(prod_client):
    resp = prod_client.post("/infer/fast", json={"text": "Call John Smith at 555-123-4567."})
    assert resp.status_code == 200
    data = resp.json()
    assert data["pipeline_name"] == "test-regex"
    assert data["original_text"] == "Call John Smith at 555-123-4567."
    assert len(data["spans"]) > 0  # regex_ner should detect the phone number


# -- Inference by pipeline name ---------------------------------------------


def test_infer_by_pipeline_name(prod_client):
    resp = prod_client.post("/infer/test-regex", json={"text": "DOB: 01/15/1990"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["pipeline_name"] == "test-regex"


def test_infer_pipeline_not_found(prod_client):
    resp = prod_client.post("/infer/nonexistent", json={"text": "hello"})
    assert resp.status_code == 404


# -- Batch inference --------------------------------------------------------


def test_infer_batch(prod_client):
    resp = prod_client.post(
        "/infer/fast/batch",
        json={
            "items": [
                {"text": "Patient: Jane Doe"},
                {"text": "SSN: 123-45-6789"},
            ]
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 2
    assert data["total_processing_time_ms"] > 0


# -- Audit (read-only, shared router) --------------------------------------


def test_audit_logs_accessible(prod_client):
    # First run an inference to generate an audit record
    prod_client.post("/infer/fast", json={"text": "Test audit"})
    resp = prod_client.get("/audit/logs")
    assert resp.status_code == 200
    logs = resp.json()
    assert len(logs) >= 1
    assert logs[0]["source"] == "production-api"


def test_audit_stats(prod_client):
    resp = prod_client.get("/audit/stats")
    assert resp.status_code == 200
