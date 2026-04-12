"""Tests for the datasets API (register, CRUD, compose, transform, preview)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_sample_jsonl(path: Path, count: int = 5) -> Path:
    """Write a minimal annotated-document JSONL file and return its path."""
    docs = []
    for i in range(count):
        docs.append(
            {
                "document": {
                    "id": f"doc_{i}",
                    "text": f"Patient John Smith was seen on 2024-01-{10 + i:02d}.",
                    "metadata": {},
                },
                "spans": [
                    {"start": 8, "end": 18, "label": "PERSON", "source": "gold"},
                    {"start": 31, "end": 41, "label": "DATE", "source": "gold"},
                ],
            }
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(d) for d in docs) + "\n", encoding="utf-8"
    )
    return path


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def test_register_and_list(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl")
    resp = client.post(
        "/datasets",
        json={
            "name": "test-corpus",
            "data_path": str(jsonl),
            "format": "jsonl",
            "description": "A test corpus",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "test-corpus"
    assert body["document_count"] == 5
    assert body["total_spans"] == 10
    assert "PERSON" in body["labels"]
    assert "DATE" in body["labels"]
    assert body["analytics"]["document_count"] == 5

    # List
    resp = client.get("/datasets")
    assert resp.status_code == 200
    names = [d["name"] for d in resp.json()]
    assert "test-corpus" in names


def test_register_duplicate_rejected(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl")
    client.post(
        "/datasets",
        json={"name": "dup", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.post(
        "/datasets",
        json={"name": "dup", "data_path": str(jsonl), "format": "jsonl"},
    )
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Get / Update / Delete
# ---------------------------------------------------------------------------


def test_get_dataset(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl")
    client.post(
        "/datasets",
        json={"name": "get-me", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.get("/datasets/get-me")
    assert resp.status_code == 200
    assert resp.json()["document_count"] == 5


def test_get_missing_returns_404(client):
    resp = client.get("/datasets/nonexistent")
    assert resp.status_code == 404


def test_update_dataset(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl")
    client.post(
        "/datasets",
        json={"name": "upd", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.put(
        "/datasets/upd",
        json={"description": "Updated description", "metadata": {"tag": "v2"}},
    )
    assert resp.status_code == 200
    assert resp.json()["description"] == "Updated description"
    assert resp.json()["metadata"]["tag"] == "v2"


def test_delete_dataset(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl")
    client.post(
        "/datasets",
        json={"name": "del-me", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.delete("/datasets/del-me")
    assert resp.status_code == 204
    assert client.get("/datasets/del-me").status_code == 404


# ---------------------------------------------------------------------------
# Preview & document
# ---------------------------------------------------------------------------


def test_preview(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl")
    client.post(
        "/datasets",
        json={"name": "prev", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.get("/datasets/prev/preview?limit=3")
    assert resp.status_code == 200
    previews = resp.json()
    assert len(previews) == 3
    assert previews[0]["span_count"] == 2


def test_get_document(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl")
    client.post(
        "/datasets",
        json={"name": "docview", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.get("/datasets/docview/documents/doc_0")
    assert resp.status_code == 200
    body = resp.json()
    assert body["document_id"] == "doc_0"
    assert len(body["spans"]) == 2


def test_get_document_not_found(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl")
    client.post(
        "/datasets",
        json={"name": "docnf", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.get("/datasets/docnf/documents/nope")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Refresh analytics
# ---------------------------------------------------------------------------


def test_refresh_analytics(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl", count=3)
    client.post(
        "/datasets",
        json={"name": "ref", "data_path": str(jsonl), "format": "jsonl"},
    )
    # Append more data
    _write_sample_jsonl(tmp_path / "data" / "sample.jsonl", count=8)
    resp = client.post("/datasets/ref/refresh")
    assert resp.status_code == 200
    assert resp.json()["document_count"] == 8


# ---------------------------------------------------------------------------
# Compose
# ---------------------------------------------------------------------------


def test_compose_merge(client, tmp_path):
    a = _write_sample_jsonl(tmp_path / "data" / "a.jsonl", count=3)
    b = _write_sample_jsonl(tmp_path / "data" / "b.jsonl", count=4)
    client.post("/datasets", json={"name": "src-a", "data_path": str(a), "format": "jsonl"})
    client.post("/datasets", json={"name": "src-b", "data_path": str(b), "format": "jsonl"})

    resp = client.post(
        "/datasets/compose",
        json={
            "output_name": "merged",
            "source_datasets": ["src-a", "src-b"],
            "strategy": "merge",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "merged"
    assert body["document_count"] == 7
    assert body["metadata"]["provenance"]["composed_from"] == ["src-a", "src-b"]


def test_compose_proportional(client, tmp_path):
    a = _write_sample_jsonl(tmp_path / "data" / "a.jsonl", count=10)
    b = _write_sample_jsonl(tmp_path / "data" / "b.jsonl", count=10)
    client.post("/datasets", json={"name": "pa", "data_path": str(a), "format": "jsonl"})
    client.post("/datasets", json={"name": "pb", "data_path": str(b), "format": "jsonl"})

    resp = client.post(
        "/datasets/compose",
        json={
            "output_name": "prop-mix",
            "source_datasets": ["pa", "pb"],
            "strategy": "proportional",
            "weights": [0.7, 0.3],
            "target_documents": 10,
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["document_count"] == 10


def test_compose_missing_source(client, tmp_path):
    a = _write_sample_jsonl(tmp_path / "data" / "a.jsonl", count=2)
    client.post("/datasets", json={"name": "only", "data_path": str(a), "format": "jsonl"})
    resp = client.post(
        "/datasets/compose",
        json={
            "output_name": "bad",
            "source_datasets": ["only", "nonexistent"],
            "strategy": "merge",
        },
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Transform
# ---------------------------------------------------------------------------


def test_transform_filter_labels(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl", count=5)
    client.post(
        "/datasets",
        json={"name": "orig", "data_path": str(jsonl), "format": "jsonl"},
    )

    resp = client.post(
        "/datasets/transform",
        json={
            "source_dataset": "orig",
            "output_name": "persons-only",
            "keep_labels": ["PERSON"],
            "description": "Only PERSON entities",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "persons-only"
    assert body["labels"] == ["PERSON"]
    assert body["total_spans"] == 5  # 1 PERSON per doc


def test_transform_label_mapping(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl", count=3)
    client.post(
        "/datasets",
        json={"name": "map-src", "data_path": str(jsonl), "format": "jsonl"},
    )

    resp = client.post(
        "/datasets/transform",
        json={
            "source_dataset": "map-src",
            "output_name": "mapped",
            "label_mapping": {"PERSON": "NAME", "DATE": "TEMPORAL"},
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert sorted(body["labels"]) == ["NAME", "TEMPORAL"]


def test_transform_resize(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl", count=10)
    client.post(
        "/datasets",
        json={"name": "big", "data_path": str(jsonl), "format": "jsonl"},
    )

    resp = client.post(
        "/datasets/transform",
        json={
            "source_dataset": "big",
            "output_name": "small",
            "target_documents": 3,
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["document_count"] == 3


def test_transform_missing_source(client):
    resp = client.post(
        "/datasets/transform",
        json={
            "source_dataset": "nope",
            "output_name": "fail",
        },
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# dataset_store unit tests
# ---------------------------------------------------------------------------


def test_store_register_and_load(tmp_path):
    from clinical_deid.dataset_store import (
        delete_dataset,
        list_datasets,
        load_dataset_documents,
        load_dataset_manifest,
        register_dataset,
    )

    jsonl = _write_sample_jsonl(tmp_path / "data" / "corpus.jsonl", count=4)
    ds_dir = tmp_path / "datasets"
    ds_dir.mkdir()

    manifest = register_dataset(ds_dir, "unit-test", str(jsonl), "jsonl", description="test")
    assert manifest["document_count"] == 4
    assert manifest["name"] == "unit-test"

    # Load back
    loaded = load_dataset_manifest(ds_dir, "unit-test")
    assert loaded["document_count"] == 4

    # List
    datasets = list_datasets(ds_dir)
    assert len(datasets) == 1
    assert datasets[0].name == "unit-test"

    # Load documents
    docs = load_dataset_documents(ds_dir, "unit-test")
    assert len(docs) == 4

    # Delete
    delete_dataset(ds_dir, "unit-test")
    assert len(list_datasets(ds_dir)) == 0


def test_store_invalid_name(tmp_path):
    from clinical_deid.dataset_store import register_dataset

    jsonl = _write_sample_jsonl(tmp_path / "data" / "corpus.jsonl")
    ds_dir = tmp_path / "datasets"
    ds_dir.mkdir()

    with pytest.raises(ValueError, match="Invalid dataset name"):
        register_dataset(ds_dir, "../escape", str(jsonl), "jsonl")

    with pytest.raises(ValueError, match="Invalid dataset name"):
        register_dataset(ds_dir, "", str(jsonl), "jsonl")


# ---------------------------------------------------------------------------
# Eval integration with dataset_name
# ---------------------------------------------------------------------------


def test_eval_with_dataset_name(client, tmp_path):
    """Eval endpoint can reference a registered dataset by name."""
    jsonl = _write_sample_jsonl(tmp_path / "data" / "gold.jsonl", count=3)
    client.post(
        "/datasets",
        json={"name": "eval-gold", "data_path": str(jsonl), "format": "jsonl"},
    )

    # Create a trivial pipeline (no pipes = returns empty spans)
    client.post("/pipelines", json={"name": "noop", "config": {"pipes": []}})

    resp = client.post(
        "/eval/run",
        json={"pipeline_name": "noop", "dataset_name": "eval-gold"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["document_count"] == 3
    assert body["dataset_source"] == "dataset:eval-gold"
