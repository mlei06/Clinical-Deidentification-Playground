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
    label_space_name: str = Field(
        description="Active LabelSpace (``CLINICAL_DEID_LABEL_SPACE_NAME``) — used for "
        "``POST /process/*`` span label normalization, not for evaluation."
    )
    risk_profile_name: str = Field(
        description="Default risk profile (``CLINICAL_DEID_RISK_PROFILE_NAME``) for eval when not overridden."
    )


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
    output_label_space: list[str] | None = Field(
        default=None,
        description="Symbolic output span labels after detector remaps and label_mapper/filter (when valid).",
    )
    output_label_space_updated_at: str | None = Field(
        default=None,
        description="ISO-8601 timestamp when output_label_space was computed (validate preview only).",
    )


# ---------------------------------------------------------------------------
# Process endpoint
# ---------------------------------------------------------------------------


MAX_TEXT_LENGTH = 500_000  # ~500 KB of text

class ProcessRequest(BaseModel):
    text: str = Field(..., max_length=MAX_TEXT_LENGTH)
    request_id: str | None = None
    include_surrogate_spans: bool = Field(
        default=False,
        description=(
            "When ``output_mode=surrogate``, populate ``surrogate_text`` / "
            "``surrogate_spans`` on the response (spans aligned to the surrogate text). "
            "No-op for other output modes."
        ),
    )
    surrogate_seed: int | None = Field(
        default=None, description="Seed for the surrogate generator (determinism)."
    )
    surrogate_consistency: bool = Field(
        default=True,
        description="When true, identical ``(label, original)`` pairs yield the same surrogate.",
    )


class EntitySpanResponse(BaseModel):
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
    spans: list[EntitySpanResponse]
    pipeline_name: str
    processing_time_ms: float
    intermediary_trace: list[dict[str, Any]] | None = Field(
        default=None,
        description="Snapshots after each pipeline stage. Present when `?trace=true` query param is set.",
    )
    surrogate_text: str | None = Field(
        default=None,
        description=(
            "Present when ``include_surrogate_spans=true`` and ``output_mode=surrogate``; "
            "identical to ``redacted_text`` in that case but exposed explicitly for clarity."
        ),
    )
    surrogate_spans: list[EntitySpanResponse] | None = Field(
        default=None,
        description=(
            "Spans aligned to ``surrogate_text`` (character offsets point into the surrogate). "
            "Present only when ``include_surrogate_spans=true`` with ``output_mode=surrogate``."
        ),
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
    labels: list[str] = Field(
        ...,
        description="Canonical detector labels after entity_map (inputs to label_mapping).",
    )


class LabelSpaceBundle(BaseModel):
    """One GET payload so the UI can derive label space for any model without a POST per switch.

    Used by detectors that declare ``label_source in {'bundle', 'both'}`` in the catalog.
    Key shape (raw NER tag vs. Presidio entity name) is signaled by the catalog
    ``bundle_key_semantics`` field on the corresponding ``PipeTypeInfo`` entry.
    """

    labels_by_model: dict[str, list[str]] = Field(
        description=(
            "Per-model label keys before ``entity_map`` projection. The semantics of these keys "
            "(raw NER tag vs. Presidio entity) are described by ``PipeTypeInfo.bundle_key_semantics``."
        ),
    )
    default_entity_map: dict[str, str] = Field(
        description="Default raw/entity → canonical PHI map (merged with config.entity_map on the client).",
    )
    default_model: str = Field(description="Default ``model`` when the pipe config omits it.")
    model_info: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        description=(
            "Optional per-model metadata for UI display (e.g. trained max sequence length, "
            "base model, segmentation, training context). Empty for pipes that don't expose it."
        ),
    )


class PipeTypeInfo(BaseModel):
    name: str
    description: str
    role: str
    extra: str | None
    install_hint: str
    installed: bool
    config_schema: dict[str, Any] | None = None
    base_labels: list[str] | None = None
    label_source: str = Field(
        default="none",
        description="How the playground discovers this pipe's label space: 'none', 'compute', 'bundle', or 'both'.",
    )
    bundle_key_semantics: str | None = Field(
        default=None,
        description="For bundle pipes: 'ner_raw' (raw NER tags) or 'presidio_entity' (Presidio entity names).",
    )
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


# ---------------------------------------------------------------------------
# Datasets: ingest via saved pipeline
# ---------------------------------------------------------------------------


class IngestFromPipelineRequest(BaseModel):
    source_path: str = Field(
        ...,
        description=(
            "Path relative to CORPORA_DIR. Points at a directory of .txt files, "
            "a single .txt, or a .jsonl of {id, text} rows. Must not escape via '..'."
        ),
    )
    pipeline_name: str = Field(..., description="Saved pipeline name (under PIPELINES_DIR).")
    output_name: str = Field(..., description="New dataset name (placed under CORPORA_DIR/<name>/).")
    description: str = ""
    max_documents: int = Field(
        default=10_000,
        ge=1,
        le=1_000_000,
        description="Cap on documents ingested per call; exceeding returns 422.",
    )


class IngestFromPipelineResponse(BaseModel):
    name: str
    document_count: int
    total_spans: int
