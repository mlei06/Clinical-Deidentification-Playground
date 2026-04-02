"""Evaluation HTTP API — run pipelines against datasets and retrieve metrics."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import col, select

from clinical_deid.api.deps import (
    SessionDep,
    get_current_version,
    get_pipeline_or_404,
)
from clinical_deid.db import get_cached_pipeline
from clinical_deid.tables import EvalRunRecord

router = APIRouter(prefix="/eval", tags=["evaluation"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class MatchMetrics(BaseModel):
    precision: float
    recall: float
    f1: float
    tp: int
    fp: int
    fn: int


class EvalMetricsResponse(BaseModel):
    strict: MatchMetrics
    exact_boundary: MatchMetrics
    partial_overlap: MatchMetrics
    token_level: MatchMetrics
    risk_weighted_recall: float


class EvalRunRequest(BaseModel):
    pipeline_id: str
    dataset_path: str  # local path to JSONL or BRAT corpus
    dataset_format: str = "jsonl"  # "jsonl", "brat-dir", "brat-corpus"


class EvalRunSummary(BaseModel):
    id: str
    pipeline_id: str
    pipeline_version: int
    dataset_source: str
    document_count: int
    strict_f1: float
    risk_weighted_recall: float
    created_at: datetime


class EvalRunDetail(EvalRunSummary):
    metrics: dict[str, Any]


class EvalCompareRequest(BaseModel):
    run_id_a: str
    run_id_b: str


class EvalCompareResponse(BaseModel):
    run_a: EvalRunDetail
    run_b: EvalRunDetail
    delta_strict_f1: float
    delta_risk_weighted_recall: float


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run_detail(r: EvalRunRecord) -> EvalRunDetail:
    metrics = r.metrics or {}
    strict = metrics.get("overall", {}).get("strict", {})
    rwr = metrics.get("risk_weighted_recall", 0.0)
    return EvalRunDetail(
        id=r.id,
        pipeline_id=r.pipeline_id,
        pipeline_version=r.pipeline_version,
        dataset_source=r.dataset_source,
        document_count=r.document_count,
        strict_f1=strict.get("f1", 0.0),
        risk_weighted_recall=rwr,
        created_at=r.created_at,
        metrics=metrics,
    )


def _match_result_to_dict(mr) -> dict[str, Any]:
    return {
        "precision": mr.precision,
        "recall": mr.recall,
        "f1": mr.f1,
        "tp": mr.tp,
        "fp": mr.fp,
        "fn": mr.fn,
    }


def _eval_metrics_to_dict(em) -> dict[str, Any]:
    return {
        "strict": _match_result_to_dict(em.strict),
        "exact_boundary": _match_result_to_dict(em.exact_boundary),
        "partial_overlap": _match_result_to_dict(em.partial_overlap),
        "token_level": _match_result_to_dict(em.token_level),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/run", response_model=EvalRunDetail, status_code=201)
def run_evaluation(session: SessionDep, body: EvalRunRequest) -> EvalRunDetail:
    """Run a pipeline against a local dataset and store results."""
    from pathlib import Path

    from clinical_deid.eval.runner import evaluate_pipeline
    from clinical_deid.ingest.sources import load_annotated_corpus

    pipeline_rec = get_pipeline_or_404(session, body.pipeline_id)
    ver = get_current_version(session, pipeline_rec)

    try:
        pipe_chain = get_cached_pipeline(ver.config_hash, ver.config)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"failed to build pipeline: {exc}"
        ) from exc

    # Load dataset
    corpus_path = Path(body.dataset_path)
    if not corpus_path.exists():
        raise HTTPException(status_code=404, detail=f"dataset path not found: {body.dataset_path}")

    fmt_map = {
        "jsonl": {"jsonl": corpus_path},
        "brat-dir": {"brat_dir": corpus_path},
        "brat-corpus": {"brat_corpus": corpus_path},
    }
    if body.dataset_format not in fmt_map:
        raise HTTPException(status_code=422, detail=f"unknown format: {body.dataset_format}")

    try:
        documents = load_annotated_corpus(**fmt_map[body.dataset_format])
    except Exception as exc:
        raise HTTPException(
            status_code=422, detail=f"failed to load dataset: {exc}"
        ) from exc

    if not documents:
        raise HTTPException(status_code=422, detail="dataset is empty")

    # Run evaluation
    result = evaluate_pipeline(pipe_chain, documents)

    # Serialize metrics
    per_label_dict = {}
    for label, lm in result.per_label.items():
        per_label_dict[label] = {
            "strict": _match_result_to_dict(lm.strict),
            "partial_overlap": _match_result_to_dict(lm.partial_overlap),
            "token_level": _match_result_to_dict(lm.token_level),
            "support": lm.support,
        }

    metrics = {
        "overall": _eval_metrics_to_dict(result.overall),
        "per_label": per_label_dict,
        "risk_weighted_recall": result.risk_weighted_recall,
        "label_confusion": result.label_confusion,
    }

    # Persist
    record = EvalRunRecord(
        pipeline_id=pipeline_rec.id,
        pipeline_version=ver.version,
        dataset_source=body.dataset_path,
        metrics=metrics,
        document_count=result.document_count,
    )
    session.add(record)
    session.flush()

    return _run_detail(record)


@router.get("/runs", response_model=list[EvalRunSummary])
def list_eval_runs(
    session: SessionDep,
    pipeline_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[EvalRunSummary]:
    """List past evaluation runs."""
    stmt = select(EvalRunRecord)
    if pipeline_id:
        stmt = stmt.where(EvalRunRecord.pipeline_id == pipeline_id)
    stmt = stmt.order_by(col(EvalRunRecord.created_at).desc()).offset(offset).limit(limit)
    records = session.exec(stmt).all()

    results = []
    for r in records:
        metrics = r.metrics or {}
        strict = metrics.get("overall", {}).get("strict", {})
        results.append(
            EvalRunSummary(
                id=r.id,
                pipeline_id=r.pipeline_id,
                pipeline_version=r.pipeline_version,
                dataset_source=r.dataset_source,
                document_count=r.document_count,
                strict_f1=strict.get("f1", 0.0),
                risk_weighted_recall=metrics.get("risk_weighted_recall", 0.0),
                created_at=r.created_at,
            )
        )
    return results


@router.get("/runs/{run_id}", response_model=EvalRunDetail)
def get_eval_run(session: SessionDep, run_id: str) -> EvalRunDetail:
    """Get detailed metrics for an evaluation run."""
    record = session.get(EvalRunRecord, run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="eval run not found")
    return _run_detail(record)


@router.post("/compare", response_model=EvalCompareResponse)
def compare_eval_runs(
    session: SessionDep, body: EvalCompareRequest
) -> EvalCompareResponse:
    """Compare two evaluation runs side by side."""
    run_a = session.get(EvalRunRecord, body.run_id_a)
    run_b = session.get(EvalRunRecord, body.run_id_b)
    if run_a is None:
        raise HTTPException(status_code=404, detail=f"run {body.run_id_a!r} not found")
    if run_b is None:
        raise HTTPException(status_code=404, detail=f"run {body.run_id_b!r} not found")

    detail_a = _run_detail(run_a)
    detail_b = _run_detail(run_b)

    return EvalCompareResponse(
        run_a=detail_a,
        run_b=detail_b,
        delta_strict_f1=round(detail_b.strict_f1 - detail_a.strict_f1, 6),
        delta_risk_weighted_recall=round(
            detail_b.risk_weighted_recall - detail_a.risk_weighted_recall, 6
        ),
    )
