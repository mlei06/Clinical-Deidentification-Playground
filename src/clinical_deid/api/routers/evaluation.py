"""Evaluation HTTP API — run pipelines against datasets and retrieve metrics."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from clinical_deid.api.deps import SessionDep
from clinical_deid.config import get_settings
from clinical_deid.eval_store import EvalResultInfo, list_eval_results, load_eval_result, save_eval_result
from clinical_deid.pipeline_store import load_pipeline_config
from clinical_deid.pipes.registry import load_pipeline
from clinical_deid.tables import AuditLogRecord

logger = logging.getLogger(__name__)

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
    pipeline_name: str
    dataset_path: str  # local path to JSONL or BRAT corpus
    dataset_format: str = "jsonl"  # "jsonl", "brat-dir", "brat-corpus"


class EvalRunSummary(BaseModel):
    id: str
    pipeline_name: str
    dataset_source: str
    document_count: int
    strict_f1: float
    risk_weighted_recall: float
    created_at: str


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


def _info_to_summary(info: EvalResultInfo) -> EvalRunSummary:
    return EvalRunSummary(
        id=info.id,
        pipeline_name=info.pipeline_name,
        dataset_source=info.dataset_source,
        document_count=info.document_count,
        strict_f1=info.strict_f1,
        risk_weighted_recall=info.risk_weighted_recall,
        created_at=info.created_at,
    )


def _data_to_detail(data: dict[str, Any]) -> EvalRunDetail:
    metrics = data.get("metrics", {})
    overall = metrics.get("overall", {})
    strict = overall.get("strict", {})
    return EvalRunDetail(
        id=data.get("id", ""),
        pipeline_name=data.get("pipeline_name", ""),
        dataset_source=data.get("dataset_source", ""),
        document_count=data.get("document_count", 0),
        strict_f1=strict.get("f1", 0.0),
        risk_weighted_recall=metrics.get("risk_weighted_recall", 0.0),
        created_at=data.get("created_at", ""),
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

    settings = get_settings()

    # Load pipeline from filesystem
    try:
        config = load_pipeline_config(settings.pipelines_dir, body.pipeline_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        pipe_chain = load_pipeline(config)
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

    # Persist eval result to filesystem
    save_eval_result(
        settings.evaluations_dir,
        pipeline_name=body.pipeline_name,
        dataset_source=body.dataset_path,
        metrics=metrics,
        document_count=result.document_count,
    )

    # Audit log
    try:
        import getpass

        record = AuditLogRecord(
            user=getpass.getuser(),
            command="eval",
            pipeline_name=body.pipeline_name,
            pipeline_config=config,
            dataset_source=body.dataset_path,
            doc_count=result.document_count,
            span_count=result.overall.strict.tp + result.overall.strict.fp,
            duration_seconds=0.0,
            metrics={
                "strict_f1": result.overall.strict.f1,
                "risk_weighted_recall": result.risk_weighted_recall,
            },
            source="api",
        )
        session.add(record)
    except Exception:
        logger.debug("Failed to write eval audit log", exc_info=True)

    # Return result
    data = {
        "id": f"{body.pipeline_name}_latest",
        "pipeline_name": body.pipeline_name,
        "dataset_source": body.dataset_path,
        "document_count": result.document_count,
        "metrics": metrics,
        "created_at": "",
    }
    return _data_to_detail(data)


@router.get("/runs", response_model=list[EvalRunSummary])
def list_eval_runs(
    pipeline_name: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[EvalRunSummary]:
    """List past evaluation runs (from filesystem)."""
    settings = get_settings()
    results = list_eval_results(settings.evaluations_dir, pipeline_name=pipeline_name)
    # Apply offset/limit
    results = results[offset : offset + limit]
    return [_info_to_summary(r) for r in results]


@router.get("/runs/{run_id}", response_model=EvalRunDetail)
def get_eval_run(run_id: str) -> EvalRunDetail:
    """Get detailed metrics for an evaluation run."""
    settings = get_settings()
    try:
        data = load_eval_result(settings.evaluations_dir, run_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _data_to_detail(data)


@router.post("/compare", response_model=EvalCompareResponse)
def compare_eval_runs(body: EvalCompareRequest) -> EvalCompareResponse:
    """Compare two evaluation runs side by side."""
    settings = get_settings()
    try:
        data_a = load_eval_result(settings.evaluations_dir, body.run_id_a)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"run {body.run_id_a!r} not found")
    try:
        data_b = load_eval_result(settings.evaluations_dir, body.run_id_b)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"run {body.run_id_b!r} not found")

    detail_a = _data_to_detail(data_a)
    detail_b = _data_to_detail(data_b)

    return EvalCompareResponse(
        run_a=detail_a,
        run_b=detail_b,
        delta_strict_f1=round(detail_b.strict_f1 - detail_a.strict_f1, 6),
        delta_risk_weighted_recall=round(
            detail_b.risk_weighted_recall - detail_a.risk_weighted_recall, 6
        ),
    )
