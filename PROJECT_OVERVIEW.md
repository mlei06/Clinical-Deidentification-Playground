# Clinical De-Identification Playground — Project Overview

Use this document to understand the full scope of the project before suggesting changes. It covers what exists, what's planned, how the pieces connect, and the key design decisions already made.

---

## What this project does

A **local-first platform** for clinical text de-identification. Three complementary threads:

1. **Local training** — Prepare annotated data, export to your trainer (spaCy, HuggingFace, etc.), and train or fine-tune models **on your machines**. Artifacts live under `models/` (see `models/README.md`) and are referenced from pipe configs so detectors stay reproducible.

2. **Pipeline composition** — Configure **pipes** (regex, whitelist, Presidio, pyDeid, LLM, combinators, redactors) and compose them into named **pipelines** (JSON files in `pipelines/`, registry-backed). The API supports creating/updating pipelines, validation, and machine-readable config schemas with `ui_*` hints for building forms.

3. **Inference for services** — Expose **HTTP endpoints** so upstream systems send text (or batch items) and receive de-identified output plus **auditable** metadata: `request_id`, spans, timings, pipeline name, and optional **intermediary traces** when the pipeline enables step capture. All operations are logged to a unified SQLite audit trail.

4. **Playground (planned UI)** — A **web UI** on top of the same APIs so people can: **(a)** pick a saved pipeline, paste or upload text, and inspect results (redacted output, spans, optional step trace); **(b)** run **evaluation** against annotated data either from **paths on the server** (JSONL, BRAT corpus roots the app can read) or from **drag-and-drop uploads** in the browser. The goal is parity: *one eval implementation*, two ways to supply gold data.

---

## Design priorities

1. **Minimal setup for new pipes (highest)** — Adding a detector, transformer, or redactor should stay a **small, local change**: Pydantic config + `forward` implementation + **one `register()` call** (and optionally one **catalog** line for install hints / role). Pipes should not require edits to the process router, pipeline loader, or UI beyond what JSON Schema + `ui_*` hints already provide.
2. **Composable pipelines** — JSON-defined sequential and parallel graphs, validation before save.
3. **Observable inference** — Rich process responses, persistent audit trail, eval metrics.
4. **Training + eval loop** — Local training artifacts, eval on disk or uploads, compare runs over time.

---

## Current state of the codebase

**~7,000 lines of Python** across 96 source modules, 25 test files, and 9 scripts. FastAPI backend with SQLite for audit only. Python 3.11+.

### What's built and working

| Component | Details |
|---|---|
| **Domain models** | `Document` (id, text, metadata), `PHISpan` (start, end, label, confidence, source), `AnnotatedDocument` (document + spans). Universal contract across all services. |
| **Pipe system** | Protocol-based: `Pipe.forward(AnnotatedDocument) -> AnnotatedDocument`. Subtypes: `Detector`, `Preprocessor`, `SpanTransformer`, `Redactor`. |
| **Built-in pipes** | Detectors: `RegexNerPipe`, `WhitelistPipe`, `PresidioNerPipe`, `PyDeidNerPipe`, `LlmNerPipe`. Span transforms: `BlacklistSpans`, `ResolveSpans`, `LabelMapper`, `LabelFilter`, `SpanResolverPipe`, `ConsistencyPropagatorPipe`. Redactors: `PresidioAnonymizerPipe`, `SurrogatePipe`. |
| **Pipeline composition** | `Pipeline` (sequential chain), `ParallelDetectors` (fan-out with merge: union, consensus voting, max-confidence, longest, exact-dedupe). |
| **Pipe registry** | Maps type names to (config_class, pipe_class) pairs. JSON serialization/deserialization. Adding a new detector = config class + pipe class + one `register()` call. |
| **Pipeline profiles** | `fast` (regex-only), `balanced` (+ presidio), `accurate` (+ consistency propagation + span resolution). |
| **CLI** | `run` (stdin/files), `batch` (directory/JSONL), `eval` (gold corpus), `audit list/show`, `setup`, `serve`. All support `--profile`, `--pipeline`, `--config`, `--redactor`. |
| **API** | Pipeline CRUD, process (single + batch), evaluation (run/list/compare), audit (logs/stats), models (list/detail/refresh). |
| **Evaluation** | 4 matching modes (strict, exact boundary, partial overlap, token-level BIO), risk-weighted recall, HIPAA Safe Harbor coverage, per-label breakdown, confusion matrix, worst-document ranking. |
| **Storage** | Filesystem-first: pipelines as JSON, eval results as JSON, models as directories. SQLite only for append-only audit trail. |
| **Dataset ingestion** | JSONL, BRAT (.txt/.ann with splits), ASQ-PHI, MIMIC synthetic notes, PhysioNet i2b2. |
| **Analytics** | Label distribution, span length histogram, docs-by-span-count, overlapping spans, label co-occurrence matrix. |
| **Transforms** | Label remapping, random resize (downsample/upsample), boost by label, train/valid/test split reassignment. |
| **Composition** | Merge, interleave, proportional sampling across multiple corpora. |
| **LLM synthesis** | Few-shot clinical note generation via OpenAI-compatible API. Prompt templates, PHI extraction, span alignment. |
| **Tests** | 25 test files covering API, ingestion, analytics, transforms, synthesis, config, compose, pipeline execution, span resolution. |

### What's NOT built yet

| Gap | Status |
|---|---|
| **Playground UI** (`htmx + Jinja2`) | Planned — pipeline picker + text try-it; eval with local path or browser upload |
| **Log viewer UI** | Planned — browse audit trail in browser |
| **Training data export** (spaCy DocBin / HF JSONL / CoNLL) | Planned |
| **Training runner CLI** | Planned |
| **Custom NER pipe** (loads trained models from `models/` by name) | Planned |
| **Eval corpus upload** (multipart JSONL / zip BRAT for browser eval) | Planned |
| **Dataset HTTP API** (import/list/analytics) | Optional — library + scripts exist |

---

## Architecture

```
     +--------------------------------+       +-------------------------+
     | Playground UI (planned)         |       | Log / audit viewer       |
     |  text in -> spans out; eval     |       | (htmx + Jinja2, planned) |
     |  local path or file upload      |       +------------+------------+
     +----------------+---------------+                    |
                      |          FastAPI Gateway            |
                      +----------------+-------------------+
                                       |
  +----------+----------+--------------+----------+----------+--------------+
  |          |          |              |          |          |              |
  v          v          v              v          v          v              v
Data prep  Training   Model          Pipeline   Process   Audit-Log     Evaluation
+ library  (local     Directory      Service    Service   Service       Service
(scripts)  CLI, plan) (FS registry)  (exists)   (exists)  (exists)      (exists)
```

---

## Storage architecture

**Filesystem-first, database only for audit.**

| Store | Implementation | Files |
|-------|---------------|-------|
| **Pipelines** | `pipeline_store.py` — `list_pipelines()`, `load_pipeline_config()`, `save_pipeline_config()`, `delete_pipeline()` | `pipelines/{name}.json` |
| **Eval results** | `eval_store.py` — `save_eval_result()`, `list_eval_results()`, `load_eval_result()` | `evaluations/{pipeline}_{timestamp}.json` |
| **Models** | `models.py` — `scan_models()` reads `model_manifest.json` from `models/{framework}/{name}/` | Filesystem directories |
| **Audit log** | `audit.py` — `log_run()`, `list_runs()`, `get_run()` via SQLModel | `var/dev.sqlite`, table `audit_log` |

The `AuditLogRecord` table schema:

| Field | Type | Description |
|-------|------|-------------|
| `id` | str (UUID) | Primary key |
| `timestamp` | datetime | UTC |
| `user` | str | OS username |
| `command` | str | "run", "batch", "eval", "process", "process_batch" |
| `pipeline_name` | str | Pipeline that ran |
| `pipeline_config` | JSON | Full config snapshot |
| `dataset_source` | str | Filesystem path or "" |
| `doc_count` | int | Documents processed |
| `error_count` | int | Errors encountered |
| `span_count` | int | Total spans detected |
| `duration_seconds` | float | Wall-clock time |
| `metrics` | JSON | Eval metrics or span counts |
| `source` | str | "cli" or "api" |
| `notes` | str | Optional notes |

---

## How the pipe system works

This is the core abstraction. Everything flows through `AnnotatedDocument`.

### The protocol

```python
class Pipe(Protocol):
    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument: ...

class Detector(Pipe, Protocol):
    @property
    def labels(self) -> set[str]: ...
```

### Adding a new detector (minimal setup)

```python
# 1. Config (Pydantic -- serializable)
class MyConfig(BaseModel):
    some_param: str = "default"

# 2. Pipe class
class MyPipe:
    def __init__(self, config: MyConfig | None = None):
        self._config = config or MyConfig()
    @property
    def labels(self) -> set[str]: ...
    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument: ...

# 3. Register
register("my_pipe", MyConfig, MyPipe)
```

After registration, it works in pipeline JSON configs, the CRUD API, the process endpoint, evaluation, and CLI — zero other code changes.

### Pipeline composition

Sequential:
```json
{"pipes": [{"type": "regex_ner"}, {"type": "blacklist"}, {"type": "resolve_spans"}]}
```

Parallel with consensus:
```json
{
  "pipes": [{
    "type": "parallel",
    "strategy": "consensus",
    "consensus_threshold": 2,
    "detectors": [
      {"type": "regex_ner"},
      {"type": "presidio_ner"},
      {"type": "llm_ner", "config": {"model": "gpt-4o-mini"}}
    ]
  }]
}
```

Merge strategies: `union`, `exact_dedupe`, `consensus`, `max_confidence`, `longest_non_overlapping`.

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/pipelines/pipe-types` | Pipe catalog, install hints, JSON Schema (+ `ui_*`) for configs |
| `GET` | `/pipelines/ner/builtins` | Bundled regex / whitelist label names |
| `POST` | `/pipelines/whitelist/parse-lists` | Parse uploaded list files for whitelist config |
| `POST` | `/pipelines/blacklist/parse-wordlists` | Merge wordlist uploads for blacklist |
| `POST` | `/pipelines` | Create named pipeline from JSON config |
| `GET` | `/pipelines` | List pipelines |
| `GET` | `/pipelines/{name}` | Pipeline config |
| `PUT` | `/pipelines/{name}` | Update pipeline config |
| `DELETE` | `/pipelines/{name}` | Delete pipeline |
| `POST` | `/pipelines/{name}/validate` | Dry-run validation |
| `POST` | `/process/{pipeline_name}` | Run pipeline on text; auditable JSON response |
| `POST` | `/process/{pipeline_name}/batch` | Batch process |
| `POST` | `/eval/run` | Run pipeline against gold dataset |
| `GET` | `/eval/runs` | List eval results |
| `GET` | `/eval/runs/{id}` | Eval result detail |
| `POST` | `/eval/compare` | Compare two eval runs |
| `GET` | `/audit/logs` | Query audit trail (paginated, filtered) |
| `GET` | `/audit/logs/{id}` | Audit log detail |
| `GET` | `/audit/stats` | Aggregate stats |
| `GET` | `/models` | List models from filesystem |
| `GET` | `/models/{framework}/{name}` | Model manifest details |
| `POST` | `/models/refresh` | Re-scan models directory |

---

## Module structure

```
src/clinical_deid/
  domain.py                  # Document, PHISpan, AnnotatedDocument
  tables.py                  # AuditLogRecord (only DB table)
  db.py                      # SQLite engine, init_db()
  config.py                  # Settings (pydantic-settings), .env loading
  audit.py                   # Unified audit: log_run(), list_runs(), get_run()
  pipeline_store.py          # Filesystem pipeline CRUD
  eval_store.py              # Filesystem eval result storage
  models.py                  # Filesystem model registry (scan, get, list)
  profiles.py                # fast/balanced/accurate profile builders
  cli.py                     # Click CLI (run, batch, eval, audit, setup, serve)
  export.py                  # Output formatters (text, JSON, JSONL, CSV, Parquet)
  ids.py                     # UUID helpers
  env_file.py                # .env resolution
  pipes/
    base.py                  # Pipe, Detector, Preprocessor, SpanTransformer, Redactor protocols
    registry.py              # Type registry, JSON load/dump, pipe catalog
    ui_schema.py             # field_ui, pipe_config_json_schema (UI hints in JSON Schema)
    span_merge.py            # Merge strategies (union, consensus, max_confidence, etc.)
    trace.py                 # Intermediary trace capture
    detector_label_mapping.py # Shared label mapping utilities
    combinators.py           # Pipeline, ParallelDetectors, ResolveSpans, LabelMapper, LabelFilter
    span_resolver.py         # Overlap resolution (longest, highest_confidence, priority)
    consistency_propagator.py # Document-level span propagation
    llm_ner.py               # LLM-prompted detection
    regex_ner/               # Regex-based PHI detection
    whitelist/               # Phrase/dictionary matching
    blacklist/               # False-positive filtering
    presidio_ner/            # Microsoft Presidio wrapper
    pydeid_ner/              # pyDeid wrapper
    presidio_anonymizer/     # Text redaction via Presidio
    surrogate/               # Realistic fake data replacement
  api/
    app.py                   # FastAPI app, CORS, lifespan, router mounting
    deps.py                  # Dependency injection (DB session for audit)
    schemas.py               # Request/response models
    routers/
      pipelines.py           # Pipeline CRUD, pipe-types, validate, list helpers
      process.py             # Inference (text + batch), audit logging
      evaluation.py          # Eval run/list/compare (filesystem-backed)
      audit.py               # Audit log query + stats
      models.py              # Model listing (filesystem-backed)
  eval/
    spans.py                 # strict_micro_f1, SpanMicroF1
    matching.py              # 4 matching modes (strict, exact boundary, partial, token-level)
    risk.py                  # Risk-weighted recall, HIPAA coverage report
    runner.py                # Batch eval runner with per-label/per-doc results
  analytics/
    stats.py                 # Label distribution, histograms, overlaps, co-occurrence
  ingest/
    jsonl.py, brat.py, asq_phi.py, sources.py, sink.py, brat_write.py
    mimic/                   # Synthetic MIMIC note generation
  transform/
    ops.py                   # Label map, resize, boost
    splits.py                # Train/valid/test reassignment
  compose/
    flatten.py, strategies.py, pipeline.py, load.py
  synthesis/
    client.py, template.py, components.py, parse.py, align.py, presets.py, synthesizer.py
  pipeline/
    job.py                   # Pipeline job execution
```

---

## Key design decisions

1. **Registry-first extensibility** — New pipe types are added with **config model + pipe class + `register()`** (and optional catalog metadata). Process, pipeline load/dump, and `/pipelines/pipe-types` stay generic.
2. **Pipes are pure transformations** — `AnnotatedDocument -> AnnotatedDocument`. No side effects, no awareness of pipeline context.
3. **Serializable configs + UI hints** — Pydantic + JSON Schema; `ui_*` keys for generated forms.
4. **Model directory, not model database** — training is local-only (CLI). The filesystem is the registry. API is read-only.
5. **Filesystem-first storage** — Pipelines, eval results, and models live on the filesystem as JSON/directories. Use git for history. No migrations.
6. **SQLite only for audit** — The database stores only the append-only audit trail (`AuditLogRecord`). Both CLI and API write to the same table.
7. **Multi-mode evaluation** — strict, partial-overlap, token-level, and exact-boundary matching. Per-label breakdowns, risk-weighted recall, label confusion matrix, HIPAA coverage reporting. Same runner for CLI and API.
8. **Three profiles** — `fast` (regex-only), `balanced` (+ presidio), `accurate` (+ consistency propagation + span resolution). CLI defaults to `balanced`.
9. **Name-based pipeline routes** — Pipelines are identified by name (e.g., `/pipelines/my-pipeline`), not UUIDs. Simpler, human-readable, filesystem-backed.
10. **One eval implementation, many ingest paths** — local filesystem, API request, or future UI uploads should all normalize to `AnnotatedDocument` iterators before scoring.

---

## Implementation phases

| Phase | Scope | Status |
|---|---|---|
| **1. Pipe system + composition** | Protocol, registry, built-in pipes, combinators, JSON serialization | Done |
| **2. API + CLI** | Pipeline CRUD, process, batch, CLI commands, profiles | Done |
| **3. Evaluation** | Multi-mode matching, risk-weighted recall, HIPAA coverage, eval runner, eval API | Done |
| **4. Storage refactor** | Filesystem-first pipelines + eval, unified audit trail | Done |
| **5. Playground UI** | htmx pages: pipeline selector, text try-it, eval form (local path or drag-and-drop) | Planned |
| **6. Log Viewer UI** | htmx templates, dashboard, log viewer | Planned |
| **7. Training & Models** | Exporters, training CLI, custom_ner pipe | Planned |

---

## Tech stack

- **Backend:** Python 3.11+, FastAPI, Pydantic v2, SQLModel (SQLAlchemy), Uvicorn
- **ML/NLP:** spaCy, HuggingFace Transformers, Microsoft Presidio
- **LLM:** OpenAI-compatible API client
- **Testing:** Pytest, Faker, HTTPx (async test client)
- **Data:** Pandas (scripts), custom JSONL/BRAT parsers
- **UI (planned):** htmx, Jinja2, Chart.js
- **Storage:** SQLite (audit only), local filesystem for everything else

---

## The full loop

```
1. Ingest data        -> JSONL, BRAT, ASQ-PHI, MIMIC
2. Prepare data       -> label remap, compose, augment with LLM synthesis
3. Export             -> clinical-deid export (spaCy/HF/CoNLL) [planned]
4. Train              -> clinical-deid train (local, outputs to models/) [planned]
5. Available          -> model directory scanned, appears in GET /models
6. Build pipeline     -> save as pipelines/my-pipeline.json or POST /pipelines
7. Evaluate pipeline  -> clinical-deid eval or POST /eval/run
8. Try interactively  -> Playground UI [planned]: choose pipeline, paste text
9. Deploy pipeline    -> POST /process/{pipeline_name} (with audit logging)
10. Monitor           -> GET /audit/logs, GET /audit/stats
11. Retrain           -> new data or failed cases -> back to step 2
```
