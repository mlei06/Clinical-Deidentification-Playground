"""Tests for pipeline CRUD and process endpoints."""

from __future__ import annotations

# Default: regex + whitelist chained (detectors accumulate spans).
REGEX_WHITELIST = {
    "pipes": [
        {"type": "regex_ner"},
        {"type": "whitelist"},
    ]
}
LABEL_MAPPER_CONFIG = {
    "pipes": [
        {"type": "regex_ner"},
        {"type": "whitelist"},
        {"type": "label_mapper", "config": {"mapping": {"PHONE": "TELEPHONE"}}},
    ]
}
LABEL_FILTER_DROP_CONFIG = {
    "pipes": [
        {"type": "regex_ner"},
        {"type": "whitelist"},
        {"type": "label_filter", "config": {"drop": ["DATE"]}},
    ]
}
LABEL_FILTER_KEEP_CONFIG = {
    "pipes": [
        {"type": "regex_ner"},
        {"type": "whitelist"},
        {"type": "label_filter", "config": {"keep": ["PHONE"]}},
    ]
}


# ---------------------------------------------------------------------------
# Pipeline CRUD
# ---------------------------------------------------------------------------


def test_create_pipeline(client) -> None:
    r = client.post(
        "/pipelines",
        json={"name": "test-regex", "config": REGEX_WHITELIST},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "test-regex"
    assert body["config"]["pipes"] == REGEX_WHITELIST["pipes"]
    assert "output_label_space" in body["config"]
    assert isinstance(body["config"]["output_label_space"], list)
    assert "output_label_space_updated_at" in body["config"]


def test_create_pipeline_duplicate_name(client) -> None:
    client.post(
        "/pipelines",
        json={"name": "dup", "config": REGEX_WHITELIST},
    )
    r = client.post(
        "/pipelines",
        json={"name": "dup", "config": REGEX_WHITELIST},
    )
    assert r.status_code == 409


def test_create_pipeline_invalid_config(client) -> None:
    r = client.post(
        "/pipelines",
        json={"name": "bad", "config": {"pipes": [{"type": "nonexistent_pipe"}]}},
    )
    assert r.status_code == 422


def test_list_pipelines(client) -> None:
    client.post("/pipelines", json={"name": "p1", "config": REGEX_WHITELIST})
    client.post("/pipelines", json={"name": "p2", "config": REGEX_WHITELIST})
    r = client.get("/pipelines")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_get_pipeline(client) -> None:
    client.post("/pipelines", json={"name": "get-me", "config": REGEX_WHITELIST})
    r = client.get("/pipelines/get-me")
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "get-me"
    assert data["config"]["pipes"] == REGEX_WHITELIST["pipes"]
    assert "output_label_space" in data["config"]


def test_get_pipeline_not_found(client) -> None:
    r = client.get("/pipelines/nonexistent")
    assert r.status_code == 404


def test_update_pipeline_config(client) -> None:
    client.post("/pipelines", json={"name": "upd", "config": REGEX_WHITELIST})
    r = client.put("/pipelines/upd", json={"config": LABEL_MAPPER_CONFIG})
    assert r.status_code == 200
    cfg = r.json()["config"]
    assert cfg["pipes"] == LABEL_MAPPER_CONFIG["pipes"]
    assert "output_label_space" in cfg


def test_update_pipeline_not_found(client) -> None:
    r = client.put("/pipelines/nonexistent", json={"config": REGEX_WHITELIST})
    assert r.status_code == 404


def test_update_pipeline_invalid_config(client) -> None:
    client.post("/pipelines", json={"name": "bad-upd", "config": REGEX_WHITELIST})
    r = client.put("/pipelines/bad-upd", json={"config": {"pipes": [{"type": "bad"}]}})
    assert r.status_code == 422


def test_delete_pipeline(client) -> None:
    client.post("/pipelines", json={"name": "del-me", "config": REGEX_WHITELIST})
    r = client.delete("/pipelines/del-me")
    assert r.status_code == 204

    r = client.get("/pipelines/del-me")
    assert r.status_code == 404

    r = client.get("/pipelines")
    assert len(r.json()) == 0


def test_validate_pipeline(client) -> None:
    client.post("/pipelines", json={"name": "val", "config": REGEX_WHITELIST})

    r = client.post("/pipelines/val/validate", json={"config": LABEL_MAPPER_CONFIG})
    assert r.status_code == 200
    v = r.json()
    assert v["valid"] is True
    assert v.get("output_label_space") is not None
    assert isinstance(v["output_label_space"], list)
    assert "TELEPHONE" in v["output_label_space"]

    r = client.post(
        "/pipelines/val/validate",
        json={"config": {"pipes": [{"type": "nope"}]}},
    )
    assert r.status_code == 200
    assert r.json()["valid"] is False
    assert r.json()["error"] is not None


# ---------------------------------------------------------------------------
# Process endpoint
# ---------------------------------------------------------------------------


def _create_pipeline(client, name="proc-pipe", config=None):
    config = config or REGEX_WHITELIST
    r = client.post("/pipelines", json={"name": name, "config": config})
    assert r.status_code == 201, r.text
    return name


def test_process_text(client) -> None:
    name = _create_pipeline(client)
    r = client.post(
        f"/process/{name}",
        json={"text": "Call 555-123-4567 on 12/25/2024."},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pipeline_name"] == name
    assert len(body["spans"]) >= 1
    assert body["original_text"] == "Call 555-123-4567 on 12/25/2024."
    assert body["redacted_text"] != body["original_text"]
    assert body["processing_time_ms"] > 0

    # Check span text matches the substring
    for span in body["spans"]:
        assert span["text"] == body["original_text"][span["start"] : span["end"]]


def test_process_text_with_request_id(client) -> None:
    name = _create_pipeline(client, name="proc-reqid")
    r = client.post(
        f"/process/{name}",
        json={"text": "No PHI here.", "request_id": "my-custom-id"},
    )
    assert r.status_code == 200
    assert r.json()["request_id"] == "my-custom-id"


def test_process_not_found(client) -> None:
    r = client.post(
        "/process/nonexistent-pipeline",
        json={"text": "hello"},
    )
    assert r.status_code == 404


def test_process_deleted_pipeline(client) -> None:
    name = _create_pipeline(client, name="proc-del")
    client.delete(f"/pipelines/{name}")
    r = client.post(f"/process/{name}", json={"text": "hello"})
    assert r.status_code == 404


def test_process_batch(client) -> None:
    name = _create_pipeline(client, name="proc-batch")
    r = client.post(
        f"/process/{name}/batch",
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
    name = _create_pipeline(client, name="proc-filter-drop", config=LABEL_FILTER_DROP_CONFIG)
    r = client.post(f"/process/{name}", json={"text": "Call 555-123-4567 on 12/25/2024."})
    assert r.status_code == 200
    body = r.json()
    labels = {s["label"] for s in body["spans"]}
    assert "DATE" not in labels
    assert "PHONE" in labels


def test_process_with_label_filter_keep(client) -> None:
    name = _create_pipeline(client, name="proc-filter-keep", config=LABEL_FILTER_KEEP_CONFIG)
    r = client.post(f"/process/{name}", json={"text": "Call 555-123-4567 on 12/25/2024."})
    assert r.status_code == 200
    body = r.json()
    labels = {s["label"] for s in body["spans"]}
    assert labels == {"PHONE"}


def test_process_with_label_mapper_pipeline(client) -> None:
    name = _create_pipeline(client, name="proc-mapper", config=LABEL_MAPPER_CONFIG)
    r = client.post(f"/process/{name}", json={"text": "Call 555-123-4567."})
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
    assert len(body) >= 3  # at least regex_ner, whitelist, label_mapper, label_filter

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


def test_neuroner_label_space_bundle(client) -> None:
    r = client.get("/pipelines/pipe-types/neuroner_ner/label-space-bundle")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "labels_by_model" in body
    assert "default_entity_map" in body
    assert "default_model" in body
    assert isinstance(body["labels_by_model"], dict)
    assert isinstance(body["default_entity_map"], dict)
    assert isinstance(body["default_model"], str)


def test_presidio_label_space_bundle(client) -> None:
    r = client.get("/pipelines/pipe-types/presidio_ner/label-space-bundle")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "labels_by_model" in body
    assert "default_entity_map" in body
    assert "default_model" in body
    assert "spacy/en_core_web_lg" in body["labels_by_model"]
    assert isinstance(body["labels_by_model"]["spacy/en_core_web_lg"], list)


def test_compute_pipe_labels_presidio_omits_neuroner_fields(client) -> None:
    r = client.post(
        "/pipelines/pipe-types/presidio_ner/labels",
        json={"config": {"model": "spacy/en_core_web_sm"}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "labels" in body
    assert isinstance(body["labels"], list)
    assert "neuroner_model" not in body
    assert "neuroner_manifest_labels" not in body


def test_pipe_types_expose_label_source(client) -> None:
    """Catalog metadata reaches the frontend so it can pick fetch strategy."""
    r = client.get("/pipelines/pipe-types")
    assert r.status_code == 200
    by_name = {entry["name"]: entry for entry in r.json()}
    # bundle detectors
    assert by_name["presidio_ner"]["label_source"] == "bundle"
    assert by_name["presidio_ner"]["bundle_key_semantics"] == "presidio_entity"
    assert by_name["neuroner_ner"]["label_source"] == "bundle"
    assert by_name["neuroner_ner"]["bundle_key_semantics"] == "ner_raw"
    # compute detectors
    assert by_name["regex_ner"]["label_source"] == "compute"
    assert by_name["regex_ner"]["bundle_key_semantics"] is None
    assert by_name["whitelist"]["label_source"] == "compute"
    # span transformers / redactors do not expose a label space
    assert by_name["resolve_spans"]["label_source"] == "none"
    assert by_name["label_filter"]["label_source"] == "none"


def test_label_space_bundle_404_for_compute_pipe(client) -> None:
    """Pipes with ``label_source='compute'`` do not expose a bundle."""
    r = client.get("/pipelines/pipe-types/regex_ner/label-space-bundle")
    assert r.status_code == 404


def test_label_space_bundle_404_for_unknown_pipe(client) -> None:
    r = client.get("/pipelines/pipe-types/no_such_pipe/label-space-bundle")
    assert r.status_code == 404
