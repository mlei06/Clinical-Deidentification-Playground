# HTTP API reference

The FastAPI app is `clinical_deid.api.app:app`.

```bash
clinical-deid-api
# or: uvicorn clinical_deid.api.app:app --reload --host 127.0.0.1 --port 8000
```

Default base URL: `http://127.0.0.1:8000`.

## Security and documentation

- **Optional API keys** — When `CLINICAL_DEID_ADMIN_API_KEYS` and `CLINICAL_DEID_INFERENCE_API_KEYS` are both empty, the API accepts unauthenticated requests (local dev). When either list is set, send `Authorization: Bearer <key>` or `X-API-Key: <key>`. Scopes and route policy: [Configuration — Authentication](configuration.md#authentication).
- **OpenAPI** — `/docs`, `/redoc`, and `/openapi.json` are available when auth is **off**; they are **removed** when auth is **on** (no anonymous schema).
- **CORS** — `CLINICAL_DEID_CORS_ORIGINS` (JSON array). Defaults allow local Playground origins.
- **Body size** — Requests with `Content-Length` above `CLINICAL_DEID_MAX_BODY_BYTES` receive `413` before handlers run. Chunked requests without `Content-Length` are not capped by this middleware.

Do not expose the service to the public internet without TLS, auth, and rate limiting at the edge.

---

## Health

### `GET /health`

Liveness. Always unauthenticated.

**Response:** `{"status": "ok"}`

---

## Pipelines

Base path: `/pipelines`. Pipelines are **named JSON files** on disk (`data/pipelines/{name}.json`), not versioned rows in a database.

When auth is on, **admin** keys are required for all routes below except **`POST /pipelines/pipe-types/{name}/labels`**, which accepts **admin or inference** keys (label-space compute only).

### `GET /pipelines/pipe-types`

Pipe catalog: install status, roles, JSON Schema (+ `ui_*` hints).

### `GET /pipelines/pipe-types/{name}/label-space-bundle`

Per-detector label bundle (bundle-mode detectors: Presidio, NeuroNER, Hugging Face, etc.).

### `POST /pipelines/pipe-types/{name}/labels`

Compute label list for a detector given optional JSON config body.

### `GET /pipelines/ner/builtins`

Built-in regex labels and whitelist dictionary labels.

### `POST /pipelines/whitelist/parse-lists` / `POST /pipelines/blacklist/parse-wordlists`

Multipart helpers for the pipeline builder (admin).

### `POST /pipelines`

Create pipeline (writes `data/pipelines/{name}.json`).

### `GET /pipelines`

List all pipelines (name + full config).

### `GET /pipelines/{pipeline_name}`

Load one pipeline config.

### `PUT /pipelines/{pipeline_name}` / `DELETE /pipelines/{pipeline_name}`

Update or delete pipeline file.

### `POST /pipelines/{pipeline_name}/validate`

Validate config (optional body overrides file).

---

## Process (inference)

Base path: `/process`. **`inference`-scoped** keys may call these routes; **`admin`** keys always can. For **`inference`** callers, the resolved pipeline name must appear on the deploy **allowlist** in `data/modes.json` when `allowed_pipelines` is set; **admin** bypasses the allowlist.

`{pipeline_name}` may be a **saved pipeline name** or a **mode alias** from `data/modes.json` (e.g. `fast`).

Query parameters on run endpoints include:

- `output_mode` — `annotated` | `redacted` | `surrogate` (default `redacted`). Pipelines produce **spans**; redaction/surrogate text is applied in the API from those spans (surrogate needs Faker / `[scripts]` extra).
- `trace` — `true` to include intermediary trace frames when the pipeline supports it.

### `POST /process/redact`

Apply redaction or surrogate given **final** spans (e.g. after human edit). Body: `text`, `spans`, `output_mode`, optional surrogate seed flags.

### `POST /process/scrub`

Zero-config cleaning: uses `default_mode` from deploy config (or body override) to pick a pipeline, then runs with `output_mode`.

### `POST /process/{pipeline_name}`

Run one document through the pipeline.

**Optional surrogate alignment:** set `include_surrogate_spans: true` together
with `?output_mode=surrogate` to receive a parallel `surrogate_text` and
`surrogate_spans` list whose character offsets point into the surrogate text.
`surrogate_seed` enables deterministic replacement.

### `POST /process/{pipeline_name}/batch`

Batch variant; body lists `items` with `text` and optional `request_id`.

---

## Inference snapshots (admin)

Base path: `/inference`. Saved runs under `data/inference_runs/` — list, get, save, delete (admin only when auth is on).

---

## Evaluation (admin)

Base path: `/eval` — `POST /eval/run`, list/detail/compare runs (admin when auth is on).

---

## Datasets (admin)

Base path: `/datasets` — register, browse, compose, transform, generate, export (see inline routes in OpenAPI or source).

### `POST /datasets/ingest-from-pipeline`

Run a saved pipeline over raw inputs under `CORPORA_DIR` and register the
annotated output as a new dataset.

```json
{
  "source_path": "raw_txts",
  "pipeline_name": "fast",
  "output_name": "raw_txts_fast_silver"
}
```

- `source_path` is resolved **relative to `CORPORA_DIR`** (absolute paths must
  still resolve under it); `..` escapes are rejected with 400.
- `pipeline_name` must be a saved pipeline (`GET /pipelines`).
- `output_name` must not already exist.

### `POST /datasets/{name}/export`

Export formats: `conll`, `spacy`, `huggingface`, `jsonl` (annotated), or `brat`.
The `jsonl` form writes an annotated JSONL that can be re-registered via
`POST /datasets` (`format: "jsonl"`).

Pass `"target_text": "surrogate"` (plus an optional `"surrogate_seed"`) to
project every document through surrogate alignment before writing — both text
and spans reflect the replacement. Overlapping spans are rejected with 422.

---

## Dictionaries (admin)

Base path: `/dictionaries` — list, preview, terms, upload, delete.

---

## Models (admin)

Base path: `/models` — list, detail, `POST /models/refresh` to rescan `models/`.

---

## Deploy

Base path: `/deploy`.

- `GET /deploy` — Full deploy config (modes, allowlist). **Admin.**
- `PUT /deploy` — Write `data/modes.json`. **Admin.**
- `GET /deploy/health` — Per-mode availability (missing deps, missing pipeline file). **Admin or inference.**
- `GET /deploy/pipelines` — Saved pipeline names for dropdowns. **Admin.**

---

## Audit

Base path: `/audit`. **Admin or inference** for log reads.

- `GET /audit/logs`, `GET /audit/logs/{id}`, `GET /audit/stats`

Records carry a `source` field distinguishing callers: `api-admin` (admin-scoped HTTP), `api-inference` (inference-scoped HTTP), or `cli`.

---

## Request limits

| Limit | Typical value | Notes |
|-------|----------------|------|
| Text length | 500,000 characters | `ProcessRequest` / batch items (`schemas.py`) |
| Batch size | 100 items | `MAX_BATCH_SIZE` in `schemas.py` |
| Dictionary / list upload | 2 MB per file | Pipeline helper uploads |
| HTTP body | `CLINICAL_DEID_MAX_BODY_BYTES` (default 10 MiB) | Middleware `Content-Length` check |
| Ingest documents | `max_documents` (default 10,000, max 1,000,000) | `IngestFromPipelineRequest` cap for `/datasets/ingest-from-pipeline` |

---

## Database

SQLite (default `./data/app.sqlite`) holds **only** the append-only **`audit_log`** table. Pipelines, eval results, and models live on the filesystem. Override with `CLINICAL_DEID_DATABASE_URL`.
