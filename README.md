# Clinical-Deidentification-Playground

A **local-first platform** for clinical PHI de-identification: compose modular detection **pipes** into named **pipelines**, evaluate against gold-standard corpora, and expose **inference HTTP APIs** with an **auditable** response trail (spans, timing, optional per-step traces).

High-level flow:

1. **Train locally** — Prepare annotated data (JSONL, BRAT, and other ingest paths in the Python package), export to your trainer of choice, save checkpoints under [`models/`](./models/README.md).
2. **Configure & compose** — Define pipes (detectors, span transforms, redactors) and merge strategies; persist named pipelines as JSON files in `pipelines/`.
3. **Infer & audit** — Call `POST /process/{pipeline_name}` (or batch); responses include `request_id`, detected spans, redacted text, `processing_time_ms`, and `intermediary_trace` when the pipeline config enables step capture. All calls are logged to a unified SQLite audit trail.
4. **Evaluate** — Run `clinical-deid eval --corpus data.jsonl` or `POST /eval/run` to compute strict, partial, token-level, and risk-weighted metrics against gold data.
5. **Playground UI** — A React (Vite + TypeScript) frontend for building pipelines visually, running inference with live span highlighting, evaluating against gold corpora, and managing whitelist/blacklist dictionaries.

**Design priority:** keep **registering new pipes** as low-friction as possible — Pydantic config, `forward` implementation, and **`register()`**; optional catalog line and `ui_*` hints only when needed.

Architecture detail and roadmap: [DESIGN_PLAN.md](./DESIGN_PLAN.md) and [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md).

### Repository layout

| Path | Purpose |
|------|---------|
| `frontend/` | React (Vite + TypeScript) playground UI |
| `pipelines/` | Named pipeline configs (JSON files, git-versioned) |
| `evaluations/` | Eval result JSON files |
| `models/` | Trained model artifacts (see [`models/README.md`](./models/README.md)) |
| [`data/raw/`](./data/raw) | Optional local inbox for source files |
| [`data/corpora/`](./data/corpora) | Annotated datasets (gold, transformed, synthesized) |
| `var/` | SQLite database (audit log only) |

## Security notice

This API has **no authentication or rate limiting** and is intended for **local or trusted-network use only**. Do not expose it to the public internet without adding an auth layer and TLS termination.

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

# Audit trail
clinical-deid audit list
clinical-deid audit show <record-id>

# Server
clinical-deid serve --port 8000 --reload
```

All commands support `--profile` (fast/balanced/accurate), `--pipeline` (saved pipeline by name), `--config` (custom JSON file), and `--redactor` (tag/surrogate).

## Frontend (Playground UI)

The frontend is a React + TypeScript app (Vite, Tailwind CSS) for visual pipeline building, inference testing, evaluation dashboards, and dictionary management.

```bash
cd frontend
npm install
npm run dev          # dev server on localhost:5173
```

The frontend expects the API at `localhost:8000` (run `clinical-deid serve` first).

## Run the API

```bash
clinical-deid serve
# or: clinical-deid-api
# or: uvicorn clinical_deid.api.app:app --reload
```

Default SQLite database: `./var/dev.sqlite` (audit log only). Override with `CLINICAL_DEID_DATABASE_URL`.

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
| Dictionaries | `GET` | `/dictionaries/{kind}/{name}/terms` | Full term list |
| Dictionaries | `POST` | `/dictionaries` | Upload a new dictionary file |
| Dictionaries | `DELETE` | `/dictionaries/{kind}/{name}` | Delete a dictionary |
| Process | `POST` | `/process/{pipeline_name}` | Run pipeline on text |
| Process | `POST` | `/process/{pipeline_name}/batch` | Batch variant |
| Eval | `POST` | `/eval/run` | Run evaluation against dataset |
| Eval | `GET` | `/eval/runs` | List eval results |
| Eval | `GET` | `/eval/runs/{id}` | Eval result detail |
| Eval | `POST` | `/eval/compare` | Compare two eval runs |
| Audit | `GET` | `/audit/logs` | Query audit trail (filtered, paginated) |
| Audit | `GET` | `/audit/logs/{id}` | Audit log detail |
| Audit | `GET` | `/audit/stats` | Aggregate stats |
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

Save as `pipelines/my-pipeline.json` or create via `POST /pipelines`.

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
