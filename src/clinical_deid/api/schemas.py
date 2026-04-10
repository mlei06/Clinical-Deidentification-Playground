from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


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
