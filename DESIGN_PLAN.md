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
3. **Version** — named pipelines with immutable versions (config hash, audit-friendly references)

### (3) Inference services & auditability

1. **Expose HTTP inference** — `POST /process/{pipeline_id}` (and batch): upstream services send text, receive redacted or model-transformed text plus structured spans
2. **Auditable by default in the response** — `request_id`, pipeline id/name/version, per-span detail, `processing_time_ms`, and optional **intermediary traces** when the pipeline enables step capture
3. **Persisted audit trail (planned)** — store each call for compliance dashboards, replay, and aggregate metrics; until then, integrators log the API response payloads

### (4) Playground & evaluation UX (planned)

1. **Try inference in the browser** — Select a saved pipeline, paste or upload text, see redacted output, spans, timings, and optional intermediary trace (thin htmx/Jinja2 UI over `POST /process`).
2. **Evaluate on gold data two ways** — **Local/server paths** (JSONL file or BRAT corpus directory the app is allowed to read) or **drag-and-drop** uploads (multipart JSONL or zipped BRAT). Both should funnel into the **same** `AnnotatedDocument` ingestion + **same** eval metrics code path (no duplicate F1 implementations).
3. **Pipe registration stays trivial** — The playground must not require per-pipe UI code: pipeline and pipe-type discovery come from existing registry + JSON Schema (`ui_*` hints).

### How the threads connect

```text
Local training                         Composition + inference
─────────────                          ─────────────────────────
Annotated corpora                         Pipeline JSON + registry
       │                                         │
       ▼                                         ▼
 Label remap ──► Export ──► Train ──► models/ ──► detector/redactor configs
       ▲              │                         │
       │              ▼                         ▼
 Synthesis         Experiments              POST /process/{id}
                                                 │
                                                 ▼
                                    Response (spans, latency, trace) + (future) audit DB
```

Datasets feed both training and evaluation. Trained models feed the pipe registry. Evaluation results inform whether to retrain or reconfigure.

---

## 2. Architecture

```text
     ┌────────────────────────────────┐       ┌─────────────────────────┐
     │ Playground UI (try + eval)      │       │ Log / audit viewer       │
     │  text in → spans out; eval path │       │ (htmx / Jinja2)         │
     │  or file upload → same metrics  │       └────────────┬────────────┘
     └─────────────────┬──────────────┘                    │
                       │          FastAPI Gateway            │
                       └────────────────┬────────────────────┘
                                        │
  ┌──────────┬──────────┬───────────────┼──────────┬──────────┬──────────────┐
  │          │          │               │          │          │              │
  ▼          ▼          ▼               ▼          ▼          ▼              ▼
  Data prep Training   Model          Pipeline   Process   Audit-Log     Evaluation
+ library  (local     Registry        Service    Service   Service       Service
(script)   CLI)       (planned       (exists)   (exists)  (partial:     (planned;
                     FS)                                      response-only  path + upload)
  │          │          │               │
  │          ▼          │               │
  └──► Export ──► Train ──► Register ──► Pipe Config  (minimal: config + class + register)
```

---

## 3. Core design principles

- **Optimize for new pipes** — Prefer **one registration site** (`register(name, Config, Pipe)` + optional `PipeCatalogEntry`). Avoid per-pipe routes, switch statements, or frontend forks; discovery flows through **`/pipelines/pipe-types`** and JSON Schema. Optional dependencies: register inside `try/except ImportError` (see builtins in `registry._register_builtins`).
- **Everything is data-driven** — pipes, pipelines, and configs are serializable Pydantic models. The registry maps type names to (config, class) pairs; pipelines are JSON documents.
- **Everything is versioned** — pipelines use immutable version rows; datasets gain the same when persisted in DB.
- **Pipes are pure transformations** — `AnnotatedDocument → AnnotatedDocument`. No awareness of pipeline or dataset context.
- **Pipelines are composable** — sequential chains and parallel fan-out with merge strategies (union, consensus, max-confidence).
- **Datasets carry provenance** — transforms and parent lineage in workflows; optional DB-backed version bumps when a dataset API is added.
- **One eval implementation, many ingest paths** — local filesystem, upload, or future DB-backed datasets should all normalize to `AnnotatedDocument` iterators before scoring.

---

## 4. What already exists

| Area | Status |
|---|---|
| Domain models (`Document`, `PHISpan`, `AnnotatedDocument`) | ✅ Done |
| Pipe protocol + registry (RegexNER, WhitelistPipe, PresidioNER, PyDeidNER, BlacklistSpans, ResolveSpans, LabelMapper, LabelFilter, PresidioAnonymizer) | ✅ Done |
| Sequential + parallel pipeline execution | ✅ Done |
| Pipeline JSON serialization/deserialization | ✅ Done |
| Dataset ingestion (JSONL, BRAT, ASQ-PHI, MIMIC, PhysioNet) | ✅ Done |
| Analytics (label distribution, overlaps, co-occurrence) | ✅ Done |
| Evaluation (`strict_micro_f1`) | ✅ Done (code only, no API) |
| LLM synthesis | ✅ Done |
| SQLite storage (`PipelineRecord`, `PipelineVersionRecord`) | ✅ Done |
| Dataset/document tables (`DatasetRecord`, `DocumentRecord`) | Planned with dataset HTTP API |
| API: health; pipeline CRUD + pipe-types/validate/helpers; `POST /process/{id}` (+ batch, auditable fields) | ✅ Done |
| Dataset import/list/analytics HTTP routes | Optional / not mounted in minimal app (library + scripts) |

---

## 5. Extensibility — Adding new detectors

The pipe system is designed so that adding a new detector is a **three-step** process with **no downstream boilerplate**:

1. **Define a config** (Pydantic model with the detector's parameters; add `Field(json_schema_extra=field_ui(...))` only if you want richer forms)
2. **Implement a pipe class** (with `forward(AnnotatedDocument) → AnnotatedDocument` and, for detectors, `labels` / `label_mapping` as applicable)
3. **Register it** — `register("my_pipe", MyConfig, MyPipe)` (typically in the same module or `_register_builtins`)

**Optional fourth steps** (only when needed): append to **`pipe_catalog()`** in `registry.py` for install hints; wrap registration in **`try: ... except ImportError`** for heavy extras.

After registration, the new detector is immediately available in pipeline JSON configs, the CRUD API, the process endpoint, and (once wired) evaluation and playground pickers — **without** edits to `process.py` or pipeline loaders.

### 5.1 Pattern: how existing detectors are built

Every detector follows the same shape:

```python
class MyDetectorConfig(BaseModel):
    """Pydantic model — all parameters are serializable."""
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

### 5.2 Example: LLM-prompted detector

An LLM detector sends the document text to a language model with a structured prompt asking it to identify PHI spans, then parses the response back into `PHISpan` objects.

#### Module: `src/clinical_deid/pipes/llm_ner.py`

```python
class LlmNerConfig(BaseModel):
    """Configuration for LLM-based NER."""
    model: str = "gpt-4o-mini"
    base_url: str | None = None
    api_key_env: str = "OPENAI_API_KEY"  # env var name, not the key itself
    labels: list[str] = ["PATIENT", "DOCTOR", "DATE", "HOSPITAL", "ID", "PHONE", "EMAIL"]
    temperature: float = 0.0
    prompt_template: str | None = None  # custom prompt; uses default if None
    source_name: str = "llm_ner"

class LlmNerPipe:
    def __init__(self, config: LlmNerConfig | None = None):
        self._config = config or LlmNerConfig()

    @property
    def labels(self) -> set[str]:
        return set(self._config.labels)

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        # 1. Build prompt asking LLM to return JSON list of {start, end, label}
        # 2. Call LLM API
        # 3. Parse response into PHISpan objects
        # 4. Validate spans against doc.document.text bounds
        # 5. return doc.with_spans(spans)
```

Registration:

```python
register("llm_ner", LlmNerConfig, LlmNerPipe)
```

Usage in a pipeline — e.g., run LLM and regex in parallel, keep spans where both agree:

```json
{
  "pipes": [
    {
      "type": "parallel",
      "strategy": "consensus",
      "consensus_threshold": 2,
      "detectors": [
        {"type": "llm_ner", "config": {"model": "gpt-4o-mini"}},
        {"type": "regex_ner"}
      ]
    },
    {"type": "presidio_anonymizer"}
  ]
}
```

### 5.3 Built-in post-processing pipes

These pipes sit between detection and redaction to improve span quality.

#### SpanResolver — overlap and conflict resolution

Detectors produce overlapping, nested, and boundary-disagreement spans (e.g., one finds "Memorial Hospital" as ORGANIZATION, another finds "Memorial Hospital, Room 204" as LOCATION). `SpanResolver` normalizes these before redaction.

```python
class SpanResolverConfig(BaseModel):
    strategy: Literal["longest", "highest_confidence", "priority"] = "longest"
    label_priority: list[str] = []  # for "priority" strategy: ordered list, first wins
    merge_adjacent: bool = True     # merge touching same-label spans
    boundary_slack: int = 0         # chars of tolerance for "same span" grouping

class SpanResolverPipe:
    """SpanTransformer that resolves overlapping spans into non-overlapping output."""
    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        # 1. Build interval tree from all spans
        # 2. Group overlapping spans into clusters
        # 3. For each cluster, pick winner by strategy (longest, highest confidence, or label priority)
        # 4. Optionally merge adjacent same-label spans
        # 5. Return doc.with_spans(resolved)

register("span_resolver", SpanResolverConfig, SpanResolverPipe)
```

#### ConsistencyPropagator — document-level span propagation

If "John Smith" is detected as PATIENT once with high confidence, every other occurrence of "John Smith" in the same document should also be flagged — even if the detector missed it in a different context.

```python
class ConsistencyPropagatorConfig(BaseModel):
    min_confidence: float = 0.8     # only propagate spans above this threshold
    case_sensitive: bool = False
    labels: list[str] | None = None # restrict to these labels; None = all
    source_name: str = "propagated"

class ConsistencyPropagatorPipe:
    """SpanTransformer that finds all occurrences of detected span text in the document."""
    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        # 1. Collect high-confidence spans
        # 2. For each, find all occurrences of that text in doc.document.text
        # 3. Create new PHISpan for each occurrence not already covered
        # 4. Merge with existing spans
        # return doc.with_spans(existing + propagated)

register("consistency_propagator", ConsistencyPropagatorConfig, ConsistencyPropagatorPipe)
```

#### SurrogatePipe — realistic PHI replacement

Instead of `[PATIENT]` bracket redaction, generate realistic surrogate values while maintaining consistency within a document (same patient name → same surrogate everywhere, shifted dates preserve intervals).

```python
class SurrogateConfig(BaseModel):
    date_shift_days: int = 0          # 0 = random per document; >0 = fixed shift
    preserve_date_intervals: bool = True
    name_locale: str = "en_US"        # Faker locale for name generation
    seed: int | None = None           # for reproducible surrogates
    source_name: str = "surrogate"

class SurrogatePipe:
    """Redactor that replaces PHI with realistic surrogate values."""
    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        # 1. Group spans by label
        # 2. Build per-document consistency map: original text → surrogate
        #    - Names: Faker-generated, consistent within doc
        #    - Dates: shift by fixed offset, preserving intervals between dates
        #    - IDs: random but format-preserving (e.g., 10-digit MRN → 10-digit MRN)
        #    - Addresses, phones: Faker-generated
        # 3. Replace each span's text with its surrogate
        # 4. Adjust all span offsets for the new text
        # return AnnotatedDocument(document=Document(id=doc.document.id, text=new_text), spans=adjusted_spans)

register("surrogate", SurrogateConfig, SurrogatePipe)
```

### 5.4 Other detectors that can be added the same way

| Detector | Config highlights | Notes |
|---|---|---|
| `spacy_ner` | `model_name`, `label_map` | Load any spaCy NER model |
| `dictionary_ner` | `dictionaries: dict[str, list[str]]` | Exact/fuzzy match against word lists |
| `transformer_ner` | `model_name`, `tokenizer`, `device`, `batch_size` | Raw HuggingFace token classification |
| `ensemble_voter` | `detectors`, `min_votes`, `label_weights` | Weighted voting across N detectors |
| `negation_filter` | `cue_words`, `scope_window` | SpanTransformer that drops negated entities |

Each one is a config + a class + one `register()` call. The rest of the system (pipelines, API, evaluation, audit logging) works automatically.

### 5.5 Recommended pipeline structure

With the new post-processing pipes, a production pipeline typically follows this pattern:

```json
{
  "pipes": [
    {"type": "parallel", "strategy": "union", "detectors": [
      {"type": "regex_ner"},
      {"type": "custom_ner", "config": {"model_name": "deid-roberta-v3"}},
      {"type": "presidio_ner"}
    ]},
    {"type": "span_resolver", "config": {"strategy": "highest_confidence"}},
    {"type": "consistency_propagator"},
    {"type": "surrogate", "config": {"preserve_date_intervals": true}}
  ]
}
```

Detect → resolve overlaps → propagate across document → replace with surrogates.

---

## 6. Training & Model Directory

**Goal:** Train NER models locally on your own clinical data. The filesystem is the registry — drop a model into the right directory and it's immediately available as a pipe.

### 6.1 Model directory structure

```
models/
  spacy/
    deid-ner-v1/
      model-best/           # spaCy model artifacts
      model_manifest.json
    en_core_web_trf/
      model-best/
      model_manifest.json
  huggingface/
    deid-roberta-i2b2/
      config.json            # HF model artifacts
      model.safetensors
      tokenizer.json
      model_manifest.json
    custom-clinical-v2/
      ...
      model_manifest.json
  external/
    presidio-default/
      model_manifest.json    # just metadata, model loaded via library
```

The top-level framework directories (`spacy/`, `huggingface/`, `external/`) organize models by type. Each model lives in its own subdirectory. The directory name *is* the model name used in pipe configs.

Configurable via `Settings.models_dir` (default: `models/`).

### 6.2 Model manifest: `model_manifest.json`

Each model directory contains a manifest with metadata. The system reads this to list models and validate pipe configs — no database table needed.

```json
{
  "name": "deid-roberta-i2b2",
  "framework": "huggingface",
  "description": "RoBERTa fine-tuned on i2b2 2014 for clinical de-identification",
  "base_model": "roberta-base",
  "labels": ["PATIENT", "DOCTOR", "DATE", "HOSPITAL", "ID", "PHONE"],
  "dataset": "i2b2-2014-v1",
  "metrics": {
    "precision": 0.94,
    "recall": 0.91,
    "f1": 0.925
  },
  "device": "cpu",
  "created_at": "2026-03-28T12:00:00Z"
}
```

Fields:

| Field | Required | Description |
|---|---|---|
| `name` | yes | Must match directory name |
| `framework` | yes | `spacy`, `huggingface`, or `external` |
| `labels` | yes | Entity labels this model produces |
| `description` | no | Human-readable description |
| `base_model` | no | What it was fine-tuned from |
| `dataset` | no | Training dataset name/ID |
| `metrics` | no | Evaluation metrics (precision, recall, F1, per-label) |
| `device` | no | Default device (`cpu`, `cuda`, `mps`) |
| `created_at` | no | When the model was created |

### 6.3 Model discovery: `src/clinical_deid/models.py`

Scans the models directory at startup (or on demand) and provides lookup:

```python
@dataclass
class ModelInfo:
    name: str
    framework: str
    path: Path
    labels: list[str]
    description: str
    base_model: str | None
    dataset: str | None
    metrics: dict[str, Any]
    device: str

def scan_models(models_dir: Path) -> dict[str, ModelInfo]:
    """Walk models/{framework}/{name}/model_manifest.json and return {name: ModelInfo}."""

def get_model(name: str) -> ModelInfo:
    """Look up a model by name. Raises if not found."""

def list_models(framework: str | None = None) -> list[ModelInfo]:
    """List all available models, optionally filtered by framework."""
```

### 6.4 Using models in pipes

A `custom_ner` pipe that loads any model from the models directory by name:

```python
class CustomNerConfig(BaseModel):
    model_name: str  # matches directory name under models/{framework}/
    confidence_threshold: float = 0.5
    device: str | None = None  # override manifest default
    source_name: str = "custom_ner"

class CustomNerPipe:
    def __init__(self, config: CustomNerConfig):
        self._config = config
        info = get_model(config.model_name)
        device = config.device or info.device
        if info.framework == "spacy":
            self._model = spacy.load(info.path / "model-best")
        elif info.framework == "huggingface":
            self._pipeline = hf_pipeline("ner", model=str(info.path), device=device)

    @property
    def labels(self) -> set[str]:
        return set(get_model(self._config.model_name).labels)

    def forward(self, doc: AnnotatedDocument) -> AnnotatedDocument:
        # run model inference, convert to PHISpan list
        # return doc.with_spans(spans)

# Register it:
register("custom_ner", CustomNerConfig, CustomNerPipe)
```

Usage in a pipeline — your trained model + regex as an ensemble:

```json
{
  "pipes": [
    {
      "type": "parallel",
      "strategy": "union",
      "detectors": [
        {"type": "custom_ner", "config": {"model_name": "deid-roberta-i2b2"}},
        {"type": "regex_ner"}
      ]
    },
    {"type": "presidio_anonymizer"}
  ]
}
```

### 6.5 Training data export: `src/clinical_deid/training/export.py`

Convert `AnnotatedDocument` collections into the formats NER frameworks expect. This is a local-only operation (CLI or script).

| Format | Target framework | Output |
|---|---|---|
| **spaCy DocBin** | spaCy | `.spacy` binary files with entity annotations |
| **HuggingFace token-classification** | Transformers | JSONL with `tokens` and `ner_tags` arrays (IOB2 scheme) |
| **CoNLL** | General NER tools | Tab-separated `token\tlabel` with blank-line sentence boundaries |

```python
def export_to_spacy(docs, output_path, label_map=None) -> ExportStats: ...
def export_to_hf_jsonl(docs, output_path, tokenizer="bert-base-uncased", label_map=None) -> ExportStats: ...
def export_to_conll(docs, output_path, label_map=None) -> ExportStats: ...

@dataclass
class ExportStats:
    documents: int
    tokens: int
    entities: int
    labels: dict[str, int]
    output_path: Path
```

### 6.6 Training runner: `src/clinical_deid/training/train.py`

Local-only CLI wrapper around spaCy and HuggingFace training. Output goes directly into the models directory with a generated manifest.

```python
class TrainingConfig(BaseModel):
    framework: Literal["spacy", "huggingface"]
    base_model: str
    dataset_id: str
    output_name: str  # becomes the directory name under models/{framework}/
    label_map: dict[str, str] | None = None
    # spaCy-specific
    spacy_config_overrides: dict[str, Any] = {}
    # HuggingFace-specific
    learning_rate: float = 5e-5
    batch_size: int = 16
    epochs: int = 10
    max_length: int = 512
    seed: int = 42
```

#### Training flow (both frameworks)

1. Export dataset to the appropriate format (train + dev splits)
2. Run training (spaCy CLI or HF Trainer)
3. Save model artifacts to `models/{framework}/{output_name}/`
4. Evaluate on dev set
5. Write `model_manifest.json` with labels, metrics, base model, dataset info
6. Model is immediately available as `{"type": "custom_ner", "config": {"model_name": "{output_name}"}}`

### 6.7 CLI commands

| Command | Description |
|---|---|
| `clinical-deid export <dataset_id> --format spacy --output ./exports/` | Export dataset to training format |
| `clinical-deid train --config train_config.json` | Train a model, output to models directory |
| `clinical-deid models list` | List all models in the models directory |
| `clinical-deid models info <model_name>` | Show model manifest details |
| `clinical-deid models evaluate <model_name> --dataset <dataset_id>` | Evaluate a model against a dataset |

### 6.8 API: read-only model listing

No training endpoints. The API only reports what models are available on disk.

#### Router: `src/clinical_deid/api/routers/models.py`

| Method | Path | Description |
|---|---|---|
| `GET` | `/models` | List all models (scans models directory) |
| `GET` | `/models/{framework}/{name}` | Model details from manifest |
| `POST` | `/models/refresh` | Re-scan the models directory (after dropping in a new model) |

### 6.9 The full loop

```text
1. Ingest data        ──► datasets/import-jsonl, BRAT, etc.
2. Prepare data       ──► label remap, compose, augment with synthesis
3. Export             ──► clinical-deid export (spaCy/HF/CoNLL)
4. Train              ──► clinical-deid train (local, outputs to models/)
5. Available          ──► model directory scanned, appears in GET /models
6. Build pipeline     ──► {"type": "custom_ner", "config": {"model_name": "..."}}
7. Evaluate pipeline  ──► POST /eval/run
8. Deploy pipeline    ──► POST /process/{pipeline_id}
9. Monitor            ──► audit logs, UI
10. Retrain           ──► new data or failed cases → back to step 2
```

---

## 7. Phase 1 — Setup CLI

**Goal:** One command to bootstrap the project: install dependencies, download models, verify everything works.

### 7.1 CLI tool: `clinical-deid setup`

Add a CLI entrypoint via `pyproject.toml` `[project.scripts]`:

```
clinical-deid = "clinical_deid.cli:main"
```

#### Module: `src/clinical_deid/cli.py`

Subcommands:

| Command | Description |
|---|---|
| `clinical-deid setup` | Interactive setup: install spaCy models, download Presidio HF models, create `.env` from `.env.example`, initialize SQLite DB |
| `clinical-deid setup --check` | Verify all dependencies are available, print status table |
| `clinical-deid serve` | Start the FastAPI server (`uvicorn`) |

#### Setup steps

1. **Check Python version** — require 3.11+
2. **Install spaCy model** — `python -m spacy download en_core_web_sm` (and optionally `en_core_web_trf`)
3. **Download Presidio NER model** — pull `obi/deid_roberta_i2b2` via HuggingFace hub (or user-specified model)
4. **Create `.env`** — copy `.env.example` if `.env` doesn't exist, prompt for optional OpenAI key
5. **Initialize database** — run `init_db()` to create SQLite tables
6. **Smoke test** — run RegexNER on a sample string, confirm it returns spans

#### Model registry file: `src/clinical_deid/models.py`

```python
AVAILABLE_MODELS = {
    "obi/deid_roberta_i2b2": {
        "source": "huggingface",
        "description": "RoBERTa fine-tuned on i2b2 for clinical de-identification",
        "labels": ["PATIENT", "DOCTOR", "DATE", "HOSPITAL", ...],
    },
    "en_core_web_sm": {
        "source": "spacy",
        "description": "spaCy small English model",
    },
}
```

---

## 8. Phase 2 — Pipeline CRUD & Process Endpoint

**Goal:** Save, list, update, and delete named pipelines. Expose a stateless endpoint for external services to send text through any saved pipeline.

### 8.1 New database tables: `PipelineRecord` + `PipelineVersionRecord`

Pipeline versions are **immutable**. When you "update" a pipeline, the old version persists and a new version row is created. Audit logs and eval runs reference a specific version, so you can always reproduce exactly what ran.

```python
# src/clinical_deid/tables.py

class PipelineRecord(SQLModel, table=True):
    """Named pipeline — mutable metadata, points to latest version."""
    __tablename__ = "pipeline"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    name: str = Field(index=True, unique=True)
    description: str = ""
    latest_version: int = 1
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PipelineVersionRecord(SQLModel, table=True):
    """Immutable snapshot of a pipeline config at a specific version."""
    __tablename__ = "pipeline_version"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    pipeline_id: str = Field(foreign_key="pipeline.id", index=True)
    version: int
    config: dict[str, Any] = Field(sa_column=Column(JSON))
    # config holds the full pipeline JSON: {"pipes": [...]}
    config_hash: str = ""  # SHA-256 of canonical JSON, for dedup
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

When `PUT /pipelines/{id}` is called with a new config:
1. Hash the new config — if it matches the current version's hash, no-op
2. Insert a new `PipelineVersionRecord` with `version = latest_version + 1`
3. Update `PipelineRecord.latest_version` and `updated_at`
4. The old version row is never modified or deleted

Audit logs and eval runs reference `pipeline_version.id`, not `pipeline.id`, so results are always tied to the exact config that produced them.

### 8.2 API: Pipeline CRUD

#### Router: `src/clinical_deid/api/routers/pipelines.py`

| Method | Path | Description |
|---|---|---|
| `POST` | `/pipelines` | Create a named pipeline from JSON config |
| `GET` | `/pipelines` | List all pipelines (id, name, version, description, created_at) |
| `GET` | `/pipelines/{pipeline_id}` | Get pipeline details + full config |
| `PUT` | `/pipelines/{pipeline_id}` | Update pipeline config (bumps version) |
| `DELETE` | `/pipelines/{pipeline_id}` | Soft-delete (set `is_active = False`) |
| `POST` | `/pipelines/{pipeline_id}/validate` | Dry-run: parse config, check all pipe types are registered, return errors or OK |

#### Request/response schemas

```python
# src/clinical_deid/api/schemas.py (additions)

class CreatePipelineRequest(BaseModel):
    name: str
    description: str = ""
    config: dict[str, Any]  # {"pipes": [...]}

class PipelineSummary(BaseModel):
    id: str
    name: str
    description: str
    version: int
    is_active: bool
    created_at: datetime

class PipelineDetail(PipelineSummary):
    config: dict[str, Any]
    updated_at: datetime

class UpdatePipelineRequest(BaseModel):
    description: str | None = None
    config: dict[str, Any] | None = None
```

#### Validation on create/update

When a pipeline config is saved, validate it by calling `load_pipeline(config)` — this catches unknown pipe types, missing required fields, etc. Return 422 with details on failure.

### 8.3 API: Process Endpoint

**The core value proposition.** External services call this with raw text and get deidentified text back.

#### Router: `src/clinical_deid/api/routers/process.py`

| Method | Path | Description |
|---|---|---|
| `POST` | `/process/{pipeline_id}` | Send raw text, get deidentified output |
| `POST` | `/process/{pipeline_id}/batch` | Send list of texts, get list of outputs |

#### Request/response schemas

```python
class ProcessRequest(BaseModel):
    text: str
    # optional: caller-assigned ID for correlation in logs
    request_id: str | None = None

class ProcessResponse(BaseModel):
    request_id: str  # auto-generated if not provided
    original_text: str
    redacted_text: str
    spans: list[PHISpanResponse]
    pipeline_id: str
    pipeline_name: str
    pipeline_version: int
    processing_time_ms: float

class PHISpanResponse(BaseModel):
    start: int
    end: int
    label: str
    text: str  # the matched substring
    confidence: float | None

class BatchProcessRequest(BaseModel):
    items: list[ProcessRequest]

class BatchProcessResponse(BaseModel):
    results: list[ProcessResponse]
    total_processing_time_ms: float
```

#### Processing flow

1. Look up `PipelineRecord` by ID → 404 if not found or inactive
2. `load_pipeline(record.config)` → build the pipe chain
3. Wrap input text in `AnnotatedDocument` (empty spans)
4. Run `pipeline.forward(doc)` → get annotated doc with detected spans
5. If pipeline includes a redactor → use `redacted_text` from output; otherwise generate `[LABEL]` replacements from spans
6. Log the request (Phase 3)
7. Return `ProcessResponse`

#### Upgrade existing document endpoint

Refactor `POST /documents/{id}/run-pipeline` to also use the registry-based `load_pipeline` instead of the current hardcoded `RegexNerPipe` switch. Accept either inline pipe specs (current behavior) or a `pipeline_id` reference:

```python
class RunPipelineRequest(BaseModel):
    pipes: list[dict[str, Any]] | None = None
    pipeline_id: str | None = None  # reference a saved pipeline
```

---

## 9. Phase 3 — Audit Log

**Goal:** Log every processing request for compliance, debugging, and analytics.

### 9.1 New database table: `AuditLogRecord`

```python
class AuditLogRecord(SQLModel, table=True):
    __tablename__ = "audit_log"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    request_id: str = Field(index=True)
    pipeline_id: str = Field(foreign_key="pipeline.id", index=True)
    pipeline_name: str
    pipeline_version: int
    input_text: str
    output_text: str
    spans: list[dict[str, Any]] = Field(sa_column=Column(JSON))
    span_count: int = 0
    processing_time_ms: float
    source: str = "api"  # "api", "batch", "eval", "manual"
    caller: str | None = None  # optional: who called (API key, service name)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

### 9.2 Logging integration

In the process endpoint (Phase 2), after running the pipeline:

```python
log = AuditLogRecord(
    request_id=request_id,
    pipeline_id=record.id,
    pipeline_name=record.name,
    pipeline_version=record.version,
    input_text=request.text,
    output_text=redacted_text,
    spans=[s.model_dump() for s in detected_spans],
    span_count=len(detected_spans),
    processing_time_ms=elapsed_ms,
    source="api",
)
session.add(log)
session.commit()
```

### 9.3 API: Audit Log Queries

#### Router: `src/clinical_deid/api/routers/audit.py`

| Method | Path | Description |
|---|---|---|
| `GET` | `/audit/logs` | List logs with pagination, filtering by pipeline_id, date range, source |
| `GET` | `/audit/logs/{log_id}` | Full log detail (input, output, spans) |
| `GET` | `/audit/stats` | Aggregate stats: requests/day, avg processing time, top pipelines, span label distribution |

#### Query parameters for list endpoint

```python
class AuditLogQuery(BaseModel):
    pipeline_id: str | None = None
    source: str | None = None
    from_date: datetime | None = None
    to_date: datetime | None = None
    limit: int = 50
    offset: int = 0
```

---

## 10. Phase 4 — Evaluation API

**Goal:** Expose evaluation as an API endpoint so users can run a pipeline against a dataset and get metrics back.

### 10.1 New database table: `EvalRunRecord`

```python
class EvalRunRecord(SQLModel, table=True):
    __tablename__ = "eval_run"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    pipeline_id: str = Field(foreign_key="pipeline.id", index=True)
    dataset_id: str = Field(foreign_key="dataset.id", index=True)
    metrics: dict[str, Any] = Field(sa_column=Column(JSON))
    # metrics: {overall: {precision, recall, f1, tp, fp, fn}, per_label: {...}}
    document_count: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

### 10.2 Evaluation metrics: `src/clinical_deid/eval/`

The existing `strict_micro_f1` (exact start/end/label match) is a starting point but too punitive for clinical de-id. A pipeline that finds "Dr. Jane Smith" when gold says "Jane Smith" shouldn't count as a complete miss.

#### Matching modes: `src/clinical_deid/eval/matching.py`

Implement four matching modes (based on SemEval partial matching scheme):

| Mode | Criteria | Use case |
|---|---|---|
| **Strict** | Exact (start, end, label) match | Baseline, existing behavior |
| **Exact boundary** | Exact (start, end), any label | Measures detection accuracy ignoring classification |
| **Partial overlap** | Spans overlap AND same label | More forgiving on boundaries — "Dr. Jane Smith" partially matches "Jane Smith" |
| **Token-level** | Per-token B/I/O tags compared | Standard in i2b2 shared tasks, most granular |

```python
@dataclass(frozen=True)
class MatchResult:
    """Metrics for a single matching mode."""
    precision: float
    recall: float
    f1: float
    tp: int
    fp: int
    fn: int
    partial: int = 0  # only for partial mode: count of partial matches

@dataclass
class EvalMetrics:
    """All matching modes computed together."""
    strict: MatchResult
    exact_boundary: MatchResult
    partial_overlap: MatchResult
    token_level: MatchResult

def compute_metrics(
    pred_spans: list[PHISpan],
    gold_spans: list[PHISpan],
    text: str,
) -> EvalMetrics:
    """Compute all four matching modes for a single document."""
```

#### Per-label breakdown

Every matching mode also produces per-label results:

```python
@dataclass
class LabelMetrics:
    label: str
    strict: MatchResult
    partial_overlap: MatchResult
    token_level: MatchResult
    support: int  # number of gold spans for this label
```

This lets users see which labels their pipeline handles well vs poorly.

#### Risk-weighted scoring

Not all missed PHI is equal. A missed SSN is catastrophic; a missed city name is low-risk. Allow users to define label weights that reflect HIPAA sensitivity:

```python
DEFAULT_RISK_WEIGHTS = {
    "SSN": 10.0, "MRN": 8.0, "PATIENT": 7.0, "PHONE": 6.0,
    "EMAIL": 6.0, "ID": 5.0, "DOCTOR": 4.0, "DATE": 3.0,
    "HOSPITAL": 2.0, "LOCATION": 2.0, "AGE": 1.0,
}

def risk_weighted_recall(
    false_negatives: list[PHISpan],
    gold_spans: list[PHISpan],
    weights: dict[str, float] = DEFAULT_RISK_WEIGHTS,
) -> float:
    """Recall where each missed span is weighted by its label's risk."""
```

#### Evaluation runner: `src/clinical_deid/eval/runner.py`

```python
@dataclass
class DocumentEvalResult:
    document_id: str
    metrics: EvalMetrics
    per_label: list[LabelMetrics]
    false_negatives: list[PHISpan]  # missed PHI — sortable by risk weight
    false_positives: list[PHISpan]
    risk_weighted_recall: float

@dataclass
class EvalResult:
    overall: EvalMetrics
    per_label: dict[str, LabelMetrics]
    risk_weighted_recall: float
    document_results: list[DocumentEvalResult]  # sorted by worst-performing first
    document_count: int
    # Confusion matrix: which labels get confused with each other
    label_confusion: dict[str, dict[str, int]]  # gold_label → {pred_label: count}

def evaluate_pipeline(
    pipeline: Pipeline,
    documents: list[AnnotatedDocument],
    risk_weights: dict[str, float] | None = None,
) -> EvalResult:
    """Run pipeline on each doc, compute all metrics, sort docs by worst performance."""
```

Document results are sorted worst-first so users can immediately focus on the most problematic cases.

### 10.3 API endpoints

#### Router: `src/clinical_deid/api/routers/evaluation.py`

| Method | Path | Description |
|---|---|---|
| `POST` | `/eval/run` | Run a pipeline against a dataset, store and return results |
| `GET` | `/eval/runs` | List past evaluation runs |
| `GET` | `/eval/runs/{run_id}` | Get detailed metrics for a run |
| `POST` | `/eval/compare` | Compare two runs side by side |

#### Schemas

```python
class EvalRunRequest(BaseModel):
    pipeline_id: str
    dataset_id: str

class MatchMetrics(BaseModel):
    precision: float
    recall: float
    f1: float
    tp: int
    fp: int
    fn: int

class EvalMetricsResponse(BaseModel):
    strict: MatchMetrics
    exact_boundary: MatchMetrics
    partial_overlap: MatchMetrics
    token_level: MatchMetrics
    risk_weighted_recall: float

class EvalRunResponse(BaseModel):
    id: str
    pipeline_id: str
    pipeline_version_id: str  # references immutable version
    dataset_id: str
    overall: EvalMetricsResponse
    per_label: dict[str, EvalMetricsResponse]
    label_confusion: dict[str, dict[str, int]]
    document_count: int
    created_at: datetime

class EvalCompareRequest(BaseModel):
    run_id_a: str
    run_id_b: str

class EvalCompareResponse(BaseModel):
    run_a: EvalRunResponse
    run_b: EvalRunResponse
    delta_strict: MatchMetrics      # difference (b - a) for strict
    delta_token_level: MatchMetrics  # difference (b - a) for token-level
```

---

## 11. Phase 5 — Log Viewer UI

**Goal:** A web UI to browse processing logs, inspect input/output diffs, and monitor pipeline usage.

### 11.1 Technology choice

Use **htmx + Jinja2 templates** served from FastAPI for the MVP. This avoids a separate React build pipeline while still providing an interactive experience. Can migrate to React later if needed.

### 11.2 Pages

| Page | Route | Description |
|---|---|---|
| Dashboard | `/ui/` | Summary cards: total requests today, active pipelines, avg processing time, top labels |
| Logs | `/ui/logs` | Paginated table of audit logs with filters (pipeline, date range, source). Click a row to expand |
| Log Detail | `/ui/logs/{id}` | Full view: original text with highlighted spans, redacted output, pipeline config, timing |
| Pipelines | `/ui/pipelines` | List saved pipelines, create/edit pipeline config (JSON editor) |
| Pipeline Detail | `/ui/pipelines/{id}` | Config viewer, recent logs for this pipeline, link to eval runs |
| Eval Runs | `/ui/eval` | Table of past eval runs with metrics, comparison selector |

### 11.3 Key UI components

**Span Diff Viewer:** Show original text with color-coded highlights for each PHI label. On hover, show label + confidence. Side-by-side with redacted output.

**Log Table:** Columns: timestamp, pipeline name, span count, processing time, first 100 chars of input. Filterable, sortable, paginated via htmx partial swaps.

**Dashboard Charts:** Simple bar/line charts for requests over time, label distribution. Use Chart.js or a lightweight charting library.

### 11.4 Module structure

```
src/clinical_deid/
  ui/
    __init__.py
    router.py         # FastAPI router mounting all UI routes
    templates/
      base.html        # Layout with nav
      dashboard.html
      logs.html
      log_detail.html
      pipelines.html
      pipeline_detail.html
      eval.html
    static/
      style.css
      htmx.min.js
```

---

## 12. Phase 6 — Training & Model Management

**Goal:** Train NER models on your clinical data and register them for use in pipelines.

| Phase | Scope | Dependencies |
|---|---|---|
| **6a. Model directory + discovery** | `models.py` — scan `models/` directory, `ModelInfo`, manifest schema | None |
| **6b. Export** | `training/export.py` — spaCy DocBin, HF JSONL, CoNLL exporters | Existing dataset service |
| **6c. Train** | `training/train.py` — spaCy + HuggingFace training runners (CLI only) | 6a + 6b |
| **6d. Custom NER Pipe** | `pipes/custom_ner.py` — loads models from directory by name | 6a (model discovery) |
| **6e. Models API** | `api/routers/models.py` — read-only listing + refresh | 6a (model discovery) |

This phase can run in parallel with Phases 2–5 since it has no dependencies on them. Training is entirely local (CLI/scripts). The API only exposes read-only model listing.

---

## 13. Data models summary

```text
┌──────────────┐     ┌───────────────┐     ┌────────────────────┐
│ DatasetRecord│     │PipelineRecord │     │PipelineVersionRecord│
│──────────────│     │───────────────│     │────────────────────│
│ id           │     │ id            │◄────│ pipeline_id        │
│ name         │     │ name          │     │ version            │
│ version      │     │ description   │     │ config (JSON)      │
│ parent_id    │     │ latest_version│     │ config_hash        │
│ created_at   │     │ is_active     │     │ created_at         │
└──────┬───────┘     │ created_at    │     └─────────┬──────────┘
       │             │ updated_at    │               │
       │             └───────────────┘               │
┌──────┴───────┐                              ┌──────┴──────────┐
│DocumentRecord│     ┌────────────────┐       │  EvalRunRecord  │
│──────────────│     │AuditLogRecord  │       │────────────────│
│ id           │     │────────────────│       │ id             │
│ dataset_id   │     │ id             │       │ pipeline_ver_id│──► PipelineVersionRecord
│ external_id  │     │ request_id     │       │ dataset_id     │──► DatasetRecord
│ text         │     │ pipeline_ver_id│──►    │ metrics (JSON) │
│ spans (JSON) │     │ pipeline_name  │       │ document_count │
│ doc_metadata │     │ input_text     │       │ created_at     │
└──────────────┘     │ output_text    │       └────────────────┘
                     │ spans (JSON)   │
                     │ span_count     │       ┌─────────────────────┐
                     │ processing_ms  │       │ Model Directory     │
                     │ source         │       │ (filesystem, no DB) │
                     │ caller         │       │─────────────────────│
                     │ created_at     │       │ models/             │
                     └────────────────┘       │   {framework}/      │
                                              │     {name}/         │
                                              │       model_manifest│
                                              └─────────────────────┘
```

---

## 14. HIPAA Safe Harbor coverage

Map the platform's label taxonomy to the [18 HIPAA Safe Harbor identifiers](https://www.hhs.gov/hipaa/for-professionals/privacy/special-topics/de-identification/index.html). This lets users verify their pipeline has no coverage gaps.

| # | HIPAA Safe Harbor Identifier | Platform Labels | Default Detectors |
|---|---|---|---|
| 1 | Names | `PATIENT`, `DOCTOR` | RegexNER, PresidioNER, custom_ner |
| 2 | Geographic data (< state) | `LOCATION`, `ADDRESS`, `ZIP` | PresidioNER, custom_ner |
| 3 | Dates (except year) | `DATE` | RegexNER, PresidioNER |
| 4 | Phone numbers | `PHONE` | RegexNER, PresidioNER |
| 5 | Fax numbers | `FAX` | RegexNER |
| 6 | Email addresses | `EMAIL` | RegexNER, PresidioNER |
| 7 | Social Security numbers | `SSN` | RegexNER |
| 8 | Medical record numbers | `MRN`, `ID` | RegexNER, custom_ner |
| 9 | Health plan beneficiary numbers | `ID` | custom_ner |
| 10 | Account numbers | `ACCOUNT`, `ID` | RegexNER |
| 11 | Certificate/license numbers | `LICENSE`, `ID` | RegexNER |
| 12 | Vehicle identifiers | `VEHICLE_ID` | custom_ner |
| 13 | Device identifiers | `DEVICE_ID` | custom_ner |
| 14 | Web URLs | `URL` | RegexNER |
| 15 | IP addresses | `IP_ADDRESS` | RegexNER |
| 16 | Biometric identifiers | `BIOMETRIC` | custom_ner |
| 17 | Full-face photographs | N/A (text only) | — |
| 18 | Any other unique identifying number | `ID` | custom_ner |

#### Coverage verification

The evaluation runner should report HIPAA coverage as part of eval results:

```python
def hipaa_coverage_report(
    pipeline_labels: set[str],
    label_to_hipaa: dict[str, list[int]],  # label → HIPAA identifier numbers
) -> dict[int, str]:
    """Return {hipaa_id: status} where status is 'covered', 'partial', or 'uncovered'."""
```

This surfaces gaps like "your pipeline has no detector for fax numbers" before deployment.

---

## 15. API endpoint summary

### Existing

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/datasets/import-jsonl` | Import JSONL |
| `GET` | `/datasets` | List datasets |
| `GET` | `/datasets/{id}/analytics` | Dataset analytics |
| `GET` | `/documents/{id}` | Fetch document |
| `POST` | `/documents/{id}/run-pipeline` | Run pipeline on document |

### New (Phases 2–6)

| Method | Path | Phase | Description |
|---|---|---|---|
| `POST` | `/pipelines` | 2 | Create named pipeline |
| `GET` | `/pipelines` | 2 | List pipelines |
| `GET` | `/pipelines/{id}` | 2 | Pipeline detail |
| `PUT` | `/pipelines/{id}` | 2 | Update pipeline (bumps version) |
| `DELETE` | `/pipelines/{id}` | 2 | Soft-delete pipeline |
| `POST` | `/pipelines/{id}/validate` | 2 | Validate pipeline config |
| `POST` | `/process/{pipeline_id}` | 2 | Process text through pipeline |
| `POST` | `/process/{pipeline_id}/batch` | 2 | Batch process |
| `GET` | `/audit/logs` | 3 | List audit logs (paginated, filtered) |
| `GET` | `/audit/logs/{id}` | 3 | Audit log detail |
| `GET` | `/audit/stats` | 3 | Aggregate audit stats |
| `POST` | `/eval/run` | 4 | Run evaluation |
| `GET` | `/eval/runs` | 4 | List eval runs |
| `GET` | `/eval/runs/{id}` | 4 | Eval run detail |
| `POST` | `/eval/compare` | 4 | Compare two eval runs |
| `GET` | `/models` | 6 | List models from models directory |
| `GET` | `/models/{framework}/{name}` | 6 | Model manifest details |
| `POST` | `/models/refresh` | 6 | Re-scan models directory |

---

## 16. Module structure (final state)

```
src/clinical_deid/
  cli.py                    # Phase 1: setup, serve commands
  models.py                 # Phase 1: available model registry
  domain.py                 # (existing)
  tables.py                 # + PipelineRecord, AuditLogRecord, EvalRunRecord
  db.py                     # (existing)
  config.py                 # (existing)
  converters.py             # (existing)
  pipes/                    # (existing + new detectors)
    base.py
    registry.py
    regex_ner.py
    presidio_ner.py
    presidio_anonymizer.py
    combinators.py
    llm_ner.py              # LLM-prompted detector (example custom pipe)
    custom_ner.py            # Phase 6: loads trained models from directory
    span_resolver.py         # Overlap/conflict resolution (interval-tree-based)
    consistency.py           # Document-level span propagation
    surrogate.py             # Realistic PHI replacement with consistency
  api/
    app.py                  # + include new routers
    deps.py                 # (existing)
    schemas.py              # + new request/response models
    routers/
      datasets.py           # (existing)
      documents.py          # (existing, upgraded)
      analytics.py          # (existing)
      pipelines.py          # Phase 2: pipeline CRUD
      process.py            # Phase 2: text processing endpoint
      audit.py              # Phase 3: audit log queries
      evaluation.py         # Phase 4: eval endpoints
      models.py             # Phase 6: read-only model listing from filesystem
  eval/
    spans.py                # (existing) strict_micro_f1
    matching.py             # Partial overlap, token-level, exact-boundary matching
    risk.py                 # Risk-weighted recall, HIPAA coverage report
    runner.py               # Phase 4: batch evaluation, per-label, per-doc, confusion matrix
  models.py                 # Phase 6: scan models directory, ModelInfo, get_model/list_models
  training/                 # Phase 6 (local-only, no API)
    export.py               # Dataset → spaCy DocBin / HF JSONL / CoNLL
    train.py                # spaCy + HuggingFace training runners (CLI only)
  ui/                       # Phase 5
    router.py
    templates/
    static/
  ingest/                   # (existing)
  analytics/                # (existing)
  transform/                # (existing)
  compose/                  # (existing)
  synthesis/                # (existing)
  storage/                  # (existing)
```

---

## 17. Implementation order

| Phase | Scope | Dependencies |
|---|---|---|
| **1. Setup CLI** | `cli.py`, `models.py`, pyproject.toml entrypoint | None |
| **2. Pipeline CRUD + Process** | `PipelineRecord`, pipelines router, process router, schema additions | Phase 1 (models available) |
| **3. Audit Log** | `AuditLogRecord`, audit router, integration in process endpoint | Phase 2 (process endpoint exists) |
| **4. Evaluation API** | `EvalRunRecord`, eval runner, evaluation router | Phase 2 (saved pipelines) |
| **5. Log Viewer UI** | htmx templates, UI router, static assets | Phase 3 (audit logs to display) |
| **6. Training & Models** | model directory, `models.py`, exporters, training CLI, `custom_ner` pipe, read-only models API | Existing dataset service |

Phases 1 and 2 are the critical path for pipeline deployment. Phase 6 (training) can run in parallel since it only depends on the existing dataset service. Phases 3–5 can be developed in parallel once Phase 2 is complete.

---

## 18. Future extensions

- **Authentication / API keys** — protect process endpoint for production use
- **Rate limiting** — per-caller throttling on process endpoint, max-length input guards
- **Async processing** — Celery/background workers for large batch jobs
- **Pipeline DAG builder** — React Flow drag-and-drop UI (upgrade from JSON editing)
- **Active learning** — surface low-confidence spans and boundary disagreements for human review, prioritize most informative failures
- **Error analysis clustering** — group failure modes (missed dates in a specific format, names confused with medications, etc.)
- **Confidence calibration** — per-label threshold tuning on the precision-recall curve (clinical de-id favors recall over precision)
- **Section segmenter** — detect clinical note sections (HPI, assessment, medications, vitals) and route each to appropriate detectors
- **Differential privacy scoring** — measure re-identification risk
- **Webhook notifications** — alert on pipeline failures or high PHI leakage
- **Export / FHIR integration** — output deidentified text in standard clinical formats
- **Adversarial test suite** — PHI in medication names, PHI that looks like medical terms, Unicode names, etc.
