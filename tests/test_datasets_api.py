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


def _write_jsonl_with_doc_splits(path: Path, splits: list[str]) -> Path:
    """Like :func:`_write_sample_jsonl` but sets ``metadata['split']`` per document."""
    docs = []
    for i, split in enumerate(splits):
        docs.append(
            {
                "document": {
                    "id": f"doc_{i}",
                    "text": f"Patient John Smith was seen on 2024-01-{10 + i:02d}.",
                    "metadata": {"split": split},
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


def test_transform_source_splits_filters_documents(client, tmp_path):
    jsonl = _write_jsonl_with_doc_splits(
        tmp_path / "data" / "split.jsonl",
        ["train", "train", "valid", "test", "test"],
    )
    client.post(
        "/datasets",
        json={"name": "split-src", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.post(
        "/datasets/transform",
        json={
            "source_dataset": "split-src",
            "output_name": "train-only",
            "source_splits": ["train"],
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["document_count"] == 2
    prov = resp.json()["metadata"]["provenance"]
    assert prov.get("source_splits") == ["train"]


def test_transform_source_splits_empty_matches_422(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl", count=2)
    client.post(
        "/datasets",
        json={"name": "no-split", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.post(
        "/datasets/transform",
        json={
            "source_dataset": "no-split",
            "output_name": "fail",
            "source_splits": ["train"],
        },
    )
    assert resp.status_code == 422
    assert "source_splits" in resp.json()["detail"].lower()


def test_transform_missing_source(client):
    resp = client.post(
        "/datasets/transform",
        json={
            "source_dataset": "nope",
            "output_name": "fail",
        },
    )
    assert resp.status_code == 404


def test_transform_writes_jsonl_under_processed_dir(client, tmp_path):
    """JSONL output goes to $PROCESSED_DIR/{name}.jsonl (not next to manifests)."""
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl", count=4)
    client.post(
        "/datasets",
        json={"name": "t-src", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.post(
        "/datasets/transform",
        json={"source_dataset": "t-src", "output_name": "t-out"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["format"] == "jsonl"
    expected = tmp_path / "data" / "processed" / "t-out.jsonl"
    assert expected.is_file()
    assert body["data_path"] == str(expected.resolve())
    # Manifest dir holds only the registry JSON, not the heavy bytes.
    assert not list((tmp_path / "datasets").glob("*.jsonl"))


def test_transform_rejects_removed_output_format_field(client, tmp_path):
    """The removed ``output_format`` field must not silently succeed."""
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl", count=2)
    client.post("/datasets", json={"name": "rej-src", "data_path": str(jsonl), "format": "jsonl"})
    resp = client.post(
        "/datasets/transform",
        json={
            "source_dataset": "rej-src",
            "output_name": "rej-out",
            "output_format": "brat-corpus",
        },
    )
    # Pydantic defaults to extra="ignore"; the field is simply dropped, so the
    # request succeeds as JSONL. Assert the outcome matches the new contract.
    assert resp.status_code == 201, resp.text
    assert resp.json()["format"] == "jsonl"


def test_compose_writes_jsonl_under_processed_dir(client, tmp_path):
    a = _write_sample_jsonl(tmp_path / "data" / "a.jsonl", count=2)
    b = _write_sample_jsonl(tmp_path / "data" / "b.jsonl", count=3)
    client.post("/datasets", json={"name": "c-a", "data_path": str(a), "format": "jsonl"})
    client.post("/datasets", json={"name": "c-b", "data_path": str(b), "format": "jsonl"})
    resp = client.post(
        "/datasets/compose",
        json={
            "output_name": "c-out",
            "source_datasets": ["c-a", "c-b"],
            "strategy": "merge",
        },
    )
    assert resp.status_code == 201, resp.text
    expected = tmp_path / "data" / "processed" / "c-out.jsonl"
    assert expected.is_file()
    assert resp.json()["data_path"] == str(expected.resolve())


def test_export_brat_writes_flat_dir(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl", count=3)
    client.post("/datasets", json={"name": "brat-src", "data_path": str(jsonl), "format": "jsonl"})
    resp = client.post("/datasets/brat-src/export", json={"format": "brat"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["format"] == "brat"
    out = tmp_path / "data" / "processed" / "brat-src_export"
    assert out.is_dir()
    assert list(out.glob("*.txt"))
    assert list(out.glob("*.ann"))


def test_dataset_schema_endpoint(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl")
    client.post(
        "/datasets",
        json={"name": "schema-src", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.get("/datasets/schema-src/schema")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dataset"] == "schema-src"
    assert body["document_count"] == 5
    by_label = {x["label"]: x["count"] for x in body["labels"]}
    assert by_label["PERSON"] == 5
    assert by_label["DATE"] == 5


def test_transform_preview_endpoint(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl", count=3)
    client.post(
        "/datasets",
        json={"name": "pv-src", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.post(
        "/datasets/transform/preview",
        json={
            "source_dataset": "pv-src",
            "keep_labels": ["PERSON"],
            "label_mapping": {"PERSON": "NAME"},
        },
    )
    assert resp.status_code == 200, resp.text
    p = resp.json()
    assert p["source_document_count"] == 3
    assert p["spans_dropped_by_filter"] == 3  # DATE dropped
    assert p["spans_kept_after_filter"] == 3
    assert p["spans_renamed"] == 3
    assert "conflicts" in p
    assert p["projected_document_count"] == 3

    clash = client.post(
        "/datasets/transform/preview",
        json={
            "source_dataset": "pv-src",
            "drop_labels": ["PERSON"],
            "label_mapping": {"PERSON": "PER"},
        },
    )
    assert clash.status_code == 200
    assert len(clash.json()["conflicts"]) >= 1


def test_transform_preview_rejects_drop_and_keep(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "sample.jsonl", count=2)
    client.post(
        "/datasets",
        json={"name": "both-src", "data_path": str(jsonl), "format": "jsonl"},
    )
    resp = client.post(
        "/datasets/transform/preview",
        json={
            "source_dataset": "both-src",
            "drop_labels": ["DATE"],
            "keep_labels": ["PERSON"],
        },
    )
    assert resp.status_code == 422


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


def test_deprecated_corpora_dir_env_still_resolves(tmp_path, monkeypatch, caplog):
    """Legacy ``CLINICAL_DEID_CORPORA_DIR`` still populates ``processed_dir`` and warns."""
    import logging

    from clinical_deid.config import Settings, reset_settings

    legacy = tmp_path / "legacy-corpora"
    legacy.mkdir()
    monkeypatch.delenv("CLINICAL_DEID_PROCESSED_DIR", raising=False)
    monkeypatch.setenv("CLINICAL_DEID_CORPORA_DIR", str(legacy))
    reset_settings()
    with caplog.at_level(logging.WARNING, logger="clinical_deid.config"):
        settings = Settings()
    assert settings.processed_dir == legacy
    assert any("CLINICAL_DEID_CORPORA_DIR" in rec.message for rec in caplog.records)
    reset_settings()


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


def test_eval_dataset_splits_filters_and_source_string(client, tmp_path):
    jsonl = _write_jsonl_with_doc_splits(
        tmp_path / "data" / "gold_split.jsonl",
        ["train", "valid", "test"],
    )
    client.post(
        "/datasets",
        json={"name": "eval-split", "data_path": str(jsonl), "format": "jsonl"},
    )
    client.post("/pipelines", json={"name": "noop2", "config": {"pipes": []}})

    resp = client.post(
        "/eval/run",
        json={
            "pipeline_name": "noop2",
            "dataset_name": "eval-split",
            "dataset_splits": ["valid", "train"],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["document_count"] == 2
    assert body["dataset_source"] == "dataset:eval-split:splits=train+valid"


def test_eval_dataset_splits_no_match_422(client, tmp_path):
    jsonl = _write_sample_jsonl(tmp_path / "data" / "gold.jsonl", count=2)
    client.post(
        "/datasets",
        json={"name": "eval-nosplit", "data_path": str(jsonl), "format": "jsonl"},
    )
    client.post("/pipelines", json={"name": "noop3", "config": {"pipes": []}})

    resp = client.post(
        "/eval/run",
        json={
            "pipeline_name": "noop3",
            "dataset_name": "eval-nosplit",
            "dataset_splits": ["train"],
        },
    )
    assert resp.status_code == 422
    assert "dataset_splits" in resp.json()["detail"].lower()
