"""Tests for the dataset export API endpoint."""

from __future__ import annotations

import json

import pytest


@pytest.fixture
def dataset_with_docs(client, tmp_path):
    """Register a test dataset via the API."""
    # Create a JSONL file with test data
    jsonl_path = tmp_path / "test_corpus.jsonl"
    docs = [
        {
            "document": {"id": "doc1", "text": "Patient John Smith DOB 01/15/1980"},
            "spans": [
                {"start": 8, "end": 18, "label": "NAME"},
                {"start": 23, "end": 33, "label": "DATE"},
            ],
        },
        {
            "document": {"id": "doc2", "text": "Dr. Jane Doe phone 555-1234"},
            "spans": [
                {"start": 4, "end": 12, "label": "NAME"},
                {"start": 19, "end": 27, "label": "PHONE"},
            ],
        },
    ]
    jsonl_path.write_text(
        "\n".join(json.dumps(d) for d in docs) + "\n",
        encoding="utf-8",
    )

    # Register the dataset
    resp = client.post("/datasets", json={
        "name": "test-export-ds",
        "data_path": str(jsonl_path),
        "format": "jsonl",
        "description": "Test dataset for export",
    })
    assert resp.status_code == 201
    return "test-export-ds"


def test_export_conll(client, dataset_with_docs):
    resp = client.post(
        f"/datasets/{dataset_with_docs}/export",
        json={"format": "conll"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["format"] == "conll"
    assert data["document_count"] == 2
    assert data["total_spans"] == 4
    assert data["path"].endswith(".conll")


def test_export_huggingface(client, dataset_with_docs):
    resp = client.post(
        f"/datasets/{dataset_with_docs}/export",
        json={"format": "huggingface"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["format"] == "huggingface"
    assert data["document_count"] == 2


def test_export_not_found(client):
    resp = client.post(
        "/datasets/nonexistent/export",
        json={"format": "conll"},
    )
    assert resp.status_code == 404


def test_export_custom_filename(client, dataset_with_docs):
    resp = client.post(
        f"/datasets/{dataset_with_docs}/export",
        json={"format": "conll", "filename": "custom.conll"},
    )
    assert resp.status_code == 200
    assert resp.json()["path"].endswith("custom.conll")
