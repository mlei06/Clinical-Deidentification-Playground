"""Database engine and initialization.

The database stores only the audit trail.  Pipelines, models, datasets,
and eval results live on the filesystem.
"""

from __future__ import annotations

import threading

from sqlalchemy import Engine
from sqlmodel import SQLModel, create_engine

from clinical_deid.config import get_settings

_engine: Engine | None = None
_engine_lock = threading.Lock()


def reset_engine() -> None:
    """Test helper: clear cached engine after changing ``CLINICAL_DEID_DATABASE_URL``."""
    global _engine
    with _engine_lock:
        _engine = None


def get_engine() -> Engine:
    global _engine
    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is None:
            settings = get_settings()
            p = settings.sqlite_path
            if p is not None:
                p.parent.mkdir(parents=True, exist_ok=True)
            connect_args = (
                {"check_same_thread": False}
                if settings.database_url.startswith("sqlite")
                else {}
            )
            _engine = create_engine(
                settings.database_url, echo=False, connect_args=connect_args
            )
    return _engine


def init_db() -> None:
    """Create all tables (audit_log)."""
    from clinical_deid.tables import AuditLogRecord  # noqa: F401

    SQLModel.metadata.create_all(get_engine(), checkfirst=True)
