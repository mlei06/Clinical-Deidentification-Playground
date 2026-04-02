from __future__ import annotations

import logging
import time
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from clinical_deid.api.deps import (
    SessionDep,
    get_current_version,
    get_pipeline_or_404,
)
from clinical_deid.api.schemas import (
    BatchProcessRequest,
    BatchProcessResponse,
    PHISpanResponse,
    ProcessRequest,
    ProcessResponse,
)
from clinical_deid.db import get_cached_pipeline
from clinical_deid.domain import AnnotatedDocument, Document
from clinical_deid.pipes.base import Pipe
from clinical_deid.pipes.combinators import Pipeline
from clinical_deid.pipes.registry import pipeline_config_requests_intermediary
from clinical_deid.tables import AuditLogRecord, PipelineRecord, PipelineVersionRecord

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/process", tags=["process"])


def _load_pipeline_and_meta(
    session: SessionDep, pipeline_id: str
) -> tuple[Pipe, PipelineRecord, PipelineVersionRecord]:
    """Look up pipeline + current version, build (or retrieve cached) pipe chain."""
    pipeline = get_pipeline_or_404(session, pipeline_id)
    ver = get_current_version(session, pipeline)

    try:
        pipe_chain = get_cached_pipeline(ver.config_hash, ver.config)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"failed to build pipeline: {exc}"
        ) from exc

    return pipe_chain, pipeline, ver


def _redact_text(text: str, spans: list[PHISpanResponse]) -> str:
    """Replace spans with [LABEL] placeholders, right-to-left to preserve offsets."""
    sorted_spans = sorted(spans, key=lambda s: s.start, reverse=True)
    result = text
    for span in sorted_spans:
        result = result[: span.start] + f"[{span.label}]" + result[span.end :]
    return result


def _process_single(
    text: str,
    request_id: str | None,
    pipe_chain: Pipe,
    pipeline: PipelineRecord,
    ver: PipelineVersionRecord,
    *,
    pipeline_config: dict[str, Any],
) -> ProcessResponse:
    req_id = request_id or str(uuid4())

    doc = AnnotatedDocument(
        document=Document(id=req_id, text=text),
        spans=[],
    )

    t0 = time.perf_counter()
    want_trace = pipeline_config_requests_intermediary(pipeline_config)
    intermediary_trace: list[dict[str, Any]] | None = None
    if want_trace and isinstance(pipe_chain, Pipeline):
        run = pipe_chain.forward_with_trace(doc)
        result = run.final
        intermediary_trace = run.frames_as_jsonable()
    else:
        result = pipe_chain.forward(doc)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    span_responses = [
        PHISpanResponse(
            start=s.start,
            end=s.end,
            label=s.label,
            text=text[s.start : s.end],
            confidence=s.confidence,
            source=s.source,
        )
        for s in result.spans
    ]

    # If the pipeline includes a redactor (text changed), use the output text.
    # Otherwise generate [LABEL] replacements from detected spans.
    if result.document.text != text:
        redacted = result.document.text
    else:
        redacted = _redact_text(text, span_responses)

    resp = ProcessResponse(
        request_id=req_id,
        original_text=text,
        redacted_text=redacted,
        spans=span_responses,
        pipeline_id=pipeline.id,
        pipeline_name=pipeline.name,
        pipeline_version=ver.version,
        processing_time_ms=round(elapsed_ms, 2),
        intermediary_trace=intermediary_trace,
    )
    return resp


def _log_audit(
    session: Any,
    response: ProcessResponse,
    source: str = "api",
) -> None:
    """Persist an audit log entry (best-effort, never raises)."""
    try:
        log = AuditLogRecord(
            request_id=response.request_id,
            pipeline_id=response.pipeline_id,
            pipeline_name=response.pipeline_name,
            pipeline_version=response.pipeline_version,
            input_text=response.original_text,
            output_text=response.redacted_text,
            spans=[s.model_dump() for s in response.spans],
            span_count=len(response.spans),
            processing_time_ms=response.processing_time_ms,
            source=source,
        )
        session.add(log)
    except Exception:
        logger.debug("Failed to write audit log", exc_info=True)


@router.post("/{pipeline_id}", response_model=ProcessResponse)
def process_text(
    session: SessionDep,
    pipeline_id: str,
    body: ProcessRequest,
) -> ProcessResponse:
    pipe_chain, pipeline, ver = _load_pipeline_and_meta(session, pipeline_id)
    resp = _process_single(
        body.text,
        body.request_id,
        pipe_chain,
        pipeline,
        ver,
        pipeline_config=ver.config,
    )
    _log_audit(session, resp, source="api")
    return resp


@router.post("/{pipeline_id}/batch", response_model=BatchProcessResponse)
def process_batch(
    session: SessionDep,
    pipeline_id: str,
    body: BatchProcessRequest,
) -> BatchProcessResponse:
    pipe_chain, pipeline, ver = _load_pipeline_and_meta(session, pipeline_id)

    t0 = time.perf_counter()
    results = [
        _process_single(
            item.text,
            item.request_id,
            pipe_chain,
            pipeline,
            ver,
            pipeline_config=ver.config,
        )
        for item in body.items
    ]
    total_ms = (time.perf_counter() - t0) * 1000

    for resp in results:
        _log_audit(session, resp, source="batch")

    return BatchProcessResponse(
        results=results,
        total_processing_time_ms=round(total_ms, 2),
    )
