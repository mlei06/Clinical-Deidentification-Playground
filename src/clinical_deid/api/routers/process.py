"""Process endpoint — send text through a named pipeline."""

from __future__ import annotations

import logging
import time
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from clinical_deid.api.deps import SessionDep
from clinical_deid.api.schemas import (
    BatchProcessRequest,
    BatchProcessResponse,
    PHISpanResponse,
    ProcessRequest,
    ProcessResponse,
)
from clinical_deid.config import get_settings
from clinical_deid.domain import AnnotatedDocument, Document, tag_replace
from clinical_deid.pipeline_store import load_pipeline_config
from clinical_deid.pipes.base import Pipe
from clinical_deid.pipes.combinators import Pipeline
from clinical_deid.pipes.registry import load_pipeline
from clinical_deid.tables import AuditLogRecord

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/process", tags=["process"])


def _load_pipe_chain(pipeline_name: str) -> tuple[Pipe, dict[str, Any]]:
    """Load a pipeline from the filesystem by name."""
    try:
        config = load_pipeline_config(get_settings().pipelines_dir, pipeline_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        pipe_chain = load_pipeline(config)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"failed to build pipeline: {exc}"
        ) from exc
    return pipe_chain, config


def _redact_text(text: str, spans: list[PHISpanResponse]) -> str:
    from clinical_deid.domain import PHISpan

    phi_spans = [
        PHISpan(start=s.start, end=s.end, label=s.label) for s in spans
    ]
    return tag_replace(text, phi_spans)


def _process_single(
    text: str,
    request_id: str | None,
    pipe_chain: Pipe,
    pipeline_name: str,
    pipeline_config: dict[str, Any],
    *,
    trace: bool = False,
) -> ProcessResponse:
    req_id = request_id or str(uuid4())

    doc = AnnotatedDocument(
        document=Document(id=req_id, text=text),
        spans=[],
    )

    intermediary_trace: list[dict[str, Any]] | None = None
    if isinstance(pipe_chain, Pipeline):
        run_result = pipe_chain.run(doc, trace=trace, timing=True)
        result = run_result.final
        elapsed_ms = run_result.total_elapsed_ms or 0.0
        if trace:
            intermediary_trace = run_result.frames_as_jsonable()
    else:
        t0 = time.perf_counter()
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

    # Redactors like SurrogatePipe consume spans (offsets invalid in new
    # text) but stash them in metadata so the UI can still annotate the
    # original text.
    if not span_responses:
        pre = result.document.metadata.get("pre_redaction_spans")
        if pre and isinstance(pre, list):
            span_responses = [
                PHISpanResponse(
                    start=s["start"],
                    end=s["end"],
                    label=s["label"],
                    text=text[s["start"] : s["end"]],
                    confidence=s.get("confidence"),
                    source=s.get("source"),
                )
                for s in pre
            ]

    if result.document.text != text:
        redacted = result.document.text
    else:
        redacted = _redact_text(text, span_responses)

    return ProcessResponse(
        request_id=req_id,
        original_text=text,
        redacted_text=redacted,
        spans=span_responses,
        pipeline_name=pipeline_name,
        processing_time_ms=round(elapsed_ms, 2),
        intermediary_trace=intermediary_trace,
    )


def _log_audit(
    session: Any,
    pipeline_name: str,
    pipeline_config: dict[str, Any],
    responses: list[ProcessResponse],
    source: str = "api",
) -> None:
    """Persist a single audit record for one or more processed docs."""
    try:
        import getpass

        total_spans = sum(len(r.spans) for r in responses)
        total_ms = sum(r.processing_time_ms for r in responses)
        record = AuditLogRecord(
            user=getpass.getuser(),
            command="process" if len(responses) == 1 else "process_batch",
            pipeline_name=pipeline_name,
            pipeline_config=pipeline_config,
            doc_count=len(responses),
            span_count=total_spans,
            duration_seconds=total_ms / 1000,
            source=source,
        )
        session.add(record)
    except Exception:
        logger.warning("Failed to write audit log", exc_info=True)


@router.post("/{pipeline_name}", response_model=ProcessResponse)
def process_text(
    session: SessionDep,
    pipeline_name: str,
    body: ProcessRequest,
    trace: bool = False,
) -> ProcessResponse:
    pipe_chain, config = _load_pipe_chain(pipeline_name)
    resp = _process_single(body.text, body.request_id, pipe_chain, pipeline_name, config, trace=trace)
    _log_audit(session, pipeline_name, config, [resp], source="api")
    return resp


@router.post("/{pipeline_name}/batch", response_model=BatchProcessResponse)
def process_batch(
    session: SessionDep,
    pipeline_name: str,
    body: BatchProcessRequest,
    trace: bool = False,
) -> BatchProcessResponse:
    pipe_chain, config = _load_pipe_chain(pipeline_name)

    t0 = time.perf_counter()
    results = [
        _process_single(item.text, item.request_id, pipe_chain, pipeline_name, config, trace=trace)
        for item in body.items
    ]
    total_ms = (time.perf_counter() - t0) * 1000

    _log_audit(session, pipeline_name, config, results, source="api")

    return BatchProcessResponse(
        results=results,
        total_processing_time_ms=round(total_ms, 2),
    )
