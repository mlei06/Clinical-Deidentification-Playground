# Clinical De-Identification Playground — Project Overview

Use this document to understand the full scope of the project before suggesting changes. It covers what exists, what's planned, how the pieces connect, and the key design decisions already made.

---

## What this project does

A **local-first platform** for clinical text de-identification. Three complementary threads:

1. **Local training** — Prepare annotated data, export to your trainer (spaCy, HuggingFace, etc.), and train or fine-tune models **on your machines**. Artifacts live under `models/` (see `models/README.md`) and are referenced from pipe configs so detectors stay reproducible.

2. **Pipeline composition** — Configure **pipes** (regex, whitelist, Presidio, pyDeid, combinators, redactors, …) and compose them into versioned **pipelines** (JSON config, registry-backed). The API supports creating/updating pipelines, validation, and machine-readable config schemas with `ui_*` hints for building forms.

3. **Inference for services** — Expose **HTTP endpoints** so upstream systems send text (or batch items) and receive de-identified output plus **auditable** metadata: `request_id`, spans, timings, pipeline name/version, and optional **intermediary traces** when the pipeline enables step capture. Persistent audit-log storage and a log viewer are planned; today, callers persist responses or integrate with their own logging stack.

4. **Playground (planned UI)** — A **web UI** on top of the same APIs so people can: **(a)** pick a saved pipeline, paste or upload text, and inspect results (redacted output, spans, optional step trace); **(b)** run **evaluation** against annotated data either from **paths on the server** (JSONL, BRAT corpus roots the app can read) or from **drag-and-drop uploads** in the browser (multipart / ephemeral session storage, then the same eval runner as local corpora). The goal is parity: *one eval implementation*, two ways to supply gold data.

---

## Design priorities

1. **Minimal setup for new pipes (highest)** — Adding a detector, transformer, or redactor should stay a **small, local change**: Pydantic config + `forward` implementation + **one `register()` call** (and optionally one **catalog** line for install hints / role). Pipes should not require edits to the process router, pipeline loader, or UI beyond what JSON Schema + `ui_*` hints already provide. Optional third-party deps should use **extras + try/import** registration patterns so core installs stay light.
2. **Composable pipelines** — JSON-defined sequential and parallel graphs, immutable versions, validation before save.
3. **Observable inference** — Rich process responses today; persisted audit + log viewer next.
4. **Training + eval loop** — Local training artifacts, eval on disk or uploads, compare runs over time.

---

## Current state of the codebase

**~5,000 lines of Python** across 67 source modules, 19 test files, and 9 scripts. FastAPI backend with SQLite (SQLModel). Python 3.11+.

### What's built and working

| Component | Details |
|---|---|
| **Domain models** | `Document` (id, text, metadata), `PHISpan` (start, end, label, confidence, source), `AnnotatedDocument` (document + spans). Universal contract across all services. |
| **Pipe system** | Protocol-based: `Pipe.forward(AnnotatedDocument) → AnnotatedDocument`. Subtypes: `Detector`, `Preprocessor`, `SpanTransformer`, `Redactor`. |
| **Built-in pipes** | Detectors: `RegexNerPipe` (pattern-based), `WhitelistPipe` (phrase/dictionary matching), `PresidioNerPipe` (HuggingFace model via Presidio), `PyDeidNerPipe` (pyDeid rule-based). Span transforms: `BlacklistSpans` (false-positive filter), `ResolveSpans` (overlap resolution), `LabelMapper` (remap labels), `LabelFilter` (keep/drop labels). Redactor: `PresidioAnonymizerPipe` (text redaction). |
| **Pipeline composition** | `Pipeline` (sequential chain), `ParallelDetectors` (fan-out with merge: union, consensus voting, max-confidence). |
| **Pipe registry** | Maps type names to (config_class, pipe_class) pairs. JSON serialization/deserialization. Adding a new detector = config class + pipe class + one `register()` call. |
| **Dataset ingestion** | JSONL, BRAT (.txt/.ann with splits), ASQ-PHI, MIMIC synthetic notes, PhysioNet i2b2. |
| **Analytics** | Label distribution, span length histogram, docs-by-span-count, overlapping spans, label co-occurrence matrix. |
| **Transforms** | Label remapping, random resize (downsample/upsample), boost by label, train/valid/test split reassignment. |
| **Composition** | Merge, interleave, proportional sampling across multiple corpora. |
| **Evaluation** | `strict_micro_f1` — exact (start, end, label) match. Precision, recall, F1, TP/FP/FN. Code only, not yet exposed as API. Planned: partial-overlap, token-level, exact-boundary matching modes, per-label breakdowns, risk-weighted recall, label confusion matrix, HIPAA coverage verification. |
| **LLM synthesis** | Few-shot clinical note generation via OpenAI-compatible API. Prompt templates, PHI extraction, span alignment. |
| **Storage** | SQLite (SQLModel) for **pipelines**: `PipelineRecord`, `PipelineVersionRecord`. Dataset rows may be added when a dataset HTTP API is mounted; today, corpora live on disk (`data/`, `var/data/`) and in JSONL/BRAT via scripts. |
| **API (default app)** | FastAPI: `GET /health`, **pipeline CRUD** (`/pipelines`, `/pipelines/pipe-types`, validate, helpers), **inference** (`POST /process/{pipeline_id}`, batch). Dataset import/analytics/document routes may be extended separately; **dataset prep** is well supported via `clinical_deid.ingest`, transforms, and `scripts/`. |
| **Tests** | 19 test files covering API, ingestion, analytics, transforms, synthesis, config, compose, pipeline execution. |
| **Scripts** | CLI tools for PhysioNet conversion, ASQ-PHI processing, MIMIC generation, dataset transforms, analytics, span listing, corpus composition. |

### What's NOT built yet

| Gap | Status |
|---|---|
| Setup CLI (`clinical-deid setup`) | Planned |
| **Persistent** audit log (DB rows for every process call; query API `/audit/logs`) | Planned — responses already carry auditable fields for clients to log |
| Log viewer UI (htmx/Jinja2 dashboard) | Planned |
| **Playground UI** — pipeline picker + text try-it (inference); eval job with **local dataset path** or **browser upload** (JSONL / zip BRAT) | Planned |
| Evaluation API (run pipeline vs dataset **from path or uploaded corpus**, store results, compare runs) | Planned |
| Training data export (AnnotatedDocument → spaCy DocBin / HF JSONL / CoNLL) | Planned |
| Training runner (CLI wrapper for spaCy/HF training) | Planned |
| Custom NER pipe (loads trained models from models directory by name) | Planned (model directory + discovery implemented in `models.py`) |
| LLM-prompted detector pipe | Planned |
| SpanResolver pipe (overlap/conflict resolution, interval-tree-based) | Planned |
| ConsistencyPropagator pipe (document-level span propagation) | Planned |
| Surrogate pipe (realistic PHI replacement with per-document consistency) | Planned |
| HIPAA Safe Harbor label mapping + coverage verification | Planned |

---

## Architecture

```
        ┌──────────────────────────────┐     ┌─────────────────────────┐
        │   Playground UI (planned)     │     │   Log / audit viewer     │
        │  • Try pipeline on text      │     │   (htmx + Jinja2)       │
        │  • Eval: local path | upload  │     └────────────┬────────────┘
        └──────────────────┬───────────┘                  │
                           │         FastAPI Gateway      │
                           └─────────────┬────────────────┘
                                         │
  ┌──────────┬──────────┬────────────────┼──────────┬──────────┬──────────────┐
  │          │          │                │          │          │              │
  ▼          ▼          ▼                ▼          ▼          ▼              ▼
Data prep Training   Model           Pipeline   Process   Audit-Log     Evaluation
(scripts  (local     Directory       Service    Service   Service       Service
+library) CLI only)  (planned        (exists)   (exists)  (partial:     (planned;
                     FS registry)                         response-only  local + UI upload)
```

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

Keep new integrations **scoped to a module + registry**: no changes to HTTP routers when the pipe follows the protocol and is registered. Optional: add `json_schema_extra` / `field_ui` hints so forms stay informative; add a **catalog** entry for “pip install …” messaging for heavy deps.

```python
# 1. Config (Pydantic — serializable)
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

After registration, it works in pipeline JSON configs, the CRUD API, the process endpoint, and evaluation — zero other code changes.

### Pipeline composition

Sequential:
```json
{"pipes": [{"type": "regex_ner"}, {"type": "presidio_ner"}, {"type": "presidio_anonymizer"}]}
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
      {"type": "custom_ner", "config": {"model_name": "deid-roberta-v3"}}
    ]
  }]
}
```

Merge strategies: `union` (keep all), `consensus` (N detectors must agree), `max_confidence` (greedy highest), or a custom callable.

---

## Model directory (planned, not DB-backed)

Training is local-only (CLI/scripts). No training API. The filesystem is the registry:

```
models/
  spacy/
    deid-ner-v1/
      model-best/
      model_manifest.json    ← {"name", "framework", "labels", "metrics", ...}
  huggingface/
    deid-roberta-i2b2/
      config.json, model.safetensors, tokenizer.json
      model_manifest.json
  external/
    presidio-default/
      model_manifest.json
```

Drop a model in, write a manifest, it's available as `{"type": "custom_ner", "config": {"model_name": "deid-ner-v1"}}`. The API only has read-only endpoints to list what's there.

---

## Database tables

**Existing (current `tables.py`):**
- `PipelineRecord` — id, name, description, latest_version, is_active, created_at, updated_at
- `PipelineVersionRecord` — id, pipeline_id, version, config (JSON), config_hash, created_at (immutable — old versions never modified)

**Planned / optional (dataset service):**
- `DatasetRecord` — id, name, version, parent_dataset_id, created_at
- `DocumentRecord` — id, dataset_id, external_id, text, spans (JSON), doc_metadata (JSON)

**Planned:**
- `AuditLogRecord` — id, request_id, pipeline_version_id, pipeline_name, input_text, output_text, spans (JSON), span_count, processing_time_ms, source, caller, created_at
- `EvalRunRecord` — id, pipeline_version_id, dataset_id, metrics (JSON), document_count, created_at

---

## API endpoints

### Existing (default `clinical_deid.api.app`)
| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/pipelines/pipe-types` | Pipe catalog, install hints, JSON Schema (+ `ui_*`) for configs |
| `GET` | `/pipelines/ner/builtins` | Packaged regex / whitelist label names |
| `POST` | `/pipelines/whitelist/parse-lists` | Parse uploaded list files for whitelist config |
| `POST` | `/pipelines/blacklist/parse-wordlists` | Merge wordlist uploads for blacklist |
| `POST` | `/pipelines` | Create named pipeline from JSON config |
| `GET` | `/pipelines` | List pipelines |
| `GET` | `/pipelines/{id}` | Pipeline detail + current version config |
| `PUT` | `/pipelines/{id}` | Update pipeline (new version when config changes) |
| `DELETE` | `/pipelines/{id}` | Soft-delete |
| `POST` | `/pipelines/{id}/validate` | Dry-run validation |
| `POST` | `/process/{pipeline_id}` | Run pipeline on plain text; auditable JSON (`request_id`, spans, latency, optional trace) |
| `POST` | `/process/{pipeline_id}/batch` | Batch process |

### Planned / optional extensions
| Method | Path | Description |
|---|---|---|
| `POST` | `/datasets/import-jsonl` | Import JSONL dataset (HTTP) — library + scripts exist today |
| `GET` | `/datasets` | List datasets |
| `GET` | `/datasets/{id}/analytics` | Analytics |
| `GET` | `/documents/{id}` | Fetch document |
| `GET` | `/audit/logs` | List persisted audit logs (paginated, filtered) |
| `GET` | `/audit/logs/{id}` | Audit log detail |
| `GET` | `/audit/stats` | Aggregate stats |
| `POST` | `/eval/run` | Run pipeline against gold data: **server path** (JSONL/BRAT root), **saved dataset id**, or **pre-uploaded** corpus id from multipart |
| `POST` | `/eval/corpora/upload` (name TBD) | Accept drag-and-drop zip/JSONL; return ephemeral id for `/eval/run` |
| `GET` | `/eval/runs` | List eval runs |
| `GET` | `/eval/runs/{id}` | Eval run detail |
| `POST` | `/eval/compare` | Compare two eval runs |
| `GET` / `POST` | `/playground/...` (name TBD) | Server-rendered try-it + eval UI (optional separate router) |
| `GET` | `/models` | List models from filesystem |
| `GET` | `/models/{framework}/{name}` | Model manifest details |
| `POST` | `/models/refresh` | Re-scan models directory |

---

## Module structure

```
src/clinical_deid/
  domain.py                  # Document, PHISpan, AnnotatedDocument
  tables.py                  # SQLModel tables (pipelines + versions)
  db.py                      # SQLite engine, init_db(), pipeline cache
  config.py                  # Settings (pydantic-settings), .env loading
  models.py                  # Filesystem model registry (scan, get, list)
  ids.py                     # UUID helpers
  env_file.py                # .env resolution
  pipes/
    base.py                  # Pipe, Detector, Preprocessor, SpanTransformer, Redactor protocols
    registry.py              # Type registry, JSON load/dump, pipe catalog
    ui_schema.py             # `field_ui`, `pipe_config_json_schema` (UI hints in JSON Schema)
    span_merge.py            # Merge strategies (union, consensus, max_confidence, etc.)
    trace.py                 # Intermediary trace capture
    detector_label_mapping.py # Shared label mapping utilities
    regex_ner/               # Regex-based PHI detection
    whitelist/               # Phrase/dictionary matching
    blacklist/               # False-positive filtering
    presidio_ner/            # Microsoft Presidio wrapper
    pydeid_ner/              # pyDeid wrapper
    resolve_spans/           # Overlap resolution
    presidio_anonymizer/     # Text redaction
    combinators.py           # Pipeline, ParallelDetectors, ResolveSpans, LabelMapper, LabelFilter
  api/
    app.py                   # FastAPI app, CORS, lifespan, router mounting
    deps.py                  # Dependency injection (DB session)
    schemas.py               # Request/response models
    routers/
      pipelines.py           # Pipeline CRUD, pipe-types, validate, list helpers
      process.py             # Inference (text + batch), auditable responses
  eval/
    spans.py                 # strict_micro_f1, SpanMicroF1
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

## Key design decisions already made

1. **Registry-first extensibility** — New pipe types are added with **config model + pipe class + `register()`** (and optional catalog metadata). Process, pipeline load/dump, and `/pipelines/pipe-types` stay generic; this is the main lever for keeping third-party and in-house detectors **low boilerplate**.
2. **Pipes are pure transformations** — `AnnotatedDocument → AnnotatedDocument`. No side effects, no awareness of pipeline context.
3. **Serializable configs + UI hints** — Pydantic + JSON Schema; `ui_*` keys for generated forms without custom per-pipe frontend code.
4. **Model directory, not model database** — training is local-only (CLI). The filesystem is the registry. API is read-only.
5. **Immutable pipeline versions** — updating a pipeline creates a new version row; old versions persist. Audit logs and eval runs reference the exact version that ran.
6. **Multi-mode evaluation** — strict, partial-overlap, token-level, and exact-boundary matching. Per-label breakdowns, risk-weighted recall, label confusion matrix, HIPAA coverage reporting. **Same runner** should accept gold data from **server-visible paths** or **UI uploads** (temp extract → ingest → eval).
7. **SQLite for MVP** — configurable via `CLINICAL_DEID_DATABASE_URL`. Can switch to Postgres later.
8. **htmx + Jinja2 for UI** — avoids React build pipeline for MVP (playground + log viewer). Can migrate later.
9. **Datasets are mutable with provenance** (when stored in DB) — version bumps + parent_dataset_id for lineage; filesystem + scripts cover many workflows today.
10. **Post-processing pipe chain** — detect → resolve overlaps (SpanResolver) → propagate across document (ConsistencyPropagator) → replace with surrogates (SurrogatePipe). Each step is a registered pipe, composable via JSON config.

---

## Implementation phases

| Phase | Scope | Dependencies |
|---|---|---|
| **1. Setup CLI** | `clinical-deid setup/serve`, model downloads | None |
| **2. Persistent audit** | `AuditLogRecord`, write-through on `/process`, query API | None (process endpoint exists) |
| **3. Evaluation API** | Eval runner service: `POST /eval/run` with **dataset source** = registered path, `dataset_id`, or **upload token** from multipart ingest; `EvalRunRecord`, list/detail/compare | Pipelines |
| **4. Playground UI** | htmx pages: pipeline selector, text try-it (wraps `/process`), eval form (**local path** OR **drag-and-drop** JSONL/BRAT zip) | Phases 2–3 |
| **5. Log Viewer UI** | htmx templates, dashboard, log viewer | Phase 2 |
| **6. Training & Models** | Model directory, exporters, training CLI, custom_ner pipe, models API | Independent |
| **7. Dataset HTTP API** | Optional mount: import/list/analytics/documents alongside pipelines (can back persistent eval datasets) | None |

Pipeline CRUD and the process endpoint are **implemented**; next differentiators are **playground + eval with upload/local parity**, **persistent audit**, and **training/model discovery**—without complicating the **register-a-pipe** path.

---

## Tech stack

- **Backend:** Python 3.11+, FastAPI, Pydantic, SQLModel (SQLAlchemy), Uvicorn
- **ML/NLP:** spaCy, HuggingFace Transformers, Microsoft Presidio
- **LLM:** OpenAI-compatible API client
- **Testing:** Pytest, Faker, HTTPx (async test client)
- **Data:** Pandas (scripts), custom JSONL/BRAT parsers
- **UI (planned):** htmx, Jinja2, Chart.js
- **Storage:** SQLite (MVP), local filesystem for models and dataset artifacts

---

## The full loop

```
1. Ingest data        → datasets/import-jsonl, BRAT, etc.
2. Prepare data       → label remap, compose, augment with synthesis
3. Export             → clinical-deid export (spaCy/HF/CoNLL)
4. Train              → clinical-deid train (local, outputs to models/)
5. Available          → model directory scanned, appears in GET /models
6. Build pipeline     → {"type": "custom_ner", "config": {"model_name": "..."}}
7. Evaluate pipeline  → POST /eval/run (local path or upload) or **Playground UI**
8. Try interactively  → **Playground**: choose pipeline, paste text, inspect spans / trace
9. Deploy pipeline    → POST /process/{pipeline_id} (log responses today; DB audit planned)
10. Monitor           → client-side logs now; audit API + UI planned
11. Retrain           → new data or failed cases → back to step 2
```
