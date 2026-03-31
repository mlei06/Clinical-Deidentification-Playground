from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"


# ---------------------------------------------------------------------------
# Pipeline CRUD
# ---------------------------------------------------------------------------


class CreatePipelineRequest(BaseModel):
    name: str
    description: str = ""
    config: dict[str, Any]  # {"pipes": [...]}


class UpdatePipelineRequest(BaseModel):
    description: str | None = None
    config: dict[str, Any] | None = None


class PipelineSummary(BaseModel):
    id: str
    name: str
    description: str
    latest_version: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PipelineVersionDetail(BaseModel):
    id: str
    version: int
    config: dict[str, Any]
    config_hash: str
    created_at: datetime


class PipelineDetail(PipelineSummary):
    current_version: PipelineVersionDetail


class ValidatePipelineRequest(BaseModel):
    config: dict[str, Any]


class ValidatePipelineResponse(BaseModel):
    valid: bool
    error: str | None = None


# ---------------------------------------------------------------------------
# Process endpoint
# ---------------------------------------------------------------------------


MAX_TEXT_LENGTH = 500_000  # ~500 KB of text; raise if you need longer clinical notes

class ProcessRequest(BaseModel):
    text: str = Field(..., max_length=MAX_TEXT_LENGTH)
    request_id: str | None = None


class PHISpanResponse(BaseModel):
    start: int
    end: int
    label: str
    text: str
    confidence: float | None = None
    source: str | None = None


class ProcessResponse(BaseModel):
    request_id: str
    original_text: str
    redacted_text: str
    spans: list[PHISpanResponse]
    pipeline_id: str
    pipeline_name: str
    pipeline_version: int
    processing_time_ms: float
    intermediary_trace: list[dict[str, Any]] | None = Field(
        default=None,
        description=(
            "Snapshots after selected pipeline stages when the pipeline JSON sets "
            "`store_intermediary` and/or `store_if_intermediary`."
        ),
    )


MAX_BATCH_SIZE = 100

class BatchProcessRequest(BaseModel):
    items: list[ProcessRequest] = Field(..., max_length=MAX_BATCH_SIZE)


class BatchProcessResponse(BaseModel):
    results: list[ProcessResponse]
    total_processing_time_ms: float


# ---------------------------------------------------------------------------
# Pipe catalog
# ---------------------------------------------------------------------------


class PipeTypeInfo(BaseModel):
    name: str
    description: str
    role: str
    extra: str | None
    install_hint: str
    installed: bool
    config_schema: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Regex NER list uploads (UI drag-and-drop → JSON terms for pipeline config)
# ---------------------------------------------------------------------------


class ParseListFileResult(BaseModel):
    label: str
    filename: str
    terms: list[str]
    count: int


class ParseListFilesResponse(BaseModel):
    """Parsed terms per file; merge into ``whitelist`` ``per_label.<label>.terms``."""

    results: list[ParseListFileResult]


class NerBuiltinInfo(BaseModel):
    """Built-in regex labels and bundled whitelist phrase files."""

    regex_labels: list[str]
    whitelist_labels: list[str]


# ---------------------------------------------------------------------------
# Blacklist — merge multiple uploads into one ``terms`` array
# ---------------------------------------------------------------------------


class BlacklistMergeResponse(BaseModel):
    """Deduped combined terms for ``blacklist`` ``config.terms`` (drag multiple .txt → one list)."""

    terms: list[str]
    count: int
    source_files: list[str]
