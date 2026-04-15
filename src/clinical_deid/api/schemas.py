from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class OutputMode(str, Enum):
    """How to format the output of a process/scrub request."""

    annotated = "annotated"  # return spans on original text (no redaction)
    redacted = "redacted"  # replace spans with [LABEL] tags
    surrogate = "surrogate"  # replace spans with realistic fake data


class HealthResponse(BaseModel):
    status: str = "ok"


# ---------------------------------------------------------------------------
# Pipeline CRUD (filesystem-backed)
# ---------------------------------------------------------------------------


class CreatePipelineRequest(BaseModel):
    name: str
    config: dict[str, Any]  # {"pipes": [...]}


class UpdatePipelineRequest(BaseModel):
    config: dict[str, Any] | None = None


class PipelineDetail(BaseModel):
    name: str
    config: dict[str, Any]


class ValidatePipelineRequest(BaseModel):
    config: dict[str, Any]


class ValidatePipelineResponse(BaseModel):
    valid: bool
    error: str | None = None


# ---------------------------------------------------------------------------
# Process endpoint
# ---------------------------------------------------------------------------


MAX_TEXT_LENGTH = 500_000  # ~500 KB of text

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
    pipeline_name: str
    processing_time_ms: float
    intermediary_trace: list[dict[str, Any]] | None = Field(
        default=None,
        description="Snapshots after each pipeline stage. Present when `?trace=true` query param is set.",
    )


MAX_BATCH_SIZE = 100

class BatchProcessRequest(BaseModel):
    items: list[ProcessRequest] = Field(..., max_length=MAX_BATCH_SIZE)


class BatchProcessResponse(BaseModel):
    results: list[ProcessResponse]
    total_processing_time_ms: float


# ---------------------------------------------------------------------------
# Redact / Scrub endpoints
# ---------------------------------------------------------------------------


class RedactSpan(BaseModel):
    start: int
    end: int
    label: str


class RedactRequest(BaseModel):
    """Apply redaction or surrogate replacement to text given known spans."""

    text: str = Field(..., max_length=MAX_TEXT_LENGTH)
    spans: list[RedactSpan]
    output_mode: OutputMode = OutputMode.redacted
    surrogate_seed: int | None = None
    surrogate_consistency: bool = True


class RedactResponse(BaseModel):
    output_text: str
    output_mode: OutputMode
    span_count: int


class ScrubRequest(BaseModel):
    """Zero-config log cleaning: text in, clean text out."""

    text: str = Field(..., max_length=MAX_TEXT_LENGTH)
    mode: str | None = Field(
        default=None,
        description="Mode name (e.g. 'fast') or pipeline name. Falls back to deploy default_mode.",
    )
    output_mode: OutputMode = OutputMode.redacted
    request_id: str | None = None


class ScrubResponse(BaseModel):
    text: str
    pipeline_used: str
    output_mode: OutputMode
    span_count: int
    processing_time_ms: float


class SaveInferenceSnapshotRequest(ProcessResponse):
    """Same shape as :class:`ProcessResponse`; persisted under ``inference_runs/``."""


class SavedInferenceRunSummary(BaseModel):
    id: str
    pipeline_name: str
    saved_at: str
    text_preview: str
    span_count: int


class SavedInferenceRunDetail(SaveInferenceSnapshotRequest):
    id: str
    saved_at: str


# ---------------------------------------------------------------------------
# Pipe catalog
# ---------------------------------------------------------------------------


class ComputeLabelsRequest(BaseModel):
    config: dict[str, Any] | None = None


class ComputeLabelsResponse(BaseModel):
    labels: list[str]


class PipeTypeInfo(BaseModel):
    name: str
    description: str
    role: str
    extra: str | None
    install_hint: str
    installed: bool
    config_schema: dict[str, Any] | None = None
    base_labels: list[str] | None = None
    deprecated: bool = False


# ---------------------------------------------------------------------------
# Regex NER list uploads
# ---------------------------------------------------------------------------


class ParseListFileResult(BaseModel):
    label: str
    filename: str
    terms: list[str]
    count: int


class ParseListFilesResponse(BaseModel):
    results: list[ParseListFileResult]


class NerBuiltinInfo(BaseModel):
    regex_labels: list[str]
    whitelist_labels: list[str]


# ---------------------------------------------------------------------------
# Blacklist
# ---------------------------------------------------------------------------


class BlacklistMergeResponse(BaseModel):
    terms: list[str]
    count: int
    source_files: list[str]


# ---------------------------------------------------------------------------
# Dictionaries
# ---------------------------------------------------------------------------


class DictionaryInfoResponse(BaseModel):
    kind: str
    label: str | None
    name: str
    filename: str
    term_count: int


class DictionaryTermsResponse(BaseModel):
    kind: str
    label: str | None
    name: str
    terms: list[str]
    term_count: int


class DictionaryPreviewResponse(BaseModel):
    kind: str
    label: str | None
    name: str
    term_count: int
    sample_terms: list[str]
    file_size_bytes: int


class DictionaryTermsPageResponse(BaseModel):
    terms: list[str]
    total: int
    offset: int
    limit: int
    search: str | None


class DictionaryUploadResponse(BaseModel):
    info: DictionaryInfoResponse
    message: str
