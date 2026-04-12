# Configuration

All configuration is managed through environment variables, with sensible defaults for local development.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLINICAL_DEID_DATABASE_URL` | `sqlite:///./var/dev.sqlite` | SQLAlchemy database URL |
| `CLINICAL_DEID_PIPELINES_DIR` | `pipelines` | Named pipeline JSON configs |
| `CLINICAL_DEID_EVALUATIONS_DIR` | `evaluations` | Evaluation result JSON files |
| `CLINICAL_DEID_DATASETS_DIR` | `datasets` | Dataset manifest JSON files |
| `CLINICAL_DEID_DICTIONARIES_DIR` | `data/dictionaries` | Whitelist/blacklist term-list files |
| `CLINICAL_DEID_MODELS_DIR` | `models` | Root directory for model registry |
| `CLINICAL_DEID_CORS_ORIGINS` | `["http://localhost:3000", "http://127.0.0.1:3000"]` | Allowed CORS origins |
| `CLINICAL_DEID_ENV_FILE` | _(auto-detected)_ | Explicit path to `.env` file |
| `OPENAI_API_KEY` | _(none)_ | API key for LLM synthesis |
| `CLINICAL_DEID_OPENAI_API_KEY` | _(none)_ | Alternative name for the API key |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model name for LLM synthesis |

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

## Deploy configuration

Production deploy settings are stored in `modes.json` (project root). This file is managed via the `/deploy` API endpoints and the Deploy tab in the UI. It maps inference mode names to pipelines, defines an optional pipeline allowlist, and stores the production API URL for audit log proxying.

## Project structure

```
src/clinical_deid/
├── api/                  # FastAPI app, routers, schemas, dependencies
│   ├── app.py            # App creation, CORS, lifespan
│   ├── deps.py           # Session dependency, pipeline lookups
│   ├── schemas.py        # Pydantic request/response models
│   └── routers/
│       ├── pipelines.py  # Pipeline CRUD + file upload endpoints
│       ├── process.py    # Inference endpoints
│       ├── evaluation.py # Eval run/list/compare
│       ├── datasets.py   # Dataset register/browse/compose/transform/generate
│       ├── dictionaries.py # Dictionary CRUD
│       ├── audit.py      # Audit log query + stats
│       ├── audit_proxy.py # Production audit proxy
│       ├── deploy.py     # Deploy config (modes, allowlist)
│       └── models.py     # Model listing
├── pipes/                # Pipe system (see pipes-and-pipelines.md)
│   ├── base.py           # Protocols (Pipe, Detector, Redactor, etc.)
│   ├── registry.py       # Registration, JSON serialization, catalog
│   ├── combinators.py    # Pipeline, ParallelDetectors, LabelMapper
│   ├── span_merge.py     # Merge strategies
│   ├── trace.py          # Intermediary trace capture
│   ├── ui_schema.py      # JSON Schema + UI hints
│   ├── detector_label_mapping.py
│   ├── regex_ner/        # Regex detector
│   ├── whitelist/        # Phrase-matching detector
│   ├── blacklist/        # False-positive filter
│   ├── presidio_ner/     # Presidio wrapper
│   ├── pydeid_ner/       # pyDeid wrapper
│   ├── spacy_ner/        # spaCy NER (planned)
│   ├── hf_ner/           # HuggingFace NER (planned)
│   ├── resolve_spans/    # Overlap resolution
│   └── presidio_anonymizer/  # Text redaction
├── ingest/               # Dataset loaders and writers
├── synthesis/            # LLM-based note generation
├── transform/            # Label mapping, resampling, splitting
├── compose/              # Multi-corpus merging
├── eval/                 # Evaluation metrics
├── analytics/            # Dataset statistics
├── pipeline/             # Job execution framework
├── domain.py             # Core data models (Document, PHISpan, AnnotatedDocument)
├── config.py             # Settings (pydantic-settings)
├── db.py                 # Database engine + pipeline cache
├── models.py             # Filesystem model registry
├── tables.py             # SQLModel table definitions
├── env_file.py           # .env file resolution
└── __main__.py           # Server entry point
```
