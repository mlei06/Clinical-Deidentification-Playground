"""CLI audit trail: log every pipeline run with metadata and metrics.

Uses a standalone SQLite database (default ``~/.clinical-deid/audit.db``)
separate from the API's ``dev.sqlite``.  Plain ``sqlite3`` — no ORM.
"""

from __future__ import annotations

import getpass
import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

DEFAULT_AUDIT_DB = Path.home() / ".clinical-deid" / "audit.db"

_CREATE_TABLE = """\
CREATE TABLE IF NOT EXISTS audit (
    run_id           TEXT PRIMARY KEY,
    timestamp        TEXT NOT NULL,
    user             TEXT NOT NULL,
    command          TEXT NOT NULL,
    profile          TEXT,
    config_json      TEXT NOT NULL,
    doc_count        INTEGER NOT NULL,
    error_count      INTEGER NOT NULL DEFAULT 0,
    duration_seconds REAL NOT NULL,
    metrics_json     TEXT,
    notes            TEXT DEFAULT ''
)
"""

_INSERT = """\
INSERT INTO audit
    (run_id, timestamp, user, command, profile, config_json,
     doc_count, error_count, duration_seconds, metrics_json, notes)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


@dataclass
class AuditRecord:
    run_id: str
    timestamp: str
    user: str
    command: str
    profile: str | None
    config_json: str
    doc_count: int
    error_count: int
    duration_seconds: float
    metrics_json: str | None
    notes: str = ""


def _db_path() -> Path:
    env = os.environ.get("CLINICAL_DEID_AUDIT_DB")
    return Path(env) if env else DEFAULT_AUDIT_DB


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute(_CREATE_TABLE)
    conn.commit()
    return conn


def log_run(record: AuditRecord) -> None:
    """Insert an audit record."""
    conn = _connect()
    try:
        conn.execute(
            _INSERT,
            (
                record.run_id,
                record.timestamp,
                record.user,
                record.command,
                record.profile,
                record.config_json,
                record.doc_count,
                record.error_count,
                record.duration_seconds,
                record.metrics_json,
                record.notes,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _row_to_record(row: tuple) -> AuditRecord:
    return AuditRecord(
        run_id=row[0],
        timestamp=row[1],
        user=row[2],
        command=row[3],
        profile=row[4],
        config_json=row[5],
        doc_count=row[6],
        error_count=row[7],
        duration_seconds=row[8],
        metrics_json=row[9],
        notes=row[10] or "",
    )


def list_runs(limit: int = 20) -> list[AuditRecord]:
    """Return the most recent audit records (newest first)."""
    path = _db_path()
    if not path.exists():
        return []
    conn = sqlite3.connect(str(path))
    try:
        conn.execute(_CREATE_TABLE)
        cur = conn.execute(
            "SELECT run_id, timestamp, user, command, profile, config_json, "
            "doc_count, error_count, duration_seconds, metrics_json, notes "
            "FROM audit ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        )
        return [_row_to_record(row) for row in cur.fetchall()]
    finally:
        conn.close()


def get_run(run_id: str) -> AuditRecord | None:
    """Return a single audit record by *run_id* (or prefix match)."""
    path = _db_path()
    if not path.exists():
        return None
    conn = sqlite3.connect(str(path))
    try:
        conn.execute(_CREATE_TABLE)
        cur = conn.execute(
            "SELECT run_id, timestamp, user, command, profile, config_json, "
            "doc_count, error_count, duration_seconds, metrics_json, notes "
            "FROM audit WHERE run_id = ? OR run_id LIKE ?",
            (run_id, f"{run_id}%"),
        )
        row = cur.fetchone()
        return _row_to_record(row) if row else None
    finally:
        conn.close()


def make_record(
    command: str,
    profile: str | None,
    config: dict[str, Any],
    doc_count: int,
    error_count: int,
    duration_seconds: float,
    metrics: dict[str, Any] | None = None,
) -> AuditRecord:
    """Factory helper."""
    return AuditRecord(
        run_id=str(uuid4()),
        timestamp=datetime.now(timezone.utc).isoformat(),
        user=getpass.getuser(),
        command=command,
        profile=profile,
        config_json=json.dumps(config, sort_keys=True),
        doc_count=doc_count,
        error_count=error_count,
        duration_seconds=duration_seconds,
        metrics_json=json.dumps(metrics) if metrics else None,
    )
