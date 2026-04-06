from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from clinical_deid.api.routers import audit, evaluation, models, pipelines, process
from clinical_deid.api.schemas import HealthResponse
from clinical_deid.config import get_settings
from clinical_deid.db import init_db

logger = logging.getLogger("clinical_deid")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    logger.info("database initialised, API ready")
    yield


app = FastAPI(
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

app.include_router(pipelines.router)
app.include_router(process.router)
app.include_router(audit.router)
app.include_router(evaluation.router)
app.include_router(models.router)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()
