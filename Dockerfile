# Clinical De-Identification API — production image.
#
# Build:  docker build -t clinical-deid-api .
# Run:    docker run -p 8000:8000 -v $(pwd)/pipelines:/app/pipelines ... clinical-deid-api
#
# Default extras: Presidio, spaCy/NER, LLM client, Parquet, and ``scripts`` (Faker/pandas)
# for API ``output_mode=surrogate`` / redact. The heavy [train] extra (transformers+torch)
# is omitted; for huggingface_ner at runtime use e.g.
#   --build-arg EXTRAS=presidio,ner,llm,parquet,scripts,train

FROM python:3.11-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System deps — curl for HEALTHCHECK, build-essential in a build stage only.
FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY pyproject.toml README.md ./
COPY src ./src

ARG EXTRAS=presidio,ner,llm,parquet,scripts
RUN pip install --prefix=/install ".[${EXTRAS}]"

FROM base AS runtime

# Curl for the HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 appuser

COPY --from=builder /install /usr/local
COPY --chown=appuser:appuser src /app/src
COPY --chown=appuser:appuser pyproject.toml /app/pyproject.toml

USER appuser
WORKDIR /app

# Runtime data paths — bind-mount or use named volumes at runtime.
#   pipelines/          → pipeline JSON definitions
#   data/dictionaries/  → whitelist/blacklist term lists
#   datasets/           → dataset manifests
#   models/             → model weights (read-mostly)
#   var/                → SQLite audit DB
# Plus modes.json at /app/modes.json (single file).
ENV CLINICAL_DEID_PIPELINES_DIR=/app/pipelines \
    CLINICAL_DEID_EVALUATIONS_DIR=/app/evaluations \
    CLINICAL_DEID_DATASETS_DIR=/app/datasets \
    CLINICAL_DEID_PROCESSED_DIR=/app/data/processed \
    CLINICAL_DEID_DICTIONARIES_DIR=/app/data/dictionaries \
    CLINICAL_DEID_MODELS_DIR=/app/models \
    CLINICAL_DEID_INFERENCE_RUNS_DIR=/app/inference_runs \
    CLINICAL_DEID_DATABASE_URL=sqlite:////app/var/dev.sqlite

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

# Workers should be tuned to the host. 1 is a safe default for a small
# container; set WEB_CONCURRENCY to override without rebuilding.
ENV WEB_CONCURRENCY=1
CMD ["sh", "-c", "uvicorn clinical_deid.api.app:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY}"]
