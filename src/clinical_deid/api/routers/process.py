"""Process endpoint — send text through a named pipeline."""

from __future__ import annotations

import logging
import time
from collections import Counter
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException

from clinical_deid.api.deps import SessionDep
from clinical_deid.api.schemas import (
    BatchProcessRequest,
    BatchProcessResponse,
    OutputMode,
    PHISpanResponse,
    ProcessRequest,
    ProcessResponse,
    RedactRequest,
    RedactResponse,
    ScrubRequest,
    ScrubResponse,
)
from clinical_deid.config import get_settings
from clinical_deid.domain import AnnotatedDocument, Document, PHISpan, tag_replace
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


def _apply_output_mode(
    original_text: str,
    spans: list[PHISpanResponse],
    output_mode: OutputMode,
    *,
    surrogate_seed: int | None = None,
    surrogate_consistency: bool = True,
) -> str:
    """Apply the requested output mode to produce the final text."""
    if output_mode == OutputMode.annotated:
        return original_text

    if output_mode == OutputMode.surrogate:
        try:
            from clinical_deid.pipes.surrogate.strategies import SurrogateGenerator
        except ImportError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"surrogate mode requires faker: {exc}",
            ) from exc

        gen = SurrogateGenerator(seed=surrogate_seed, consistency=surrogate_consistency)
        phi_spans = sorted(
            [PHISpan(start=s.start, end=s.end, label=s.label) for s in spans],
            key=lambda s: s.start,
            reverse=True,
        )
        result = original_text
        for s in phi_spans:
            original = original_text[s.start : s.end]
            replacement = gen.replace(s.label, original)
            result = result[: s.start] + replacement + result[s.end :]
        return result

    # Default: redacted (tag replacement)
    phi_spans = [PHISpan(start=s.start, end=s.end, label=s.label) for s in spans]
    return tag_replace(original_text, phi_spans)


def _process_single(
    text: str,
    request_id: str | None,
    pipe_chain: Pipe,
    pipeline_name: str,
    pipeline_config: dict[str, Any],
    *,
    trace: bool = False,
    output_mode: OutputMode = OutputMode.redacted,
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

    # Apply output mode (redact / surrogate / annotated)
    redacted = _apply_output_mode(text, span_responses, output_mode)

    return ProcessResponse(
        request_id=req_id,
        original_text=text,
        redacted_text=redacted,
        spans=span_responses,
        pipeline_name=pipeline_name,
        processing_time_ms=round(elapsed_ms, 2),
        intermediary_trace=intermediary_trace,
    )


def _entity_counts(responses: list[ProcessResponse]) -> dict[str, int]:
    """Per-label span counts across all responses."""
    counts: Counter[str] = Counter()
    for r in responses:
        for s in r.spans:
            counts[s.label] += 1
    return dict(counts)


def _log_audit(
    session: Any,
    pipeline_name: str,
    pipeline_config: dict[str, Any],
    responses: list[ProcessResponse],
    *,
    source: str = "api",
    output_mode: OutputMode = OutputMode.redacted,
    client_id: str = "",
    service_type: str = "inference",
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
            client_id=client_id,
            output_mode=output_mode.value,
            service_type=service_type,
            metrics={"entity_counts": _entity_counts(responses)},
        )
        session.add(record)
    except Exception:
        logger.warning("Failed to write audit log", exc_info=True)


# ---------------------------------------------------------------------------
# Fixed routes MUST come before parameterized /{pipeline_name} routes
# ---------------------------------------------------------------------------


@router.post("/redact", response_model=RedactResponse)
def redact_document(
    session: SessionDep,
    body: RedactRequest,
    x_client_id: str | None = Header(default=None),
) -> RedactResponse:
    """Apply redaction or surrogate replacement given text and known spans.

    Useful after human review: the user corrects spans in the UI, then
    sends the final set here for export.
    """
    span_responses = [
        PHISpanResponse(
            start=s.start, end=s.end, label=s.label,
            text=body.text[s.start : s.end],
        )
        for s in body.spans
    ]
    output_text = _apply_output_mode(
        body.text, span_responses, body.output_mode,
        surrogate_seed=body.surrogate_seed,
        surrogate_consistency=body.surrogate_consistency,
    )

    # Audit
    try:
        import getpass

        counts: dict[str, int] = {}
        for s in body.spans:
            counts[s.label] = counts.get(s.label, 0) + 1
        record = AuditLogRecord(
            user=getpass.getuser(),
            command="redact",
            pipeline_name="",
            doc_count=1,
            span_count=len(body.spans),
            source="api",
            client_id=x_client_id or "",
            output_mode=body.output_mode.value,
            service_type="redact",
            metrics={"entity_counts": counts},
        )
        session.add(record)
    except Exception:
        logger.warning("Failed to write audit log for redact", exc_info=True)

    return RedactResponse(
        output_text=output_text,
        output_mode=body.output_mode,
        span_count=len(body.spans),
    )


@router.post("/scrub", response_model=ScrubResponse)
def scrub_text(
    session: SessionDep,
    body: ScrubRequest,
    x_client_id: str | None = Header(default=None),
) -> ScrubResponse:
    """Zero-config log cleaning: text in, clean text out.

    Uses the deploy config's ``default_mode`` when no mode/pipeline is
    specified.  Designed for easy integration from other services::

        import httpx
        client = httpx.Client(base_url="http://deid-server:8000")
        clean = client.post("/process/scrub", json={"text": log_line}).json()["text"]
    """
    from clinical_deid.mode_config import load_mode_config

    deploy_cfg = load_mode_config()

    # Resolve pipeline name: explicit mode > deploy default > fallback "fast"
    mode_or_pipeline = body.mode or deploy_cfg.default_mode or "fast"
    pipeline_name = deploy_cfg.resolve(mode_or_pipeline)

    pipe_chain, config = _load_pipe_chain(pipeline_name)

    resp = _process_single(
        body.text, body.request_id, pipe_chain, pipeline_name, config,
        output_mode=body.output_mode,
    )

    _log_audit(
        session, pipeline_name, config, [resp],
        output_mode=body.output_mode,
        client_id=x_client_id or "",
        service_type="scrub",
    )

    return ScrubResponse(
        text=resp.redacted_text,
        pipeline_used=pipeline_name,
        output_mode=body.output_mode,
        span_count=len(resp.spans),
        processing_time_ms=resp.processing_time_ms,
    )


# ---------------------------------------------------------------------------
# Parameterized pipeline routes
# ---------------------------------------------------------------------------


@router.post("/{pipeline_name}", response_model=ProcessResponse)
def process_text(
    session: SessionDep,
    pipeline_name: str,
    body: ProcessRequest,
    trace: bool = False,
    output_mode: OutputMode = OutputMode.redacted,
    x_client_id: str | None = Header(default=None),
) -> ProcessResponse:
    pipe_chain, config = _load_pipe_chain(pipeline_name)
    resp = _process_single(
        body.text, body.request_id, pipe_chain, pipeline_name, config,
        trace=trace, output_mode=output_mode,
    )
    _log_audit(
        session, pipeline_name, config, [resp],
        output_mode=output_mode,
        client_id=x_client_id or "",
    )
    return resp


@router.post("/{pipeline_name}/batch", response_model=BatchProcessResponse)
def process_batch(
    session: SessionDep,
    pipeline_name: str,
    body: BatchProcessRequest,
    trace: bool = False,
    output_mode: OutputMode = OutputMode.redacted,
    x_client_id: str | None = Header(default=None),
) -> BatchProcessResponse:
    pipe_chain, config = _load_pipe_chain(pipeline_name)

    t0 = time.perf_counter()
    results = [
        _process_single(
            item.text, item.request_id, pipe_chain, pipeline_name, config,
            trace=trace, output_mode=output_mode,
        )
        for item in body.items
    ]
    total_ms = (time.perf_counter() - t0) * 1000

    _log_audit(
        session, pipeline_name, config, results,
        output_mode=output_mode,
        client_id=x_client_id or "",
        service_type="batch",
    )

    return BatchProcessResponse(
        results=results,
        total_processing_time_ms=round(total_ms, 2),
    )
