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


def test_process_preview_runs_unsaved_pipeline(client) -> None:
    """``/process/preview`` lets the playground run an unsaved pipeline JSON."""
    r = client.post(
        "/process/preview",
        json={"text": PHONE_TEXT, "config": REGEX_ONLY},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pipeline_name"] == "__preview__"
    assert any(s["label"] == "PHONE" for s in body["spans"])
    # Trace is always on for preview
    assert body["intermediary_trace"] is not None
    assert len(body["intermediary_trace"]) >= 1


def test_process_preview_invalid_pipeline_returns_422(client) -> None:
    r = client.post(
        "/process/preview",
        json={"text": "hello", "config": {"pipes": [{"type": "no_such_pipe"}]}},
    )
    assert r.status_code == 422


def test_process_preview_does_not_audit(client) -> None:
    """Preview is throwaway — should not create an audit record."""
    before = client.get("/audit/logs").json()
    before_count = len(before.get("items", before)) if isinstance(before, dict) else len(before)

    client.post("/process/preview", json={"text": PHONE_TEXT, "config": REGEX_ONLY})

    after = client.get("/audit/logs").json()
    after_count = len(after.get("items", after)) if isinstance(after, dict) else len(after)
    assert after_count == before_count


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


def test_redact_surrogate_includes_spans(client) -> None:
    """POST /process/redact in surrogate mode can return aligned surrogate_spans for UIs."""
    import pytest
    pytest.importorskip("faker", reason="surrogate replacement requires faker")

    r = client.post(
        "/process/redact",
        json={
            "text": "Call 555-123-4567 today.",
            "spans": [{"start": 5, "end": 17, "label": "PHONE"}],
            "output_mode": "surrogate",
            "include_surrogate_spans": True,
            "surrogate_seed": 42,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["surrogate_text"] == body["output_text"]
    assert body["surrogate_spans"] is not None
    assert len(body["surrogate_spans"]) == 1
    st = body["output_text"]
    s0 = body["surrogate_spans"][0]
    assert st[s0["start"] : s0["end"]] == s0["text"]


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


def test_scrub_with_deploy_default(client, tmp_path) -> None:
    """When no mode is given, scrub uses deploy config's default_mode."""
    name = _create_pipeline(client, name="scrub-default")
    # Write a modes.json that maps the default mode to our pipeline
    modes_file = tmp_path / "data" / "modes.json"
    modes_file.write_text(json.dumps({
        "modes": {"auto": {"pipeline": name, "description": "test"}},
        "default_mode": "auto",
    }))

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


def test_process_include_surrogate_spans(client) -> None:
    """Surrogate mode with include_surrogate_spans populates aligned fields."""
    import pytest
    pytest.importorskip("faker", reason="surrogate replacement requires faker")

    name = _create_pipeline(client, name="proc-surrogate-aligned")
    r = client.post(
        f"/process/{name}?output_mode=surrogate",
        json={
            "text": PHONE_TEXT,
            "include_surrogate_spans": True,
            "surrogate_seed": 42,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["surrogate_text"] is not None
    assert body["surrogate_spans"] is not None
    assert len(body["surrogate_spans"]) == len(body["spans"])
    # surrogate_text equals redacted_text in surrogate mode
    assert body["surrogate_text"] == body["redacted_text"]
    # Every surrogate span points at its replacement substring
    for s in body["surrogate_spans"]:
        assert body["surrogate_text"][s["start"]:s["end"]] == s["text"]


def test_process_include_surrogate_spans_no_op_when_not_surrogate(client) -> None:
    name = _create_pipeline(client, name="proc-surrogate-noop")
    r = client.post(
        f"/process/{name}?output_mode=redacted",
        json={"text": PHONE_TEXT, "include_surrogate_spans": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["surrogate_text"] is None
    assert body["surrogate_spans"] is None
