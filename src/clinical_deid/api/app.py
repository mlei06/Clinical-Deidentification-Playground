from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from clinical_deid.api.routers import pipelines, process
from clinical_deid.api.schemas import HealthResponse
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

# CORS — restrictive by default; widen allow_origins for production deployments.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

app.include_router(pipelines.router)
app.include_router(process.router)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()
