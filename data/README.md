# Data Directory

All **mutable runtime state** for the API lives here — a deployment bind-mounts
this single directory (`./data:/app/data`) plus a read-only `./models:/app/models`
for weights. See [docs/deployment.md](../docs/deployment.md).

Most contents are git-ignored except `.gitkeep` placeholders and the seed
`pipelines/*.json` + `modes.json` files that the repo ships.

```
data/
  pipelines/            Named pipeline JSON configs  (CLINICAL_DEID_PIPELINES_DIR)
                        — seed files are tracked; operator edits via Playground
                          admin UI or on disk
  modes.json            Deploy config: mode aliases, allowlist, production URL
                        (CLINICAL_DEID_MODES_PATH; mutable via PUT /deploy)
  evaluations/          Eval result JSON            (CLINICAL_DEID_EVALUATIONS_DIR)
  inference_runs/       Saved batch inference runs  (CLINICAL_DEID_INFERENCE_RUNS_DIR)
  app.sqlite            Audit log (SQLite)          (CLINICAL_DEID_DATABASE_URL)
  corpora/              Registered datasets          (CLINICAL_DEID_CORPORA_DIR)
                        — each dataset is ``<name>/dataset.json`` + corpus
                          (``corpus.jsonl`` or BRAT). Training exports land in
                          ``<name>_export/`` next to dataset dirs.
    physionet/brat/     Example: train/valid/test .txt/.ann
    physionet/jsonl/    Example: optional parallel JSONL copy
  dictionaries/         Whitelist / blacklist term lists (CLINICAL_DEID_DICTIONARIES_DIR)
  raw/                  Unprocessed source files before ingestion
```

| Directory / file | Purpose | Typical commands |
|------------------|---------|-----------------|
| `pipelines/` | Pipeline configs | Playground builder; `POST`/`PUT`/`DELETE /pipelines` |
| `modes.json` | Deploy mapping | Playground Deploy view; `GET`/`PUT /deploy` |
| `evaluations/` | Eval results | `clinical-deid eval`, `POST /eval/run` |
| `inference_runs/` | Batch inference snapshots | `clinical-deid batch`, `POST /process/*` |
| `app.sqlite` | Audit log | Written by `log_run()` on every run |
| `corpora/` | All corpus files + materialized exports | `clinical-deid dataset register`, `POST /datasets/*` |
| `dictionaries/` | Whitelist / blacklist term lists | `clinical-deid dict import`, `POST /dictionaries` |
| `raw/` | Drop source files before ingestion | `scripts/process_*.py` |
