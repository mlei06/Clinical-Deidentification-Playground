# Clinical-Deidentification-Playground

A **local-first platform** for clinical PHI de-identification: compose modular detection **pipes** into named **pipelines**, evaluate against gold-standard corpora, and expose **inference HTTP APIs** with an **auditable** response trail (spans, timing, optional per-step traces).

High-level flow:

1. **Train locally** — Prepare annotated data (JSONL, BRAT, and other ingest paths in the Python package), export to your trainer of choice, save checkpoints under [`models/`](./models/README.md).
2. **Configure & compose** — Define pipes (detectors, span transforms, redactors) and merge strategies; persist named pipelines as JSON files in `data/pipelines/`.
3. **Infer & audit** — Call `POST /process/{pipeline_name}` (or batch); responses include `request_id`, detected spans, redacted text, `processing_time_ms`, and `intermediary_trace` when the pipeline config enables step capture. All calls are logged to a unified SQLite audit trail.
4. **Evaluate** — Run `clinical-deid eval --corpus data.jsonl` or `POST /eval/run` to compute strict, partial, token-level, and risk-weighted metrics against gold data.
5. **Playground UI** — A React (Vite + TypeScript) frontend for building pipelines visually, running inference with live span highlighting, evaluating against gold corpora, and managing whitelist/blacklist dictionaries.

**Design priority:** keep **registering new pipes** as low-friction as possible — Pydantic config, `forward` implementation, and **`register()`**; optional catalog line and `ui_*` hints only when needed.

**Documentation:** [docs/README.md](docs/README.md) (index), [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) (architecture), [docs/deployment.md](docs/deployment.md) (Docker / production), [docs/configuration.md](docs/configuration.md) (env & auth).

### Repository layout

All mutable runtime state lives under `data/`; model weights live under `models/`. A deployment mounts those two directories — see [docs/deployment.md](docs/deployment.md) and [data/README.md](./data/README.md).

| Path | Purpose |
|------|---------|
| `frontend/` | React (Vite + TypeScript) playground UI |
| `data/pipelines/` | Named pipeline configs (JSON files, git-versioned) |
| `data/modes.json` | Deploy configuration (inference modes, pipeline allowlist) |
| `data/evaluations/` | Eval result JSON files |
| `data/inference_runs/` | Saved batch inference snapshots |
| `data/corpora/<name>/` | Registered datasets (`dataset.json` + imported corpus files) |
| `data/dictionaries/` | Whitelist & blacklist term-list files |
| [`data/raw/`](./data/raw) | Optional local inbox for source files |
| `data/app.sqlite` | SQLite database (audit log only) |
| `models/` | Trained model artifacts (see [`models/README.md`](./models/README.md)) |

## Security notice

**Optional API keys** (`CLINICAL_DEID_ADMIN_API_KEYS` / `CLINICAL_DEID_INFERENCE_API_KEYS`): when both lists are empty, the API is open (typical local dev). For any shared or production host, set keys, TLS at the reverse proxy, and rate limits. See [docs/configuration.md](docs/configuration.md#authentication) and [docs/deployment.md](docs/deployment.md).

## Setup

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
clinical-deid setup          # verify deps, download spaCy model, init DB
```

Optional extras for specific pipes: `pip install -e ".[presidio]"`, `pip install -e ".[ner]"`, `pip install -e ".[llm]"`, etc. (see `pyproject.toml`).

## CLI

```bash
# De-identify text
echo "Patient John Smith DOB 01/15/1980" | clinical-deid run
clinical-deid run --profile fast notes.txt
clinical-deid run --pipeline my-pipeline notes.txt
clinical-deid run --redactor surrogate notes.txt

# Batch process
clinical-deid batch notes_dir/ -o output/ --format jsonl
clinical-deid batch corpus.jsonl -o output/ --pipeline my-pipeline

# Evaluate against gold standard
clinical-deid eval --corpus data.jsonl --profile balanced
clinical-deid eval --corpus data.jsonl --pipeline my-pipeline

# Dictionary management
clinical-deid dict list
clinical-deid dict preview whitelist hospitals --label HOSPITAL
clinical-deid dict import terms.txt --kind whitelist --name hospitals --label HOSPITAL
clinical-deid dict delete whitelist hospitals

# Dataset management
clinical-deid dataset list
clinical-deid dataset register data/corpus.jsonl --name i2b2-2014
clinical-deid dataset register data/brat/ --name physionet --format brat-dir
clinical-deid dataset show i2b2-2014
clinical-deid dataset delete i2b2-2014

# Audit trail
clinical-deid audit list
clinical-deid audit show <record-id>

# Server
clinical-deid serve --port 8000 --reload
```

Pipeline commands (`run`, `batch`, `eval`) support `--profile` (fast/balanced/accurate), `--pipeline` (saved pipeline by name), `--config` (custom JSON file), and `--redactor` (tag/surrogate).

## Frontend (Playground UI)

The frontend is a React + TypeScript app (Vite, Tailwind CSS) with seven views:

| View | Route | What it does |
|------|-------|-------------|
| **Pipeline Builder** | `/create` | Visual drag-and-drop pipeline composer |
| **Inference** | `/inference` | Paste text, see spans + redacted output + trace |
| **Evaluate** | `/evaluate` | Run evals, view metrics/confusion matrix, compare runs |
| **Datasets** | `/datasets` | Register, browse, compose, transform, generate datasets |
| **Dictionaries** | `/dictionaries` | Upload/manage whitelist & blacklist term lists |
| **Deploy** | `/deploy` | Configure production inference modes & pipeline allowlist |
| **Audit** | `/audit` | Browse audit trail with stats, filters, detail panel |

```bash
cd frontend
npm install
npm run dev          # default http://localhost:3000 (see frontend/vite.config.ts)
```

Configure `VITE_API_BASE_URL` / `VITE_API_KEY` via `frontend/.env.local` when the API is not proxied under `/api`. The dev server proxies `/api` to `localhost:8000` by default.

## Run the API

```bash
clinical-deid serve
# or: clinical-deid-api
# or: uvicorn clinical_deid.api.app:app --reload
```

Default SQLite database: `./data/app.sqlite` (audit log only). Override with `CLINICAL_DEID_DATABASE_URL`.

### HTTP API

| Area | Method | Path | Description |
|------|--------|------|-------------|
| Core | `GET` | `/health` | Liveness |
| Pipelines | `GET` | `/pipelines/pipe-types` | Pipe catalog, install hints, JSON Schema for configs |
| Pipelines | `POST` | `/pipelines/pipe-types/{name}/labels` | Compute label space for a detector given config |
| Pipelines | `GET` | `/pipelines/ner/builtins` | Bundled regex / whitelist label names |
| Pipelines | `POST` | `/pipelines/whitelist/parse-lists` | Parse uploaded list files for whitelist config |
| Pipelines | `POST` | `/pipelines/blacklist/parse-wordlists` | Merge uploads into blacklist terms |
| Pipelines | `POST` | `/pipelines` | Create named pipeline from JSON config |
| Pipelines | `GET` | `/pipelines` | List pipelines |
| Pipelines | `GET` | `/pipelines/{name}` | Pipeline config |
| Pipelines | `PUT` | `/pipelines/{name}` | Update pipeline config |
| Pipelines | `DELETE` | `/pipelines/{name}` | Delete pipeline |
| Pipelines | `POST` | `/pipelines/{name}/validate` | Validate config without saving |
| Dictionaries | `GET` | `/dictionaries` | List all uploaded dictionaries |
| Dictionaries | `GET` | `/dictionaries/{kind}/{name}` | Dictionary metadata |
| Dictionaries | `GET` | `/dictionaries/{kind}/{name}/preview` | Preview first N terms |
| Dictionaries | `GET` | `/dictionaries/{kind}/{name}/terms` | Full term list (paginated) |
| Dictionaries | `POST` | `/dictionaries` | Upload a new dictionary file |
| Dictionaries | `DELETE` | `/dictionaries/{kind}/{name}` | Delete a dictionary |
| Datasets | `GET` | `/datasets` | List registered datasets |
| Datasets | `POST` | `/datasets` | Register dataset from local path |
| Datasets | `GET` | `/datasets/{name}` | Dataset detail + analytics |
| Datasets | `PUT` | `/datasets/{name}` | Update description/metadata |
| Datasets | `DELETE` | `/datasets/{name}` | Delete dataset directory under corpora |
| Datasets | `POST` | `/datasets/{name}/refresh` | Recompute analytics |
| Datasets | `GET` | `/datasets/{name}/preview` | Preview documents (paginated) |
| Datasets | `GET` | `/datasets/{name}/documents/{doc_id}` | Full document with spans |
| Datasets | `POST` | `/datasets/compose` | Compose multiple datasets |
| Datasets | `POST` | `/datasets/transform` | Apply transforms to dataset |
| Datasets | `POST` | `/datasets/generate` | Generate synthetic data via LLM |
| Process | `POST` | `/process/redact` | Redact/surrogate from edited spans |
| Process | `POST` | `/process/scrub` | Zero-config clean using default mode |
| Process | `POST` | `/process/{pipeline_name}` | Run pipeline (name or mode alias) |
| Process | `POST` | `/process/{pipeline_name}/batch` | Batch variant |
| Eval | `POST` | `/eval/run` | Run evaluation against dataset |
| Eval | `GET` | `/eval/runs` | List eval results |
| Eval | `GET` | `/eval/runs/{id}` | Eval result detail |
| Eval | `POST` | `/eval/compare` | Compare two eval runs |
| Audit | `GET` | `/audit/logs` | Query audit trail (filtered, paginated) |
| Audit | `GET` | `/audit/logs/{id}` | Audit log detail |
| Audit | `GET` | `/audit/stats` | Aggregate stats |
| Deploy | `GET` | `/deploy` | Get deploy config (modes + allowlist) |
| Deploy | `PUT` | `/deploy` | Update deploy config |
| Deploy | `GET` | `/deploy/health` | Per-mode availability (Production UI) |
| Deploy | `GET` | `/deploy/pipelines` | List deployable pipeline names |
| Models | `GET` | `/models` | List models from filesystem |
| Models | `GET` | `/models/{framework}/{name}` | Model manifest details |
| Models | `POST` | `/models/refresh` | Re-scan models directory |

## Example pipeline config

Pipelines are JSON documents — sequential steps with detectors feeding into span transformers:

```json
{
  "pipes": [
    {"type": "regex_ner"},
    {"type": "whitelist"},
    {"type": "presidio_ner"},
    {"type": "blacklist"},
    {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}}
  ]
}
```

Save as `data/pipelines/my-pipeline.json` or create via `POST /pipelines`.

## Example JSONL line (training / evaluation)

```json
{
  "document": {"id": "note-001", "text": "Patient John Smith DOB 01/15/1980"},
  "spans": [
    {"start": 8, "end": 18, "label": "PATIENT"},
    {"start": 23, "end": 33, "label": "DATE"}
  ]
}
```

## PhysioNet raw to BRAT (optional)

Requires `pip install -e ".[scripts]"` (pandas):

```bash
python scripts/process_physionet.py \
  --text data/raw/physionet/id.text \
  --annotations data/raw/physionet/ann.csv \
  --output data/corpora/physionet/brat
```

## ASQ-PHI synthetic queries to JSONL / BRAT

```bash
python scripts/process_asq_phi.py \
  --input data/raw/ASQ-PHI/synthetic_clinical_queries.txt \
  --output-jsonl data/corpora/asq_phi/jsonl/asq_phi.jsonl
```

### Dataset analytics (CLI)

```bash
python scripts/dataset_analytics.py --jsonl tests/fixtures/sample.jsonl
python scripts/dataset_analytics.py --brat-corpus data/corpora/physionet/brat
```

### Dataset transforms (CLI)

```bash
python scripts/transform_dataset.py --brat-corpus data/corpora/physionet/brat \
  --label-map scripts/label_maps/physionet_to_deid_example.json \
  --target-documents 500 --seed 42 \
  --output-jsonl data/corpora/sample500.jsonl
```

## Tests

```bash
pytest
```
