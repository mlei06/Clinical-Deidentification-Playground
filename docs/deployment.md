# Deployment (single API)

One FastAPI application serves the Playground, automation, and the Production UI. There is no separate `clinical-deid-production` binary.

## Topology

- **API:** `clinical-deid-api` → `uvicorn clinical_deid.api.app:app` (see root `Dockerfile` and `compose.yaml`).
- **Playground UI** (`frontend/`) and **Production UI** (`frontend-production/`) are static SPAs. They call the API using `VITE_API_BASE_URL` and optional `VITE_API_KEY` (see each app’s `.env.example`).
- **Mutable config after deploy:** Pipeline definitions (`CLINICAL_DEID_PIPELINES_DIR`, default `data/pipelines`) and deploy/mode mapping (`CLINICAL_DEID_MODES_PATH`, default `data/modes.json`) are **meant to change in production** without rebuilding the image. Operators can use the full **admin** Playground UI (pipeline builder, **Deploy** view) or **edit the JSON files on the instance** (bind-mount or volume). The API re-reads `modes.json` on each request that needs it; pipeline JSON is read from disk per request when loading a pipeline.
- **Two volumes** — everything mutable lives under `./data` (pipelines, modes, evaluations, inference runs, corpora, dictionaries, SQLite audit log); model weights live under `./models` and are read-only at runtime. This is the full mount story — see `compose.yaml`:
    - `./data:/app/data` (read-write)
    - `./models:/app/models:ro`
- **NeuroNER:** Optional HTTP sidecar (`neuroner-cspmc/sidecar/`); set `CLINICAL_DEID_NEURONER_HTTP_URL`.

## Authentication

When `CLINICAL_DEID_ADMIN_API_KEYS` and `CLINICAL_DEID_INFERENCE_API_KEYS` are both empty, auth is **off** (local dev). When either list is non-empty, clients must send `Authorization: Bearer <key>` or `X-API-Key: <key>`.

Scopes are documented in [Configuration — Authentication](configuration.md#authentication). Inference keys are limited to `/process/*`, label-space compute, `GET /deploy/health`, and audit reads; admin keys have full access.

OpenAPI (`/docs`, `/redoc`, `/openapi.json`) is **disabled** for anonymous clients when auth is enabled.

## Hardening

- **`CLINICAL_DEID_MAX_BODY_BYTES`** — rejects oversized `Content-Length` with `413` (see [Configuration](configuration.md#request-body-limits)).
- **Rate limits and TLS** — use your reverse proxy or load balancer (recommended), not only the app.

## Smoke test

See [staging-smoke.md](staging-smoke.md) for a manual checklist after deploy.
