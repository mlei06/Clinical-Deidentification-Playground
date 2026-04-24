"""Tests for API health endpoint."""

from __future__ import annotations


def test_health(client) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "label_space_name" in data
    assert "risk_profile_name" in data
