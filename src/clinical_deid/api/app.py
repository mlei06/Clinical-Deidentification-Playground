from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from clinical_deid.api.routers import audit, dictionaries, evaluation, inference, models, pipelines, process
from clinical_deid.api.schemas import HealthResponse
from clinical_deid.db import init_db

logger = logging.getLogger("clinical_deid")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    logger.info("database initialised, API ready")
    yield


def create_app() -> FastAPI:
    """Application factory — defers settings access until called."""
    from clinical_deid.config import get_settings

    application = FastAPI(
        title="Clinical De-Identification Playground",
        description=(
            "Platform API: compose and version de-identification pipelines, run inference for upstream "
            "services, and return auditable responses (timing, spans, optional step traces). "
            "Train models locally, drop artifacts under `models/`, and reference them from pipe configs. "
            "Planned: playground UI (try text + evaluate on local paths or uploads) and eval APIs—see docs."
        ),
        lifespan=lifespan,
    )

    # CORS — configured via settings (env var CLINICAL_DEID_CORS_ORIGINS or .env).
    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["*"],
    )

    application.include_router(pipelines.router)
    application.include_router(process.router)
    application.include_router(inference.router)
    application.include_router(audit.router)
    application.include_router(evaluation.router)
    application.include_router(models.router)
    application.include_router(dictionaries.router)

    @application.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse()

    return application


app = create_app()
