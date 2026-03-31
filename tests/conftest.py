from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_file = tmp_path / "test.sqlite"
    monkeypatch.setenv("CLINICAL_DEID_DATABASE_URL", f"sqlite:///{db_file.as_posix()}")

    from clinical_deid.config import reset_settings
    from clinical_deid.db import clear_pipeline_cache, init_db, reset_engine

    reset_settings()
    reset_engine()
    clear_pipeline_cache()
    init_db()

    from clinical_deid.api.app import app

    with TestClient(app) as test_client:
        yield test_client
