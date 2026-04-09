from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_file = tmp_path / "test.sqlite"
    pipelines_dir = tmp_path / "pipelines"
    evaluations_dir = tmp_path / "evaluations"
    dictionaries_dir = tmp_path / "dictionaries"
    pipelines_dir.mkdir()
    evaluations_dir.mkdir()
    dictionaries_dir.mkdir()

    monkeypatch.setenv("CLINICAL_DEID_DATABASE_URL", f"sqlite:///{db_file.as_posix()}")
    monkeypatch.setenv("CLINICAL_DEID_PIPELINES_DIR", str(pipelines_dir))
    monkeypatch.setenv("CLINICAL_DEID_EVALUATIONS_DIR", str(evaluations_dir))
    monkeypatch.setenv("CLINICAL_DEID_DICTIONARIES_DIR", str(dictionaries_dir))

    from clinical_deid.config import reset_settings
    from clinical_deid.db import init_db, reset_engine

    reset_settings()
    reset_engine()
    init_db()

    from clinical_deid.api.app import create_app

    test_app = create_app()

    with TestClient(test_app) as test_client:
        yield test_client
