"""Production API — minimal surface for deployed inference.

Exposes only:
- Health check
- List available pipelines (read-only)
- Get pipeline detail (read-only)
- List available modes
- Process text (by pipeline name or mode alias)
- Batch process (by pipeline name or mode alias)
- Audit log queries (read-only)

No pipeline CRUD, no evaluation, no dictionary management, no model management,
no inference snapshots.  Those belong to the local playground.
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from clinical_deid.api.deps import SessionDep
from clinical_deid.api.routers.process import _load_pipe_chain, _log_audit, _process_single
from clinical_deid.api.schemas import (
    BatchProcessRequest,
    BatchProcessResponse,
    HealthResponse,
    PipelineDetail,
    ProcessRequest,
    ProcessResponse,
)
from clinical_deid.config import get_settings
from clinical_deid.db import init_db
from clinical_deid.mode_config import ModeConfig, ModeEntry, load_mode_config
from clinical_deid.pipeline_store import list_pipelines, load_pipeline_config

logger = logging.getLogger("clinical_deid.production")

# ---------------------------------------------------------------------------
# Schemas specific to the production API
# ---------------------------------------------------------------------------


class ModeInfo(BaseModel):
    name: str
    pipeline: str
    description: str = ""


class ModesResponse(BaseModel):
    modes: list[ModeInfo]
    default_mode: str | None = None


class PipelineSummary(BaseModel):
    name: str
    pipe_count: int
    pipe_types: list[str]


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(tags=["production"])


def _get_mode_config() -> ModeConfig:
    """Load mode config (cached on the app state in create_production_app)."""
    return _mode_config


_mode_config = ModeConfig()


def _resolve_pipeline(target: str) -> str:
    """Resolve a mode alias or pipeline name to a concrete pipeline name.

    Raises 403 if the resolved pipeline is not in the allowlist.
    """
    pipeline_name = _mode_config.resolve(target)
    if not _mode_config.is_pipeline_allowed(pipeline_name):
        raise HTTPException(
            status_code=403,
            detail=f"pipeline {pipeline_name!r} is not allowed in production",
        )
    return pipeline_name


# -- Modes ------------------------------------------------------------------


@router.get("/modes", response_model=ModesResponse)
def list_modes() -> ModesResponse:
    """List configured inference modes and their backing pipelines."""
    cfg = _mode_config
    return ModesResponse(
        modes=[
            ModeInfo(name=name, pipeline=entry.pipeline, description=entry.description)
            for name, entry in sorted(cfg.modes.items())
        ],
        default_mode=cfg.default_mode,
    )


# -- Pipelines (read-only) -------------------------------------------------


@router.get("/pipelines", response_model=list[PipelineSummary])
def list_available_pipelines() -> list[PipelineSummary]:
    """List saved pipelines (name + high-level info only).

    If an allowlist is configured, only allowed pipelines are returned.
    """
    summaries: list[PipelineSummary] = []
    for p in list_pipelines(get_settings().pipelines_dir):
        if not _mode_config.is_pipeline_allowed(p.name):
            continue
        pipes = p.config.get("pipes", [])
        summaries.append(
            PipelineSummary(
                name=p.name,
                pipe_count=len(pipes),
                pipe_types=[step.get("type", "?") for step in pipes],
            )
        )
    return summaries


@router.get("/pipelines/{pipeline_name}", response_model=PipelineDetail)
def get_pipeline(pipeline_name: str) -> PipelineDetail:
    """Get a single pipeline's full config."""
    try:
        config = load_pipeline_config(get_settings().pipelines_dir, pipeline_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return PipelineDetail(name=pipeline_name, config=config)


# -- Inference --------------------------------------------------------------


@router.post("/infer/{target}", response_model=ProcessResponse)
def infer(
    session: SessionDep,
    target: str,
    body: ProcessRequest,
    trace: bool = False,
) -> ProcessResponse:
    """Run a single text through a pipeline.

    ``target`` may be a mode name (``fast``, ``balanced``, ``accurate``) or a
    saved pipeline name.
    """
    pipeline_name = _resolve_pipeline(target)
    pipe_chain, config = _load_pipe_chain(pipeline_name)
    resp = _process_single(body.text, body.request_id, pipe_chain, pipeline_name, config, trace=trace)
    _log_audit(session, pipeline_name, config, [resp], source="production-api")
    return resp


@router.post("/infer/{target}/batch", response_model=BatchProcessResponse)
def infer_batch(
    session: SessionDep,
    target: str,
    body: BatchProcessRequest,
    trace: bool = False,
) -> BatchProcessResponse:
    """Batch-process texts through a pipeline.

    ``target`` may be a mode name or a saved pipeline name.
    """
    pipeline_name = _resolve_pipeline(target)
    pipe_chain, config = _load_pipe_chain(pipeline_name)

    t0 = time.perf_counter()
    results = [
        _process_single(item.text, item.request_id, pipe_chain, pipeline_name, config, trace=trace)
        for item in body.items
    ]
    total_ms = (time.perf_counter() - t0) * 1000

    _log_audit(session, pipeline_name, config, results, source="production-api")

    return BatchProcessResponse(
        results=results,
        total_processing_time_ms=round(total_ms, 2),
    )


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


@asynccontextmanager
async def _lifespan(app: FastAPI):
    init_db()
    logger.info("production API ready")
    yield


def create_production_app(*, modes_path: str | None = None) -> FastAPI:
    """Build the production FastAPI application.

    Parameters
    ----------
    modes_path
        Path to the modes JSON config.  Defaults to ``modes.json`` in the cwd.
    """
    from pathlib import Path

    global _mode_config

    settings = get_settings()

    # Load mode config
    mp = Path(modes_path) if modes_path else Path("modes.json")
    _mode_config = load_mode_config(mp)
    logger.info(
        "loaded %d mode(s) from %s: %s",
        len(_mode_config.modes),
        mp,
        ", ".join(_mode_config.mode_names()) or "(none)",
    )

    app = FastAPI(
        title="Clinical De-Identification API",
        description="Production inference API for clinical text de-identification.",
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    # Mount production router
    app.include_router(router)

    # Mount audit (read-only — same router, all endpoints are GET)
    from clinical_deid.api.routers.audit import router as audit_router

    app.include_router(audit_router)

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse()

    return app
