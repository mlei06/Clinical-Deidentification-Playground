"""Audit log HTTP API — query processing logs for compliance and debugging."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import col, func, select

from clinical_deid.api.deps import SessionDep
from clinical_deid.tables import AuditLogRecord

router = APIRouter(prefix="/audit", tags=["audit"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

from pydantic import BaseModel


class AuditLogSummary(BaseModel):
    id: str
    request_id: str
    pipeline_id: str
    pipeline_name: str
    pipeline_version: int
    span_count: int
    processing_time_ms: float
    source: str
    caller: str | None
    created_at: datetime


class AuditLogDetail(AuditLogSummary):
    input_text: str
    output_text: str
    spans: list[dict[str, Any]]


class AuditStats(BaseModel):
    total_requests: int
    avg_processing_time_ms: float
    total_spans_detected: int
    top_pipelines: list[dict[str, Any]]
    label_distribution: dict[str, int]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/logs", response_model=list[AuditLogSummary])
def list_audit_logs(
    session: SessionDep,
    pipeline_id: str | None = Query(default=None),
    source: str | None = Query(default=None),
    from_date: datetime | None = Query(default=None),
    to_date: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[AuditLogSummary]:
    """List audit logs with optional filters."""
    stmt = select(AuditLogRecord)

    if pipeline_id:
        stmt = stmt.where(AuditLogRecord.pipeline_id == pipeline_id)
    if source:
        stmt = stmt.where(AuditLogRecord.source == source)
    if from_date:
        stmt = stmt.where(col(AuditLogRecord.created_at) >= from_date)
    if to_date:
        stmt = stmt.where(col(AuditLogRecord.created_at) <= to_date)

    stmt = stmt.order_by(col(AuditLogRecord.created_at).desc()).offset(offset).limit(limit)
    records = session.exec(stmt).all()

    return [
        AuditLogSummary(
            id=r.id,
            request_id=r.request_id,
            pipeline_id=r.pipeline_id,
            pipeline_name=r.pipeline_name,
            pipeline_version=r.pipeline_version,
            span_count=r.span_count,
            processing_time_ms=r.processing_time_ms,
            source=r.source,
            caller=r.caller,
            created_at=r.created_at,
        )
        for r in records
    ]


@router.get("/logs/{log_id}", response_model=AuditLogDetail)
def get_audit_log(session: SessionDep, log_id: str) -> AuditLogDetail:
    """Get full audit log detail including input/output text and spans."""
    record = session.get(AuditLogRecord, log_id)
    if record is None:
        raise HTTPException(status_code=404, detail="audit log not found")
    return AuditLogDetail(
        id=record.id,
        request_id=record.request_id,
        pipeline_id=record.pipeline_id,
        pipeline_name=record.pipeline_name,
        pipeline_version=record.pipeline_version,
        span_count=record.span_count,
        processing_time_ms=record.processing_time_ms,
        source=record.source,
        caller=record.caller,
        created_at=record.created_at,
        input_text=record.input_text,
        output_text=record.output_text,
        spans=record.spans,
    )


@router.get("/stats", response_model=AuditStats)
def audit_stats(
    session: SessionDep,
    pipeline_id: str | None = Query(default=None),
) -> AuditStats:
    """Aggregate audit stats: total requests, avg processing time, top pipelines, label distribution."""
    base = select(AuditLogRecord)
    if pipeline_id:
        base = base.where(AuditLogRecord.pipeline_id == pipeline_id)

    records = session.exec(base).all()

    if not records:
        return AuditStats(
            total_requests=0,
            avg_processing_time_ms=0.0,
            total_spans_detected=0,
            top_pipelines=[],
            label_distribution={},
        )

    total = len(records)
    avg_time = sum(r.processing_time_ms for r in records) / total
    total_spans = sum(r.span_count for r in records)

    # Top pipelines by request count
    pipeline_counts: dict[str, int] = {}
    for r in records:
        pipeline_counts[r.pipeline_name] = pipeline_counts.get(r.pipeline_name, 0) + 1
    top_pipelines = [
        {"pipeline_name": name, "request_count": count}
        for name, count in sorted(pipeline_counts.items(), key=lambda x: -x[1])[:10]
    ]

    # Label distribution from spans
    label_dist: dict[str, int] = {}
    for r in records:
        for span in (r.spans or []):
            label = span.get("label", "UNKNOWN")
            label_dist[label] = label_dist.get(label, 0) + 1

    return AuditStats(
        total_requests=total,
        avg_processing_time_ms=round(avg_time, 2),
        total_spans_detected=total_spans,
        top_pipelines=top_pipelines,
        label_distribution=label_dist,
    )
