# Clinical-Deidentification-Playground

A **local-first platform** for clinical PHI de-identification: train or fine-tune models on your hardware, compose those models with rule-based and library-backed **pipes** into versioned **pipelines**, and expose **inference HTTP APIs** so other services can run those pipelines with **auditable** responses (identifiers, timing, and optional per-step traces).

High-level flow:

1. **Train locally** — Prepare annotated data (JSONL, BRAT, and other ingest paths in the Python package), export to your trainer of choice, save checkpoints under [`models/`](./models/README.md).
2. **Configure & compose** — Define pipes (detectors, span transforms, redactors) and merge strategies; persist named pipelines with immutable versions via the API (JSON config + UI-oriented schema metadata on each pipe type).
3. **Infer & audit** — Call `POST /process/{pipeline_id}` (or batch); responses include `request_id`, detected spans, redacted text (or model output text after redactors), `processing_time_ms`, and `intermediary_trace` when the pipeline config enables step capture—so you can log and review what ran without a separate log store. Persistent audit storage and a log viewer UI are [planned](./PROJECT_OVERVIEW.md).

4. **Playground (planned)** — A small **web UI** to **try** a chosen pipeline on pasted or uploaded text (see spans and redaction side-by-side) and to **evaluate** pipelines on **local annotated datasets** (paths on the machine running the app) **or** **drag-and-drop** gold files (e.g. JSONL / BRAT zip)—both paths should hit the **same** scoring code as CLI/library eval.

**Design priority:** keep **registering new pipes** as low-friction as possible—Pydantic config, `forward` implementation, and **`register()`**; optional catalog line and `ui_*` hints only when you need them. See [PROJECT_OVERVIEW.md § Design priorities](./PROJECT_OVERVIEW.md#design-priorities).

Architecture detail and roadmap: [DESIGN_PLAN.md](./DESIGN_PLAN.md) and [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md).

### Repository `data/` layout

| Path | Purpose |
|------|---------|
| [`data/raw/`](./data/raw) | Optional **local inbox** for source files you plan to ingest (see [`data/README.md`](./data/README.md)). |
| [`data/corpora/`](./data/corpora) | Annotated datasets — gold, transformed, synthesised, merged (see [`data/README.md`](./data/README.md)). |

Dataset preparation, analytics, and transforms are available as **library code and CLI scripts**; the default `clinical-deid-api` app mounts **pipelines** and **process** routes (see below).

## Security notice

This API has **no authentication or rate limiting** and is intended for **local or trusted-network use only**. Do not expose it to the public internet without adding an auth layer (e.g. reverse proxy with OAuth, API-key middleware) and TLS termination.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

Optional extras for specific pipes: `pip install -e ".[presidio]"`, `pip install -e ".[pydeid]"`, etc. (see `pyproject.toml`).

## Run the API

```bash
mkdir -p var
clinical-deid-api
# or: python -m clinical_deid
# or: uvicorn clinical_deid.api.app:app --reload --host 127.0.0.1 --port 8000
```

Default SQLite database: `./var/dev.sqlite`. Override with `CLINICAL_DEID_DATABASE_URL` (e.g. `sqlite:////tmp/custom.sqlite`).

### HTTP API (default app)

The FastAPI app in `clinical_deid.api.app` currently exposes:

| Area | Method | Path | Description |
|------|--------|------|-------------|
| Core | `GET` | `/health` | Liveness |
| Pipelines | `GET` | `/pipelines/pipe-types` | Known pipe types, install hints, JSON Schema for configs (includes `ui_*` hints for forms) |
| Pipelines | `GET` | `/pipelines/ner/builtins` | Packaged regex / whitelist label names |
| Pipelines | `POST` | `/pipelines/whitelist/parse-lists` | Multipart: parse list files for whitelist config |
| Pipelines | `POST` | `/pipelines/blacklist/parse-wordlists` | Merge uploads into blacklist `terms` |
| Pipelines | `POST` | `/pipelines` | Create named pipeline from JSON config |
| Pipelines | `GET` | `/pipelines` | List pipelines |
| Pipelines | `GET` | `/pipelines/{pipeline_id}` | Pipeline detail + current version config |
| Pipelines | `PUT` | `/pipelines/{pipeline_id}` | Update pipeline (new version when config changes) |
| Pipelines | `DELETE` | `/pipelines/{pipeline_id}` | Soft-delete pipeline |
| Pipelines | `POST` | `/pipelines/{pipeline_id}/validate` | Validate config without persisting |
| Process | `POST` | `/process/{pipeline_id}` | Run pipeline on `text`; auditable JSON response |
| Process | `POST` | `/process/{pipeline_id}/batch` | Batch variant |

**Inference logging / auditability today:** responses include `request_id`, `pipeline_id`, `pipeline_version`, span-level detail, latency, and optionally `intermediary_trace` when `store_intermediary` / per-step flags are set in the pipeline JSON. Upstream services should persist those payloads to their log store; first-class **audit log** tables and queries are [planned](./PROJECT_OVERVIEW.md).

### Local dataset storage

When using dataset features that write under a configurable root, the API or scripts may create **`{CLINICAL_DEID_LOCAL_DATA_DIR}/datasets/{dataset_id}/`** (default root: `var/data`). See [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) for layout. Set `CLINICAL_DEID_LOCAL_DATA_DIR` to move the tree.

## Example pipeline config

Pipelines are JSON documents validated by the registry—sequential steps, optional `parallel` blocks with merge strategies (`union`, `consensus`, etc.). Example:

```json
{
  "pipes": [
    {"type": "regex_ner", "config": {}},
    {"type": "resolve_spans", "config": {"strategy": "longest_non_overlapping"}}
  ]
}
```

See `DESIGN_PLAN.md` and tests for fuller examples.

## Example JSONL line (training / evaluation)

Each line can represent one `AnnotatedDocument`: a `document` (`id`, `text`, `metadata`) and `spans` (`start`, `end`, `label`, optional `confidence`, `source`). See `tests/fixtures/sample.jsonl`.

## PhysioNet raw → BRAT (optional)

Requires `pip install -e ".[scripts]"` (pandas). From repo root:

```bash
python scripts/process_physionet.py \
  --text data/raw/physionet/id.text \
  --annotations data/raw/physionet/ann.csv \
  --output data/corpora/physionet/brat
```

Writes `train/`, `valid/`, `test/` with paired `.txt`/`.ann` using **original** CSV `type` values. To remap types, pass a JSON file:

```bash
python scripts/process_physionet.py \
  --text data/raw/physionet/id.text \
  --annotations data/raw/physionet/ann.csv \
  --output data/corpora/physionet/brat \
  --label-map scripts/label_maps/physionet_to_deid_example.json
```

## ASQ-PHI synthetic queries → JSONL / BRAT

Raw file: `data/raw/ASQ-PHI/synthetic_clinical_queries.txt` (`===QUERY===` / `===PHI_TAGS===` blocks with JSON tag lines). Spans use **original** `identifier_type` labels (`NAME`, `GEOGRAPHIC_LOCATION`, `DATE`, etc.); offsets match each `value` substring in order (first match forward from the previous span).

```bash
python scripts/process_asq_phi.py \
  --input data/raw/ASQ-PHI/synthetic_clinical_queries.txt \
  --output-jsonl data/corpora/asq_phi/jsonl/asq_phi.jsonl

# Flat BRAT (one directory of .txt/.ann pairs)
python scripts/process_asq_phi.py --output-brat-dir data/corpora/asq_phi/brat

# BRAT corpus with train/valid/test/ (same layout as PhysioNet — works with analytics / brat loaders)
python scripts/process_asq_phi.py \
  --output-brat-corpus data/corpora/asq_phi/brat \
  --brat-seed 42 --brat-train 0.7 --brat-valid 0.15

# --single-line collapses query whitespace (offsets match collapsed text)
python scripts/process_asq_phi.py --single-line ...
```

Parser module: `clinical_deid.ingest.asq_phi`.

### Dataset analytics (CLI)

```bash
python scripts/dataset_analytics.py --jsonl tests/fixtures/sample.jsonl

# PhysioNet (or any BRAT corpus with train/valid/test folders)
python scripts/dataset_analytics.py --brat-corpus data/corpora/physionet/brat

# Single BRAT directory
python scripts/dataset_analytics.py --brat-dir data/corpora/physionet/brat/train
```

### List spans for one label

```bash
python scripts/list_spans_by_label.py --brat-corpus data/corpora/physionet/brat --label DATE
python scripts/list_spans_by_label.py --jsonl tests/fixtures/sample.jsonl --label PHONE --format json --max 20
```

(TSV default columns: `document_id`, `start`, `end`, `label`, `text`, `split`.)

### Train / validation / test / deploy splits

Splits are **not** separate database tables everywhere. They often live in **`document.metadata["split"]`** (a string like `train`, `valid`, `test`, or `deploy`).

- **BRAT folder layout:** `load_brat_corpus_with_splits` reads `train/`, `valid/`, `test/`, `dev/`, or `deploy/` subdirectories and sets `metadata["split"]` from the folder name (`dev` is kept as `dev`).
- **`deploy`:** optional held-out bucket for your own workflow (e.g. production-like evaluation).

To **re-randomize** splits on a corpus, use the transform CLI **`--resplit`**:

```bash
python scripts/transform_dataset.py --brat-corpus data/corpora/physionet/brat \
  --resplit "train=0.7,valid=0.15,test=0.1,deploy=0.05" --seed 42 \
  --output-jsonl data/corpora/resplit.jsonl
```

Weights are normalized to 1; document **order** in the list is preserved. Programmatic: `clinical_deid.transform.reassign_splits`.

### Dataset transforms (CLI)

Pipeline order: **label map → target document count (random) → boost by label → resplit** (each step optional except you must request at least one output).

```bash
# JSONL only
python scripts/transform_dataset.py --brat-corpus data/corpora/physionet/brat \
  --label-map scripts/label_maps/physionet_to_deid_example.json \
  --target-documents 500 --seed 42 \
  --output-jsonl data/corpora/sample500.jsonl
```

Sources: `--jsonl`, `--dataset-id`, `--brat-dir`, or `--brat-corpus` (same as analytics). Programmatic API: `clinical_deid.transform`.

## Tests

```bash
pytest
```
