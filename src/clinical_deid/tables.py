from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import Column, UniqueConstraint
from sqlalchemy.dialects.sqlite import JSON
from sqlmodel import Field, SQLModel


def config_hash(config: dict[str, Any]) -> str:
    """SHA-256 of canonical JSON for dedup."""
    canonical = json.dumps(config, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


class PipelineRecord(SQLModel, table=True):
    """Named pipeline — mutable metadata, points to latest version."""

    __tablename__ = "pipeline"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    name: str = Field(index=True, unique=True)
    description: str = ""
    latest_version: int = 1
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PipelineVersionRecord(SQLModel, table=True):
    """Immutable snapshot of a pipeline config at a specific version."""

    __tablename__ = "pipeline_version"
    __table_args__ = (
        UniqueConstraint("pipeline_id", "version", name="uq_pipeline_version"),
    )

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    pipeline_id: str = Field(foreign_key="pipeline.id", index=True)
    version: int
    config: dict[str, Any] = Field(sa_column=Column(JSON))
    config_hash: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AuditLogRecord(SQLModel, table=True):
    """Persisted audit log entry for each processing request."""

    __tablename__ = "audit_log"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    request_id: str = Field(index=True)
    pipeline_id: str = Field(foreign_key="pipeline.id", index=True)
    pipeline_name: str = ""
    pipeline_version: int = 1
    input_text: str = ""
    output_text: str = ""
    spans: list[dict[str, Any]] = Field(sa_column=Column(JSON), default=[])
    span_count: int = 0
    processing_time_ms: float = 0.0
    source: str = "api"  # "api", "batch", "eval", "manual"
    caller: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class EvalRunRecord(SQLModel, table=True):
    """Persisted evaluation run results."""

    __tablename__ = "eval_run"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    pipeline_id: str = Field(foreign_key="pipeline.id", index=True)
    pipeline_version: int = 1
    dataset_source: str = ""  # path or description of the dataset used
    metrics: dict[str, Any] = Field(sa_column=Column(JSON), default={})
    document_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
