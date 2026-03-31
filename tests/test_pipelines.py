"""Tests for pipeline CRUD and process endpoints."""

from __future__ import annotations

# Default: union of regex patterns + list phrases (replaces monolithic ``regex_ner``).
PARALLEL_REGEX_LIST = {
    "pipes": [
        {
            "type": "parallel",
            "strategy": "union",
            "detectors": [
                {"type": "regex_ner"},
                {"type": "whitelist"},
            ],
        }
    ]
}
LABEL_MAPPER_CONFIG = {
    "pipes": [
        {
            "type": "parallel",
            "strategy": "union",
            "detectors": [
                {"type": "regex_ner"},
                {"type": "whitelist"},
            ],
        },
        {"type": "label_mapper", "config": {"mapping": {"PHONE": "TELEPHONE"}}},
    ]
}
LABEL_FILTER_DROP_CONFIG = {
    "pipes": [
        {
            "type": "parallel",
            "strategy": "union",
            "detectors": [
                {"type": "regex_ner"},
                {"type": "whitelist"},
            ],
        },
        {"type": "label_filter", "config": {"drop": ["DATE"]}},
    ]
}
LABEL_FILTER_KEEP_CONFIG = {
    "pipes": [
        {
            "type": "parallel",
            "strategy": "union",
            "detectors": [
                {"type": "regex_ner"},
                {"type": "whitelist"},
            ],
        },
        {"type": "label_filter", "config": {"keep": ["PHONE"]}},
    ]
}


# ---------------------------------------------------------------------------
# Pipeline CRUD
# ---------------------------------------------------------------------------


def test_create_pipeline(client) -> None:
    r = client.post(
        "/pipelines",
        json={"name": "test-regex", "description": "regex only", "config": PARALLEL_REGEX_LIST},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "test-regex"
    assert body["description"] == "regex only"
    assert body["latest_version"] == 1
    assert body["is_active"] is True
    assert body["current_version"]["version"] == 1
    assert body["current_version"]["config"] == PARALLEL_REGEX_LIST


def test_create_pipeline_duplicate_name(client) -> None:
    client.post(
        "/pipelines",
        json={"name": "dup", "config": PARALLEL_REGEX_LIST},
    )
    r = client.post(
        "/pipelines",
        json={"name": "dup", "config": PARALLEL_REGEX_LIST},
    )
    assert r.status_code == 409


def test_create_pipeline_invalid_config(client) -> None:
    r = client.post(
        "/pipelines",
        json={"name": "bad", "config": {"pipes": [{"type": "nonexistent_pipe"}]}},
    )
    assert r.status_code == 422


def test_list_pipelines(client) -> None:
    client.post("/pipelines", json={"name": "p1", "config": PARALLEL_REGEX_LIST})
    client.post("/pipelines", json={"name": "p2", "config": PARALLEL_REGEX_LIST})
    r = client.get("/pipelines")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_get_pipeline(client) -> None:
    r = client.post("/pipelines", json={"name": "get-me", "config": PARALLEL_REGEX_LIST})
    pid = r.json()["id"]
    r = client.get(f"/pipelines/{pid}")
    assert r.status_code == 200
    assert r.json()["name"] == "get-me"
    assert r.json()["current_version"]["config"] == PARALLEL_REGEX_LIST


def test_get_pipeline_not_found(client) -> None:
    r = client.get("/pipelines/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


def test_update_pipeline_description(client) -> None:
    r = client.post("/pipelines", json={"name": "upd", "config": PARALLEL_REGEX_LIST})
    pid = r.json()["id"]
    r = client.put(f"/pipelines/{pid}", json={"description": "updated desc"})
    assert r.status_code == 200
    assert r.json()["description"] == "updated desc"
    assert r.json()["latest_version"] == 1  # no config change, same version


def test_update_pipeline_config_creates_new_version(client) -> None:
    r = client.post("/pipelines", json={"name": "versioned", "config": PARALLEL_REGEX_LIST})
    pid = r.json()["id"]
    v1_hash = r.json()["current_version"]["config_hash"]

    r = client.put(f"/pipelines/{pid}", json={"config": LABEL_MAPPER_CONFIG})
    assert r.status_code == 200
    assert r.json()["latest_version"] == 2
    assert r.json()["current_version"]["version"] == 2
    assert r.json()["current_version"]["config"] == LABEL_MAPPER_CONFIG
    assert r.json()["current_version"]["config_hash"] != v1_hash


def test_update_pipeline_same_config_no_new_version(client) -> None:
    r = client.post("/pipelines", json={"name": "no-dup", "config": PARALLEL_REGEX_LIST})
    pid = r.json()["id"]
    r = client.put(f"/pipelines/{pid}", json={"config": PARALLEL_REGEX_LIST})
    assert r.status_code == 200
    assert r.json()["latest_version"] == 1  # same hash, no bump


def test_update_pipeline_invalid_config(client) -> None:
    r = client.post("/pipelines", json={"name": "bad-upd", "config": PARALLEL_REGEX_LIST})
    pid = r.json()["id"]
    r = client.put(f"/pipelines/{pid}", json={"config": {"pipes": [{"type": "bad"}]}})
    assert r.status_code == 422


def test_delete_pipeline(client) -> None:
    r = client.post("/pipelines", json={"name": "del-me", "config": PARALLEL_REGEX_LIST})
    pid = r.json()["id"]
    r = client.delete(f"/pipelines/{pid}")
    assert r.status_code == 204

    r = client.get(f"/pipelines/{pid}")
    assert r.status_code == 404

    r = client.get("/pipelines")
    assert len(r.json()) == 0


def test_validate_pipeline(client) -> None:
    r = client.post("/pipelines", json={"name": "val", "config": PARALLEL_REGEX_LIST})
    pid = r.json()["id"]

    r = client.post(f"/pipelines/{pid}/validate", json={"config": LABEL_MAPPER_CONFIG})
    assert r.status_code == 200
    assert r.json()["valid"] is True

    r = client.post(
        f"/pipelines/{pid}/validate",
        json={"config": {"pipes": [{"type": "nope"}]}},
    )
    assert r.status_code == 200
    assert r.json()["valid"] is False
    assert r.json()["error"] is not None


# ---------------------------------------------------------------------------
# Process endpoint
# ---------------------------------------------------------------------------


def _create_pipeline(client, name="proc-pipe", config=None):
    config = config or PARALLEL_REGEX_LIST
    r = client.post("/pipelines", json={"name": name, "config": config})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_process_text(client) -> None:
    pid = _create_pipeline(client)
    r = client.post(
        f"/process/{pid}",
        json={"text": "Call 555-123-4567 on 12/25/2024."},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pipeline_id"] == pid
    assert body["pipeline_name"] == "proc-pipe"
    assert body["pipeline_version"] == 1
    assert len(body["spans"]) >= 1
    assert body["original_text"] == "Call 555-123-4567 on 12/25/2024."
    assert body["redacted_text"] != body["original_text"]
    assert body["processing_time_ms"] > 0

    # Check span text matches the substring
    for span in body["spans"]:
        assert span["text"] == body["original_text"][span["start"] : span["end"]]


def test_process_text_with_request_id(client) -> None:
    pid = _create_pipeline(client, name="proc-reqid")
    r = client.post(
        f"/process/{pid}",
        json={"text": "No PHI here.", "request_id": "my-custom-id"},
    )
    assert r.status_code == 200
    assert r.json()["request_id"] == "my-custom-id"


def test_process_not_found(client) -> None:
    r = client.post(
        "/process/00000000-0000-0000-0000-000000000000",
        json={"text": "hello"},
    )
    assert r.status_code == 404


def test_process_deleted_pipeline(client) -> None:
    pid = _create_pipeline(client, name="proc-del")
    client.delete(f"/pipelines/{pid}")
    r = client.post(f"/process/{pid}", json={"text": "hello"})
    assert r.status_code == 404


def test_process_batch(client) -> None:
    pid = _create_pipeline(client, name="proc-batch")
    r = client.post(
        f"/process/{pid}/batch",
        json={
            "items": [
                {"text": "Call 555-123-4567."},
                {"text": "Email me at jane@hospital.org."},
                {"text": "No PHI here."},
            ]
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["results"]) == 3
    assert body["total_processing_time_ms"] > 0

    # First item should have phone span
    assert len(body["results"][0]["spans"]) >= 1
    # Third item — no PHI
    assert body["results"][2]["redacted_text"] == "No PHI here."


def test_process_with_label_filter_drop(client) -> None:
    pid = _create_pipeline(client, name="proc-filter-drop", config=LABEL_FILTER_DROP_CONFIG)
    r = client.post(f"/process/{pid}", json={"text": "Call 555-123-4567 on 12/25/2024."})
    assert r.status_code == 200
    body = r.json()
    labels = {s["label"] for s in body["spans"]}
    assert "DATE" not in labels
    assert "PHONE" in labels


def test_process_with_label_filter_keep(client) -> None:
    pid = _create_pipeline(client, name="proc-filter-keep", config=LABEL_FILTER_KEEP_CONFIG)
    r = client.post(f"/process/{pid}", json={"text": "Call 555-123-4567 on 12/25/2024."})
    assert r.status_code == 200
    body = r.json()
    labels = {s["label"] for s in body["spans"]}
    assert labels == {"PHONE"}


def test_process_with_label_mapper_pipeline(client) -> None:
    pid = _create_pipeline(client, name="proc-mapper", config=LABEL_MAPPER_CONFIG)
    r = client.post(f"/process/{pid}", json={"text": "Call 555-123-4567."})
    assert r.status_code == 200
    body = r.json()
    # PHONE should be remapped to TELEPHONE
    phone_spans = [s for s in body["spans"] if s["label"] == "TELEPHONE"]
    assert len(phone_spans) >= 1


# ---------------------------------------------------------------------------
# Pipe type catalog
# ---------------------------------------------------------------------------


def test_list_pipe_types(client) -> None:
    r = client.get("/pipelines/pipe-types")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    assert len(body) >= 3  # at least pattern, list, label_mapper, label_filter

    names = {entry["name"] for entry in body}
    assert "regex_ner" in names
    assert "whitelist" in names
    assert "blacklist" in names
    assert "label_mapper" in names
    assert "label_filter" in names

    for entry in body:
        assert "installed" in entry
        assert "role" in entry
        assert "install_hint" in entry
        assert "description" in entry
        # Installed pipes should have a config schema
        if entry["installed"]:
            assert entry["config_schema"] is not None
            assert "properties" in entry["config_schema"]
