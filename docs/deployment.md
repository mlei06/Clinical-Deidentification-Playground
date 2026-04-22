# Deployment (single API)

One FastAPI application serves the Playground, automation, and the Production UI. There is no separate `clinical-deid-production` binary.

## Topology

- **API:** `clinical-deid-api` → `uvicorn clinical_deid.api.app:app` (see root `Dockerfile` and `compose.yaml`).
- **Playground UI** (`frontend/`) and **Production UI** (`frontend-production/`) are static SPAs. They call the API using `VITE_API_BASE_URL` and optional `VITE_API_KEY` (see each app’s `.env.example`).
- **Volumes:** Mount persistent directories for `pipelines/`, `modes.json` (writable if you use `PUT /deploy` from the Playground), `data/dictionaries/`, `datasets/`, `models/`, and the SQLite path behind `CLINICAL_DEID_DATABASE_URL` (default under `var/` in the container).
- **NeuroNER:** Optional HTTP sidecar (`docker/neuroner/`); set `CLINICAL_DEID_NEURONER_HTTP_URL`.

## Authentication

When `CLINICAL_DEID_ADMIN_API_KEYS` and `CLINICAL_DEID_INFERENCE_API_KEYS` are both empty, auth is **off** (local dev). When either list is non-empty, clients must send `Authorization: Bearer <key>` or `X-API-Key: <key>`.

Scopes are documented in [Configuration — Authentication](configuration.md#authentication). Inference keys are limited to `/process/*`, label-space compute, `GET /deploy/health`, and audit reads; admin keys have full access.

OpenAPI (`/docs`, `/redoc`, `/openapi.json`) is **disabled** for anonymous clients when auth is enabled.

## Hardening

- **`CLINICAL_DEID_MAX_BODY_BYTES`** — rejects oversized `Content-Length` with `413` (see [Configuration](configuration.md#request-body-limits)).
- **Rate limits and TLS** — use your reverse proxy or load balancer (recommended), not only the app.

## Smoke test

See [staging-smoke.md](staging-smoke.md) for a manual checklist after deploy.
