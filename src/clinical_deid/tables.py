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
