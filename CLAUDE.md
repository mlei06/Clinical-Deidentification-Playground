# CLAUDE.md

## Project summary

Clinical De-Identification Playground — a local-first platform for detecting and removing Protected Health Information (PHI) from clinical text. Compose detection pipelines from modular pipes, evaluate against gold-standard corpora, serve inference via HTTP API, and maintain an audit trail.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
clinical-deid setup          # verify deps, init DB, smoke test
clinical-deid serve           # start API on localhost:8000
pytest                        # run tests
```

Optional extras: `.[presidio]`, `.[ner]`, `.[pydeid]`, `.[llm]`, `.[scripts]`, `.[parquet]`, `.[all]`.

## Architecture

### Storage pattern: filesystem-first, audit in SQLite

| What | Storage | Location |
|------|---------|----------|
| Pipelines | JSON files | `pipelines/{name}.json` |
| Eval results | JSON files | `evaluations/{pipeline}_{timestamp}.json` |
| Models | Directories | `models/{framework}/{name}/` |
| Datasets | Local files | User-provided paths (JSONL, BRAT dirs) |
| Audit log | SQLite (SQLModel) | `var/dev.sqlite` — `audit_log` table |

No migrations. Pipelines use git for history. The database stores only the append-only audit trail (`AuditLogRecord` in `tables.py`).

### Core abstraction: Pipes and AnnotatedDocument

Everything flows through `AnnotatedDocument` (document + spans). All pipes implement:

```python
class Pipe(Protocol):
    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument: ...
```

Subtypes: `Detector` (produces spans), `SpanTransformer` (modifies spans), `Redactor` (replaces text), `Preprocessor` (transforms text before detection).

### Pipe registry

Pipes are registered by name: `register("my_pipe", MyConfig, MyPipe)`. After registration, the pipe works in pipeline JSON configs, the API, CLI, and evaluation — zero other code changes.

Adding a new pipe is 3 steps:
1. Pydantic config class
2. Pipe class with `forward()` method
3. `register()` call in `registry.py`

### Pipeline composition

Pipelines are JSON documents with sequential steps and optional parallel fan-out:

```json
{
  "pipes": [
    {"type": "parallel", "strategy": "union", "detectors": [
      {"type": "regex_ner"},
      {"type": "presidio_ner"}
    ]},
    {"type": "blacklist"},
    {"type": "span_resolver", "config": {"strategy": "highest_confidence"}}
  ]
}
```

### Three built-in profiles

- **fast** — regex + whitelist + blacklist + resolve (~10ms, no ML)
- **balanced** — adds presidio NER (falls back to fast if not installed)
- **accurate** — adds consistency propagation + confidence-based span resolution

## Key directories

```
src/clinical_deid/
  domain.py              # Document, PHISpan, AnnotatedDocument
  pipes/                 # All pipe implementations + registry + combinators
    registry.py          # Central registry, JSON load/dump, pipe catalog
    base.py              # Pipe protocol definitions
    combinators.py       # Pipeline, ParallelDetectors, ResolveSpans, LabelMapper
    regex_ner/           # Regex-based detection
    whitelist/           # Dictionary/phrase matching
    blacklist/           # False-positive filtering
    presidio_ner/        # Presidio wrapper (optional)
    presidio_anonymizer/ # Presidio redaction (optional)
    pydeid_ner/          # pyDeid wrapper (optional)
    llm_ner.py           # LLM-prompted detection (optional)
    span_resolver.py     # Overlap resolution
    consistency_propagator.py  # Document-level span propagation
    surrogate/           # Realistic fake data replacement (optional)
  api/
    app.py               # FastAPI application
    routers/             # pipelines, process, evaluation, audit, models
    schemas.py           # Pydantic request/response models
  eval/
    matching.py          # 4 matching modes (strict, exact boundary, partial, token-level)
    risk.py              # Risk-weighted recall, HIPAA coverage
    runner.py            # Batch evaluation with per-label/per-doc results
  ingest/                # JSONL, BRAT, ASQ-PHI, MIMIC loaders
  cli.py                 # Click CLI: run, batch, eval, audit, setup, serve
  config.py              # Pydantic settings (env vars, .env file)
  tables.py              # AuditLogRecord (only DB table)
  db.py                  # SQLite engine
  audit.py               # Unified audit: log_run(), list_runs(), get_run()
  pipeline_store.py      # Filesystem pipeline CRUD
  eval_store.py          # Filesystem eval result storage
  profiles.py            # fast/balanced/accurate profile builders
  export.py              # Output formatters (text, JSON, JSONL, CSV, Parquet)
```

## API routes

All pipeline routes use **name-based** paths (not UUIDs):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness |
| `POST` | `/pipelines` | Create pipeline |
| `GET` | `/pipelines` | List pipelines |
| `GET` | `/pipelines/{name}` | Get pipeline config |
| `PUT` | `/pipelines/{name}` | Update pipeline config |
| `DELETE` | `/pipelines/{name}` | Delete pipeline |
| `POST` | `/pipelines/{name}/validate` | Validate config |
| `GET` | `/pipelines/pipe-types` | Pipe catalog with JSON Schema |
| `POST` | `/process/{pipeline_name}` | Run pipeline on text |
| `POST` | `/process/{pipeline_name}/batch` | Batch process |
| `POST` | `/eval/run` | Run evaluation |
| `GET` | `/eval/runs` | List eval results |
| `GET` | `/eval/runs/{id}` | Eval result detail |
| `POST` | `/eval/compare` | Compare two runs |
| `GET` | `/audit/logs` | Query audit trail |
| `GET` | `/audit/logs/{id}` | Audit detail |
| `GET` | `/audit/stats` | Aggregate stats |
| `GET` | `/models` | List models |
| `POST` | `/models/refresh` | Re-scan models directory |

## CLI commands

```
clinical-deid run [FILES]           # De-identify text from stdin or files
clinical-deid batch INPUT -o OUT    # Batch process directory or JSONL
clinical-deid eval --corpus FILE    # Evaluate against gold standard
clinical-deid audit list            # List audit records
clinical-deid audit show ID         # Show audit detail
clinical-deid setup                 # Verify deps, init DB
clinical-deid serve                 # Start API server
```

All commands support `--profile` (fast/balanced/accurate), `--pipeline` (saved pipeline by name), `--config` (custom JSON file), and `--redactor` (tag/surrogate).

## Evaluation

Four matching modes: strict (exact start+end+label), exact boundary (ignore label), partial overlap (same label, any overlap), token-level (per-character BIO tags).

Also computes: risk-weighted recall (HIPAA severity weights), per-label breakdown, label confusion matrix, HIPAA Safe Harbor coverage report (18 identifiers), worst-document ranking.

## What's built

- Full pipe system with 11 registered pipe types
- Pipeline composition (sequential + parallel with 5 merge strategies)
- CLI with all subcommands
- FastAPI with all routes (pipelines, process, eval, audit, models)
- Multi-mode evaluation with HIPAA coverage
- Filesystem-backed pipeline and eval storage
- Unified audit trail (CLI + API write to same SQLite table)
- Data ingestion (JSONL, BRAT, ASQ-PHI, MIMIC, PhysioNet)
- LLM synthesis for generating training data
- 25 test files

## What's not built yet

- **Playground UI** (htmx + Jinja2) — try pipelines on text, run eval with drag-and-drop uploads
- **Audit/log viewer UI** — browse audit trail in browser
- **Training data export** — AnnotatedDocument to spaCy DocBin / HuggingFace JSONL / CoNLL
- **Training runner CLI** — wrapper for spaCy/HF training
- **Custom NER pipe** — load trained models from `models/` by name
- **Eval corpus upload** — multipart upload for browser-based eval
- **Dataset HTTP API** — import/list/analytics via API (library + scripts exist)

## Conventions

- Python 3.11+, Pydantic v2, FastAPI, SQLModel
- Config via env vars with `CLINICAL_DEID_` prefix or `.env` file
- Optional deps use `try/except ImportError` in `_register_builtins()`
- Tests use `tmp_path` fixtures for isolated filesystem state
- Entry points: `clinical-deid` (CLI), `clinical-deid-api` (server)

## Testing

```bash
pytest                     # all tests
pytest tests/test_api.py   # specific file
pytest -k "test_process"   # by name pattern
```

The `client` fixture in `conftest.py` sets up isolated temp dirs for pipelines, evaluations, and SQLite. Tests don't touch the real filesystem.
