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

Optional extras: `.[presidio]`, `.[ner]`, `.[llm]`, `.[scripts]`, `.[parquet]`, `.[all]`.

## Architecture

### Storage pattern: filesystem-first, audit in SQLite

| What | Storage | Location |
|------|---------|----------|
| Pipelines | JSON files | `pipelines/{name}.json` |
| Eval results | JSON files | `evaluations/{pipeline}_{timestamp}.json` |
| Models | Directories | `models/{framework}/{name}/` |
| Datasets | JSON manifests + data files | `datasets/{name}.json` → user-provided paths |
| Dictionaries | Term-list files | `data/dictionaries/{whitelist,blacklist}/` |
| Deploy config | JSON file | `modes.json` |
| Audit log | SQLite (SQLModel) | `var/dev.sqlite` — `audit_log` table |

No migrations. Pipelines use git for history. The database stores only the append-only audit trail (`AuditLogRecord` in `tables.py`).

### Core abstraction: Pipes and AnnotatedDocument

Everything flows through `AnnotatedDocument` (document + spans). All pipes implement:

```python
class Pipe(Protocol):
    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument: ...
```

Subtypes: `Detector` (produces spans), `SpanTransformer` (modifies spans), `Redactor` (replaces text), `Preprocessor` (transforms text before detection).

### Canonical PHI labels

`PHILabel` enum in `domain.py` defines the canonical label space (~30 labels based on HIPAA Safe Harbor 18 identifiers + clinical additions). Detectors may use any internal labels but should map to canonical labels via `remap` config. `PHILabel.normalize(raw_label)` maps raw strings to canonical labels (with alias support), falling back to `OTHER`.

### Redaction as an output mode (not a pipe)

Pipelines should only predict spans. Redaction (tag replacement) and surrogate (fake data) are applied at the API layer via `output_mode` parameter (`annotated`, `redacted`, `surrogate`). Legacy redactor pipes (surrogate, presidio_anonymizer) still work in pipelines for backward compat, but the preferred pattern is `output_mode` on process endpoints. The `/process/redact` endpoint accepts text + user-corrected spans for post-editing export. The `/process/scrub` endpoint provides zero-config log cleaning.

### Pipe registry

Pipes are registered by name: `register("my_pipe", MyConfig, MyPipe)`. After registration, the pipe works in pipeline JSON configs, the API, CLI, and evaluation — zero other code changes.

Adding a new pipe is 3 steps:
1. Pydantic config class
2. Pipe class with `forward()` method
3. `register()` call in `registry.py`

### Pipeline composition

Pipelines are JSON documents with sequential steps — detectors chained into span transformers:

```json
{
  "pipes": [
    {"type": "regex_ner"},
    {"type": "presidio_ner"},
    {"type": "blacklist"},
    {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}}
  ]
}
```

> **Note:** The older `"type": "parallel"` block syntax is deprecated. Chain detectors sequentially instead and use `resolve_spans` to handle overlaps.

### Three built-in profiles

- **fast** — regex + whitelist + blacklist + resolve (~10ms, no ML)
- **balanced** — adds presidio NER (falls back to fast if not installed)
- **accurate** — adds consistency propagation + confidence-based span resolution

## Key directories

```
frontend/                # Vite + React + TypeScript playground UI
  src/components/
    create/              # Visual pipeline builder (drag-and-drop canvas)
    inference/           # Text input, span highlighting, trace timeline
    evaluate/            # Eval dashboard, metrics, confusion matrix, comparison
    datasets/            # Dataset register, browse, compose, transform, generate
    dictionaries/        # Dictionary upload / browse / manage
    deploy/              # Deploy config: inference modes, pipeline allowlist
    audit/               # Audit log viewer with stats, filters, local/production toggle
    layout/              # Shell layout
    shared/              # Reusable components (SpanHighlighter, LabelBadge, etc.)

src/clinical_deid/
  domain.py              # Document, PHISpan, AnnotatedDocument
  pipes/                 # All pipe implementations + registry + combinators
    registry.py          # Central registry, JSON load/dump, pipe catalog
    base.py              # Pipe protocol definitions
    combinators.py       # Pipeline, ResolveSpans, LabelMapper, LabelFilter
    span_merge.py        # Shared span merge / resolution strategies
    trace.py             # Pipeline tracing (PipelineRunResult, PipelineTraceFrame)
    ui_schema.py         # UI schema hints for frontend config forms
    detector_label_mapping.py  # Configurable label mapping for detectors
    regex_ner/           # Regex-based detection
    whitelist/           # Dictionary/phrase matching
    blacklist/           # False-positive filtering
    presidio_ner/        # Presidio wrapper (optional)
    presidio_anonymizer/ # Presidio redaction (optional)
    neuroner_ner/        # NeuroNER LSTM-CRF wrapper (Python 3.7 subprocess)
    custom_ner/          # Load trained spaCy/HuggingFace models from models/
    llm_ner.py           # LLM-prompted detection (optional)
    span_resolver.py     # Overlap resolution (deprecated, use resolve_spans)
    consistency_propagator.py  # Document-level span propagation
    surrogate/           # Realistic fake data replacement (optional)
  api/
    app.py               # FastAPI application
    routers/             # pipelines, process, evaluation, audit, models, dictionaries, datasets, deploy, audit_proxy
    schemas.py           # Pydantic request/response models
  eval/
    matching.py          # 4 matching modes (strict, exact boundary, partial, token-level)
    risk.py              # Risk-weighted recall, HIPAA coverage
    runner.py            # Batch evaluation with per-label/per-doc results
  ingest/                # JSONL, BRAT, ASQ-PHI, MIMIC loaders
  cli.py                 # Click CLI: run, batch, eval, audit, dict, dataset, setup, serve
  dataset_store.py       # Filesystem dataset registry (register, list, analytics)
  mode_config.py         # Deploy config (modes.json) load/save
  config.py              # Pydantic settings (env vars, .env file)
  tables.py              # AuditLogRecord (only DB table)
  db.py                  # SQLite engine
  audit.py               # Unified audit: log_run(), list_runs(), get_run()
  pipeline_store.py      # Filesystem pipeline CRUD
  eval_store.py          # Filesystem eval result storage
  profiles.py            # fast/balanced/accurate profile builders
  export.py              # Output formatters (text, JSON, JSONL, CSV, Parquet)
  training_export.py     # Training data export (CoNLL, spaCy DocBin, HuggingFace JSONL)
```

## API routes

All pipeline routes use **name-based** paths (not UUIDs):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness |
| `GET` | `/pipelines/pipe-types` | Pipe catalog with JSON Schema |
| `POST` | `/pipelines/pipe-types/{name}/labels` | Compute label space for a detector |
| `GET` | `/pipelines/ner/builtins` | Bundled regex / whitelist label names |
| `POST` | `/pipelines/whitelist/parse-lists` | Parse uploaded list files for whitelist config |
| `POST` | `/pipelines/blacklist/parse-wordlists` | Merge uploads into blacklist terms |
| `POST` | `/pipelines` | Create pipeline |
| `GET` | `/pipelines` | List pipelines |
| `GET` | `/pipelines/{name}` | Get pipeline config |
| `PUT` | `/pipelines/{name}` | Update pipeline config |
| `DELETE` | `/pipelines/{name}` | Delete pipeline |
| `POST` | `/pipelines/{name}/validate` | Validate config |
| `GET` | `/dictionaries` | List uploaded dictionaries |
| `GET` | `/dictionaries/{kind}/{name}` | Dictionary metadata |
| `GET` | `/dictionaries/{kind}/{name}/preview` | Preview first N terms |
| `GET` | `/dictionaries/{kind}/{name}/terms` | Full term list |
| `POST` | `/dictionaries` | Upload a dictionary |
| `DELETE` | `/dictionaries/{kind}/{name}` | Delete a dictionary |
| `POST` | `/process/redact` | Redact/surrogate given text + spans |
| `POST` | `/process/scrub` | Zero-config log cleaning (text in, clean text out) |
| `POST` | `/process/{pipeline_name}?output_mode=` | Run pipeline on text (annotated/redacted/surrogate) |
| `POST` | `/process/{pipeline_name}/batch` | Batch process |
| `POST` | `/eval/run` | Run evaluation |
| `GET` | `/eval/runs` | List eval results |
| `GET` | `/eval/runs/{id}` | Eval result detail |
| `POST` | `/eval/compare` | Compare two runs |
| `GET` | `/datasets` | List registered datasets |
| `POST` | `/datasets` | Register dataset from local path |
| `GET` | `/datasets/{name}` | Dataset detail + analytics |
| `PUT` | `/datasets/{name}` | Update description/metadata |
| `DELETE` | `/datasets/{name}` | Unregister dataset |
| `POST` | `/datasets/{name}/refresh` | Recompute analytics |
| `GET` | `/datasets/{name}/preview` | Preview documents (paginated) |
| `GET` | `/datasets/{name}/documents/{doc_id}` | Full document with spans |
| `POST` | `/datasets/compose` | Compose multiple datasets |
| `POST` | `/datasets/transform` | Apply transforms to dataset |
| `POST` | `/datasets/generate` | Generate synthetic data via LLM |
| `POST` | `/datasets/{name}/export` | Export dataset to training format |
| `GET` | `/audit/logs` | Query audit trail |
| `GET` | `/audit/logs/{id}` | Audit detail |
| `GET` | `/audit/stats` | Aggregate stats |
| `GET` | `/audit/production/logs` | Proxy production audit logs |
| `GET` | `/audit/production/logs/{id}` | Proxy production log detail |
| `GET` | `/audit/production/stats` | Proxy production stats |
| `GET` | `/deploy` | Get deploy config (modes + allowlist) |
| `PUT` | `/deploy` | Update deploy config |
| `GET` | `/deploy/pipelines` | List deployable pipeline names |
| `GET` | `/models` | List models |
| `GET` | `/models/{framework}/{name}` | Model manifest details |
| `POST` | `/models/refresh` | Re-scan models directory |

## CLI commands

```
clinical-deid run [FILES]           # De-identify text from stdin or files
clinical-deid batch INPUT -o OUT    # Batch process directory or JSONL
clinical-deid eval --corpus FILE    # Evaluate against gold standard
clinical-deid dict list             # List dictionaries
clinical-deid dict preview KIND NAME  # Preview dictionary terms
clinical-deid dict import FILE --kind KIND --name NAME  # Import dictionary
clinical-deid dict delete KIND NAME # Delete dictionary
clinical-deid dataset list          # List registered datasets
clinical-deid dataset register PATH --name NAME  # Register dataset
clinical-deid dataset show NAME     # Dataset details + analytics
clinical-deid dataset delete NAME   # Unregister dataset
clinical-deid dataset export NAME -o DIR  # Export to training format (conll/spacy/huggingface)
clinical-deid audit list            # List audit records
clinical-deid audit show ID         # Show audit detail
clinical-deid setup                 # Verify deps, init DB
clinical-deid serve                 # Start API server
```

Pipeline commands (`run`, `batch`, `eval`) support `--profile` (fast/balanced/accurate), `--pipeline` (saved pipeline by name), `--config` (custom JSON file), and `--redactor` (tag/surrogate).

## Evaluation

Four matching modes: strict (exact start+end+label), exact boundary (ignore label), partial overlap (same label, any overlap), token-level (per-character BIO tags).

Also computes: risk-weighted recall (HIPAA severity weights), per-label breakdown, label confusion matrix, HIPAA Safe Harbor coverage report (18 identifiers), worst-document ranking.

## What's built

- Full pipe system with 14 cataloged pipe types (including 2 deprecated aliases)
- Pipeline composition (sequential chaining with 7 span merge/resolution strategies)
- CLI with all subcommands (run, batch, eval, dict, dataset, audit, setup, serve)
- FastAPI with all routes (pipelines, process, eval, audit, models, dictionaries, datasets, deploy, audit production proxy)
- **Playground UI** — Vite + React + TypeScript frontend with 7 views: pipeline builder, inference (span highlighting + trace), eval dashboard (metrics/confusion/comparison), datasets (register/compose/transform/generate), dictionaries, deploy config (modes + allowlist), audit log viewer (stats, filters, local/production toggle)
- Dataset HTTP API — register, browse, compose, transform, generate (LLM synthesis) via REST
- Deploy configuration — inference modes mapped to pipelines, pipeline allowlist, production API URL
- Audit production proxy — view remote production audit logs from the playground UI
- Multi-mode evaluation with HIPAA coverage
- Filesystem-backed pipeline, eval, and dataset storage
- Unified audit trail (CLI + API write to same SQLite table)
- Data ingestion (JSONL, BRAT, ASQ-PHI, MIMIC, PhysioNet)
- LLM synthesis for generating training data
- NeuroNER LSTM-CRF integration (Python 3.7 subprocess bridge)
- **Training data export** — AnnotatedDocument to CoNLL, spaCy DocBin, HuggingFace JSONL (CLI + API)
- **Custom NER pipe** — load trained spaCy/HuggingFace models from `models/` by name
- **Canonical PHI labels** — `PHILabel` enum with HIPAA-based label space + `normalize()` for alias mapping
- **Output mode separation** — redaction/surrogate decoupled from pipelines; applied via `output_mode` param on process endpoints
- **`/process/redact`** — apply redaction/surrogate to user-corrected spans (post-editing export)
- **`/process/scrub`** — zero-config log cleaning endpoint for upstream services
- **Enriched audit** — `client_id`, `output_mode`, `service_type`, per-label `entity_counts` in audit records
- 30+ test files

## What's not built yet

- **Training runner CLI** — wrapper for spaCy/HF training (export + model registry are ready)
- **Production inference UI** — assisted deidentification + batch inference/export frontend view (span editing, file upload, human-assist toggle)

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
