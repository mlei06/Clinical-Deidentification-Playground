# Clinical De-Identification Playground — Design Plan

**A local-first platform for training detectors, composing pipelines, and serving audited inference**

---

## 1. Vision

Build a platform with three entangled goals:

### (1) Local model training

Train and fine-tune NER (and related) models **on your own hardware**, on annotated clinical text, so custom checkpoints can back **pipes** in production configs.

1. **Prepare data** — ingest annotated datasets (BRAT, JSONL, i2b2), remap labels, compose corpora, generate synthetic data
2. **Export training data** — convert `AnnotatedDocument` collections into the formats NER frameworks expect (spaCy DocBin, HuggingFace token-classification JSONL, CoNLL)
3. **Train models** — run your trainer locally; track experiments (hyperparameters, dataset version, metrics)
4. **Register artifacts** — publish checkpoints under `models/` (manifest + layout in `models/README.md`) so configs can reference them by name

### (2) Pipeline composition

1. **Configure pipes** — each pipe has a Pydantic config, serializable JSON, and (for UI) optional `ui_*` hints in JSON Schema
2. **Compose** — sequential `Pipeline`, parallel detectors with merge strategies, span resolution, label mapping, redactors
3. **Save** — named pipelines as JSON files in `pipelines/` (use git for version history)

### (3) Inference services & auditability

1. **Expose HTTP inference** — `POST /process/{pipeline_name}` (and batch): upstream services send text, receive redacted or model-transformed text plus structured spans
2. **Auditable by default** — `request_id`, pipeline name, per-span detail, `processing_time_ms`, and optional **intermediary traces** when the pipeline enables step capture
3. **Persistent audit trail** — every operation (CLI and API) logged to SQLite `audit_log` table for compliance dashboards and replay

### (4) Playground & evaluation UX (planned)

1. **Try inference in the browser** — Select a saved pipeline, paste or upload text, see redacted output, spans, timings, and optional intermediary trace (thin htmx/Jinja2 UI over `POST /process`).
2. **Evaluate on gold data two ways** — **Local/server paths** (JSONL file or BRAT corpus directory the app is allowed to read) or **drag-and-drop** uploads (multipart JSONL or zipped BRAT). Both funnel into the **same** `AnnotatedDocument` ingestion + **same** eval metrics code path.
3. **Pipe registration stays trivial** — The playground must not require per-pipe UI code: pipeline and pipe-type discovery come from existing registry + JSON Schema (`ui_*` hints).

### How the threads connect

```text
Local training                         Composition + inference
---------------------                  -------------------------
Annotated corpora                         Pipeline JSON + registry
       |                                         |
       v                                         v
 Label remap --> Export --> Train --> models/ --> detector/redactor configs
       ^              |                         |
       |              v                         v
 Synthesis         Experiments              POST /process/{name}
                                                 |
                                                 v
                                    Response (spans, latency, trace) + audit DB
```

Datasets feed both training and evaluation. Trained models feed the pipe registry. Evaluation results inform whether to retrain or reconfigure.

---

## 2. Architecture

```text
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
+ library  (local     Registry       Service    Service   Service       Service
(scripts)  CLI, plan) (FS)           (exists)   (exists)  (exists)      (exists)
```

---

## 3. Core design principles

- **Optimize for new pipes** — Prefer **one registration site** (`register(name, Config, Pipe)` + optional `PipeCatalogEntry`). Avoid per-pipe routes, switch statements, or frontend forks; discovery flows through **`/pipelines/pipe-types`** and JSON Schema.
- **Everything is data-driven** — pipes, pipelines, and configs are serializable Pydantic models. The registry maps type names to (config, class) pairs; pipelines are JSON documents.
- **Filesystem-first** — Pipelines, eval results, models, and datasets live on the filesystem. The database stores only the append-only audit trail. Use git for version history.
- **Pipes are pure transformations** — `AnnotatedDocument -> AnnotatedDocument`. No awareness of pipeline or dataset context.
- **Pipelines are composable** — sequential chains and parallel fan-out with merge strategies (union, consensus, max-confidence, longest, exact-dedupe).
- **One eval implementation, many ingest paths** — local filesystem, upload, or future UI-uploaded datasets should all normalize to `AnnotatedDocument` iterators before scoring.

---

## 4. What already exists

| Area | Status |
|---|---|
| Domain models (`Document`, `PHISpan`, `AnnotatedDocument`) | Done |
| Pipe protocol + registry (11 pipe types: RegexNER, Whitelist, Presidio, pyDeid, LLM, Blacklist, ResolveSpans, LabelMapper, LabelFilter, SpanResolver, ConsistencyPropagator, Surrogate) | Done |
| Sequential + parallel pipeline execution with 5 merge strategies | Done |
| Pipeline JSON serialization/deserialization | Done |
| Pipeline profiles (fast, balanced, accurate) | Done |
| CLI (run, batch, eval, audit, setup, serve) | Done |
| API (pipeline CRUD, process, eval, audit, models) | Done |
| Multi-mode evaluation (strict, exact boundary, partial overlap, token-level, risk-weighted recall, HIPAA coverage) | Done |
| Filesystem-backed pipeline and eval result storage | Done |
| Unified audit trail (SQLite, CLI + API) | Done |
| Dataset ingestion (JSONL, BRAT, ASQ-PHI, MIMIC, PhysioNet) | Done |
| Analytics (label distribution, overlaps, co-occurrence) | Done |
| LLM synthesis | Done |
| Model directory + API listing | Done |
| Tests (25 test files) | Done |
| Playground UI (htmx + Jinja2) | Planned |
| Log viewer UI | Planned |
| Training data export (spaCy DocBin / HF JSONL / CoNLL) | Planned |
| Training runner CLI | Planned |
| Custom NER pipe (loads models from `models/` by name) | Planned |
| Eval corpus upload (multipart for browser eval) | Planned |

---

## 5. Extensibility — Adding new detectors

The pipe system is designed so that adding a new detector is a **three-step** process with **no downstream boilerplate**:

1. **Define a config** (Pydantic model with the detector's parameters; add `Field(json_schema_extra=field_ui(...))` only if you want richer forms)
2. **Implement a pipe class** (with `forward(AnnotatedDocument) -> AnnotatedDocument` and, for detectors, `labels` / `label_mapping` as applicable)
3. **Register it** — `register("my_pipe", MyConfig, MyPipe)` (typically in the same module or `_register_builtins`)

**Optional fourth steps** (only when needed): append to **`pipe_catalog()`** in `registry.py` for install hints; wrap registration in **`try: ... except ImportError`** for heavy extras.

After registration, the new detector is immediately available in pipeline JSON configs, the CRUD API, the process endpoint, evaluation, and CLI — **without** edits to `process.py` or pipeline loaders.

### 5.1 Pattern: how existing detectors are built

Every detector follows the same shape:

```python
class MyDetectorConfig(BaseModel):
    """Pydantic model -- all parameters are serializable."""
    some_param: str = "default"

class MyDetectorPipe:
    def __init__(self, config: MyDetectorConfig | None = None):
        self._config = config or MyDetectorConfig()

    @property
    def labels(self) -> set[str]:
        return {"PATIENT", "DATE", ...}

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        # detect spans in doc.document.text
        # return doc.with_spans(found_spans)

# One line to register:
register("my_detector", MyDetectorConfig, MyDetectorPipe)
```

Once registered, it works everywhere:

```json
{
  "pipes": [
    {"type": "my_detector", "config": {"some_param": "value"}},
    {"type": "presidio_ner"},
    {"type": "label_mapper", "config": {"mapping": {"PATIENT": "PERSON"}}}
  ]
}
```

### 5.2 Built-in post-processing pipes

These pipes sit between detection and redaction to improve span quality.

#### SpanResolver — overlap and conflict resolution

Detectors produce overlapping, nested, and boundary-disagreement spans. `SpanResolver` normalizes these before redaction.

```python
class SpanResolverConfig(BaseModel):
    strategy: Literal["longest", "highest_confidence", "priority"] = "longest"
    label_priority: list[str] = []  # for "priority" strategy
    merge_adjacent: bool = True     # merge touching same-label spans
    boundary_slack: int = 0         # chars of tolerance for "same span" grouping

register("span_resolver", SpanResolverConfig, SpanResolverPipe)
```

#### ConsistencyPropagator — document-level span propagation

If "John Smith" is detected as PATIENT once with high confidence, every other occurrence in the same document should also be flagged.

```python
class ConsistencyPropagatorConfig(BaseModel):
    min_confidence: float = 0.8
    case_sensitive: bool = False
    labels: list[str] | None = None  # restrict to these labels; None = all
    source_name: str = "propagated"

register("consistency_propagator", ConsistencyPropagatorConfig, ConsistencyPropagatorPipe)
```

#### SurrogatePipe — realistic PHI replacement

Instead of `[PATIENT]` bracket redaction, generate realistic surrogate values while maintaining consistency within a document.

```python
class SurrogateConfig(BaseModel):
    date_shift_days: int = 0          # 0 = random per document
    preserve_date_intervals: bool = True
    name_locale: str = "en_US"        # Faker locale
    seed: int | None = None

register("surrogate", SurrogateConfig, SurrogatePipe)
```

#### LlmNerPipe — LLM-prompted detection

Uses an OpenAI-compatible chat API with a structured prompt to identify PHI spans.

```python
class LlmNerConfig(BaseModel):
    model: str = "gpt-4o-mini"
    base_url: str | None = None
    api_key_env: str = "OPENAI_API_KEY"
    labels: list[str] = ["PATIENT", "DOCTOR", "DATE", "HOSPITAL", "ID", "PHONE", "EMAIL"]
    temperature: float = 0.0

register("llm_ner", LlmNerConfig, LlmNerPipe)
```

### 5.3 Recommended pipeline structure

A production pipeline typically follows this pattern:

```json
{
  "pipes": [
    {"type": "parallel", "strategy": "union", "detectors": [
      {"type": "regex_ner"},
      {"type": "presidio_ner"},
      {"type": "llm_ner", "config": {"model": "gpt-4o-mini"}}
    ]},
    {"type": "blacklist"},
    {"type": "consistency_propagator", "config": {"min_confidence": 0.7}},
    {"type": "span_resolver", "config": {"strategy": "highest_confidence", "merge_adjacent": true}},
    {"type": "surrogate"}
  ]
}
```

Detect -> filter false positives -> propagate across document -> resolve overlaps -> replace with surrogates.

### 5.4 Other detectors that can be added the same way

| Detector | Config highlights | Notes |
|---|---|---|
| `spacy_ner` | `model_name`, `label_map` | Load any spaCy NER model |
| `custom_ner` | `model_name` (from `models/` directory) | Load trained models by name |
| `dictionary_ner` | `dictionaries: dict[str, list[str]]` | Exact/fuzzy match against word lists |
| `transformer_ner` | `model_name`, `tokenizer`, `device`, `batch_size` | Raw HuggingFace token classification |
| `negation_filter` | `cue_words`, `scope_window` | SpanTransformer that drops negated entities |

Each one is a config + a class + one `register()` call. The rest of the system works automatically.

---

## 6. Storage architecture

### 6.1 Filesystem-first design

| Store | Implementation | Files |
|-------|---------------|-------|
| **Pipelines** | `pipeline_store.py` | `pipelines/{name}.json` |
| **Eval results** | `eval_store.py` | `evaluations/{pipeline}_{timestamp}.json` |
| **Models** | `models.py` | `models/{framework}/{name}/model_manifest.json` |
| **Datasets** | User-provided | Local JSONL files, BRAT directories |
| **Audit log** | `audit.py` via SQLModel | `var/dev.sqlite`, table `audit_log` |

Configuration via env vars (prefix `CLINICAL_DEID_`):
- `CLINICAL_DEID_DATABASE_URL` — SQLite path (default: `sqlite:///./var/dev.sqlite`)
- `CLINICAL_DEID_PIPELINES_DIR` — pipeline directory (default: `pipelines`)
- `CLINICAL_DEID_EVALUATIONS_DIR` — eval results directory (default: `evaluations`)
- `CLINICAL_DEID_MODELS_DIR` — models directory (default: `models`)

### 6.2 Audit log schema

The only database table. Both CLI and API write to it.

```python
class AuditLogRecord(SQLModel, table=True):
    __tablename__ = "audit_log"

    id: str              # UUID primary key
    timestamp: datetime  # UTC
    user: str            # OS username
    command: str         # "run", "batch", "eval", "process", "process_batch"
    pipeline_name: str
    pipeline_config: dict[str, Any]  # JSON snapshot
    dataset_source: str  # filesystem path or ""
    doc_count: int
    error_count: int
    span_count: int
    duration_seconds: float
    metrics: dict[str, Any]  # JSON (eval metrics, span counts, etc.)
    source: str          # "cli" or "api"
    notes: str
```

### 6.3 Model directory structure

```
models/
  spacy/
    deid-ner-v1/
      model-best/
      model_manifest.json
  huggingface/
    deid-roberta-i2b2/
      config.json, model.safetensors, tokenizer.json
      model_manifest.json
  external/
    presidio-default/
      model_manifest.json
```

Drop a model in, write a manifest, it's available via `GET /models` and (once `custom_ner` is implemented) in pipe configs.

---

## 7. Evaluation system

### 7.1 Matching modes

Four matching modes (based on SemEval partial matching scheme):

| Mode | Criteria | Use case |
|---|---|---|
| **Strict** | Exact (start, end, label) match | Baseline |
| **Exact boundary** | Exact (start, end), any label | Detection accuracy ignoring classification |
| **Partial overlap** | Spans overlap AND same label | Forgiving on boundaries |
| **Token-level** | Per-character B/I/O tags compared | Most granular, standard in i2b2 tasks |

### 7.2 Risk-weighted recall

Each missed span is weighted by its label's HIPAA severity:

```python
DEFAULT_RISK_WEIGHTS = {
    "SSN": 10.0, "MRN": 8.0, "PATIENT": 7.0, "PHONE": 6.0,
    "EMAIL": 6.0, "ID": 5.0, "DOCTOR": 4.0, "DATE": 3.0,
    "HOSPITAL": 2.0, "LOCATION": 2.0, "AGE": 1.0,
}
```

### 7.3 HIPAA Safe Harbor coverage

Maps pipeline labels to the 18 HIPAA Safe Harbor identifiers. Reports which identifiers are covered, partially covered, or uncovered.

### 7.4 Eval output

Per document: metrics across all 4 modes, false negatives, false positives, risk-weighted recall.
Aggregate: overall metrics, per-label breakdown, label confusion matrix, worst-document ranking.

Results stored as JSON files in `evaluations/`.

---

## 8. API design

### 8.1 Pipeline CRUD (filesystem-backed)

| Method | Path | Description |
|---|---|---|
| `POST` | `/pipelines` | Create named pipeline (writes JSON file) |
| `GET` | `/pipelines` | List all pipelines |
| `GET` | `/pipelines/{name}` | Get pipeline config |
| `PUT` | `/pipelines/{name}` | Update pipeline config |
| `DELETE` | `/pipelines/{name}` | Delete pipeline file |
| `POST` | `/pipelines/{name}/validate` | Dry-run validation |

Validation: `load_pipeline(config)` catches unknown pipe types, missing fields, etc.

### 8.2 Process endpoint

| Method | Path | Description |
|---|---|---|
| `POST` | `/process/{pipeline_name}` | Run pipeline on text |
| `POST` | `/process/{pipeline_name}/batch` | Batch variant |

Processing flow:
1. Load pipeline config from `pipelines/{name}.json`
2. Build pipe chain via `load_pipeline(config)`
3. Wrap input text in `AnnotatedDocument` (empty spans)
4. Run `pipeline.forward(doc)`
5. If pipeline includes a redactor, use output text; otherwise generate `[LABEL]` replacements
6. Log to audit trail
7. Return `ProcessResponse` with spans, timing, optional intermediary trace

### 8.3 Evaluation API

| Method | Path | Description |
|---|---|---|
| `POST` | `/eval/run` | Run pipeline against gold dataset (local path) |
| `GET` | `/eval/runs` | List eval results (from filesystem) |
| `GET` | `/eval/runs/{id}` | Eval result detail |
| `POST` | `/eval/compare` | Compare two eval runs |

### 8.4 Audit API

| Method | Path | Description |
|---|---|---|
| `GET` | `/audit/logs` | Query audit trail (paginated, filtered by pipeline/source/date) |
| `GET` | `/audit/logs/{id}` | Full audit log detail |
| `GET` | `/audit/stats` | Aggregate stats (total requests, avg duration, top pipelines, source breakdown) |

---

## 9. CLI design

```
clinical-deid run [FILES]           # De-identify from stdin or files
clinical-deid batch INPUT -o OUT    # Batch process directory or JSONL
clinical-deid eval --corpus FILE    # Evaluate against gold standard
clinical-deid audit list            # List audit records
clinical-deid audit show ID         # Show audit detail
clinical-deid setup                 # Verify deps, init DB
clinical-deid serve                 # Start API server
```

All commands support `--profile` (fast/balanced/accurate), `--pipeline` (saved pipeline name), `--config` (custom JSON file), `--redactor` (tag/surrogate).

---

## 10. Implementation phases

| Phase | Scope | Status |
|---|---|---|
| **1. Pipe system** | Protocol, registry, built-in pipes (regex, whitelist, blacklist, presidio, pydeid), combinators, JSON serialization | Done |
| **2. API + CLI** | Pipeline CRUD, process endpoint, batch, CLI commands (run, batch, setup, serve), profiles | Done |
| **3. Advanced pipes** | LLM NER, SpanResolver, ConsistencyPropagator, Surrogate | Done |
| **4. Evaluation** | Multi-mode matching, risk-weighted recall, HIPAA coverage, eval runner, eval API, eval store | Done |
| **5. Storage refactor** | Filesystem-first pipelines + eval, unified audit trail (CLI + API to same SQLite table) | Done |
| **6. Playground UI** | htmx pages: pipeline selector, text try-it (wraps `/process`), eval form (local path or drag-and-drop) | Planned |
| **7. Log Viewer UI** | htmx templates, dashboard, audit log browser | Planned |
| **8. Training & Models** | Training data export (spaCy/HF/CoNLL), training runner CLI, custom_ner pipe | Planned |

---

## 11. Tech stack

- **Backend:** Python 3.11+, FastAPI, Pydantic v2, SQLModel (SQLAlchemy), Uvicorn, Click
- **ML/NLP:** spaCy, HuggingFace Transformers, Microsoft Presidio
- **LLM:** OpenAI-compatible API client (httpx)
- **Testing:** Pytest, Faker, HTTPx
- **Data:** Pandas (scripts), custom JSONL/BRAT parsers
- **UI (planned):** htmx, Jinja2, Chart.js
- **Storage:** SQLite (audit only), local filesystem for everything else
