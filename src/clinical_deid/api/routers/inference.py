"""Saved inference snapshots — list, save, load, delete JSON files under ``inference_runs/``."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from clinical_deid.api.schemas import (
    SavedInferenceRunDetail,
    SavedInferenceRunSummary,
    SaveInferenceSnapshotRequest,
)
from clinical_deid.config import get_settings
from clinical_deid.inference_store import (
    delete_inference_run,
    list_inference_runs,
    load_inference_run,
    save_inference_run,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inference", tags=["inference"])


@router.get("/runs", response_model=list[SavedInferenceRunSummary])
def list_saved_runs() -> list[SavedInferenceRunSummary]:
    """List saved inference snapshots, newest first."""
    rows = list_inference_runs(get_settings().inference_runs_dir)
    return [
        SavedInferenceRunSummary(
            id=r.id,
            pipeline_name=r.pipeline_name,
            saved_at=r.saved_at,
            text_preview=r.text_preview,
            span_count=r.span_count,
        )
        for r in rows
    ]


@router.post("/runs", response_model=SavedInferenceRunDetail)
def save_snapshot(body: SaveInferenceSnapshotRequest) -> SavedInferenceRunDetail:
    """Persist a process response as a JSON snapshot for later reload."""
    try:
        path = save_inference_run(
            get_settings().inference_runs_dir,
            body.model_dump(mode="json"),
        )
    except OSError as exc:
        logger.exception("Failed to save inference snapshot")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    data = load_inference_run(get_settings().inference_runs_dir, path.stem)
    return SavedInferenceRunDetail.model_validate(data)


@router.get("/runs/{run_id}", response_model=SavedInferenceRunDetail)
def get_saved_run(run_id: str) -> SavedInferenceRunDetail:
    """Load a full snapshot by ID."""
    try:
        data = load_inference_run(get_settings().inference_runs_dir, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return SavedInferenceRunDetail.model_validate(data)


@router.delete("/runs/{run_id}", status_code=204)
def delete_saved_run(run_id: str) -> None:
    """Delete a saved snapshot file."""
    try:
        delete_inference_run(get_settings().inference_runs_dir, run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
