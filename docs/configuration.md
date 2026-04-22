# Configuration

All configuration is managed through environment variables, with sensible defaults for local development.

## Environment variables

### Storage paths

| Variable | Default | Description |
|----------|---------|-------------|
| `CLINICAL_DEID_DATABASE_URL` | `sqlite:///./var/dev.sqlite` | SQLAlchemy database URL (audit log) |
| `CLINICAL_DEID_PIPELINES_DIR` | `pipelines` | Named pipeline JSON configs |
| `CLINICAL_DEID_EVALUATIONS_DIR` | `evaluations` | Evaluation result JSON files |
| `CLINICAL_DEID_INFERENCE_RUNS_DIR` | `inference_runs` | Batch inference output directory |
| `CLINICAL_DEID_DATASETS_DIR` | `datasets` | Dataset manifest JSON files |
| `CLINICAL_DEID_DICTIONARIES_DIR` | `data/dictionaries` | Whitelist/blacklist term-list files |
| `CLINICAL_DEID_MODELS_DIR` | `models` | Root directory for model registry |
| `CLINICAL_DEID_PROCESSED_DIR` | `data/processed` | Materialized corpus bytes (transforms, exports) |
| `CLINICAL_DEID_ENV_FILE` | _(auto-detected)_ | Explicit path to `.env` file |

`CLINICAL_DEID_CORPORA_DIR` is a deprecated alias for `CLINICAL_DEID_PROCESSED_DIR` — still honored with a warning.

### HTTP / auth

| Variable | Default | Description |
|----------|---------|-------------|
| `CLINICAL_DEID_CORS_ORIGINS` | `["http://localhost:3000", "http://127.0.0.1:3000"]` | Allowed CORS origins (JSON array) |
| `CLINICAL_DEID_ADMIN_API_KEYS` | `[]` | Admin-scope API keys (JSON array) |
| `CLINICAL_DEID_INFERENCE_API_KEYS` | `[]` | Inference-scope API keys (JSON array) |
| `CLINICAL_DEID_MAX_BODY_BYTES` | `10485760` | Reject requests with `Content-Length` above this (10 MiB) |

List-valued variables must be JSON arrays, e.g. `CLINICAL_DEID_CORS_ORIGINS='["https://app.example.com"]'`.

### External services

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | _(none)_ | API key for LLM synthesis |
| `CLINICAL_DEID_OPENAI_API_KEY` | _(none)_ | Alternative name for the API key |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model name for LLM synthesis |
| `CLINICAL_DEID_NEURONER_HTTP_URL` | `http://127.0.0.1:8765` | Base URL for the NeuroNER Docker sidecar |

### Runtime tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_CONCURRENCY` | `1` | Uvicorn worker count (honored by the container `CMD`, not read by the app) |

## Authentication

The API has two scopes:

- **`admin`** — full access: pipeline CRUD, dictionaries, deploy config (`GET`/`PUT` `/deploy`, `GET` `/deploy/pipelines`), datasets, evaluation, models, audit proxy, and all `/process/*` routes. Admin keys also satisfy `inference`-scoped checks.
- **`inference`** — least privilege for integrators and the Production UI:
  - `POST /process/*` (including `/process/redact`, `/process/scrub`), subject to the deploy allowlist in `modes.json` (admins bypass the allowlist).
  - `POST /pipelines/pipe-types/{name}/labels` (label-space compute; no filesystem writes).
  - `GET /deploy/health` (mode list + availability for the mode selector).
  - `GET /audit/logs`, `GET /audit/logs/{id}`, `GET /audit/stats` (read-only audit queries).

All other routes require an **admin** key when auth is enabled.

Keys are accepted in either header:

```
Authorization: Bearer <key>
X-API-Key: <key>
```

Auth is **disabled when both key lists are empty** — this keeps local dev friction-free. In that mode, OpenAPI docs are served at `/docs` and `/redoc`. When any key is configured, `/docs`, `/redoc`, and `/openapi.json` are removed from the app.

Example production config:

```bash
export CLINICAL_DEID_ADMIN_API_KEYS='["ops-team-key-1","ops-team-key-2"]'
export CLINICAL_DEID_INFERENCE_API_KEYS='["upstream-service-key"]'
```

The audit log records a hashed client id (first 12 chars of `sha256(key)`) — raw keys are never persisted.

## .env file

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

The `.env` file is loaded automatically by `pydantic-settings`. The file is gitignored.

### .env resolution order

1. `CLINICAL_DEID_ENV_FILE` environment variable (if set and the file exists)
2. Walk up from the current working directory looking for `.env`
3. `.env` next to the nearest `pyproject.toml` ancestor
4. No `.env` file (rely on environment variables only)

## Settings object

All settings are managed by a Pydantic `Settings` class:

```python
from clinical_deid.config import get_settings, reset_settings

settings = get_settings()  # singleton, cached
print(settings.database_url)
print(settings.openai_api_key)
```

`reset_settings()` clears the cache (useful in tests).

## Database

The default database is SQLite at `./var/dev.sqlite`. The `var/` directory is created by the server on first run.

```bash
mkdir -p var
clinical-deid-api
```

To use a different path:

```bash
export CLINICAL_DEID_DATABASE_URL="sqlite:////tmp/my-deid.sqlite"
```

Tables are auto-created on startup via `init_db()`:

| Table | Purpose |
|-------|---------|
| `audit_log` | Append-only audit trail for all CLI and API operations |

## Pipeline cache

Built pipe chains are cached in memory (LRU, max 32 entries, keyed by config hash). This avoids rebuilding the pipe chain on every request. The cache is thread-safe and cleared on server restart.

```python
from clinical_deid.db import clear_pipeline_cache
clear_pipeline_cache()  # manually clear if needed
```

## Logging

Structured logging is configured in `__main__.py`:

```
2024-06-15 10:30:00 INFO     clinical_deid  database initialised, API ready
```

Format: `%(asctime)s %(levelname)-8s %(name)s  %(message)s`

The `clinical_deid` logger namespace is used throughout the application. Uvicorn adds its own access logging.

## CORS

CORS middleware allows requests from origins in `CLINICAL_DEID_CORS_ORIGINS` (default: `http://localhost:3000`, `http://127.0.0.1:3000`). Override via environment variable or `.env` file.

## Request body limits

`MaxBodySizeMiddleware` rejects any request whose `Content-Length` exceeds `CLINICAL_DEID_MAX_BODY_BYTES` (default 10 MiB) with a 413 response before the route runs. Chunked uploads (no `Content-Length` header) pass through; per-endpoint upload handlers (dictionaries, list parsers) apply their own stricter caps. Heavier limits like rate limiting and IP allowlisting are expected at the reverse proxy / load balancer layer, not in the app.

## Deploy configuration

Production deploy settings are stored in `modes.json` (project root). This file is managed via the `/deploy` API endpoints and the Deploy tab in the UI. It maps inference mode names to pipelines, defines an optional pipeline allowlist, and stores the production API URL for audit log proxying.

In Docker Compose, mount `modes.json` **writable** if operators use `PUT /deploy` from the Playground; a read-only mount blocks saving deploy changes.

## Pipelines vs API output mode

Pipeline definitions should contain **detectors and span transforms** only (e.g. `resolve_spans`). **Redacted** and **surrogate** text are produced by the API using `output_mode` on `POST /process/...` and `POST /process/redact`, not by adding a surrogate redactor step to the pipeline catalog. Surrogate mode needs Faker (`pip install '.[scripts]'`, or include `scripts` in the Docker image `EXTRAS`).

## Project structure

High-level layout (see also [docs/README.md](README.md)):

```
src/clinical_deid/
├── api/                  # FastAPI app, routers, schemas, auth, middleware
├── pipes/                # Pipe implementations + registry (see pipes-and-pipelines.md)
├── training/             # HF fine-tuning (CLI: clinical-deid train run)
├── ingest/               # Dataset loaders
├── synthesis/            # LLM note generation
├── transform/            # Dataset transforms
├── compose/              # Multi-corpus merging
├── eval/                 # Evaluation metrics + runner
├── domain.py             # Document, PHISpan, AnnotatedDocument
├── config.py             # Settings
├── db.py                 # SQLite + pipeline cache
├── models.py             # Filesystem model registry scanner
├── tables.py             # audit_log
└── ...
```

Specific pipe packages (`regex_ner/`, `huggingface_ner/`, `presidio_ner/`, …) live under `pipes/`; the authoritative list is the catalog in `pipes/registry.py`.
