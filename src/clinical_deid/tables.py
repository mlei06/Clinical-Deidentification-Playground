"""Database tables — audit log only.

Pipelines, datasets, models, and eval results live on the filesystem.
The database stores the append-only audit trail.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import Column
from sqlalchemy.dialects.sqlite import JSON
from sqlmodel import Field, SQLModel


class AuditLogRecord(SQLModel, table=True):
    """Unified audit log entry for CLI and API operations."""

    __tablename__ = "audit_log"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    user: str = ""
    command: str = ""  # "run", "batch", "eval", "process", "process_batch"
    pipeline_name: str = ""
    pipeline_config: dict[str, Any] = Field(sa_column=Column(JSON), default_factory=dict)
    dataset_source: str = ""  # filesystem path or "" for ad-hoc text
    doc_count: int = 0
    error_count: int = 0
    span_count: int = 0
    duration_seconds: float = 0.0
    metrics: dict[str, Any] = Field(sa_column=Column(JSON), default_factory=dict)
    source: str = "cli"  # "cli" or "api"
    notes: str = ""
