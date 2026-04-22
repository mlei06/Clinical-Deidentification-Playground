# Data Directory

Workspace for **raw corpora, transformed datasets, and training exports** that feed **local model training** and offline evaluation. It complements the HTTP API: ingest and analytics are available via **Python APIs and CLI scripts** documented in the root [README](../README.md).

All contents are git-ignored except `.gitkeep` placeholders.

```
data/
  raw/                  Unprocessed source files before ingestion
  corpora/              **Single root for corpus bytes** (see CLINICAL_DEID_CORPORA_DIR)
                        — BRAT trees, JSONL, outputs from API/CLI transform · compose · LLM generate,
                        and `{dataset}_export/` folders from dataset export (CoNLL, spaCy, HF, BRAT)
    physionet/brat/     Example: train/valid/test .txt/.ann
    physionet/jsonl/    Example: optional parallel JSONL copy
  evaluations/          Optional: offline copies of eval artifacts (eval JSON also under repo evaluations/)
```

`corpora/` matches **Settings.corpora_dir** (`data/corpora` by default). Each registered dataset is a subdirectory ``<corpora_dir>/<name>/`` containing ``dataset.json`` (analytics + metadata) and the corpus (typically ``corpus.jsonl`` or BRAT files). Registration **copies** from the path you supply into that layout. API export still writes ``<corpora_dir>/<dataset>_export/`` next to dataset dirs.

| Directory | Purpose | Typical commands |
|-----------|---------|-----------------|
| `raw/` | Drop source files before ingestion | `scripts/process_*.py` |
| `corpora/` | All corpus files + materialized exports (incl. `POST /datasets/generate` LLM output) | `scripts/transform_dataset.py`, `clinical-deid dataset register`, `POST /datasets/transform`, `POST /datasets/generate`, `dataset export` |
| `evaluations/` | Optional local mirror of eval runs | `clinical-deid eval`, `POST /eval/run` (default eval JSON is under top-level `evaluations/`) |
