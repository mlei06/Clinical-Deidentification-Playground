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

---

## Dictionaries (admin)

Base path: `/dictionaries` — list, preview, terms, upload, delete.

---

## Models (admin)

Base path: `/models` — list, detail, `POST /models/refresh` to rescan `models/`.

---

## Deploy

Base path: `/deploy`.

- `GET /deploy` — Full deploy config (modes, allowlist, `production_api_url`). **Admin.**
- `PUT /deploy` — Write `data/modes.json`. **Admin.**
- `GET /deploy/health` — Per-mode availability (missing deps, missing pipeline file). **Admin or inference.**
- `GET /deploy/pipelines` — Saved pipeline names for dropdowns. **Admin.**

---

## Audit

Base path: `/audit`. **Admin or inference** for local log reads.

- `GET /audit/logs`, `GET /audit/logs/{id}`, `GET /audit/stats`

### Production proxy (admin)

When `production_api_url` is set in `data/modes.json`:

- `GET /audit/production/logs`, `GET /audit/production/logs/{id}`, `GET /audit/production/stats`

These forward to the remote API’s audit endpoints (Playground ops).

---

## Request limits

| Limit | Typical value | Notes |
|-------|----------------|------|
| Text length | 500,000 characters | `ProcessRequest` / batch items (`schemas.py`) |
| Batch size | 100 items | `MAX_BATCH_SIZE` in `schemas.py` |
| Dictionary / list upload | 2 MB per file | Pipeline helper uploads |
| HTTP body | `CLINICAL_DEID_MAX_BODY_BYTES` (default 10 MiB) | Middleware `Content-Length` check |

---

## Database

SQLite (default `./data/app.sqlite`) holds **only** the append-only **`audit_log`** table. Pipelines, eval results, and models live on the filesystem. Override with `CLINICAL_DEID_DATABASE_URL`.
