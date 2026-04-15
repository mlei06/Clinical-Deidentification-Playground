"""Tests for output_mode, /redact, and /scrub endpoints."""

from __future__ import annotations

import json

REGEX_ONLY = {"pipes": [{"type": "regex_ner"}]}
PHONE_TEXT = "Call 555-123-4567 today."


def _create_pipeline(client, *, name: str = "test-proc-modes", config=None):
    config = config or REGEX_ONLY
    r = client.post("/pipelines", json={"name": name, "config": config})
    assert r.status_code == 201, r.text
    return name


# ---------------------------------------------------------------------------
# output_mode on /process
# ---------------------------------------------------------------------------


def test_process_output_mode_annotated(client) -> None:
    name = _create_pipeline(client)
    r = client.post(
        f"/process/{name}?output_mode=annotated",
        json={"text": PHONE_TEXT},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # In annotated mode, redacted_text should be the original
    assert body["redacted_text"] == PHONE_TEXT
    assert len(body["spans"]) >= 1


def test_process_output_mode_redacted(client) -> None:
    name = _create_pipeline(client, name="proc-redact-mode")
    r = client.post(
        f"/process/{name}?output_mode=redacted",
        json={"text": PHONE_TEXT},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "[PHONE]" in body["redacted_text"]


def test_process_output_mode_default_is_redacted(client) -> None:
    name = _create_pipeline(client, name="proc-default-mode")
    r = client.post(f"/process/{name}", json={"text": PHONE_TEXT})
    assert r.status_code == 200
    body = r.json()
    # Default should be redacted
    assert body["redacted_text"] != PHONE_TEXT
    assert "[PHONE]" in body["redacted_text"]


def test_process_batch_output_mode(client) -> None:
    name = _create_pipeline(client, name="proc-batch-mode")
    r = client.post(
        f"/process/{name}/batch?output_mode=annotated",
        json={"items": [{"text": PHONE_TEXT}]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["results"][0]["redacted_text"] == PHONE_TEXT


# ---------------------------------------------------------------------------
# POST /process/redact
# ---------------------------------------------------------------------------


def test_redact_endpoint_tag_replace(client) -> None:
    r = client.post(
        "/process/redact",
        json={
            "text": "Call 555-123-4567 today.",
            "spans": [{"start": 5, "end": 17, "label": "PHONE"}],
            "output_mode": "redacted",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["output_text"] == "Call [PHONE] today."
    assert body["output_mode"] == "redacted"
    assert body["span_count"] == 1


def test_redact_endpoint_annotated_passthrough(client) -> None:
    text = "Call 555-123-4567 today."
    r = client.post(
        "/process/redact",
        json={
            "text": text,
            "spans": [{"start": 5, "end": 17, "label": "PHONE"}],
            "output_mode": "annotated",
        },
    )
    assert r.status_code == 200
    assert r.json()["output_text"] == text


# ---------------------------------------------------------------------------
# POST /process/scrub
# ---------------------------------------------------------------------------


def test_scrub_with_explicit_pipeline(client) -> None:
    name = _create_pipeline(client, name="scrub-pipe")
    r = client.post(
        "/process/scrub",
        json={"text": PHONE_TEXT, "mode": name},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pipeline_used"] == name
    assert "[PHONE]" in body["text"]
    assert body["span_count"] >= 1
    assert body["processing_time_ms"] > 0


def test_scrub_with_deploy_default(client, tmp_path, monkeypatch) -> None:
    """When no mode is given, scrub uses deploy config's default_mode."""
    name = _create_pipeline(client, name="scrub-default")
    # Write a modes.json that maps the default mode to our pipeline
    modes_file = tmp_path / "modes.json"
    modes_file.write_text(json.dumps({
        "modes": {"auto": {"pipeline": name, "description": "test"}},
        "default_mode": "auto",
    }))
    monkeypatch.chdir(tmp_path)

    r = client.post("/process/scrub", json={"text": PHONE_TEXT})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pipeline_used"] == name


# ---------------------------------------------------------------------------
# X-Client-ID header is accepted
# ---------------------------------------------------------------------------


def test_process_accepts_client_id_header(client) -> None:
    name = _create_pipeline(client, name="proc-client-id")
    r = client.post(
        f"/process/{name}",
        json={"text": "No PHI."},
        headers={"X-Client-Id": "my-service"},
    )
    assert r.status_code == 200
