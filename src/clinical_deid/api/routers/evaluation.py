"""Evaluation HTTP API — run pipelines against datasets and retrieve metrics."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from clinical_deid.api.auth import require_admin
from clinical_deid.api.deps import SessionDep
from clinical_deid.config import get_settings
from clinical_deid.eval_store import EvalResultInfo, list_eval_results, load_eval_result, save_eval_result
from clinical_deid.pipeline_store import load_pipeline_config
from clinical_deid.pipes.registry import load_pipeline
from clinical_deid.tables import AuditLogRecord

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/eval", tags=["evaluation"], dependencies=[require_admin])


def _eval_dataset_source_with_splits(base: str, splits: list[str] | None) -> str:
    if not splits or not any(str(s).strip() for s in splits):
        return base
    norm = sorted({s.strip() for s in splits if s and str(s).strip()})
    return f"{base}:splits={'+'.join(norm)}"


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
    dataset_path: str | None = None
    dataset_name: str | None = None
    #: If set, only documents whose ``metadata["split"]`` is in this list are evaluated.
    dataset_splits: list[str] | None = None


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


def _redaction_metrics_to_dict(rm) -> dict[str, Any]:
    return {
        "gold_phi_count": rm.gold_phi_count,
        "leaked_phi_count": rm.leaked_phi_count,
        "leakage_rate": rm.leakage_rate,
        "redaction_recall": rm.redaction_recall,
        "over_redaction_chars": rm.over_redaction_chars,
        "original_length": rm.original_length,
        "redacted_length": rm.redacted_length,
        "per_label": [
            {
                "label": ll.label,
                "gold_count": ll.gold_count,
                "leaked_count": ll.leaked_count,
                "leakage_rate": ll.leakage_rate,
            }
            for ll in rm.per_label
        ],
        "leaked_spans": [
            {
                "label": ls.label,
                "original_text": ls.original_text,
                "found_at": ls.found_at,
            }
            for ls in rm.leaked_spans
        ],
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
    from clinical_deid.transform.ops import filter_documents_by_split_query

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

    # Load dataset — either from a registered dataset name or a raw path.
    dataset_source: str
    if body.dataset_name:
        from clinical_deid.dataset_store import load_dataset_documents

        try:
            documents = load_dataset_documents(settings.corpora_dir, body.dataset_name)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"failed to load dataset: {exc}") from exc
        dataset_source = _eval_dataset_source_with_splits(
            f"dataset:{body.dataset_name}",
            body.dataset_splits,
        )
    elif body.dataset_path:
        corpus_path = Path(body.dataset_path).resolve()
        allowed_roots = [Path.cwd().resolve()]
        if settings.evaluations_dir.is_absolute():
            allowed_roots.append(settings.evaluations_dir.resolve())
        if not any(corpus_path == root or root in corpus_path.parents for root in allowed_roots):
            raise HTTPException(
                status_code=403,
                detail="dataset_path must be within the project working directory",
            )
        if not corpus_path.exists():
            raise HTTPException(status_code=404, detail=f"dataset path not found: {body.dataset_path}")
        if corpus_path.suffix.lower() != ".jsonl":
            raise HTTPException(
                status_code=422,
                detail=(
                    "dataset_path must be a .jsonl file. "
                    "Convert BRAT to JSONL first (e.g. POST /datasets/import/brat or "
                    "`clinical-deid dataset import-brat`)."
                ),
            )

        try:
            documents = load_annotated_corpus(jsonl=corpus_path)
        except Exception as exc:
            raise HTTPException(
                status_code=422, detail=f"failed to load dataset: {exc}"
            ) from exc
        dataset_source = _eval_dataset_source_with_splits(
            str(corpus_path),
            body.dataset_splits,
        )
    else:
        raise HTTPException(
            status_code=422, detail="Provide either dataset_name or dataset_path"
        )

    if not documents:
        raise HTTPException(status_code=422, detail="dataset is empty")

    if body.dataset_splits and any(str(s).strip() for s in body.dataset_splits):
        documents = filter_documents_by_split_query(documents, body.dataset_splits)
        if not documents:
            raise HTTPException(
                status_code=422,
                detail="No documents match dataset_splits; ensure metadata['split'] matches or adjust the filter.",
            )

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

    metrics: dict[str, Any] = {
        "overall": _eval_metrics_to_dict(result.overall),
        "per_label": per_label_dict,
        "risk_weighted_recall": result.risk_weighted_recall,
        "label_confusion": result.label_confusion,
        "has_redaction": result.has_redaction,
    }

    if result.redaction is not None:
        metrics["redaction"] = _redaction_metrics_to_dict(result.redaction)

    # Persist eval result to filesystem
    result_path = save_eval_result(
        settings.evaluations_dir,
        pipeline_name=body.pipeline_name,
        dataset_source=dataset_source,
        metrics=metrics,
        document_count=result.document_count,
    )
    result_id = result_path.stem

    # Audit log
    try:
        import getpass

        record = AuditLogRecord(
            user=getpass.getuser(),
            command="eval",
            pipeline_name=body.pipeline_name,
            pipeline_config=config,
            dataset_source=dataset_source,
            doc_count=result.document_count,
            span_count=result.overall.strict.tp + result.overall.strict.fp,
            duration_seconds=0.0,
            metrics={
                "strict_f1": result.overall.strict.f1,
                "risk_weighted_recall": result.risk_weighted_recall,
            },
            source="api-admin",
        )
        session.add(record)
    except Exception:
        logger.warning("Failed to write eval audit log", exc_info=True)

    # Return result — read back the saved file for consistent id/created_at
    saved = load_eval_result(settings.evaluations_dir, result_id)
    return _data_to_detail(saved)


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
