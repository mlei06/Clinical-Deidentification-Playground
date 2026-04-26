# Clinical-Deidentification-Playground

## What It Does

A **local-first NER pipeline platform**: compose modular detectors (regex, Presidio, HuggingFace, LLM) into named pipelines, evaluate against gold corpora with multi-mode metrics, generate and manage training datasets, and serve auditable inference via HTTP API.

Ships with a **clinical de-identification pack** (HIPAA Safe Harbor label space, regex patterns, surrogate strategies, risk/coverage profile) as the default configuration — so it works out of the box for PHI detection. The clinical domain is a *pack*, not a baked-in assumption. Swap the label space, pattern pack, surrogate pack, and risk profile to target any NER task. A minimal `generic_pii` pack ships alongside; custom packs register at startup.

**Key capabilities:**
- Visual pipeline builder (drag-and-drop, auto-generated config forms from JSON Schema)
- 11 pipe types: `regex_ner`, `whitelist`, `blacklist`, `presidio_ner`, `huggingface_ner`, `neuroner_ner`, `llm_ner`, `label_mapper`, `label_filter`, `resolve_spans`, `consistency_propagator`
- **Shipped example pipelines** (under `data/pipelines/`, name = filename stem): `clinical-fast`, `presidio`, `clinical-transformer`, `clinical-transformer-presidio` — plus seed **inference modes** in `data/modes.json` (`fast` → `clinical-fast` by default)
- Evaluation: 4 matching modes (strict, partial, token-level, boundary), per-label breakdown, risk-weighted recall, HIPAA Safe Harbor coverage report, confusion matrix
- **Shipped eval snapshots** for the `discharge_summaries` gold set (`data/evaluations/discharge-summaries__*.json`); refresh with `python scripts/emit_discharge_eval_snapshots.py` after changing pipelines or the corpus
- Dataset tools: JSONL/BRAT import, compose, transform, LLM synthesis, export to CoNLL/spaCy/HuggingFace/BRAT
- HuggingFace fine-tuning pipeline (`clinical-deid train run`)
- Full audit trail (SQLite) on every inference call

## Quick Start

```bash
# Backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
clinical-deid setup          # verify deps, init DB
clinical-deid serve           # API on http://localhost:8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev   # http://localhost:3000
```

Open `http://localhost:3000` → **Pipeline Builder** to compose a pipeline, then **Inference** to test it. See [SETUP.md](SETUP.md) for detailed installation options and optional extras.

## Video Links
Demo+Technical Walkthrough
https://youtu.be/iKYWic1IqJQ

## Evaluation

The platform ships three built-in profiles for out-of-the-box use:

| Profile | Pipes | Latency |
|---------|-------|---------|
| **fast** | regex_ner + whitelist + blacklist + resolve_spans | ~10 ms |
| **balanced** | + presidio_ner (spaCy NER fallback) | ~200 ms |
| **accurate** | + consistency_propagator + confidence-based resolution | ~300 ms |

Four evaluation modes supported: **strict** (exact span + label), **exact boundary** (ignore label), **partial overlap** (any span overlap, same label), **token-level** (per-character BIO). Metrics computed: precision, recall, F1, risk-weighted recall (HIPAA severity weights), per-label breakdown, label confusion matrix, HIPAA Safe Harbor identifier coverage (18 identifiers), worst-document ranking.

```bash
# Evaluate a pipeline against a gold JSONL corpus
clinical-deid eval --corpus data/corpora/my-dataset/corpus.jsonl --pipeline my-pipeline
```

**Demo gold set — `discharge_summaries`:** seven short clinical snippets with span **gold labels** in `corpus.jsonl` (layered surrogate / model metadata on some lines under `document.metadata` from the **Production UI** export flow), plus cached stats in `dataset.json`. The repo **tracks** that corpus so Evaluate and the CLI use the same files.

Strict micro-F1 and risk-weighted recall (RWR) on that corpus, for each **shipped** pipeline (regenerate after edits — see [data/README.md](data/README.md)):

| Pipeline | Strict F1 (micro) | Risk-weighted recall |
|----------|-------------------:|---------------------:|
| `clinical-fast` | 0.43 | 0.26 |
| `presidio` | 0.42 | 0.59 |
| `clinical-transformer` | 0.68 | 0.78 |
| `clinical-transformer-presidio` | 0.54 | 0.78 |

Full per-label tables and confusion matrices: `data/evaluations/discharge-summaries__<pipeline>.json`. **Regenerate:** `python scripts/emit_discharge_eval_snapshots.py` (requires the same optional extras you use to load each pipeline, e.g. Presidio + spaCy + HF weights).

> The same eval can be run from **Playground → Evaluate**; HTTP details are in [docs/api.md](docs/api.md).

**Larger benchmark — mimic-10k (optional download):** MIMIC-III clinical notes ship with PHI already redacted (replaced by `[** ... **]` placeholders) but with **no span annotations**, so they cannot be used for evaluation directly. For a large-scale labeled set, synthetic PHI was reinjected at those positions using the surrogate pipeline (see [SETUP.md](SETUP.md)). That optional archive is **not** in git; the discharge set above is the repo-default teaching corpus.

---

**End-to-end flow:** train or import data → save models under [`models/`](./models/README.md) → compose pipelines in `data/pipelines/` (Playground, CLI, or API) → run inference and evaluation → optional SQLite **audit** on every process call. Pack selection (label space, risk profile, etc.) is env-driven; see [docs/configuration.md](docs/configuration.md) (`CLINICAL_DEID_LABEL_SPACE_NAME`, …).

**Developer note:** new pipes are a Pydantic config + `forward` + `register()`. **Documentation index:** [docs/README.md](docs/README.md), [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md), [docs/deployment.md](docs/deployment.md), [docs/api.md](docs/api.md).

### Repository layout

All mutable runtime state lives under `data/`; model weights live under `models/`. A deployment mounts those two directories — see [docs/deployment.md](docs/deployment.md) and [data/README.md](./data/README.md).

| Path | Purpose |
|------|---------|
| `frontend/` | Playground UI (Vite + React + TypeScript) |
| `frontend-production/` | Production UI (inference-scoped batch reviewer) |
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

**Presidio** does not pull spaCy model weights by itself: configure `python -m spacy download` for the `presidio_ner` `model` you use; HF-based Presidio models also need `en_core_web_sm` and a transformers install (see [docs/pipes-and-pipelines.md](docs/pipes-and-pipelines.md), `presidio_ner`).

`pip` is the canonical install path; `uv.lock` is committed for reproducible builds when using `uv sync` / `uv pip install -e ".[dev]"`, but is not required.

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
clinical-deid dataset import-brat data/brat/ --name physionet
clinical-deid dataset show i2b2-2014
clinical-deid dataset delete i2b2-2014

# Audit trail
clinical-deid audit list
clinical-deid audit show <record-id>

# Server
clinical-deid serve --port 8000 --reload
```

Pipeline commands (`run`, `batch`, `eval`) support `--profile` (fast/balanced/accurate), `--pipeline` (saved pipeline by name), `--config` (custom JSON file), and `--redactor` (tag/surrogate).

## Web UIs: Playground vs Production app

The repo ships **two** React (Vite + TypeScript) apps over the same HTTP API. They differ by **API key scope**: the **Playground** uses an **admin** key (full configuration); the **Production** app uses an **inference** key (process + read-only support surfaces). *Naming note:* the Playground has a **“Production”** page for deploy-mode batch review; the separate **Production UI** app is the inference-scoped batch reviewer below.

```bash
cd frontend && npm install && npm run dev              # Playground — http://localhost:3000
cd frontend-production && npm install && npm run dev   # Production UI — http://localhost:3001
```

Set `VITE_API_BASE_URL` and `VITE_API_KEY` in each app’s `frontend` / `frontend-production` `.env.local` as needed. Dev servers proxy `/api` to `localhost:8000` by default. Large dataset uploads need a high enough `CLINICAL_DEID_MAX_BODY_BYTES` on the API (otherwise **413**).

### Playground — `frontend/` (admin)

For authors, evaluators, and operators who manage pipelines, corpora, and deploy config.

| View | Route | What you can do there |
|------|--------|------------------------|
| **Create** | `/create` | **Visual pipeline builder** (XYFlow canvas), per-pipe settings from **JSON Schema** forms, save pipelines to the server. |
| **Pipelines** | `/pipelines` | **List and inspect** saved pipelines: description, ordered pipe list, **output label space**, compute/refresh server-side labels, raw JSON, **rename** and **delete**. |
| **Inference** | `/inference` | **Single-document** run: pick a **saved pipeline**, **output mode** (annotated / redacted / surrogate), run on typed or uploaded text, **highlight** spans, optional per-pipe **trace** timeline, **hand-edit** spans and resolve overlap conflicts, **save/load** inference snapshots, **export** results. |
| **Production** | `/production` | **Deploy-mode** assisted workflow: choose an inference **mode** (maps to a pipeline via `modes.json`), set **reviewer** id, queue **documents**, **batch** run pending items, per-doc **review** and **export**; uses **deploy health** for mode availability. |
| **Evaluate** | `/evaluate` | Pick pipeline + **registered dataset**, start an eval run, view **strict** (and related) **metrics**, per-label table, **confusion matrix**, optional **redaction** / risk views, **compare** two runs. |
| **Datasets** | `/datasets` | **Register** server-side paths, **preview** documents, **compose** / **transform** / **LLM generate**, training **export**; **upload** JSONL when configured. |
| **Dictionaries** | `/dictionaries` | Upload and manage **whitelist** and **blacklist** term lists used by pipes. |
| **Deploy** | `/deploy` | Edit **inference modes** and **pipeline allowlist** (who `POST /process/{mode}` may hit when scoped). |
| **Audit** | `/audit` | Search and open **local** audit log records; optional **production** log proxy for operators. |

### Production UI — `frontend-production/` (inference)

For day-to-day reviewers and batch consumers **without** admin credentials. Datasets in this app are **browser-local** (IndexedDB) unless you add server features separately.

| Area | Route | What you can do there |
|------|--------|------------------------|
| **Library** | `/library` | Create, rename, duplicate, and delete **local** datasets; open the workspace or **export** flow; filter by completion. |
| **Workspace** | `/datasets/:id/files` | **File list** for the active dataset, **document reviewer** (highlights, edits), **batch detection** using a **deploy mode**, keyboard shortcuts, run progress. |
| **Export** | `/datasets/:id/export` | Download results (**redacted**, **annotated**, or **surrogate + annotated**). |
| **Audit** | `/audit` | Read-only audit trail (as allowed for the inference key). |

**Not available** with a typical inference key: create/edit **named pipelines** on the server, **register** server **datasets**, change **deploy** or **dictionaries** — use the Playground (admin) for those.

## Run the API

```bash
clinical-deid serve
# or: clinical-deid-api
# or: uvicorn clinical_deid.api.app:app --reload
```

Default SQLite database: `./data/app.sqlite` (audit log only). Override with `CLINICAL_DEID_DATABASE_URL`.

### HTTP API

**Full reference:** [docs/api.md](docs/api.md) (all routes, request bodies, and auth). **Interactive OpenAPI** (`/docs`, `/openapi.json`) is available when API keys are disabled. The API covers: health, pipeline CRUD and validation, per-pipe config helpers, `POST /process/{pipeline|mode}` and batch, eval runs and comparison, dataset registry and transforms, dictionaries, deploy config, audit, and model registry.

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

Save as `data/pipelines/my-pipeline.json` or create from **Playground → Create**.

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

